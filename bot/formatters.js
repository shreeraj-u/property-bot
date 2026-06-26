const WHATSAPP_MAX = 1500;

function formatCurrency(amount) {
  return `SGD ${Number(amount || 0).toLocaleString('en-SG', { minimumFractionDigits: 0 })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function splitMessage(text, maxLen = WHATSAPP_MAX) {
  if (!text || text.length <= maxLen) return [text];

  const parts = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

function formatRentRoll(payments, month) {
  if (!payments?.length) {
    return `No rent payments found for ${month || 'this month'}.`;
  }

  const lines = payments.map((p) => {
    const name = p.tenants?.full_name || 'Unknown';
    const unit = p.tenants?.units?.unit_number || '?';
    const status = (p.status || 'unknown').toUpperCase();
    const paid = p.paid_date ? ` (paid ${formatDate(p.paid_date)})` : '';
    return `- ${unit} ${name}: ${formatCurrency(p.amount_paid)} — ${status}${paid}`;
  });

  const summary = {
    paid: payments.filter((p) => p.status === 'paid').length,
    pending: payments.filter((p) => p.status === 'pending').length,
    overdue: payments.filter((p) => p.status === 'overdue').length,
  };

  return [
    `Rent roll (${month || 'current month'}):`,
    `Paid: ${summary.paid} | Pending: ${summary.pending} | Overdue: ${summary.overdue}`,
    '',
    ...lines,
  ].join('\n');
}

function formatExpiringLeases(leases) {
  if (!leases?.length) return 'No leases expiring in the requested period.';

  const lines = leases.map((l) => {
    const unit = l.unit_number || l.units?.unit_number || '?';
    const name = l.full_name || l.tenants?.full_name || 'Unknown';
    return `- ${unit} ${name}: expires ${formatDate(l.end_date || l.lease_end_date)} (${l.days_until_expiry} days)`;
  });

  return ['Expiring leases:', '', ...lines].join('\n');
}

function formatTenantProfile(tenant) {
  if (!tenant) return 'Tenant not found.';

  const unit = tenant.units?.unit_number || '?';
  const activeLease = (tenant.leases || []).find((l) => l.status === 'active');
  const recentPayments = (tenant.rent_payments || [])
    .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
    .slice(0, 3);

  const lines = [
    `Tenant: ${tenant.full_name}`,
    `Unit: ${unit}`,
    `Phone: ${tenant.phone_number}`,
    `Email: ${tenant.email || 'N/A'}`,
  ];

  if (activeLease) {
    lines.push(
      '',
      'Active lease:',
      `- Rent: ${formatCurrency(activeLease.monthly_rent)}/mo`,
      `- Period: ${formatDate(activeLease.start_date)} – ${formatDate(activeLease.end_date)}`,
      `- Deposit: ${formatCurrency(activeLease.deposit_amount)}`
    );
  }

  if (recentPayments.length) {
    lines.push('', 'Recent payments:');
    for (const p of recentPayments) {
      lines.push(`- ${formatDate(p.due_date)}: ${formatCurrency(p.amount_paid)} (${p.status})`);
    }
  }

  return lines.join('\n');
}

function formatMyRentStatus(payment, month) {
  if (!payment) {
    return `No rent record found for ${month || 'this month'}. Please contact your property manager.`;
  }

  const lines = [
    `Rent status (${month || 'current month'}):`,
    `Amount: ${formatCurrency(payment.amount_paid)}`,
    `Due: ${formatDate(payment.due_date)}`,
    `Status: ${(payment.status || 'unknown').toUpperCase()}`,
  ];

  if (payment.paid_date) {
    lines.push(`Paid on: ${formatDate(payment.paid_date)}`);
  }

  return lines.join('\n');
}

function formatNextRentPayment(data) {
  const tenant = data?.tenant || data;
  const payment = data?.payment || pickNextPayment(data?.rent_payments);

  if (!tenant) return 'Tenant not found.';

  const unit = tenant.units?.unit_number || '?';

  if (!payment) {
    return `No upcoming rent payments found for ${tenant.full_name} (Unit ${unit}).`;
  }

  const lines = [
    `Next rent payment for ${tenant.full_name} (Unit ${unit}):`,
    `Amount: ${formatCurrency(payment.amount_paid)}`,
    `Due: ${formatDate(payment.due_date)}`,
    `Status: ${(payment.status || 'unknown').toUpperCase()}`,
  ];

  if (payment.paid_date) {
    lines.push(`Paid on: ${formatDate(payment.paid_date)}`);
  }

  return lines.join('\n');
}

function pickNextPayment(payments) {
  if (!payments?.length) return null;

  const sorted = [...payments].sort(
    (a, b) => new Date(a.due_date) - new Date(b.due_date)
  );
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const unpaid = sorted.filter((p) => p.status !== 'paid');
  return (
    unpaid.find((p) => new Date(p.due_date) >= today) ||
    unpaid[0] ||
    sorted.find((p) => new Date(p.due_date) >= today)
  );
}

function formatTenantMonthlyRent(tenant, payment, month) {
  if (!tenant) return 'Tenant not found.';

  const unit = tenant.units?.unit_number || '?';
  const label = month || new Date().toISOString().slice(0, 7);

  if (!payment) {
    return `${tenant.full_name} (Unit ${unit}) has no rent record for ${label}.`;
  }

  if (payment.status === 'paid') {
    return [
      `${tenant.full_name} (Unit ${unit}) has PAID rent for ${label}.`,
      `Amount: ${formatCurrency(payment.amount_paid)}`,
      `Paid on: ${formatDate(payment.paid_date)}`,
    ].join('\n');
  }

  return [
    `${tenant.full_name} (Unit ${unit}) has NOT paid rent for ${label}.`,
    `Amount due: ${formatCurrency(payment.amount_paid)}`,
    `Due: ${formatDate(payment.due_date)}`,
    `Status: ${(payment.status || 'unknown').toUpperCase()}`,
  ].join('\n');
}

function formatLeaseInfo(lease, documentUrl) {
  if (!lease) return 'No active lease found on your account.';

  const lines = [
    'Your lease details:',
    `Rent: ${formatCurrency(lease.monthly_rent)}/month`,
    `Deposit: ${formatCurrency(lease.deposit_amount)}`,
    `Start: ${formatDate(lease.start_date)}`,
    `End: ${formatDate(lease.end_date)}`,
    `Renewal offered: ${lease.renewal_offered ? 'Yes' : 'No'}`,
  ];

  if (documentUrl) {
    lines.push('', `Lease document: ${documentUrl}`);
  } else if (lease.document_path) {
    lines.push('', 'Lease document is on file but could not generate a link right now.');
  }

  return lines.join('\n');
}

function formatComplaints(complaints) {
  if (!complaints?.length) return 'No open complaints.';

  const lines = complaints.map((c) => {
    const unit = c.units?.unit_number || '?';
    const name = c.tenants?.full_name || 'Unknown';
    const desc = (c.description || '').slice(0, 80);
    return `- [${c.status}] ${unit} ${name} (${c.category}): ${desc}`;
  });

  return ['Open complaints:', '', ...lines].join('\n');
}

function tenantMainMenu(tenant) {
  const unit = tenant.units?.unit_number || '?';
  return [
    `Hi ${tenant.full_name}, Unit ${unit}. How can I help you today?`,
    '',
    '1. Check my rent status',
    '2. View lease info',
    '3. File a complaint',
    '',
    'Reply with a number, or type menu anytime.',
  ].join('\n');
}

function managerHelpMenu() {
  return [
    'Property Manager Assistant',
    '',
    'Ask me anything, for example:',
    '- Who has not paid rent this month?',
    '- Show overdue payments',
    '- Leases expiring in 60 days',
    '- Look up tenant in unit A-05-12',
    '- Send lease for [tenant name]',
    '- Any open complaints?',
    '',
    'Type help anytime for this menu.',
  ].join('\n');
}

module.exports = {
  WHATSAPP_MAX,
  formatCurrency,
  formatDate,
  splitMessage,
  formatRentRoll,
  formatExpiringLeases,
  formatTenantProfile,
  formatMyRentStatus,
  formatNextRentPayment,
  formatTenantMonthlyRent,
  formatLeaseInfo,
  formatComplaints,
  tenantMainMenu,
  managerHelpMenu,
};
