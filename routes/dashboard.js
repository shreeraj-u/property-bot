const path = require('path');
const express = require('express');
const db = require('../supabase');
const auth = require('../lib/dashboardAuth');
const proofNotifier = require('../bot/rentProofManager');

const router = express.Router();
const PUBLIC_DIR = path.join(__dirname, '..', 'public', 'dashboard');

const MONTH_RE = /^\d{4}-\d{2}$/;

function cleanMonth(value) {
  return MONTH_RE.test(String(value || '')) ? value : null;
}

function requireAuth(req, res, next) {
  if (auth.isAuthenticated(req)) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/dashboard/login');
}

function startSession(req, res) {
  res.setHeader('Set-Cookie', auth.sessionCookieHeader(auth.createSessionValue(), req));
}

function sendData(res, { data, error }, mapper) {
  if (error) {
    console.error('Dashboard API error:', error.message || error);
    return res.status(500).json({ error: db.formatDbError(error) || 'Query failed' });
  }
  return res.json({ data: mapper ? mapper(data) : data });
}

// --- Auth pages & session -------------------------------------------------

router.get('/dashboard/login', (req, res) => {
  if (req.query.token) {
    if (auth.verifyLoginToken(req.query.token)) {
      startSession(req, res);
      return res.redirect('/dashboard');
    }
    return res.redirect('/dashboard/login?expired=1');
  }
  if (auth.isAuthenticated(req)) return res.redirect('/dashboard');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

router.post('/dashboard/login', (req, res) => {
  if (!auth.checkPassword(req.body?.password)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  startSession(req, res);
  return res.json({ ok: true });
});

router.post('/dashboard/logout', (req, res) => {
  res.setHeader('Set-Cookie', auth.clearSessionCookieHeader());
  return res.json({ ok: true });
});

router.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

router.use('/dashboard/assets', (req, res, next) => {
  if (req.path.endsWith('.html')) return res.status(404).end();
  return next();
});
router.use('/dashboard/assets', express.static(PUBLIC_DIR, { index: false }));

// --- JSON API ---------------------------------------------------------------

const api = express.Router();
api.use(requireAuth);

api.get('/overview', async (req, res) => {
  sendData(res, await db.getDashboardStats(cleanMonth(req.query.month)));
});

api.get('/rent', async (req, res) => {
  sendData(res, await db.getRentBoard(cleanMonth(req.query.month)));
});

api.get('/proofs', async (req, res) => {
  sendData(
    res,
    await db.listProofSubmissions({
      status: req.query.status,
      month: cleanMonth(req.query.month),
    })
  );
});

api.post('/proofs/:id/approve', async (req, res) => {
  const result = await db.approveSubmission(req.params.id, 'dashboard');
  if (!result.error && result.data) {
    await proofNotifier.notifyTenantProofApproved(result.data);
  }
  sendData(res, result);
});

api.post('/proofs/:id/reject', async (req, res) => {
  const reason = (req.body?.reason || '').trim() || 'Rejected by manager';
  const result = await db.rejectSubmission(req.params.id, 'dashboard', reason);
  if (!result.error && result.data) {
    await proofNotifier.notifyTenantProofRejected(result.data);
  }
  sendData(res, result);
});

api.get('/leases', async (req, res) => {
  sendData(res, await db.listAllLeases());
});

api.get('/leases/:id/document', async (req, res) => {
  const { url, error } = await db.getLeaseDocumentUrl(req.params.id);
  if (error || !url) {
    return res.status(404).json({ error: error?.message || 'No document on file' });
  }
  return res.json({ data: { url } });
});

api.get('/complaints', async (req, res) => {
  sendData(res, await db.listAllComplaints());
});

api.patch('/complaints/:id', async (req, res) => {
  sendData(res, await db.updateComplaintStatus(req.params.id, req.body?.status));
});

api.get('/tenants', async (req, res) => {
  sendData(res, await db.listTenantsDirectory());
});

api.get('/tenants/:id', async (req, res) => {
  sendData(res, await db.getTenantDetail(req.params.id));
});

api.get('/vacant-units', async (req, res) => {
  sendData(res, await db.listVacantUnits({}));
});

router.use('/api/dashboard', api);

module.exports = router;
