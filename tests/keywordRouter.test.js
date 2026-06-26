const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { routeByKeywords } = require('../bot/keywordRouter');

describe('keywordRouter', () => {
  it('routes next rent payment questions by tenant name', () => {
    const route = routeByKeywords('When is the next rent payment for David Lim');
    assert.equal(route.tool, 'tenant_next_payment');
    assert.equal(route.input.identifier, 'David Lim');
  });

  it('routes overdue rent questions', () => {
    const route = routeByKeywords("Who hasn't paid rent this month?");
    assert.equal(route.tool, 'rent_roll');
    assert.equal(route.input.status, 'overdue');
  });

  it('routes paid rent question by tenant name', () => {
    const route = routeByKeywords('Can you tell me if David Lim has paid his rent this month?');
    assert.equal(route.tool, 'tenant_monthly_rent');
    assert.equal(route.input.identifier, 'David Lim');
  });
});
