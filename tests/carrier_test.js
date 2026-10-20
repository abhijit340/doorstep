// Run: node tests/carrier_test.js
// Loads apps-script/Parse.gs + Carrier.gs and checks the USPS status mapping and how it updates a package.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const ctx = { module: { exports: {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'Parse.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'Carrier.gs'), 'utf8'), ctx);
const { uspsCandidate_, uspsStatus_, applyUsps_ } = ctx.module.exports;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };

t('USPS numbers and carrier names are candidates; delivered/archived ones are not', () => {
  assert.ok(uspsCandidate_({ tracking: '9405550106151069020021', status: 'shipped' }));
  assert.ok(uspsCandidate_({ tracking: 'LZ123456789US', status: 'in_transit' }));
  assert.ok(uspsCandidate_({ tracking: 'ABC123', carrier: 'USPS', status: 'shipped' }));
  assert.ok(!uspsCandidate_({ tracking: '1Z999AA10123456784', carrier: 'UPS', status: 'shipped' }));
  assert.ok(!uspsCandidate_({ tracking: '9405550106151069020021', status: 'delivered' }));
  assert.ok(!uspsCandidate_({ tracking: '9405550106151069020021', status: 'shipped', archived: true }));
  assert.ok(!uspsCandidate_({ tracking: '', carrier: 'USPS', status: 'shipped' }));
});

t('maps v3 delivered, out for delivery, in transit, and attempted', () => {
  const d = uspsStatus_({ trackingNumber: '9405', statusCategory: 'Delivered', status: 'Delivered, Front Desk/Reception/Mail Room',
    statusSummary: 'Your item was delivered to the front desk at 11:25 am on October 19, 2026 in SEATTLE, WA 98102.',
    trackingEvents: [{ eventType: 'Delivered, Front Desk/Reception/Mail Room', eventTimestamp: '2026-10-19T11:25:00' }] });
  assert.strictEqual(d.status, 'delivered');
  assert.strictEqual(d.at, '2026-10-19T11:25:00');
  assert.strictEqual(uspsStatus_({ statusCategory: 'Out for Delivery', expectedDeliveryDate: '2026-10-21' }).status, 'out_for_delivery');
  const it = uspsStatus_({ statusCategory: 'In Transit', status: 'Arrived at USPS Regional Facility', expectedDeliveryDate: '2026-10-22T00:00:00' });
  assert.strictEqual(it.status, 'in_transit');
  assert.strictEqual(it.eta, '2026-10-22');
  assert.strictEqual(uspsStatus_({ statusCategory: 'Alert', status: 'Delivery Attempted - No Access to Delivery Location' }), null);
  assert.strictEqual(uspsStatus_({}), null);
  assert.strictEqual(uspsStatus_(null), null);
});

t('a delivered result moves the package forward once and records the event', () => {
  const k = { id: 8, status: 'shipped', eta: '', events: [{ s: 'shipped', at: '2026-10-15T08:44:20' }] };
  const r = uspsStatus_({ statusCategory: 'Delivered', status: 'Delivered, Front Desk/Reception/Mail Room',
    trackingEvents: [{ eventType: 'Delivered', eventTimestamp: '2026-10-19T11:25:00' }] });
  assert.ok(applyUsps_(k, r, new Date(2026, 9, 20, 9, 0, 0)));
  assert.strictEqual(k.status, 'delivered');
  assert.strictEqual(k.delivered_at, '2026-10-19T11:25:00');
  assert.strictEqual(k.events.length, 2);
  assert.ok(!applyUsps_(k, r, new Date()), 'same result twice changes nothing');
});

t('status never moves backward; eta updates while not delivered', () => {
  const k = { id: 1, status: 'out_for_delivery', eta: '2026-10-20', events: [] };
  assert.ok(!applyUsps_(k, { status: 'in_transit', eta: '', at: '', summary: '' }, new Date()));
  assert.strictEqual(k.status, 'out_for_delivery');
  const j = { id: 2, status: 'shipped', eta: '', events: [] };
  assert.ok(applyUsps_(j, { status: null, eta: '2026-10-23', at: '', summary: '' }, new Date()));
  assert.strictEqual(j.eta, '2026-10-23');
  assert.strictEqual(j.status, 'shipped');
});

console.log(n + ' passed');
