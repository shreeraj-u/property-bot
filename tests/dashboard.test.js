const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.SKIP_TWILIO_VALIDATION = '1';
process.env.DASHBOARD_SECRET = 'test-secret';
process.env.DASHBOARD_PASSWORD = 'test-pass';

const supabase = require('../supabase');

const sentReplies = [];
supabase.sendWhatsAppReply = async (phone, messages) => {
  sentReplies.push({ phone, messages });
  return { error: null };
};

const app = require('../server');
const auth = require('../lib/dashboardAuth');
const { routeByKeywords } = require('../bot/keywordRouter');

function signPayload(payload) {
  return crypto.createHmac('sha256', 'test-secret').update(payload).digest('base64url');
}

async function loginCookie() {
  const res = await request(app)
    .post('/dashboard/login')
    .send({ password: 'test-pass' });
  assert.equal(res.status, 200);
  return res.headers['set-cookie'][0].split(';')[0];
}

describe('dashboard auth module', () => {
  it('round-trips login tokens and session values', () => {
    assert.equal(auth.verifyLoginToken(auth.createLoginToken()), true);
    assert.equal(auth.verifySessionValue(auth.createSessionValue()), true);
  });

  it('rejects tampered tokens', () => {
    const token = auth.createLoginToken();
    const parts = token.split('.');
    parts[1] = String(Number(parts[1]) + 999999);
    assert.equal(auth.verifyLoginToken(parts.join('.')), false);
    assert.equal(auth.verifyLoginToken('garbage'), false);
  });

  it('rejects expired tokens even with a valid signature', () => {
    const payload = `login.${Date.now() - 1000}.abc123`;
    assert.equal(auth.verifyLoginToken(`${payload}.${signPayload(payload)}`), false);
  });

  it('does not accept a login token as a session cookie', () => {
    assert.equal(auth.verifySessionValue(auth.createLoginToken()), false);
  });

  it('builds magic links against the webhook origin', () => {
    process.env.WEBHOOK_URL = 'https://bot.example.com/webhook';
    delete process.env.DASHBOARD_BASE_URL;
    const link = auth.createMagicLink();
    assert.match(link, /^https:\/\/bot\.example\.com\/dashboard\/login\?token=/);
  });
});

describe('dashboard keyword routing', () => {
  it('routes "dashboard" to dashboard_link', () => {
    assert.deepEqual(routeByKeywords('dashboard'), { tool: 'dashboard_link', input: {} });
    assert.deepEqual(routeByKeywords('send me the dashboard link'), {
      tool: 'dashboard_link',
      input: {},
    });
  });

  it('still routes greetings to help', () => {
    assert.deepEqual(routeByKeywords('hello'), { tool: 'help', input: {} });
  });
});

describe('dashboard auth flow', () => {
  it('redirects unauthenticated page requests to login', async () => {
    const res = await request(app).get('/dashboard');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard/login');
  });

  it('returns 401 JSON for unauthenticated API requests', async () => {
    const res = await request(app).get('/api/dashboard/overview');
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Not authenticated');
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/dashboard/login').send({ password: 'nope' });
    assert.equal(res.status, 401);
  });

  it('accepts the password and grants a working session', async () => {
    const cookie = await loginCookie();
    const res = await request(app).get('/dashboard').set('Cookie', cookie);
    assert.equal(res.status, 200);
    assert.match(res.text, /Property Dashboard/);
  });

  it('exchanges a valid magic-link token for a session', async () => {
    const res = await request(app).get(
      `/dashboard/login?token=${encodeURIComponent(auth.createLoginToken())}`
    );
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard');
    assert.match(res.headers['set-cookie'][0], /pb_dash=/);
  });

  it('bounces an invalid magic-link token', async () => {
    const res = await request(app).get('/dashboard/login?token=bad');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/dashboard/login?expired=1');
  });

  it('serves the login page and hides html from the assets route', async () => {
    const login = await request(app).get('/dashboard/login');
    assert.equal(login.status, 200);
    assert.match(login.text, /Manager sign-in/);

    const leaked = await request(app).get('/dashboard/assets/index.html');
    assert.equal(leaked.status, 404);
  });
});

