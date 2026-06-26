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
  it('executes rent_roll tool', async () => {
    const { executeManagerTool } = loadManagerFlows({
      getRentStatus: async () => ({
        data: [
          {
            amount_paid: 2500,
            status: 'overdue',
            tenants: { full_name: 'Jane', units: { unit_number: 'A-01-1' } },
          },
        ],
        error: null,
      }),
    });

    const reply = await executeManagerTool('rent_roll', { status: 'overdue' });
    assert.match(reply, /Overdue: 1/);
    assert.match(reply, /Jane/);
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
