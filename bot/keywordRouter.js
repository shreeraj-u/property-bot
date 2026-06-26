function routeByKeywords(message) {
  const lower = (message || '').trim().toLowerCase();
  if (!lower) return { tool: 'help', input: {} };
  if (/^(help|menu|hi|hello|start)\b/.test(lower)) {
    return { tool: 'help', input: {} };
  }
  return null;
}

module.exports = {
  routeByKeywords,
};
