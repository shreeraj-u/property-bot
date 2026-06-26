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

function formatMonthLabel(month) {
  if (!month) return 'this month';
  const [year, mon] = month.split('-').map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString('en-SG', {
    month: 'long',
    year: 'numeric',
  });
}

function sumPayments(payments) {
  return (payments || []).reduce((total, payment) => total + Number(payment.amount_paid || 0), 0);
}

function formatRentSummary(payments, month, filters = {}, filterContext) {
  const label = formatMonthLabel(month);
  const ctx = filterContext ? `, ${filterContext}` : '';

  if (!payments?.length) {
    return `No rent data for ${label}${ctx}.`;
  }

  const status = filters.status || 'all';

  if (status === 'paid') {
    const total = sumPayments(payments);
    return [
      `Total rent collected (${label}${ctx}):`,
      formatCurrency(total),
      `From ${payments.length} tenant${payments.length === 1 ? '' : 's'}`,
    ].join('\n');
  }

  if (status === 'pending' || status === 'overdue') {
    const total = sumPayments(payments);
    return [
      `Total ${status} rent (${label}${ctx}):`,
      formatCurrency(total),
      `${payments.length} tenant${payments.length === 1 ? '' : 's'}`,
    ].join('\n');
  }

  const paid = payments.filter((p) => p.status === 'paid');
  const pending = payments.filter((p) => p.status === 'pending');
  const overdue = payments.filter((p) => p.status === 'overdue');

  return [
    `Rent summary (${label}${ctx}):`,
    '',
    `Collected: ${formatCurrency(sumPayments(paid))} (${paid.length} paid)`,
    `Outstanding (pending): ${formatCurrency(sumPayments(pending))} (${pending.length} tenants)`,
    `Overdue: ${formatCurrency(sumPayments(overdue))} (${overdue.length} tenants)`,
    `Total due this month: ${formatCurrency(sumPayments(payments))} (${payments.length} tenants)`,
  ].join('\n');
}

function formatRentRoll(payments, month, filterContext) {
  const header = filterContext
    ? `Rent roll (${month || 'current month'}, ${filterContext}):`
    : `Rent roll (${month || 'current month'}):`;

  if (!payments?.length) {
    return filterContext
      ? `No rent payments found for ${month || 'this month'} matching ${filterContext}.`
      : `No rent payments found for ${month || 'this month'}.`;
  }

  const lines = payments.map((p) => {
    const name = p.tenants?.full_name || 'Unknown';
    const unit = p.tenants?.units?.unit_number || '?';
    const block = p.tenants?.units?.block;
    const status = (p.status || 'unknown').toUpperCase();
    const paid = p.paid_date ? ` (paid ${formatDate(p.paid_date)})` : '';
    const blockTag = block ? ` [${block}]` : '';
    return `- ${unit}${blockTag} ${name}: ${formatCurrency(p.amount_paid)} — ${status}${paid}`;
  });

  const summary = {
    paid: payments.filter((p) => p.status === 'paid').length,
    pending: payments.filter((p) => p.status === 'pending').length,
    overdue: payments.filter((p) => p.status === 'overdue').length,
  };

  return [
    header,
    `Paid: ${summary.paid} | Pending: ${summary.pending} | Overdue: ${summary.overdue}`,
    '',
    ...lines,
  ].join('\n');
}

function formatExpiringLeases(leases, filterContext) {
  if (!leases?.length) {
    return filterContext
      ? `No leases expiring in the requested period matching ${filterContext}.`
      : 'No leases expiring in the requested period.';
  }

  const lines = leases.map((l) => {
    const unit = l.unit_number || l.units?.unit_number || '?';
    const block = l.units?.block;
    const name = l.full_name || l.tenants?.full_name || 'Unknown';
    const blockTag = block ? ` [${block}]` : '';
    return `- ${unit}${blockTag} ${name}: expires ${formatDate(l.end_date || l.lease_end_date)} (${l.days_until_expiry} days)`;
  });

  const header = filterContext ? `Expiring leases (${filterContext}):` : 'Expiring leases:';
  return [header, '', ...lines].join('\n');
}

