const {
  approveSubmission,
  rejectSubmission,
  submissionShortId,
  formatDbError,
  notifyManager,
  sendWhatsAppReply,
} = require('../supabase');
const { formatCurrency, formatMonthLabel } = require('./formatters');

const APPROVE_RE = /^APPROVE\s+([a-f0-9-]{6,36})\s*$/i;
const REJECT_RE = /^REJECT\s+([a-f0-9-]{6,36})(?:\s+(.+))?$/i;

function parseManagerProofCommand(text) {
  const trimmed = (text || '').trim();
  const approve = trimmed.match(APPROVE_RE);
  if (approve) return { action: 'approve', id: approve[1] };

  const reject = trimmed.match(REJECT_RE);
  if (reject) return { action: 'reject', id: reject[1], reason: reject[2]?.trim() };

  return null;
}

async function notifyTenantProofApproved(submission) {
  const tenantPhone = submission.tenants?.phone_number;
  if (!tenantPhone) return { error: null };

  const unit = submission.units?.unit_number || '?';
  const month = formatMonthLabel(submission.payment_month);

  return sendWhatsAppReply(
    tenantPhone,
    [
      `Your rent payment proof for ${month} (Unit ${unit}) has been approved.`,
      `Amount: ${formatCurrency(submission.rent_payments?.amount_paid)}`,
      'Thank you — your rent status is now marked as PAID.',
    ].join('\n')
  );
}

async function notifyTenantProofRejected(submission) {
  const tenantPhone = submission.tenants?.phone_number;
  if (!tenantPhone) return { error: null };

  const unit = submission.units?.unit_number || '?';
  const month = formatMonthLabel(submission.payment_month);
  const reason = submission.rejection_reason || 'Please try again.';

  return sendWhatsAppReply(
    tenantPhone,
    [
      `Your rent payment proof for ${month} (Unit ${unit}) was not accepted.`,
      `Reason: ${reason}`,
      '',
      'Reply menu, then 4 to submit a new proof.',
    ].join('\n')
  );
}

async function handleManagerProofCommand(phoneNumber, text) {
  const command = parseManagerProofCommand(text);
  if (!command) return null;

  if (command.action === 'approve') {
    const { data, error } = await approveSubmission(command.id, phoneNumber);
    if (error || !data) {
      return formatDbError(error) || 'Could not approve submission. Check the id and try again.';
    }

    const unit = data.units?.unit_number || '?';
    const month = formatMonthLabel(data.payment_month);
    const shortId = submissionShortId(data.id);

    await notifyTenantProofApproved(data);

    return [
      `Approved submission ${shortId}.`,
      `${data.tenants?.full_name} (Unit ${unit}) — ${month}`,
      `Rent marked PAID (${formatCurrency(data.rent_payments?.amount_paid)}).`,
    ].join('\n');
  }

  const { data, error } = await rejectSubmission(
    command.id,
    phoneNumber,
    command.reason || 'Please resubmit with a clearer screenshot.'
  );

  if (error || !data) {
    return formatDbError(error) || 'Could not reject submission. Check the id and try again.';
  }

  await notifyTenantProofRejected(data);

  return [`Rejected submission ${submissionShortId(data.id)}. Tenant notified.`].join('\n');
}

async function notifyManagerOfProof(submission, signedUrl) {
  const shortId = submissionShortId(submission.id);
  const unit = submission.units?.unit_number || '?';
  const amount = formatCurrency(submission.rent_payments?.amount_paid);
  const month = formatMonthLabel(submission.payment_month);

  const message = [
    'New rent payment proof submitted:',
    `${submission.tenants?.full_name} (Unit ${unit})`,
    `Month: ${month} | Amount: ${amount}`,
    `Submission id: ${shortId}`,
    signedUrl ? `View proof: ${signedUrl}` : '',
    '',
    `Reply APPROVE ${shortId} or REJECT ${shortId} [reason]`,
  ]
    .filter(Boolean)
    .join('\n');

  return notifyManager(message, signedUrl);
}

module.exports = {
  parseManagerProofCommand,
  handleManagerProofCommand,
  notifyManagerOfProof,
  notifyTenantProofApproved,
  notifyTenantProofRejected,
};
