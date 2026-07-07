const crypto = require('crypto');

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000; // magic links are single-purpose, keep them short
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = 'pb_dash';

function getSecret() {
  const secret = process.env.DASHBOARD_SECRET || process.env.TWILIO_AUTH_TOKEN;
  if (!secret) {
    throw new Error('DASHBOARD_SECRET (or TWILIO_AUTH_TOKEN) must be set for dashboard auth');
  }
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createToken(type, ttlMs) {
  const expiresAt = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(6).toString('base64url');
  const payload = `${type}.${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token, expectedType) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return false;

  const [type, expiresAt, nonce, signature] = parts;
  if (type !== expectedType) return false;
  if (!safeEqual(sign(`${type}.${expiresAt}.${nonce}`), signature)) return false;
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;

  return true;
}

function createLoginToken() {
  return createToken('login', LOGIN_TOKEN_TTL_MS);
}

function verifyLoginToken(token) {
  return verifyToken(token, 'login');
}

function createSessionValue() {
  return createToken('session', SESSION_TTL_MS);
}

function verifySessionValue(value) {
  return verifyToken(value, 'session');
}

function parseCookies(header) {
  const cookies = {};
  for (const pair of String(header || '').split(';')) {
    const index = pair.indexOf('=');
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    if (!name) continue;
    cookies[name] = decodeURIComponent(pair.slice(index + 1).trim());
  }
  return cookies;
}

function sessionCookieHeader(value, req) {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (req?.secure || req?.protocol === 'https') {
    attributes.push('Secure');
  }
  return attributes.join('; ');
}

function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return verifySessionValue(cookies[SESSION_COOKIE]);
}

function checkPassword(password) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  return safeEqual(password || '', expected);
}

function dashboardBaseUrl() {
  if (process.env.DASHBOARD_BASE_URL) {
    return process.env.DASHBOARD_BASE_URL.replace(/\/+$/, '');
  }
  if (process.env.WEBHOOK_URL) {
    try {
      return new URL(process.env.WEBHOOK_URL).origin;
    } catch {
      // fall through to localhost
    }
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

function createMagicLink() {
  return `${dashboardBaseUrl()}/dashboard/login?token=${createLoginToken()}`;
}

module.exports = {
  SESSION_COOKIE,
  createLoginToken,
  verifyLoginToken,
  createSessionValue,
  verifySessionValue,
  parseCookies,
  sessionCookieHeader,
  clearSessionCookieHeader,
  isAuthenticated,
  checkPassword,
  dashboardBaseUrl,
  createMagicLink,
};
