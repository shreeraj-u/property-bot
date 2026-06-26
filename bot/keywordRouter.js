function extractDays(text) {
  const match = text.match(/(\d+)\s*days?/i);
  return match ? Number(match[1]) : null;
}

function extractIdentifier(text) {
  const patterns = [
    /(?:for|unit)\s+([A-C]-\d{2}-\d+)/i,
    /(?:for|tenant)\s+([A-Za-z]+(?:\s+[A-Za-z]+)+)/i,
    /unit\s+([A-C]-\d{2}-\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function routeByKeywords(message) {
  const text = (message || '').trim();
  const lower = text.toLowerCase();

  if (!text) return { tool: 'help', input: {} };
  if (/^(help|menu|hi|hello)\b/.test(lower)) return { tool: 'help', input: {} };
  if (/complaint/.test(lower)) return { tool: 'open_complaints', input: {} };

  if (/expir/.test(lower) && /lease/.test(lower)) {
    return { tool: 'expiring_leases', input: { days: extractDays(text) || 60 } };
  }

  if (
    /lease.*(doc|pdf|document|send|get)/.test(lower) ||
    /(doc|pdf).*lease/.test(lower)
  ) {
    const identifier = extractIdentifier(text);
    if (identifier) return { tool: 'lease_document', input: { identifier } };
  }

  if (/overdue|not paid|hasn't paid|haven't paid|unpaid/.test(lower)) {
    return { tool: 'rent_roll', input: { status: 'overdue' } };
  }

  if (/pending.*rent|rent.*pending/.test(lower)) {
    return { tool: 'rent_roll', input: { status: 'pending' } };
  }

  if (/who paid|paid rent|rent roll|rent status/.test(lower) && !/ for /.test(lower)) {
    return { tool: 'rent_roll', input: { status: 'all' } };
  }

  const nextRentPatterns = [
    /next rent payment for (.+?)\??$/i,
    /rent payment for (.+?)\??$/i,
    /when is (?:the )?next rent (?:payment )?for (.+?)\??$/i,
    /when is (.+?)'?s next rent payment/i,
  ];

  for (const pattern of nextRentPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return { tool: 'tenant_next_payment', input: { identifier: match[1].trim() } };
    }
  }

  const unitMatch = text.match(/unit\s+([A-C]-\d{2}-\d+)/i);
  if (unitMatch) {
    return { tool: 'tenant_lookup', input: { identifier: unitMatch[1] } };
  }

  const lookupMatch = text.match(
    /(?:look up|lookup|details for|info for|about|find tenant)\s+(.+?)\??$/i
  );
  if (lookupMatch) {
    return { tool: 'tenant_lookup', input: { identifier: lookupMatch[1].trim() } };
  }

  return null;
}

module.exports = {
  routeByKeywords,
  extractIdentifier,
};
