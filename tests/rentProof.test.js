const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseManagerProofCommand,
  handleManagerProofCommand,
} = require('../bot/rentProofManager');
const { submissionShortId } = require('../supabase');

function loadRentProofManager(mocks = {}) {
  const supabasePath = require.resolve('../supabase');
  const managerPath = require.resolve('../bot/rentProofManager');
  delete require.cache[managerPath];

  const supabase = require(supabasePath);
  Object.assign(supabase, mocks);
  return require(managerPath);
}

describe('rentProof', () => {
  it('parses APPROVE and REJECT commands', () => {
    assert.deepEqual(parseManagerProofCommand('APPROVE abc12345'), {
      action: 'approve',
      id: 'abc12345',
    });
    assert.deepEqual(parseManagerProofCommand('REJECT abc12345 wrong amount'), {
      action: 'reject',
      id: 'abc12345',
      reason: 'wrong amount',
    });
    assert.equal(parseManagerProofCommand('hello'), null);
  });

  it('formats submission short ids', () => {
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    assert.equal(submissionShortId(id), 'a1b2c3d4');
  });

  it('approves submission and notifies tenant', async () => {
    const sent = [];
    const { handleManagerProofCommand: approveHandler } = loadRentProofManager({
      approveSubmission: async () => ({
        data: {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          payment_month: '2026-06',
          tenants: { full_name: 'Aisha Rahman', phone_number: '+6512345678' },
          units: { unit_number: 'A-02-1' },
          rent_payments: { amount_paid: 2500, paid_date: '2026-06-26' },
        },
        error: null,
      }),
      sendWhatsAppReply: async (phone, message) => {
        sent.push({ phone, message });
        return { error: null };
      },
    });

    const reply = await approveHandler('+6588907746', 'APPROVE a1b2c3d4');
    assert.match(reply, /Approved submission a1b2c3d4/);
    assert.match(reply, /Aisha Rahman/);
    assert.equal(sent.length, 1);
    assert.match(sent[0].message, /approved/i);
  });

  it('rejects submission with reason', async () => {
    const sent = [];
    const { handleManagerProofCommand: rejectHandler } = loadRentProofManager({
      rejectSubmission: async (_id, _phone, reason) => ({
        data: {
          id: 'b2c3d4e5-e5f6-7890-abcd-ef1234567890',
          payment_month: '2026-06',
          rejection_reason: reason,
          tenants: { full_name: 'Aisha Rahman', phone_number: '+6512345678' },
          units: { unit_number: 'A-02-1' },
          rent_payments: { amount_paid: 2500 },
        },
        error: null,
      }),
      sendWhatsAppReply: async (phone, message) => {
        sent.push({ phone, message });
        return { error: null };
      },
    });

    const reply = await rejectHandler('+6588907746', 'REJECT b2c3d4e5 blurry image');
    assert.match(reply, /Rejected submission b2c3d4e5/);
    assert.match(sent[0].message, /blurry image/);
  });
});
