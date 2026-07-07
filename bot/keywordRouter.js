function routeByKeywords(message) {
  const lower = (message || '').trim().toLowerCase();
  if (!lower) return { tool: 'help', input: {} };
  if (/^(help|menu|hi|hello|start)\b/.test(lower)) {
    return { tool: 'help', input: {} };
  }
  if (/^dashboard\b/.test(lower) || /\b(dashboard|web)\s+(link|login|access)\b/.test(lower)) {
    return { tool: 'dashboard_link', input: {} };
  }
  return null;
}

module.exports = {
  routeByKeywords,
};
