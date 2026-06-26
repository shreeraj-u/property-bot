const {
  getMyPaymentStatus,
  getActiveLease,
  getLeaseDocument,
  fileComplaint,
  notifyManager,
} = require('../supabase');
const {
  formatMyRentStatus,
  formatLeaseInfo,
  tenantMainMenu,
  splitMessage,
} = require('./formatters');
const { updateSession, resetSession } = require('./session');

const COMPLAINT_CATEGORIES = ['maintenance', 'noise', 'other'];

function normalizeInput(body) {
  return (body || '').trim();
}

function isGlobalCommand(body) {
  const cmd = normalizeInput(body).toLowerCase();
  return ['menu', 'help', 'cancel', 'reset', 'start'].includes(cmd);
}

async function handleRentStatus(tenant) {
  const month = new Date().toISOString().slice(0, 7);
  const { data, error } = await getMyPaymentStatus(tenant.id, month);
  if (error) return `Could not fetch rent status: ${error.message}`;
  return formatMyRentStatus(data, month);
}

async function handleLeaseInfo(tenant) {
  const { data: lease, error } = await getActiveLease(tenant.id);
  if (error) return `Could not fetch lease: ${error.message}`;

  let documentUrl = null;
  if (lease?.document_path) {
    const unitNumber = tenant.units?.unit_number;
    const doc = await getLeaseDocument(unitNumber || tenant.full_name);
    documentUrl = doc.url;
  }

  return formatLeaseInfo(lease, documentUrl);
}

async function handleTenantMessage(tenant, phoneNumber, body) {
  const text = normalizeInput(body);

  if (isGlobalCommand(text)) {
    if (text === 'cancel' || text === 'reset') {
      await resetSession(phoneNumber);
    } else {
      await updateSession(phoneNumber, 'main_menu', {});
    }
    return tenantMainMenu(tenant);
  }

  const session = await require('./session').loadSession(phoneNumber);
  const flow = session?.current_flow || 'main_menu';
  const sessionData = session?.session_data || {};

  if (flow === 'main_menu') {
    if (text === '1') {
      await updateSession(phoneNumber, 'main_menu', {});
      return handleRentStatus(tenant);
    }
    if (text === '2') {
      await updateSession(phoneNumber, 'main_menu', {});
      return handleLeaseInfo(tenant);
    }
    if (text === '3') {
      await updateSession(phoneNumber, 'complaint_category', {});
      return [
        'File a complaint — pick a category:',
        '',
        '1. Maintenance',
        '2. Noise',
        '3. Other',
        '',
        'Reply 1–3, or cancel to go back.',
      ].join('\n');
    }
    return `Sorry, I didn't understand that.\n\n${tenantMainMenu(tenant)}`;
  }

  if (flow === 'complaint_category') {
    const map = { 1: 'maintenance', 2: 'noise', 3: 'other' };
    const category = map[text];
    if (!category) {
      return 'Please reply 1, 2, or 3 for the category, or cancel to go back.';
    }
    await updateSession(phoneNumber, 'complaint_description', { category });
    return 'Please describe the issue in a few sentences:';
  }

  if (flow === 'complaint_description') {
    if (text.length < 5) {
      return 'Please provide a bit more detail (at least 5 characters).';
    }
    await updateSession(phoneNumber, 'complaint_confirm', {
      ...sessionData,
      description: text,
    });
    return [
      'Confirm your complaint:',
      `Category: ${sessionData.category}`,
      `Description: ${text}`,
      '',
      'Reply YES to submit, or NO to cancel.',
    ].join('\n');
  }

  if (flow === 'complaint_confirm') {
    if (['yes', 'y'].includes(text.toLowerCase())) {
      const { data, error } = await fileComplaint(
        tenant.id,
        tenant.unit_id,
        sessionData.category,
        sessionData.description
      );

      await resetSession(phoneNumber);

      if (error) {
        return `Sorry, we couldn't file your complaint: ${error.message}\n\n${tenantMainMenu(tenant)}`;
      }

      const unit = tenant.units?.unit_number || '?';
      await notifyManager(
        `New complaint from ${tenant.full_name} (Unit ${unit}):\n` +
          `[${sessionData.category}] ${sessionData.description}\n` +
          `Ref: ${data.id}`
      );

      return [
        'Your complaint has been submitted. The property manager will follow up soon.',
        '',
        tenantMainMenu(tenant),
      ].join('\n');
    }

    if (['no', 'n'].includes(text.toLowerCase())) {
      await resetSession(phoneNumber);
      return `Complaint cancelled.\n\n${tenantMainMenu(tenant)}`;
    }

    return 'Reply YES to submit or NO to cancel.';
  }

  await updateSession(phoneNumber, 'main_menu', {});
  return tenantMainMenu(tenant);
}

module.exports = {
  COMPLAINT_CATEGORIES,
  isGlobalCommand,
  handleTenantMessage,
  handleRentStatus,
  handleLeaseInfo,
};