function formatTenantByFields(tenant, fields = ['profile'], extras = {}) {
  if (!tenant) return 'Tenant not found.';

  const fieldSet = new Set(fields || ['profile']);
  if (fieldSet.has('profile') || fieldSet.has('all')) {
    return formatTenantProfile(tenant);
  }

  const activeLease = (tenant.leases || []).find((l) => l.status === 'active');
  const unit = tenant.units?.unit_number || '?';
  const name = tenant.full_name;

  if (fieldSet.has('lease_end')) {
    if (!activeLease) return `No active lease found for ${name}.`;
    return `${name}'s lease ends on ${formatDate(activeLease.end_date)} (Unit ${unit}).`;
  }

  if (fieldSet.has('lease_start')) {
    if (!activeLease) return `No active lease found for ${name}.`;
    return `${name}'s lease started on ${formatDate(activeLease.start_date)} (Unit ${unit}).`;
  }

  if (fieldSet.has('lease_dates')) {
    if (!activeLease) return `No active lease found for ${name}.`;
    return `${name}'s lease runs ${formatDate(activeLease.start_date)} – ${formatDate(activeLease.end_date)} (Unit ${unit}).`;
  }

  if (fieldSet.has('rent')) {
    if (!activeLease) return `No active lease found for ${name}.`;
    return `${name}'s monthly rent is ${formatCurrency(activeLease.monthly_rent)}/mo (Unit ${unit}).`;
  }

  if (fieldSet.has('deposit')) {
    if (!activeLease) return `No active lease found for ${name}.`;
    return `${name}'s deposit is ${formatCurrency(activeLease.deposit_amount)} (Unit ${unit}).`;
  }

  if (fieldSet.has('next_payment')) {
    return formatNextRentPayment({ tenant, payment: extras.nextPayment });
  }

  if (fieldSet.has('current_rent')) {
    return formatTenantMonthlyRent(tenant, extras.currentPayment, extras.month);
  }

  if (fieldSet.has('payments')) {
    const payments = tenant.rent_payments || [];
    if (!payments.length) return `No recent payments for ${name}.`;
    const lines = [`Recent payments for ${name} (Unit ${unit}):`];
    for (const p of payments) {
      lines.push(`- ${formatDate(p.due_date)}: ${formatCurrency(p.amount_paid)} (${p.status})`);
    }
    return lines.join('\n');
  }

  const lines = [`${name} (Unit ${unit})`];

  if (fieldSet.has('contact')) {
    lines.push(`Phone: ${tenant.phone_number}`, `Email: ${tenant.email || 'N/A'}`);
  }

  if (fieldSet.has('unit')) {
    const u = tenant.units || {};
    lines.push(
      `Type: ${u.unit_type || 'N/A'}`,
      `Block: ${u.block || 'N/A'}`,
      `Floor: ${u.floor ?? 'N/A'}`,
      `Listed rent: ${formatCurrency(u.monthly_rent_price)}`
    );
  }

  return lines.length > 1 ? lines.join('\n') : formatTenantProfile(tenant);
}

function formatVacantUnits(units, filterContext) {
  if (!units?.length) {
    return filterContext
      ? `No vacant units matching ${filterContext}.`
      : 'No vacant units at the moment.';
  }

  const lines = units.map((u) => {
    const amenities = u.amenities ? ` — ${u.amenities}` : '';
    return `- ${u.unit_number} [${u.block}] ${u.unit_type}, ${u.size_sqft || '?'} sqft: ${formatCurrency(u.monthly_rent_price)}/mo${amenities}`;
  });

  const header = filterContext ? `Vacant units (${filterContext}):` : 'Vacant units:';
  return [header, '', ...lines].join('\n');
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

function formatComplaints(complaints, filterContext) {
  if (!complaints?.length) {
    return filterContext
      ? `No complaints matching ${filterContext}.`
      : 'No open complaints.';
  }

  const lines = complaints.map((c) => {
    const unit = c.units?.unit_number || '?';
    const block = c.units?.block;
    const name = c.tenants?.full_name || 'Unknown';
    const desc = (c.description || '').slice(0, 80);
    const blockTag = block ? ` [${block}]` : '';
    return `- [${c.status}] ${unit}${blockTag} ${name} (${c.category}): ${desc}`;
  });

  const header = filterContext ? `Complaints (${filterContext}):` : 'Open complaints:';
  return [header, '', ...lines].join('\n');
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
    '- How much rent was collected last month?',
    '- Has anyone in block B missed rent?',
    '- Show overdue payments on floor 5',
    '- Leases expiring in 60 days in block A',
    '- When does Isabelle Koh\'s lease end?',
    '- Next rent payment for David Lim',
    '- Look up tenant in unit A-05-12',
    '- Any vacant 2BR units in block C?',
    '- Open maintenance complaints in block B',
    '- Send lease for [tenant name]',
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
  formatRentSummary,
  formatExpiringLeases,
  formatTenantProfile,
  formatTenantByFields,
  formatMyRentStatus,
  formatNextRentPayment,
  formatTenantMonthlyRent,
  formatLeaseInfo,
  formatComplaints,
  formatVacantUnits,
  tenantMainMenu,
  managerHelpMenu,
};
