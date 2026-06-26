#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TEST_TENANT_PHONE = '+6512345678';
const BUILDING_ADDRESS = 'The Orchard Residences, 238 Orchard Boulevard, Singapore 238854';

const TENANT_NAMES = [
  'Aisha Rahman',
  'Benjamin Tan',
  'Chloe Wong',
  'David Lim',
  'Emily Ng',
  'Farhan Ibrahim',
  'Grace Chen',
  'Hassan Ali',
  'Isabelle Koh',
  'James Ong',
  'Karen Teo',
  'Liam Goh',
  'Mei Ling Ho',
  'Nathan Yeo',
  'Olivia Chua',
  'Priya Nair',
  'Quentin Lee',
  'Rachel Sim',
  'Samuel Wee',
  'Tan Mei Hui',
  'Umar Hassan',
  'Valerie Tan',
  'Wei Jie Poh',
  'Xin Yi Lau',
  'Yusuf Khan',
  'Zara Abdullah',
  'Marcus Fernandez',
];

const UNIT_TYPES = [
  { type: '1BR', sqft: 580, rent: [1800, 2200] },
  { type: '2BR', sqft: 850, rent: [2800, 3400] },
  { type: '3BR', sqft: 1150, rent: [3800, 4500] },
];

const BLOCKS = ['A', 'B', 'C'];
const VACANT_INDICES = new Set([2, 15, 28]);

function randBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function fmt(date) {
  return date.toISOString().slice(0, 10);
}

function monthStart(offsetMonths) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetMonths);
  return fmt(d);
}

function paymentStatus(tenantIndex, monthOffset) {
  const roll = (tenantIndex * 7 + monthOffset * 3) % 10;
  if (monthOffset === 0) {
    if (roll < 7) return 'paid';
    if (roll < 9) return 'pending';
    return 'overdue';
  }
  return roll < 8 ? 'paid' : 'pending';
}

function paidDateForStatus(status, dueDate) {
  if (status !== 'paid') return null;
  const due = new Date(dueDate);
  due.setDate(due.getDate() - randBetween(0, 3));
  return fmt(due);
}

function fakePhone(index) {
  if (index === 0) return TEST_TENANT_PHONE;
  const base = 81000000 + index * 137;
  return `+65${String(base).slice(0, 8)}`;
}