describe('dashboard API', () => {
  it('returns overview stats', async () => {
    supabase.getDashboardStats = async (month) => ({
      data: { month: month || '2026-07', rent: { collected: 100 } },
      error: null,
    });

    const res = await request(app)
      .get('/api/dashboard/overview?month=2026-06')
      .set('Cookie', await loginCookie());

    assert.equal(res.status, 200);
    assert.equal(res.body.data.month, '2026-06');
  });

  it('ignores malformed month params', async () => {
    supabase.getRentBoard = async (month) => ({
      data: { month: month || 'default', units: [] },
      error: null,
    });

    const res = await request(app)
      .get('/api/dashboard/rent?month=DROP%20TABLE')
      .set('Cookie', await loginCookie());

    assert.equal(res.status, 200);
    assert.equal(res.body.data.month, 'default');
  });

  it('surfaces query errors as 500s', async () => {
    supabase.listAllComplaints = async () => ({
      data: null,
      error: new Error('boom'),
    });

    const res = await request(app)
      .get('/api/dashboard/complaints')
      .set('Cookie', await loginCookie());

    assert.equal(res.status, 500);
    assert.match(res.body.error, /boom/);
  });

  it('approves a proof and notifies the tenant on WhatsApp', async () => {
    supabase.approveSubmission = async (shortId, reviewer) => {
      assert.equal(reviewer, 'dashboard');
      return {
        data: {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
          payment_month: '2026-07',
          tenants: { full_name: 'Aisha Rahman', phone_number: '+6512345678' },
          units: { unit_number: 'A-02-1' },
          rent_payments: { amount_paid: 2500 },
        },
        error: null,
      };
    };

    sentReplies.length = 0;
    const res = await request(app)
      .post('/api/dashboard/proofs/a1b2c3d4/approve')
      .set('Cookie', await loginCookie());

    assert.equal(res.status, 200);
    assert.equal(res.body.data.tenants.full_name, 'Aisha Rahman');
    assert.equal(sentReplies.length, 1);
    assert.equal(sentReplies[0].phone, '+6512345678');
    assert.match(sentReplies[0].messages, /approved/i);
  });

  it('rejects a proof with a reason and notifies the tenant', async () => {
    supabase.rejectSubmission = async (shortId, reviewer, reason) => ({
      data: {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        payment_month: '2026-07',
        rejection_reason: reason,
        tenants: { full_name: 'Aisha Rahman', phone_number: '+6512345678' },
        units: { unit_number: 'A-02-1' },
        rent_payments: { amount_paid: 2500 },
      },
      error: null,
    });

    sentReplies.length = 0;
    const res = await request(app)
      .post('/api/dashboard/proofs/a1b2c3d4/reject')
      .set('Cookie', await loginCookie())
      .send({ reason: 'Wrong amount shown' });

    assert.equal(res.status, 200);
    assert.equal(sentReplies.length, 1);
    assert.match(sentReplies[0].messages, /Wrong amount shown/);
  });

  it('validates complaint status without touching the database', async () => {
    const { data, error } = await supabase.updateComplaintStatus('some-id', 'bogus');
    assert.equal(data, null);
    assert.match(error.message, /Invalid complaint status/);
  });
});

describe('manager dashboard_link tool', () => {
  it('replies with a magic link', async () => {
    process.env.WEBHOOK_URL = 'https://bot.example.com/webhook';
    const { executeManagerTool } = require('../bot/managerFlows');
    const reply = await executeManagerTool('dashboard_link', {});
    assert.match(reply, /https:\/\/bot\.example\.com\/dashboard\/login\?token=/);
    assert.match(reply, /valid 15 minutes/);
  });
});
