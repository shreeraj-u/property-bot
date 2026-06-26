require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabaseOptions = {};
if (typeof globalThis.WebSocket === 'undefined') {
  supabaseOptions.realtime = { transport: require('ws') };
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  supabaseOptions
);

let twilioClient;
function getTwilioClient() {
  if (!twilioClient) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

function sanitizeFilterValue(value) {
  return String(value || '').replace(/[%_,().]/g, '').trim();
}

function monthBounds(month) {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = targetMonth.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  return {
    start: `${targetMonth}-01`,
    end: `${targetMonth}-${String(lastDay).padStart(2, '0')}`,
  };
}

async function identifySender(phoneNumber) {
  const isManager = phoneNumber === process.env.MANAGER_PHONE;
  if (isManager) {
    return { tenant: null, isManager: true };
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select(`
      *,
      units!tenants_unit_id_fkey(*),
      leases(*)
    `)
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  return { tenant, isManager: false };
}

function isManagerPhone(phoneNumber) {
  return phoneNumber === process.env.MANAGER_PHONE;
}

async function findTenantByIdentifier(identifier) {
  const safe = sanitizeFilterValue(identifier);
  if (!safe) return { data: null, error: new Error('Invalid identifier') };

  const select =
    'id, full_name, phone_number, unit_id, units!tenants_unit_id_fkey(unit_number)';

  if (safe.startsWith('+')) {
    const { data, error } = await supabase
      .from('tenants')
      .select(select)
      .eq('phone_number', safe)
      .maybeSingle();
    return { data, error };
  }

  const { data: unit } = await supabase
    .from('units')
    .select('id')
    .eq('unit_number', safe)
    .maybeSingle();

  if (unit) {
    const { data, error } = await supabase
      .from('tenants')
      .select(select)
      .eq('unit_id', unit.id)
      .maybeSingle();
    return { data, error };
  }

  const { data: matches, error } = await supabase
    .from('tenants')
    .select(select)
    .ilike('full_name', `%${safe}%`)
    .limit(1);

  return { data: matches?.[0] || null, error };
}

async function getTenantMonthlyPayment(identifier, month) {
  const { data: tenant, error } = await findTenantByIdentifier(identifier);
  if (error) return { data: null, error };
  if (!tenant) return { data: null, error: new Error('Tenant not found') };

  const { start, end } = monthBounds(month);
  const { data: payment, error: payError } = await supabase
    .from('rent_payments')
    .select('amount_paid, due_date, paid_date, status')
    .eq('tenant_id', tenant.id)
    .gte('due_date', start)
    .lte('due_date', end)
    .maybeSingle();

  return { data: { tenant, payment }, error: payError };
}

async function getTenantNextPaymentSummary(identifier) {
  const { data: tenant, error } = await findTenantByIdentifier(identifier);
  if (error) return { data: null, error };
  if (!tenant) return { data: null, error: new Error('Tenant not found') };

  const { data: payments, error: payError } = await supabase
    .from('rent_payments')
    .select('amount_paid, due_date, paid_date, status')
    .eq('tenant_id', tenant.id)
    .order('due_date', { ascending: true })
    .limit(6);

  if (payError) return { data: null, error: payError };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const unpaid = (payments || []).filter((p) => p.status !== 'paid');
  const payment =
    unpaid.find((p) => new Date(p.due_date) >= today) ||
    unpaid[0] ||
    (payments || []).find((p) => new Date(p.due_date) >= today);

  return { data: { tenant, payment }, error: null };
}

async function getRentStatus(month, statusFilter) {
  const { start, end } = monthBounds(month);

  let query = supabase
    .from('rent_payments')
    .select(`
      id,
      tenant_id,
      lease_id,
      amount_paid,
      due_date,
      paid_date,
      status,
      tenants(full_name, phone_number, units!tenants_unit_id_fkey(unit_number))
    `)
    .gte('due_date', start)
    .lte('due_date', end)
    .order('due_date');

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  return { data, error };
}

async function getExpiringLeases(daysAhead = 60) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const future = new Date(today);
  future.setDate(future.getDate() + daysAhead);

  const { data, error } = await supabase
    .from('leases')
    .select(`
      id,
      tenant_id,
      unit_id,
      start_date,
      end_date,
      monthly_rent,
      status,
      tenants(full_name, phone_number),
      units!leases_unit_id_fkey(unit_number)
    `)
    .eq('status', 'active')
    .gte('end_date', today.toISOString().slice(0, 10))
    .lte('end_date', future.toISOString().slice(0, 10))
    .order('end_date');

  if (error) return { data: null, error };

  const enriched = (data || []).map((lease) => {
    const endDate = new Date(lease.end_date);
    endDate.setHours(0, 0, 0, 0);
    const daysUntilExpiry = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    return {
      ...lease,
      days_until_expiry: daysUntilExpiry,
      full_name: lease.tenants?.full_name,
      unit_number: lease.units?.unit_number,
      lease_end_date: lease.end_date,
    };
  });

  return { data: enriched, error: null };
}

async function getTenantProfile(identifier) {
  const { data: tenant, error } = await findTenantByIdentifier(identifier);
  if (error || !tenant) return { data: tenant, error };

  const [{ data: leases }, { data: payments }] = await Promise.all([
    supabase
      .from('leases')
      .select('id, start_date, end_date, monthly_rent, deposit_amount, status, renewal_offered')
      .eq('tenant_id', tenant.id)
      .order('end_date', { ascending: false })
      .limit(2),
    supabase
      .from('rent_payments')
      .select('amount_paid, due_date, paid_date, status')
      .eq('tenant_id', tenant.id)
      .order('due_date', { ascending: false })
      .limit(3),
  ]);

  return {
    data: {
      ...tenant,
      leases: leases || [],
      rent_payments: payments || [],
    },
    error: null,
  };
}

async function getLeaseDocument(tenantNameOrUnit) {
  const safe = sanitizeFilterValue(tenantNameOrUnit);
  if (!safe) return { url: null, error: new Error('Invalid identifier') };

  const { data: byUnit } = await supabase
    .from('units')
    .select('id, unit_number')
    .eq('unit_number', safe)
    .maybeSingle();

  let leaseQuery = supabase
    .from('leases')
    .select(`
      document_path,
      tenant_id,
      tenants(full_name),
      units!leases_unit_id_fkey(unit_number)
    `)
    .eq('status', 'active');

  if (byUnit) {
    leaseQuery = leaseQuery.eq('unit_id', byUnit.id);
  } else {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, full_name')
      .ilike('full_name', `%${safe}%`)
      .limit(1);

    if (!tenants?.length) return { url: null, tenantName: null };
    leaseQuery = leaseQuery.eq('tenant_id', tenants[0].id);
  }

  const { data, error } = await leaseQuery.maybeSingle();
  if (error || !data?.document_path) {
    return { url: null, tenantName: data?.tenants?.full_name || null, error };
  }

  const { data: signedUrl, error: signError } = await supabase.storage
    .from('lease-agreements')
    .createSignedUrl(data.document_path, 3600);

  if (signError) {
    return { url: null, tenantName: data.tenants?.full_name, error: signError };
  }

  return { url: signedUrl?.signedUrl, tenantName: data.tenants?.full_name };
}

async function getActiveLease(tenantId) {
  const { data, error } = await supabase
    .from('leases')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .maybeSingle();

  return { data, error };
}

async function getMyPaymentStatus(tenantId, month) {
  const { start, end } = monthBounds(month);

  const { data, error } = await supabase
    .from('rent_payments')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('due_date', start)
    .lte('due_date', end)
    .maybeSingle();

  return { data, error };
}

async function fileComplaint(tenantId, unitId, category, description) {
  const { data, error } = await supabase
    .from('complaints')
    .insert({
      tenant_id: tenantId,
      unit_id: unitId,
      category,
      description,
      source: 'whatsapp',
      status: 'open',
    })
    .select()
    .single();

  return { data, error };
}

async function listOpenComplaints() {
  const { data, error } = await supabase
    .from('complaints')
    .select(`
      id,
      category,
      description,
      status,
      created_at,
      tenants(full_name, phone_number),
      units!complaints_unit_id_fkey(unit_number)
    `)
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false });

  return { data, error };
}