async function clearAll() {
  await supabase.from('complaints').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('rent_payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('leases').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('tenants').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('units').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('whatsapp_sessions').delete().neq('phone_number', '');
}

async function seed() {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('Clearing existing data...');
    await clearAll();
  }

  const units = [];
  let tenantNameIndex = 0;

  for (let i = 0; i < 30; i++) {
    const block = BLOCKS[i % BLOCKS.length];
    const floor = String(Math.floor(i / 3) + 2).padStart(2, '0');
    const stack = String((i % 3) + 1);
    const unitNumber = `${block}-${floor}-${stack}`;
    const spec = UNIT_TYPES[i % UNIT_TYPES.length];
    const monthlyRent = randBetween(spec.rent[0], spec.rent[1]);
    const isVacant = VACANT_INDICES.has(i);

    const { data: unit, error } = await supabase
      .from('units')
      .insert({
        unit_number: unitNumber,
        block,
        floor: Number(floor),
        address: BUILDING_ADDRESS,
        unit_type: spec.type,
        size_sqft: spec.sqft + randBetween(-20, 40),
        monthly_rent_price: monthlyRent,
        status: isVacant ? 'vacant' : 'occupied',
        amenities: spec.type === '3BR' ? ['Pool', 'Gym', 'BBQ'] : ['Pool', 'Gym'],
        notes: isVacant ? 'Available for viewing' : null,
      })
      .select()
      .single();

    if (error) throw new Error(`Unit ${unitNumber}: ${error.message}`);
    units.push({ ...unit, isVacant, tenantIndex: isVacant ? null : tenantNameIndex++ });
  }

  console.log(`Inserted ${units.length} units`);

  const tenants = [];
  const leases = [];

  for (const unit of units) {
    if (unit.isVacant) continue;

    const name = TENANT_NAMES[unit.tenantIndex];
    const phone = fakePhone(unit.tenantIndex);

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        full_name: name,
        phone_number: phone,
        email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        unit_id: unit.id,
        emergency_contact_name: 'Emergency Contact',
        emergency_contact_phone: `+659${String(1000000 + unit.tenantIndex).slice(0, 7)}`,
      })
      .select()
      .single();

    if (tenantError) throw new Error(`Tenant ${name}: ${tenantError.message}`);

    await supabase.from('units').update({ current_tenant_id: tenant.id }).eq('id', unit.id);

    tenants.push(tenant);

    const startDate = addMonths(new Date(), -randBetween(6, 18));
    const endOffset = unit.tenantIndex < 5 ? randBetween(1, 4) : randBetween(4, 14);
    const endDate = addMonths(new Date(), endOffset);
    const monthlyRent = unit.monthly_rent_price;

    const { data: lease, error: leaseError } = await supabase
      .from('leases')
      .insert({
        tenant_id: tenant.id,
        unit_id: unit.id,
        start_date: fmt(startDate),
        end_date: fmt(endDate),
        monthly_rent: monthlyRent,
        deposit_amount: monthlyRent * 2,
        deposit_returned: false,
        status: 'active',
        renewal_offered: endOffset <= 4,
        document_path: null,
      })
      .select()
      .single();

    if (leaseError) throw new Error(`Lease ${name}: ${leaseError.message}`);
    leases.push(lease);
  }

  console.log(`Inserted ${tenants.length} tenants and ${leases.length} leases`);

  let paymentCount = 0;
  for (let t = 0; t < tenants.length; t++) {
    const tenant = tenants[t];
    const lease = leases[t];

    for (let m = -3; m <= 0; m++) {
      const dueDate = monthStart(m);
      const status = paymentStatus(t, m);
      const amount = lease.monthly_rent;

      const { error } = await supabase.from('rent_payments').insert({
        tenant_id: tenant.id,
        lease_id: lease.id,
        amount_paid: amount,
        due_date: dueDate,
        paid_date: paidDateForStatus(status, dueDate),
        status,
        payment_method: status === 'paid' ? 'bank_transfer' : null,
        reference_number: status === 'paid' ? `PAY-${tenant.id.slice(0, 8)}-${dueDate.slice(0, 7)}` : null,
      });

      if (error) throw new Error(`Payment ${tenant.full_name}: ${error.message}`);
      paymentCount++;
    }
  }

  console.log(`Inserted ${paymentCount} rent payments`);

  const complaintSamples = [
    { category: 'maintenance', description: 'Air conditioner not cooling properly in master bedroom.', status: 'open' },
    { category: 'noise', description: 'Loud renovation noise from neighbouring unit after 10pm.', status: 'open' },
    { category: 'other', description: 'Parcel room access card not working.', status: 'in_progress' },
    { category: 'maintenance', description: 'Kitchen sink drain is clogged.', status: 'resolved' },
    { category: 'noise', description: 'Frequent loud music on weekends.', status: 'open' },
    { category: 'maintenance', description: 'Bathroom heater switch faulty.', status: 'open' },
    { category: 'other', description: 'Request to replace intercom handset.', status: 'in_progress' },
    { category: 'maintenance', description: 'Water stain on ceiling after recent rain.', status: 'open' },
    { category: 'noise', description: 'Dog barking for extended periods.', status: 'resolved' },
    { category: 'maintenance', description: 'Window latch broken in living room.', status: 'open' },
    { category: 'other', description: 'Car park lot sensor light not working.', status: 'open' },
    { category: 'maintenance', description: 'Washing machine hookup leaking.', status: 'in_progress' },
    { category: 'noise', description: 'Construction work starting too early.', status: 'open' },
  ];

  for (let i = 0; i < complaintSamples.length; i++) {
    const sample = complaintSamples[i];
    const tenant = tenants[i % tenants.length];
    const { error } = await supabase.from('complaints').insert({
      tenant_id: tenant.id,
      unit_id: tenant.unit_id,
      category: sample.category,
      description: sample.description,
      status: sample.status,
      source: 'whatsapp',
      resolved_at: sample.status === 'resolved' ? new Date().toISOString() : null,
    });
    if (error) throw new Error(`Complaint: ${error.message}`);
  }

  console.log(`Inserted ${complaintSamples.length} complaints`);
  console.log('');
  console.log('Seed complete.');
  console.log(`Test tenant phone: ${TEST_TENANT_PHONE} (${TENANT_NAMES[0]})`);
  console.log(`Manager phone (env): ${process.env.MANAGER_PHONE}`);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
