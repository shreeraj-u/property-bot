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

  it('routes open complaints', () => {
    const route = routeByKeywords('Any open complaints?');
    assert.equal(route.tool, 'open_complaints');
  });
});
