const { identifySender } = require('../supabase');
const { tenantMainMenu, managerHelpMenu, splitMessage } = require('./formatters');
const { loadSession, updateSession, resetSession } = require('./session');
const { handleTenantMessage, isGlobalCommand } = require('./tenantFlows');
const { handleManagerMessage } = require('./managerFlows');

async function handleIncomingMessage(phoneNumber, body) {
  const { tenant, isManager } = await identifySender(phoneNumber);
  const text = (body || '').trim();

  if (isManager) {
    if (isGlobalCommand(text) && ['menu', 'help', 'start'].includes(text.toLowerCase())) {
      return splitMessage(managerHelpMenu());
    }
    if (['cancel', 'reset'].includes(text.toLowerCase())) {
      await resetSession(phoneNumber);
      return splitMessage(managerHelpMenu());
    }

    const reply = await handleManagerMessage(text);
    return splitMessage(reply);
  }

  if (tenant) {
    const reply = await handleTenantMessage(tenant, phoneNumber, body);
    return splitMessage(reply);
  }

  return splitMessage(
    "Sorry, your number isn't registered in our system. Please contact your property manager."
  );
}

async function handleFirstMessage(phoneNumber) {
  const { tenant, isManager } = await identifySender(phoneNumber);

  if (isManager) {
    return splitMessage(
      `Welcome back, Manager.\n\n${managerHelpMenu()}`
    );
  }

  if (tenant) {
    await updateSession(phoneNumber, 'main_menu', {});
    return splitMessage(tenantMainMenu(tenant));
  }

  return splitMessage(
    "Sorry, your number isn't registered in our system. Please contact your property manager."
  );
}

module.exports = {
  handleIncomingMessage,
  handleFirstMessage,
};
