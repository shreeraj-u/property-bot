require('dotenv').config();
const dns = require('dns');
const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

// Avoid IPv6 resolution issues on Railway/container hosts
dns.setDefaultResultOrder('ipv4first');

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(10000),
      });
    } catch (error) {
      lastError = error;
      console.warn(`Supabase fetch attempt ${attempt}/${retries} failed:`, error.message);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
  }

  throw lastError;
}

const supabaseOptions = {
  global: { fetch: fetchWithRetry },
};
if (typeof globalThis.WebSocket === 'undefined') {
  supabaseOptions.realtime = { transport: require('ws') };
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }

  if (!url.startsWith('https://')) {
    throw new Error('SUPABASE_URL must start with https://');
  }

  return { url, key };
}

const { url: supabaseUrl, key: supabaseKey } = getSupabaseConfig();
const supabase = createClient(supabaseUrl, supabaseKey, supabaseOptions);

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

function parseUnitNumber(unitNumber) {
  if (!unitNumber) return null;
  const match = String(unitNumber).toUpperCase().match(/^([A-C])-(\d{2})-(\d)$/);
  if (!match) return { unit_number: unitNumber };
  return {
    block: match[1],
    floor: Number(match[2]),
    unit_number: unitNumber.toUpperCase(),
  };
}

function getUnitFromRecord(record) {
  return record?.units || record?.tenants?.units || record;
}

function getUnitNumber(record) {
  const unit = getUnitFromRecord(record);
  return unit?.unit_number || record?.unit_number || null;
}

function matchesTenantName(name, filterName) {
  if (!filterName) return true;
  return (name || '').toLowerCase().includes(filterName.toLowerCase());
}

function matchesUnitFilters(record, filters = {}) {
  const unit = getUnitFromRecord(record);
  const unitNumber = getUnitNumber(record);
  const parsed = parseUnitNumber(unitNumber);

  if (filters.unit_number && unitNumber !== filters.unit_number) return false;

  if (filters.block) {
    const block = unit?.block || parsed?.block;
    if (block !== filters.block) return false;
  }

  if (filters.floor != null) {
    const floor = unit?.floor ?? parsed?.floor;
    if (Number(floor) !== Number(filters.floor)) return false;
  }

  if (filters.unit_type && unit?.unit_type !== filters.unit_type) return false;

  const rentAmount =
    record?.amount_paid ??
    record?.monthly_rent ??
    record?.monthly_rent_price ??
    unit?.monthly_rent_price;

  if (filters.min_rent != null && Number(rentAmount) < filters.min_rent) return false;
  if (filters.max_rent != null && Number(rentAmount) > filters.max_rent) return false;

  return true;
}

