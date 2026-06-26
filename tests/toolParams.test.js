const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeToolCall,
  normalizeBlock,
  normalizeStatus,
  normalizeFields,
  describeFilters,
  buildFilters,
  resolveMonth,
} = require('../bot/toolParams');

describe('toolParams', () => {
  it('normalizes block and status aliases', () => {
    assert.equal(normalizeBlock('b'), 'B');
    assert.equal(normalizeStatus('missed'), 'overdue');
    assert.equal(normalizeStatus('late'), 'overdue');
  });

  it('builds filters with defaults', () => {
    const filters = buildFilters({ block: 'A', status: 'overdue' });
    assert.equal(filters.block, 'A');
    assert.equal(filters.status, 'overdue');
    assert.match(filters.month, /^\d{4}-\d{2}$/);
  });

  it('maps legacy tenant tools to tenant_lookup with fields', () => {
    const next = normalizeToolCall('tenant_next_payment', { identifier: 'David Lim' });
    assert.equal(next.tool, 'tenant_lookup');
    assert.deepEqual(next.input.filters.fields, ['next_payment']);
    assert.equal(next.input.identifier, 'David Lim');

    const monthly = normalizeToolCall('tenant_monthly_rent', { identifier: 'Jane', month: '2026-06' });
    assert.equal(monthly.tool, 'tenant_lookup');
    assert.deepEqual(monthly.input.filters.fields, ['current_rent']);
    assert.equal(monthly.input.filters.month, '2026-06');
  });

  it('normalizes tenant_lookup lease_end field', () => {
    const call = normalizeToolCall('tenant_lookup', {
      identifier: 'Isabelle Koh',
      fields: ['lease_end'],
    });
    assert.deepEqual(call.input.filters.fields, ['lease_end']);
  });

  it('describes active filters', () => {
    const text = describeFilters({ block: 'B', status: 'overdue' });
    assert.match(text, /block B/);
    assert.match(text, /overdue/);
  });

  it('normalizes idempotently when input already has filters', () => {
    const first = normalizeToolCall('rent_roll', { status: 'overdue', block: 'C' });
    const second = normalizeToolCall(first.tool, first.input);
    assert.equal(second.input.filters.status, 'overdue');
    assert.equal(second.input.filters.block, 'C');
  });

  it('resolves relative months', () => {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const expected = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
    assert.equal(resolveMonth({ relative_month: 'last_month' }), expected);
  });

  it('routes aggregate questions to rent_summary shape', () => {
    const call = normalizeToolCall('rent_summary', {
      relative_month: 'last_month',
      status: 'paid',
    });
    assert.equal(call.tool, 'rent_summary');
    assert.equal(call.input.filters.status, 'paid');
    assert.equal(call.input.filters.month, resolveMonth({ relative_month: 'last_month' }));
  });
});
