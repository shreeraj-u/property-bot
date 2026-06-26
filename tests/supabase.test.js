const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getRentStatus, getExpiringLeases, listOpenComplaints } = require('../supabase');

describe('supabase integration', { skip: !process.env.RUN_INTEGRATION }, () => {
  it('fetches current month rent payments', async () => {
    const { data, error } = await getRentStatus();
    assert.equal(error, null);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
  });

  it('fetches expiring leases', async () => {
    const { data, error } = await getExpiringLeases({ days: 60 });
    assert.equal(error, null);
    assert.ok(Array.isArray(data));
  });

  it('filters rent roll by block', async () => {
    const { data, error } = await getRentStatus({ block: 'B', status: 'all' });
    assert.equal(error, null);
    assert.ok(Array.isArray(data));
    for (const payment of data) {
      assert.equal(payment.tenants?.units?.block, 'B');
    }
  });

  it('lists open complaints', async () => {
    const { data, error } = await listOpenComplaints();
    assert.equal(error, null);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 0);
  });
});
