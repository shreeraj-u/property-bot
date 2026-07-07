const crypto = require('crypto');
const {
  getMyPaymentStatus,
  getActiveLease,
  getLeaseDocument,
  fileComplaint,
  notifyManager,
  listEligibleProofPayments,
  uploadProofBuffer,
  createProofSubmission,
  getProofSignedUrl,
  submissionShortId,
} = require('../supabase');
const { isAllowedImageType } = require('./media');
const { notifyManagerOfProof } = require('./rentProofManager');
const {
  formatMyRentStatus,
  formatLeaseInfo,
  tenantMainMenu,
  formatProofMonthPrompt,
  formatProofUploadPrompt,
  formatProofConfirmPrompt,
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

async function startProofFlow(tenant, phoneNumber) {
  const { data: eligible, error } = await listEligibleProofPayments(tenant.id);
  if (error) return `Could not load rent payments: ${error.message}`;

  if (!eligible?.length) {
    return [
      'No pending or overdue rent payments need proof right now.',
      '',
      tenantMainMenu(tenant),
    ].join('\n');
  }

  if (eligible.length === 1) {
    const payment = eligible[0];
    await updateSession(phoneNumber, 'proof_upload', {
      payment_id: payment.id,
      payment_month: payment.payment_month,
      amount_paid: payment.amount_paid,
      status: payment.status,
      due_date: payment.due_date,
    });
    return formatProofUploadPrompt(payment);
  }

  await updateSession(phoneNumber, 'proof_month', { eligible_payments: eligible });
  return formatProofMonthPrompt(eligible);
}

async function handleProofMedia(tenant, phoneNumber, sessionData, mediaPayload) {
  if (!mediaPayload) {
    return 'Please send a photo of your payment receipt or bank transfer screenshot.';
  }

  if (mediaPayload.downloadError) {
    return 'Could not download your image. Please try sending it again.';
  }

  if (!mediaPayload.buffer) {
    return 'Please send a photo of your payment receipt or bank transfer screenshot.';
  }

  if (!isAllowedImageType(mediaPayload.contentType)) {
    return 'Please send an image file (JPEG or PNG screenshot). Other file types are not supported.';
  }

  const submissionId = crypto.randomUUID();
  const { proofPath, error: uploadError } = await uploadProofBuffer(
    tenant.id,
    sessionData.payment_month,
    submissionId,
    mediaPayload.buffer,
    mediaPayload.contentType
  );

  if (uploadError) {
    return `Could not save your proof: ${uploadError.message}. Please try again.`;
  }

  await updateSession(phoneNumber, 'proof_confirm', {
    payment_id: sessionData.payment_id,
    payment_month: sessionData.payment_month,
    amount_paid: sessionData.amount_paid,
    status: sessionData.status,
    due_date: sessionData.due_date,
    proof_path: proofPath,
    submission_id: submissionId,
    twilio_media_sid: mediaPayload.mediaSid || null,
  });

  return formatProofConfirmPrompt(sessionData);
}

async function submitProof(tenant, phoneNumber, sessionData) {
  const { data: submission, error } = await createProofSubmission({
    tenantId: tenant.id,
    rentPaymentId: sessionData.payment_id,
    unitId: tenant.unit_id,
    paymentMonth: sessionData.payment_month,
    proofPath: sessionData.proof_path,
    twilioMediaSid: sessionData.twilio_media_sid,
  });

  await resetSession(phoneNumber);

  if (error) {
    return [
      `Sorry, we couldn't submit your proof: ${error.message}`,
      '',
      tenantMainMenu(tenant),
    ].join('\n');
  }

  const { url } = await getProofSignedUrl(sessionData.proof_path);
  await notifyManagerOfProof(submission, url);

  const shortId = submissionShortId(submission.id);
  return [
    'Your payment proof has been submitted for manager review.',
    `Reference: ${shortId}`,
    'We will notify you once it is approved or if we need a new screenshot.',
    '',
    tenantMainMenu(tenant),
  ].join('\n');
}

async function handleTenantMessage(tenant, phoneNumber, body, mediaPayload = null) {
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
    if (text === '4') {
      return startProofFlow(tenant, phoneNumber);
    }
    return `Sorry, I didn't understand that.\n\n${tenantMainMenu(tenant)}`;
  }

  if (flow === 'proof_month') {
    const eligible = sessionData.eligible_payments || [];
    const index = Number(text);
    if (!Number.isInteger(index) || index < 1 || index > eligible.length) {
      return `Please reply 1–${eligible.length}, or cancel to go back.`;
    }

    const payment = eligible[index - 1];
    await updateSession(phoneNumber, 'proof_upload', {
      payment_id: payment.id,
      payment_month: payment.payment_month,
      amount_paid: payment.amount_paid,
      status: payment.status,
      due_date: payment.due_date,
    });
    return formatProofUploadPrompt(payment);
  }

  if (flow === 'proof_upload') {
    if (mediaPayload) {
      return handleProofMedia(tenant, phoneNumber, sessionData, mediaPayload);
    }
    return 'Please send a photo of your payment receipt or bank transfer screenshot.';
  }

  if (flow === 'proof_confirm') {
    if (['yes', 'y'].includes(text.toLowerCase())) {
      return submitProof(tenant, phoneNumber, sessionData);
    }
    if (['no', 'n'].includes(text.toLowerCase())) {
      await resetSession(phoneNumber);
      return `Proof submission cancelled.\n\n${tenantMainMenu(tenant)}`;
    }
    return 'Reply YES to submit or NO to cancel.';
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
  startProofFlow,
  submitProof,
};
