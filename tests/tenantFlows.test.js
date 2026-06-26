const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mockTenant = {
  id: 'tenant-1',
  full_name: 'Aisha Rahman',
  unit_id: 'unit-1',
  units: { unit_number: 'A-02-1' },
};

function loadTenantFlows(sessionMocks = {}) {
  const sessionPath = require.resolve('../bot/session');
  const tenantPath = require.resolve('../bot/tenantFlows');
  delete require.cache[tenantPath];

  const session = require(sessionPath);
  session.loadSession = sessionMocks.loadSession || (async () => ({
    current_flow: 'main_menu',
    session_data: {},
  }));
  session.updateSession = sessionMocks.updateSession || (async () => {});
  session.resetSession = sessionMocks.resetSession || (async () => {});

  return require(tenantPath);
}

describe('tenantFlows', () => {
  it('shows menu on menu command', async () => {
    const { handleTenantMessage } = loadTenantFlows({});
    const reply = await handleTenantMessage(mockTenant, '+6512345678', 'menu');
    assert.match(reply, /Check my rent status/);
  });

  it('starts complaint category flow on option 3', async () => {
    const calls = [];
    const { handleTenantMessage } = loadTenantFlows({
      updateSession: async (phone, flow, data) => {
        calls.push({ phone, flow, data });
      },
    });

    const reply = await handleTenantMessage(mockTenant, '+6512345678', '3');
    assert.match(reply, /pick a category/i);
    assert.ok(calls.some((c) => c.flow === 'complaint_category'));
  });
});
