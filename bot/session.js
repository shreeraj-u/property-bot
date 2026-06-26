const { getSession, saveSession, clearSession } = require('../supabase');

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

async function loadSession(phoneNumber) {
  const session = await getSession(phoneNumber);
  if (!session) return null;

  const lastActive = new Date(session.last_active).getTime();
  if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
    await clearSession(phoneNumber);
    return null;
  }

  return session;
}

async function updateSession(phoneNumber, flow, sessionData = {}) {
  await saveSession(phoneNumber, flow, sessionData);
}

async function resetSession(phoneNumber) {
  await clearSession(phoneNumber);
}

module.exports = {
  SESSION_TIMEOUT_MS,
  loadSession,
  updateSession,
  resetSession,
};
