require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { routeByKeywords } = require('./bot/keywordRouter');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = 256;
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000);

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
    name: 'tenant_next_payment',
    description: 'Get the next rent payment date and status for a specific tenant.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Tenant name or unit number' },
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
  'tenant_next_payment for next rent payment for a named tenant, lease_document for lease PDF requests, ' +
  'open_complaints for complaints, help for capability questions. Do not invent data.';

let client;

function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: LLM_TIMEOUT_MS,
    });
  }
  return client;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function routeWithLLM(message) {
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
}

async function routeManagerMessage(message) {
  const keywordRoute = routeByKeywords(message);
  if (keywordRoute) {
    console.log(`Keyword route: ${keywordRoute.tool}`);
    return keywordRoute;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { tool: 'help', input: {}, fallback: true };
  }

  try {
    const start = Date.now();
    const route = await withTimeout(routeWithLLM(message), LLM_TIMEOUT_MS, 'LLM');
    console.log(`LLM route: ${route.tool} (${Date.now() - start}ms)`);
    return route;
  } catch (error) {
    console.error('LLM routing failed:', error.message);
    return { tool: 'help', input: {}, fallback: true };
  }
}

module.exports = {
  MODEL,
  TOOLS,
  routeManagerMessage,
  routeByKeywords,
};
