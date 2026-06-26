const VALID_BLOCKS = new Set(['A', 'B', 'C']);
const VALID_STATUSES = new Set(['all', 'paid', 'pending', 'overdue']);
const VALID_UNIT_TYPES = new Set(['1BR', '2BR', '3BR']);
const VALID_COMPLAINT_CATEGORIES = new Set(['maintenance', 'noise', 'other']);
const VALID_COMPLAINT_STATUSES = new Set(['open', 'in_progress', 'resolved', 'all']);
const VALID_FIELDS = new Set([
  'all',
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
]);

const UNIT_NUMBER_RE = /^[A-C]-\d{2}-\d$/i;

function cleanString(value) {
  if (value == null || value === '') return null;
  return String(value).trim();
}

function normalizeBlock(value) {
  const block = cleanString(value)?.toUpperCase();
  if (!block) return null;
  if (VALID_BLOCKS.has(block)) return block;
  return null;
}

function normalizeUnitNumber(value) {
  const unit = cleanString(value)?.toUpperCase();
  if (!unit) return null;
  if (!UNIT_NUMBER_RE.test(unit)) return null;
  return unit;
}

function normalizeMonth(value) {
  const month = cleanString(value);
  if (!month) return null;
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return month;
}

function normalizeStatus(value, allowed = VALID_STATUSES) {
  const status = cleanString(value)?.toLowerCase();
  if (!status) return 'all';
  if (allowed.has(status)) return status;
  if (status === 'unpaid' || status === 'missed' || status === 'late') return 'overdue';
  if (status === 'behind') return 'overdue';
  return 'all';
}

function normalizeFloor(value) {
  if (value == null || value === '') return null;
  const floor = Number(value);
  if (!Number.isInteger(floor) || floor < 1 || floor > 99) return null;
  return floor;
}

function normalizeDays(value, fallback = 60) {
  if (value == null || value === '') return fallback;
  const days = Number(value);
  if (!Number.isFinite(days) || days < 1) return fallback;
  return Math.min(Math.round(days), 365);
}

function normalizeAmount(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function normalizeUnitType(value) {
  const type = cleanString(value)?.toUpperCase();
  if (!type) return null;
  const normalized = type.replace(/\s+/g, '');
  if (VALID_UNIT_TYPES.has(normalized)) return normalized;
  return null;
}

function normalizeCategory(value) {
  const category = cleanString(value)?.toLowerCase();
  if (!category) return null;
  if (VALID_COMPLAINT_CATEGORIES.has(category)) return category;
  return null;
}

function normalizeComplaintStatus(value) {
  const status = cleanString(value)?.toLowerCase();
  if (!status) return null;
  if (VALID_COMPLAINT_STATUSES.has(status)) return status;
  return null;
}

function normalizeFields(value) {
  if (!value) return ['profile'];
  const list = Array.isArray(value) ? value : [value];
  const normalized = list
    .map((field) => cleanString(field)?.toLowerCase())
    .filter((field) => field && VALID_FIELDS.has(field));

  if (!normalized.length || normalized.includes('all') || normalized.includes('profile')) {
    return ['profile'];
  }
  return [...new Set(normalized)];
}

function normalizePhone(value) {
  const phone = cleanString(value);
  if (!phone) return null;
  return phone.startsWith('+') ? phone : `+${phone.replace(/\D/g, '')}`;
}

function buildFilters(input = {}) {
  return {
    month: normalizeMonth(input.month) || new Date().toISOString().slice(0, 7),
    status: normalizeStatus(input.status),
    block: normalizeBlock(input.block),
    floor: normalizeFloor(input.floor),
    unit_number: normalizeUnitNumber(input.unit_number),
    unit_type: normalizeUnitType(input.unit_type),
    tenant_name: cleanString(input.tenant_name),
    phone: normalizePhone(input.phone),
    category: normalizeCategory(input.category),
    complaint_status: normalizeComplaintStatus(input.complaint_status),
    days: normalizeDays(input.days),
    min_rent: normalizeAmount(input.min_rent),
    max_rent: normalizeAmount(input.max_rent),
    fields: normalizeFields(input.fields),
  };
}

function normalizeToolInput(tool, rawInput = {}) {
  const input = { ...rawInput };

  switch (tool) {
    case 'rent_roll':
      return { filters: buildFilters(input) };
    case 'expiring_leases':
      return { filters: buildFilters(input) };
    case 'open_complaints':
      return {
        filters: buildFilters({
          ...input,
          complaint_status:
            input.complaint_status ||
            normalizeComplaintStatus(input.status) ||
            null,
        }),
      };
    case 'vacant_units':
      return { filters: buildFilters(input) };
    case 'tenant_lookup':
      return {
        identifier: cleanString(input.identifier || input.tenant_name || input.unit_number),
        filters: buildFilters({
          ...input,
          tenant_name: input.tenant_name || input.identifier,
        }),
      };
    case 'lease_document':
      return {
        identifier: cleanString(input.identifier || input.tenant_name || input.unit_number),
      };
    case 'help':
      return {};
    default:
      return { filters: buildFilters(input), raw: input };
  }
}

function normalizeToolCall(tool, rawInput = {}) {
  if (tool === 'tenant_next_payment') {
    return normalizeToolCall('tenant_lookup', {
      ...rawInput,
      fields: ['next_payment'],
    });
  }

  if (tool === 'tenant_monthly_rent') {
    return normalizeToolCall('tenant_lookup', {
      ...rawInput,
      fields: ['current_rent'],
    });
  }

  return {
    tool,
    input: normalizeToolInput(tool, rawInput),
  };
}

function describeFilters(filters = {}) {
  const parts = [];
  if (filters.block) parts.push(`block ${filters.block}`);
  if (filters.floor) parts.push(`floor ${filters.floor}`);
  if (filters.unit_number) parts.push(`unit ${filters.unit_number}`);
  if (filters.unit_type) parts.push(filters.unit_type);
  if (filters.tenant_name) parts.push(`tenant ${filters.tenant_name}`);
  if (filters.status && filters.status !== 'all') parts.push(filters.status);
  if (filters.category) parts.push(filters.category);
  if (filters.complaint_status && filters.complaint_status !== 'all') {
    parts.push(filters.complaint_status);
  }
  if (filters.min_rent != null || filters.max_rent != null) {
    parts.push(`rent ${filters.min_rent || 0}-${filters.max_rent || '∞'}`);
  }
  return parts.length ? parts.join(', ') : null;
}

module.exports = {
  VALID_BLOCKS,
  VALID_FIELDS,
  buildFilters,
  normalizeToolCall,
  normalizeToolInput,
  describeFilters,
  normalizeBlock,
  normalizeUnitNumber,
  normalizeStatus,
  normalizeFields,
};
