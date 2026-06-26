const {
  getRentStatus,
  getExpiringLeases,
  getTenantProfile,
  getTenantMonthlyPayment,
  getTenantNextPaymentSummary,
  getLeaseDocument,
  listOpenComplaints,
  listVacantUnits,
  formatDbError,
} = require('../supabase');
const {
  formatRentRoll,
  formatRentSummary,
  formatExpiringLeases,
  formatTenantByFields,
  formatComplaints,
  formatVacantUnits,
  managerHelpMenu,
} = require('./formatters');
const { normalizeToolCall, describeFilters } = require('./toolParams');
const { routeManagerMessage } = require('../llm');

async function executeManagerTool(tool, input) {
  switch (tool) {
    case 'rent_roll': {
      const filters = input.filters || {};
      const { data, error, month } = await getRentStatus(filters);
      if (error) return formatDbError(error) || 'Could not fetch rent data.';
      return formatRentRoll(data, month, describeFilters(filters));
    }
    case 'rent_summary': {
      const filters = input.filters || {};
      const { data, error, month } = await getRentStatus(filters);
      if (error) return formatDbError(error) || 'Could not fetch rent data.';
      return formatRentSummary(data, month, filters, describeFilters(filters));
    }
    case 'expiring_leases': {
      const filters = input.filters || {};
      const { data, error } = await getExpiringLeases(filters);
      if (error) return formatDbError(error) || 'Could not fetch leases.';
      return formatExpiringLeases(data, describeFilters(filters));
    }
    case 'tenant_lookup': {
      const { identifier, filters = {} } = input;
      if (!identifier) return 'Please provide a unit number or tenant name.';

      const { data, error } = await getTenantProfile(identifier);
      if (error) return formatDbError(error) || 'Lookup failed.';
      if (!data) return 'Tenant not found.';

      const fields = filters.fields || ['profile'];
      const extras = { month: filters.month };

      if (fields.includes('next_payment')) {
        const next = await getTenantNextPaymentSummary(identifier);
        if (next.error) return formatDbError(next.error) || 'Lookup failed.';
        extras.nextPayment = next.data?.payment;
      }

      if (fields.includes('current_rent')) {
        const monthly = await getTenantMonthlyPayment(identifier, filters.month);
        if (monthly.error) return formatDbError(monthly.error) || 'Lookup failed.';
        extras.currentPayment = monthly.data?.payment;
      }

      return formatTenantByFields(data, fields, extras);
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
      const filters = input.filters || {};
      const { data, error } = await listOpenComplaints(filters);
      if (error) return formatDbError(error) || 'Could not fetch complaints.';
      return formatComplaints(data, describeFilters(filters));
    }
    case 'vacant_units': {
      const filters = input.filters || {};
      const { data, error } = await listVacantUnits(filters);
      if (error) return formatDbError(error) || 'Could not fetch vacant units.';
      return formatVacantUnits(data, describeFilters(filters));
    }
    case 'help':
    default:
      return managerHelpMenu();
  }
}

async function handleManagerMessage(message) {
  const { tool, input, fallback } = await routeManagerMessage(message);
  const normalized = normalizeToolCall(tool, input);

  console.log(
    `Manager route: tool=${normalized.tool} input=${JSON.stringify(normalized.input)}` +
      (fallback ? ' (fallback)' : '')
  );

  const reply = await executeManagerTool(normalized.tool, normalized.input);

  if (fallback) {
    return `${reply}\n\n(LLM routing unavailable — showing help menu.)`;
  }

  return reply;
}

module.exports = {
  executeManagerTool,
  handleManagerMessage,
};