function applyRecordFilters(records, filters = {}, nameAccessor) {
  return (records || []).filter((record) => {
    const name =
      typeof nameAccessor === 'function'
        ? nameAccessor(record)
        : record?.tenants?.full_name || record?.full_name;

    if (filters.tenant_name && !matchesTenantName(name, filters.tenant_name)) {
      return false;
    }

    if (filters.phone) {
      const phone = record?.tenants?.phone_number || record?.phone_number;
      if (phone !== filters.phone) return false;
    }

    return matchesUnitFilters(record, filters);
  });
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
    'id, full_name, phone_number, email, unit_id, units!tenants_unit_id_fkey(unit_number, block, floor, unit_type, monthly_rent_price, status)';

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

async function getRentStatus(filters = {}) {
  const month = filters.month || new Date().toISOString().slice(0, 7);
  const statusFilter = filters.status || 'all';
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
      tenants(full_name, phone_number, units!tenants_unit_id_fkey(unit_number, block, floor, unit_type, monthly_rent_price))
    `)
    .gte('due_date', start)
    .lte('due_date', end)
    .order('due_date');

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  if (error) return { data: null, error, month };

  const filtered = applyRecordFilters(data, filters);
  return { data: filtered, error: null, month };
}

async function getExpiringLeases(filters = {}) {
  const daysAhead = filters.days || 60;
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
      deposit_amount,
      status,
      renewal_offered,
      tenants(full_name, phone_number),
      units!leases_unit_id_fkey(unit_number, block, floor, unit_type, monthly_rent_price)
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

  const filtered = applyRecordFilters(enriched, filters);
  return { data: filtered, error: null };
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

async function listOpenComplaints(filters = {}) {
  const statuses =
    filters.complaint_status && filters.complaint_status !== 'all'
      ? [filters.complaint_status]
      : ['open', 'in_progress'];

  let query = supabase
    .from('complaints')
    .select(`
      id,
      category,
      description,
      status,
      created_at,
      tenants(full_name, phone_number),
      units!complaints_unit_id_fkey(unit_number, block, floor, unit_type)
    `)
    .in('status', statuses)
    .order('created_at', { ascending: false });

  if (filters.category) {
    query = query.eq('category', filters.category);
  }

  const { data, error } = await query;
  if (error) return { data: null, error };

  let filtered = applyRecordFilters(data, filters);

  if (filters.days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - filters.days);
    filtered = filtered.filter((item) => new Date(item.created_at) >= cutoff);
  }

  return { data: filtered, error: null };
}

async function listVacantUnits(filters = {}) {
  let query = supabase
    .from('units')
    .select('unit_number, block, floor, unit_type, size_sqft, monthly_rent_price, status, amenities, notes')
    .eq('status', 'vacant')
    .order('unit_number');

  if (filters.block) query = query.eq('block', filters.block);
  if (filters.floor != null) query = query.eq('floor', filters.floor);
  if (filters.unit_type) query = query.eq('unit_type', filters.unit_type);
  if (filters.min_rent != null) query = query.gte('monthly_rent_price', filters.min_rent);
  if (filters.max_rent != null) query = query.lte('monthly_rent_price', filters.max_rent);

  const { data, error } = await query;
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

async function sendWhatsAppReply(phoneNumber, messages) {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) {
    console.warn('sendWhatsAppReply skipped: TWILIO_WHATSAPP_FROM not set');
    return { error: new Error('Missing TWILIO_WHATSAPP_FROM') };
  }

  const to = phoneNumber.startsWith('whatsapp:')
    ? phoneNumber
    : `whatsapp:${phoneNumber}`;
  const list = Array.isArray(messages) ? messages : [messages];

  try {
    for (const body of list) {
      if (body) {
        await getTwilioClient().messages.create({ from, to, body });
      }
    }
    return { error: null };
  } catch (error) {
    console.error('sendWhatsAppReply failed:', error.message);
    return { error };
  }
}

async function notifyManager(message) {
  if (!process.env.MANAGER_PHONE) {
    console.warn('notifyManager skipped: MANAGER_PHONE not set');
    return { error: new Error('Missing MANAGER_PHONE') };
  }

  return sendWhatsAppReply(process.env.MANAGER_PHONE, message);
}

async function checkSupabaseConnection() {
  const host = new URL(supabaseUrl).host;
  const started = Date.now();

  const { error } = await supabase.from('units').select('id').limit(1);
  const ms = Date.now() - started;

  if (error) {
    console.error(`Supabase check failed (${host}, ${ms}ms):`, error.message);
    return { ok: false, ms, error };
  }

  console.log(`Supabase connected (${host}, ${ms}ms)`);
  return { ok: true, ms };
}

function formatDbError(error) {
  if (!error) return null;
  const message = error.message || String(error);
  if (message.includes('fetch failed') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return 'Could not reach the database. Check Supabase URL/key on Railway and try again.';
  }
  return `Database error: ${message}`;
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
  listVacantUnits,
  getSession,
  saveSession,
  clearSession,
  notifyManager,
  sendWhatsAppReply,
  checkSupabaseConnection,
  formatDbError,
  monthBounds,
  sanitizeFilterValue,
  applyRecordFilters,
  parseUnitNumber,
};
