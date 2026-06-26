require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { routeByKeywords } = require('./bot/keywordRouter');

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

const RENT_TIME_FILTERS = {
  month: {
    type: 'string',
    description: 'Explicit month as YYYY-MM, e.g. 2026-05',
  },
  relative_month: {
    type: 'string',
    enum: ['this_month', 'last_month', 'next_month'],
    description:
      'Relative month. Use last_month for "last month" or "previous month". Defaults to this_month.',
  },
  status: {
    type: 'string',
    enum: ['all', 'paid', 'pending', 'overdue'],
    description: 'Payment status filter. Use paid for collected rent totals.',
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
    name: 'rent_summary',
    description:
      'Aggregate rent totals for a month. Use for "how much total", "total collected", "sum of rent paid", revenue questions. Returns a short summary, not a tenant list.',
    input_schema: {
      type: 'object',
      properties: {
        ...RENT_TIME_FILTERS,
        ...UNIT_FILTERS,
      },
    },
  },
  {
    name: 'rent_roll',
    description:
      'List individual tenant rent payments for a month. Use when user wants to see WHO paid/overdue/pending, not totals alone.',
    input_schema: {
      type: 'object',
      properties: {
        ...RENT_TIME_FILTERS,
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

function getSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    'You are a property manager assistant for a Singapore condo (blocks A, B, C). ' +
    `Today is ${today} (current month: ${currentMonth}). ` +
    'Route each message to exactly one tool. ' +
    'Use rent_summary for totals and aggregates — "how much total", "total collected", "sum paid", "revenue last month". Set status=paid for collected rent. Set relative_month=last_month when user says "last month". ' +
    'Use rent_roll to LIST individual tenants — who paid, overdue, pending, missed rent. Set status=overdue for missed/late/unpaid. Set block/floor/unit filters when mentioned. ' +
    'Use expiring_leases for lease expiry/renewal questions. ' +
    'Use tenant_lookup for tenant details — set fields precisely (lease_end, next_payment, current_rent). ' +
    'Use lease_document for lease PDF requests. ' +
    'Use open_complaints for complaint issues. ' +
    'Use vacant_units for empty/available units. ' +
    'Use help for capability questions. Do not invent data.'
  );
}

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
    system: getSystemPrompt(),
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
    console.log(
      `LLM route: ${route.tool} (${Date.now() - start}ms) input=${JSON.stringify(route.input)}`
    );
    return { ...route, fallback: false };
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