async function getSession(phoneNumber) {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  return data;
}

async function saveSession(phoneNumber, flow, sessionData) {
  const { error } = await supabase.from('whatsapp_sessions').upsert(
    {
      phone_number: phoneNumber,
      current_flow: flow,
      session_data: sessionData,
      last_active: new Date().toISOString(),
    },
    { onConflict: 'phone_number' }
  );

  return { error };
}

async function clearSession(phoneNumber) {
  const { error } = await supabase
    .from('whatsapp_sessions')
    .delete()
    .eq('phone_number', phoneNumber);

  return { error };
}

async function notifyManager(message) {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const managerPhone = process.env.MANAGER_PHONE;

  if (!from || !managerPhone) {
    console.warn('notifyManager skipped: TWILIO_WHATSAPP_FROM or MANAGER_PHONE not set');
    return { error: new Error('Missing Twilio WhatsApp configuration') };
  }

  const to = managerPhone.startsWith('whatsapp:')
    ? managerPhone
    : `whatsapp:${managerPhone}`;

  try {
    await getTwilioClient().messages.create({
      from,
      to,
      body: message,
    });
    return { error: null };
  } catch (error) {
    console.error('notifyManager failed:', error.message);
    return { error };
  }
}

module.exports = {
  supabase,
  identifySender,
  isManagerPhone,
  findTenantByIdentifier,
  getTenantMonthlyPayment,
  getTenantNextPaymentSummary,
  getRentStatus,
  getExpiringLeases,
  getTenantProfile,
  getLeaseDocument,
  getActiveLease,
  getMyPaymentStatus,
  fileComplaint,
  listOpenComplaints,
  getSession,
  saveSession,
  clearSession,
  notifyManager,
  monthBounds,
  sanitizeFilterValue,
};
