const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function loadManagerFlows(mocks = {}) {
  const supabasePath = require.resolve('../supabase');
  const managerPath = require.resolve('../bot/managerFlows');
  delete require.cache[managerPath];

  const supabase = require(supabasePath);
  Object.assign(supabase, mocks);
  return require(managerPath);
}

describe('managerTools', () => {
  it('executes rent_roll tool with filters', async () => {
    let capturedFilters;
    const { executeManagerTool } = loadManagerFlows({
      getRentStatus: async (filters) => {
        capturedFilters = filters;
        return {
          data: [
            {
              amount_paid: 2500,
              status: 'overdue',
              tenants: {
                full_name: 'Jane',
                units: { unit_number: 'B-02-1', block: 'B' },
              },
            },
          ],
          error: null,
          month: '2026-06',
        };
      },
    });

    const reply = await executeManagerTool('rent_roll', {
      filters: { status: 'overdue', block: 'B', month: '2026-06' },
    });
    assert.equal(capturedFilters.block, 'B');
    assert.equal(capturedFilters.status, 'overdue');
    assert.match(reply, /Overdue: 1/);
    assert.match(reply, /block B/);
    assert.match(reply, /Jane/);
  });

  it('executes tenant_lookup with lease_end field', async () => {
    const { executeManagerTool } = loadManagerFlows({
      getTenantProfile: async () => ({
        data: {
          full_name: 'Isabelle Koh',
          phone_number: '+6511111111',
          units: { unit_number: 'A-03-2' },
          leases: [
            {
              status: 'active',
              start_date: '2025-01-01',
              end_date: '2026-12-31',
              monthly_rent: 2800,
              deposit_amount: 5600,
            },
          ],
          rent_payments: [],
        },
        error: null,
      }),
    });

    const reply = await executeManagerTool('tenant_lookup', {
      identifier: 'Isabelle Koh',
      filters: { fields: ['lease_end'] },
    });
    assert.match(reply, /lease ends on/);
    assert.match(reply, /Isabelle Koh/);
    assert.doesNotMatch(reply, /Recent payments/);
  });

  it('executes help tool', async () => {
    const { executeManagerTool } = loadManagerFlows({});
    const reply = await executeManagerTool('help', {});
    assert.match(reply, /Property Manager Assistant/);
  });

  it('handles missing lease document', async () => {
    const { executeManagerTool } = loadManagerFlows({
      getLeaseDocument: async () => ({ url: null, tenantName: null }),
    });
    const reply = await executeManagerTool('lease_document', { identifier: 'A-01-1' });
    assert.match(reply, /not found|No lease document/i);
  });
});
