const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SKIP_TWILIO_VALIDATION = '1';

const app = require('../server');

describe('webhook', () => {
  beforeEach(() => {
    process.env.MANAGER_PHONE = process.env.MANAGER_PHONE || '+6588907746';
  });

  it('returns health check', async () => {
    const res = await request(app).get('/');
    assert.equal(res.status, 200);
    assert.match(res.text, /Property bot is running/);
  });

  it('returns TwiML for manager greeting', async () => {
    const res = await request(app)
      .post('/webhook')
      .type('form')
      .send({ From: 'whatsapp:+6588907746', Body: 'hello' });

    assert.equal(res.status, 200);
    assert.match(res.text, /<Response>/);
    assert.match(res.text, /Manager/);
  });

  it('rejects unknown sender', async () => {
    const res = await request(app)
      .post('/webhook')
      .type('form')
      .send({ From: 'whatsapp:+6599999999', Body: 'hello' });

    assert.equal(res.status, 200);
    assert.match(res.text, /isn't registered/i);
  });

  it('routes manager APPROVE command', async () => {
    const supabasePath = require.resolve('../supabase');
    const rentProofPath = require.resolve('../bot/rentProofManager');
    const handlerPath = require.resolve('../bot/handler');
    delete require.cache[handlerPath];
    delete require.cache[rentProofPath];

    const supabase = require(supabasePath);
    supabase.approveSubmission = async () => ({
      data: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        payment_month: '2026-06',
        tenants: { full_name: 'Aisha Rahman', phone_number: '+6512345678' },
        units: { unit_number: 'A-02-1' },
        rent_payments: { amount_paid: 2500 },
      },
      error: null,
    });
    supabase.sendWhatsAppReply = async () => ({ error: null });

    const { handleIncomingMessage } = require('../bot/handler');
    const messages = await handleIncomingMessage('+6588907746', 'APPROVE a1b2c3d4');
    assert.match(messages[0], /Approved submission/i);
  });
});

describe('webhook integration', { skip: !process.env.RUN_INTEGRATION }, () => {
  it('returns tenant menu for seeded test phone', async () => {
    const res = await request(app)
      .post('/webhook')
      .type('form')
      .send({ From: 'whatsapp:+6512345678', Body: 'menu' });

    assert.equal(res.status, 200);
    assert.match(res.text, /File a complaint/);
  });
});
