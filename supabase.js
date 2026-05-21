// supabase.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseOptions = {};
if (typeof globalThis.WebSocket === 'undefined') {
  supabaseOptions.realtime = { transport: require('ws') };
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  supabaseOptions
);

// Identify who is messaging by their phone number
async function identifySender(phoneNumber) {
  const { data: tenant } = await supabase
    .from('tenants')
    .select(`
      *,
      units!tenants_unit_id_fkey(*),
      leases(*)
    `)
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  const isManager = phoneNumber === process.env.MANAGER_PHONE;

  return { tenant, isManager };
}

// ── Manager queries ──────────────────────────────────────

async function getRentStatus(month, statusFilter) {
  let query = supabase
    .from('current_month_payments') // uses the view you created
    .select('*');

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;
  return { data, error };
}

async function getExpiringLeases(daysAhead = 60) {
  const { data, error } = await supabase
    .from('unit_overview')
    .select('*')
    .lte('days_until_expiry', daysAhead)
    .gte('days_until_expiry', 0)
    .order('days_until_expiry');

  return { data, error };
}

async function getTenantProfile(identifier) {
  const { data, error } = await supabase
    .from('tenants')
    .select(`
      *,
      units!tenants_unit_id_fkey(*),
      leases(*),
      rent_payments(*)
    `)
    .or(`full_name.ilike.%${identifier}%,phone_number.eq.${identifier}`)
    .single();

  return { data, error };
}

async function getLeaseDocument(tenantNameOrUnit) {
  const { data, error } = await supabase
    .from('leases')
    .select(`
      document_path,
      tenants(full_name),
      units(unit_number)
    `)
    .eq('status', 'active')
    .or(`units.unit_number.eq.${tenantNameOrUnit},tenants.full_name.ilike.%${tenantNameOrUnit}%`)
    .single();

  if (error || !data?.document_path) return { url: null };

  // Generate a signed URL valid for 1 hour
  const { data: signedUrl } = await supabase.storage
    .from('lease-agreements')
    .createSignedUrl(data.document_path, 3600);

  return { url: signedUrl?.signedUrl, tenantName: data.tenants?.full_name };
}

// ── Tenant queries ───────────────────────────────────────

async function getMyPaymentStatus(tenantId, month) {
  const targetMonth = month || new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  const { data, error } = await supabase
    .from('rent_payments')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('due_date', `${targetMonth}-01`)
    .lte('due_date', `${targetMonth}-31`)
    .single();

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
    })
    .select()
    .single();

  return { data, error };
}

// ── Session management ───────────────────────────────────

async function getSession(phoneNumber) {
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('*')
    .eq('phone_number', phoneNumber)
    .single();

  return data;
}

async function saveSession(phoneNumber, flow, sessionData) {
  await supabase.from('whatsapp_sessions').upsert({
    phone_number: phoneNumber,
    current_flow: flow,
    session_data: sessionData,
    last_active: new Date().toISOString(),
  });
}

module.exports = {
  identifySender,
  getRentStatus,
  getExpiringLeases,
  getTenantProfile,
  getLeaseDocument,
  getMyPaymentStatus,
  fileComplaint,
  getSession,
  saveSession,
};
