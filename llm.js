require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { routeByKeywords } = require('./bot/keywordRouter');
const { normalizeToolCall } = require('./bot/toolParams');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = 256;
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 8000);

const UNIT_FILTERS = {
  block: {
    type: 'string',
    enum: ['A', 'B', 'C'],
    description: 'Building block letter (A, B, or C)',
  },
  floor: {
    type: 'number',
    description: 'Floor number, e.g. 5 for units on the 05 floor',
  },
  unit_number: {
    type: 'string',
    description: 'Full unit code, e.g. A-05-12',
  },
  unit_type: {
    type: 'string',
    enum: ['1BR', '2BR', '3BR'],
    description: 'Unit bedroom type',
  },
  tenant_name: {
    type: 'string',
    description: 'Partial or full tenant name for filtering lists',
  },
  phone: {
    type: 'string',
    description: 'Tenant phone number with country code, e.g. +6512345678',
  },
  min_rent: {
    type: 'number',
    description: 'Minimum monthly rent in SGD',
  },
  max_rent: {
    type: 'number',
    description: 'Maximum monthly rent in SGD',
  },
};

const TENANT_FIELDS = {
  type: 'array',
  items: {
    type: 'string',
    enum: [
      'profile',
      'lease_end',
      'lease_start',
      'lease_dates',
      'rent',
      'deposit',
      'next_payment',
      'current_rent',
      'payments',
      'contact',
      'unit',
    ],
  },
  description:
    'Which tenant details to return. Use lease_end for "when does lease end", next_payment for upcoming payment, current_rent for this month payment status. Omit or profile for full details.',
};

const TOOLS = [
  {
    name: 'rent_roll',
    description:
      'Rent payment status for a month. Use for who paid, overdue, pending, missed, or late rent. Supports block/floor/unit/tenant filters.',
    input_schema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'YYYY-MM format, omit for current month' },
        status: {
          type: 'string',
          enum: ['all', 'paid', 'pending', 'overdue'],
          description: 'Payment status filter. Use overdue for missed/late/unpaid rent.',
        },
        ...UNIT_FILTERS,
      },
    },
  },
  {
    name: 'expiring_leases',
    description:
      'Active leases expiring within N days. Use for lease renewals, expiring soon, ending leases.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Days ahead to look, default 60' },
        ...UNIT_FILTERS,
      },
    },
  },
  {
    name: 'tenant_lookup',
    description:
      'Look up a tenant by unit number, name, or phone. Use fields to return only what was asked (e.g. lease_end, next_payment, current_rent).',
    input_schema: {
      type: 'object',
      properties: {
        identifier: {
          type: 'string',
          description: 'Unit number (A-05-12), tenant name, or phone number',
        },
        tenant_name: { type: 'string', description: 'Alias for identifier when searching by name' },
        unit_number: { type: 'string', description: 'Alias for identifier when searching by unit' },
        month: { type: 'string', description: 'YYYY-MM for current_rent field, default current month' },
        fields: TENANT_FIELDS,
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
    description:
      'List complaints. Default shows open and in-progress. Filter by block, unit, tenant, category, or status.',
    input_schema: {
      type: 'object',
      properties: {
        complaint_status: {
          type: 'string',
          enum: ['open', 'in_progress', 'resolved', 'all'],
          description: 'Complaint status filter. Default: open + in_progress.',
        },
        category: {
          type: 'string',
          enum: ['maintenance', 'noise', 'other'],
          description: 'Complaint category',
        },
        days: {
          type: 'number',
          description: 'Only complaints filed in the last N days',
        },
        ...UNIT_FILTERS,
      },
    },
  },
  {
    name: 'vacant_units',
    description:
      'List vacant units available for rent. Filter by block, floor, unit type, or rent range.',
    input_schema: {
      type: 'object',
      properties: {
        ...UNIT_FILTERS,
      },
    },
  },
  {
    name: 'help',
    description: 'Show manager help menu when user asks what you can do.',
    input_schema: { type: 'object', properties: {} },
  },
];

const SYSTEM_PROMPT =
  'You are a property manager assistant for a Singapore condo (blocks A, B, C). ' +
  'Route each message to exactly one tool. ' +
  'Use rent_roll for payment/overdue/missed rent questions — always set status=overdue for missed/late/unpaid rent, and set block/floor/unit filters when the user mentions them. ' +
  'Use expiring_leases for lease expiry/renewal questions. ' +
  'Use tenant_lookup for tenant details — set fields to answer precisely (lease_end for "when does lease end", next_payment for next payment date, current_rent for "has X paid this month"). ' +
  'Use lease_document for lease PDF requests. ' +
  'Use open_complaints for complaint issues. ' +
  'Use vacant_units for empty/available units. ' +
  'Use help for capability questions. Do not invent data.';

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
    const normalized = normalizeToolCall(route.tool, route.input);
    console.log(
      `LLM route: ${normalized.tool} (${Date.now() - start}ms) input=${JSON.stringify(normalized.input)}`
    );
    return { tool: normalized.tool, input: normalized.input, fallback: false };
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
