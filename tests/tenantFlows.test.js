const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const mockTenant = {
  id: 'tenant-1',
  full_name: 'Aisha Rahman',
  unit_id: 'unit-1',
  units: { unit_number: 'A-02-1' },
};

function loadTenantFlows(sessionMocks = {}, supabaseMocks = {}, rentProofMocks = {}) {
  const sessionPath = require.resolve('../bot/session');
  const supabasePath = require.resolve('../supabase');
  const rentProofPath = require.resolve('../bot/rentProofManager');
  const tenantPath = require.resolve('../bot/tenantFlows');
  delete require.cache[tenantPath];
  delete require.cache[rentProofPath];

  const session = require(sessionPath);
  session.loadSession = sessionMocks.loadSession || (async () => ({
    current_flow: 'main_menu',
    session_data: {},
  }));
  session.updateSession = sessionMocks.updateSession || (async () => {});
  session.resetSession = sessionMocks.resetSession || (async () => {});

  if (Object.keys(supabaseMocks).length) {
    const supabase = require(supabasePath);
    Object.assign(supabase, supabaseMocks);
  }

  if (Object.keys(rentProofMocks).length) {
    const rentProof = require(rentProofPath);
    Object.assign(rentProof, rentProofMocks);
  }

  return require(tenantPath);
}

describe('tenantFlows', () => {
  it('shows menu on menu command', async () => {
    const { handleTenantMessage } = loadTenantFlows({});
    const reply = await handleTenantMessage(mockTenant, '+6512345678', 'menu');
    assert.match(reply, /Check my rent status/);
  });

  it('shows menu with proof option', async () => {
    const { handleTenantMessage } = loadTenantFlows({});
    const reply = await handleTenantMessage(mockTenant, '+6512345678', 'menu');
    assert.match(reply, /Submit rent payment proof/);
  });

  it('starts proof upload when only one eligible payment', async () => {
    const calls = [];
    const { handleTenantMessage } = loadTenantFlows(
      {
        updateSession: async (phone, flow, data) => {
          calls.push({ flow, data });
        },
      },
      {
        listEligibleProofPayments: async () => ({
          data: [
            {
              id: 'pay-1',
              amount_paid: 2500,
              due_date: '2026-06-01',
              status: 'pending',
              payment_month: '2026-06',
            },
          ],
          error: null,
        }),
      }
    );

    const reply = await handleTenantMessage(mockTenant, '+6512345678', '4');
    assert.match(reply, /Send a photo/i);
    assert.ok(calls.some((c) => c.flow === 'proof_upload'));
  });

  it('submits proof after confirmation', async () => {
    const { handleTenantMessage } = loadTenantFlows(
      {
        loadSession: async () => ({
          current_flow: 'proof_confirm',
          session_data: {
            payment_id: 'pay-1',
            payment_month: '2026-06',
            amount_paid: 2500,
            status: 'pending',
            proof_path: 'tenant-1/2026-06/sub-1.jpg',
            submission_id: 'sub-1',
          },
        }),
      },
      {
        createProofSubmission: async () => ({
          data: {
            id: 'sub-1',
            payment_month: '2026-06',
            tenants: { full_name: 'Aisha Rahman' },
            units: { unit_number: 'A-02-1' },
            rent_payments: { amount_paid: 2500 },
          },
          error: null,
        }),
        getProofSignedUrl: async () => ({ url: 'https://signed.example/proof.jpg', error: null }),
      },
      {
        notifyManagerOfProof: async () => ({ error: null }),
      }
    );

    const reply = await handleTenantMessage(mockTenant, '+6512345678', 'yes');
    assert.match(reply, /submitted for manager review/i);
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
