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
