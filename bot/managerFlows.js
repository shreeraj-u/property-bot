const {
  getRentStatus,
  getExpiringLeases,
  getTenantProfile,
  getTenantMonthlyPayment,
  getTenantNextPaymentSummary,
  getLeaseDocument,
  listOpenComplaints,
} = require('../supabase');
const {
  formatRentRoll,
  formatExpiringLeases,
  formatTenantProfile,
  formatNextRentPayment,
  formatTenantMonthlyRent,
  formatComplaints,
  managerHelpMenu,
} = require('./formatters');
const { routeManagerMessage } = require('../llm');

async function executeManagerTool(tool, input) {
  switch (tool) {
    case 'rent_roll': {
      const month = input.month || new Date().toISOString().slice(0, 7);
      const status = input.status || 'all';
      const { data, error } = await getRentStatus(month, status);
      if (error) return `Could not fetch rent data: ${error.message}`;
      return formatRentRoll(data, month);
    }
    case 'expiring_leases': {
      const days = input.days || 60;
      const { data, error } = await getExpiringLeases(days);
      if (error) return `Could not fetch leases: ${error.message}`;
      return formatExpiringLeases(data);
    }
    case 'tenant_lookup': {
      if (!input.identifier) return 'Please provide a unit number or tenant name.';
      const { data, error } = await getTenantProfile(input.identifier);
      if (error) return `Lookup failed: ${error.message}`;
      if (!data) return 'Tenant not found.';
      return formatTenantProfile(data);
    }
    case 'tenant_next_payment': {
      if (!input.identifier) return 'Please provide a tenant name or unit number.';
      const { data, error } = await getTenantNextPaymentSummary(input.identifier);
      if (error) return `Lookup failed: ${error.message}`;
      return formatNextRentPayment(data);
    }
    case 'tenant_monthly_rent': {
      if (!input.identifier) return 'Please provide a tenant name or unit number.';
      const month = input.month || new Date().toISOString().slice(0, 7);
      const { data, error } = await getTenantMonthlyPayment(input.identifier, month);
      if (error) return `Lookup failed: ${error.message}`;
      if (!data?.tenant) return 'Tenant not found.';
      return formatTenantMonthlyRent(data.tenant, data.payment, month);
    }
    case 'lease_document': {
      if (!input.identifier) return 'Please provide a unit number or tenant name.';
      const { url, tenantName, error } = await getLeaseDocument(input.identifier);
      if (error && !url) return `Could not fetch lease: ${error.message}`;
      if (!url) {
        return tenantName
          ? `No lease document on file for ${tenantName}.`
          : 'Tenant or unit not found, or no lease document on file.';
      }
      return `Lease document for ${tenantName || input.identifier}:\n${url}`;
    }
    case 'open_complaints': {
      const { data, error } = await listOpenComplaints();
      if (error) return `Could not fetch complaints: ${error.message}`;
      return formatComplaints(data);
    }
    case 'help':
    default:
      return managerHelpMenu();
  }
}

async function handleManagerMessage(message) {
  const { tool, input, fallback } = await routeManagerMessage(message);
  const reply = await executeManagerTool(tool, input);

  if (fallback) {
    return `${reply}\n\n(LLM routing unavailable — showing help menu.)`;
  }

  return reply;
}

module.exports = {
  executeManagerTool,
  handleManagerMessage,
};
