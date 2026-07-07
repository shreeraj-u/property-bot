const { identifySender, isManagerPhone } = require('../supabase');
const { tenantMainMenu, managerHelpMenu, splitMessage } = require('./formatters');
const { updateSession, resetSession } = require('./session');
const { handleTenantMessage, isGlobalCommand } = require('./tenantFlows');
const { handleManagerMessage } = require('./managerFlows');
const { handleManagerProofCommand, parseManagerProofCommand } = require('./rentProofManager');

async function handleIncomingMessage(phoneNumber, body, mediaPayload = null) {
  const text = (body || '').trim();

  if (isManagerPhone(phoneNumber)) {
    if (parseManagerProofCommand(text)) {
      const reply = await handleManagerProofCommand(phoneNumber, text);
      return splitMessage(reply);
    }

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

  const { tenant } = await identifySender(phoneNumber);

  if (tenant) {
    const reply = await handleTenantMessage(tenant, phoneNumber, body, mediaPayload);
    return splitMessage(reply);
  }

  return splitMessage(
    "Sorry, your number isn't registered in our system. Please contact your property manager."
  );
}

async function handleFirstMessage(phoneNumber) {
  if (isManagerPhone(phoneNumber)) {
    return splitMessage(`Welcome back, Manager.\n\n${managerHelpMenu()}`);
  }

  const { tenant } = await identifySender(phoneNumber);

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
