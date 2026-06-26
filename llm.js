require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-3-5-haiku-latest';
const MAX_TOKENS = 256;

const TOOLS = [
  {
    name: 'rent_roll',
    description: 'Get rent payment status for a month. Use for who paid, overdue, pending rent.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM format, omit for current month' },
        status: {
          type: 'string',
          enum: ['all', 'paid', 'pending', 'overdue'],
          description: 'Filter by payment status',
        },
      },
    },
  },
  {
    name: 'expiring_leases',
    description: 'List active leases expiring within N days.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Days ahead to look, default 60' },
      },
    },
  },
  {
    name: 'tenant_lookup',
    description: 'Look up a tenant by unit number, name, or phone.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Unit number, tenant name, or phone' },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'lease_document',
    description: 'Get a signed lease PDF link for a tenant or unit.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Unit number or tenant name' },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'open_complaints',
    description: 'List open or in-progress complaints.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'help',
    description: 'Show manager help menu when user asks what you can do.',
    input_schema: { type: 'object', properties: {} },
  },
];

const SYSTEM_PROMPT =
  'You are a property manager assistant. Route the user request to exactly one tool. ' +
  'Use rent_roll for payment questions, expiring_leases for lease expiry, tenant_lookup for tenant details, ' +
  'lease_document for lease PDF requests, open_complaints for complaints, help for capability questions. ' +
  'Do not invent data.';

let client;

function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

async function routeManagerMessage(message) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { tool: 'help', input: {}, fallback: true };
  }

  const normalized = (message || '').trim().toLowerCase();
  if (['help', 'menu', 'hi', 'hello'].includes(normalized)) {
    return { tool: 'help', input: {} };
  }

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: message }],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use');
    if (!toolUse) {
      return { tool: 'help', input: {} };
    }

    return { tool: toolUse.name, input: toolUse.input || {} };
  } catch (error) {
    console.error('LLM routing failed:', error.message);
    return { tool: 'help', input: {}, fallback: true };
  }
}

module.exports = {
  MODEL,
  TOOLS,
  routeManagerMessage,
};
