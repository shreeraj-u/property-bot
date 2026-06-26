const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitMessage,
  formatRentRoll,
  formatRentSummary,
  formatMyRentStatus,
  formatExpiringLeases,
  tenantMainMenu,
} = require('../bot/formatters');

describe('formatters', () => {
  it('splits long messages', () => {
    const text = 'a'.repeat(2000);
    const parts = splitMessage(text, 1500);
    assert.equal(parts.length, 2);
    assert.ok(parts[0].length <= 1500);
  });

  it('formats rent summary for paid totals', () => {
    const payments = [
      { amount_paid: 2500, status: 'paid' },
      { amount_paid: 3000, status: 'paid' },
    ];
    const text = formatRentSummary(payments, '2026-05', { status: 'paid' });
    assert.match(text, /Total rent collected/);
    assert.match(text, /SGD 5,500/);
    assert.match(text, /2 tenants/);
  });

  it('formats rent roll with summary', () => {
    const payments = [
      {
        amount_paid: 2500,
        status: 'paid',
        paid_date: '2026-06-01',
        tenants: { full_name: 'Jane Doe', units: { unit_number: 'A-02-1' } },
      },
      {
        amount_paid: 3000,
        status: 'overdue',
        tenants: { full_name: 'John Tan', units: { unit_number: 'B-03-2' } },
      },
    ];

    const text = formatRentRoll(payments, '2026-06');
    assert.match(text, /Paid: 1/);
    assert.match(text, /Overdue: 1/);
    assert.match(text, /Jane Doe/);
  });

  it('formats tenant rent status', () => {
    const text = formatMyRentStatus(
      {
        amount_paid: 2200,
        due_date: '2026-06-01',
        status: 'pending',
      },
      '2026-06'
    );
    assert.match(text, /PENDING/);
    assert.match(text, /SGD 2,200/);
  });

  it('formats expiring leases', () => {
    const text = formatExpiringLeases([
      {
        unit_number: 'A-02-1',
        full_name: 'Test User',
        end_date: '2026-08-01',
        days_until_expiry: 36,
      },
    ]);
    assert.match(text, /Test User/);
    assert.match(text, /36 days/);
  });

  it('formats tenant lease_end field only', () => {
    const { formatTenantByFields } = require('../bot/formatters');
    const text = formatTenantByFields(
      {
        full_name: 'Isabelle Koh',
        units: { unit_number: 'A-03-2' },
        leases: [{ status: 'active', end_date: '2026-12-31', start_date: '2025-01-01' }],
      },
      ['lease_end']
    );
    assert.match(text, /lease ends on/);
    assert.doesNotMatch(text, /Recent payments/);
  });

  it('builds tenant main menu', () => {
    const menu = tenantMainMenu({
      full_name: 'Aisha Rahman',
      units: { unit_number: 'A-02-1' },
    });
    assert.match(menu, /Aisha Rahman/);
    assert.match(menu, /1\. Check my rent status/);
  });
});
