const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeToolCall,
  normalizeBlock,
  normalizeStatus,
  normalizeFields,
  describeFilters,
  buildFilters,
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
});
