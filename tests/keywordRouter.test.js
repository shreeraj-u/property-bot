const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { routeByKeywords } = require('../bot/keywordRouter');

describe('keywordRouter', () => {
  it('routes help and menu to help tool', () => {
    assert.equal(routeByKeywords('help').tool, 'help');
    assert.equal(routeByKeywords('menu please').tool, 'help');
    assert.equal(routeByKeywords('hi there').tool, 'help');
    assert.equal(routeByKeywords('hello').tool, 'help');
  });

  it('returns null for natural language so LLM can route', () => {
    assert.equal(routeByKeywords('When is the next rent payment for David Lim'), null);
    assert.equal(routeByKeywords("Who hasn't paid rent this month?"), null);
    assert.equal(routeByKeywords('Has anyone in block b missed rent?'), null);
  });
});
