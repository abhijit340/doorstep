// Run: node tests/regress_test.js
// Real-world emails Doorstep got wrong (Oct 2026): long USPS-handoff tracking numbers, shipment
// item tables, totals mistaken for items, payment notices filed as packages, forwarded duplicates.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { module: { exports: {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Parse.gs'), 'utf8'), ctx);
const { parseEmail, applyEmail } = ctx.module.exports;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const date = new Date(2026, 9, 21, 4, 55, 0);

const SHIPSTATION = {
  from: 'Bona Fide Masks™ <tracking@shipstation.com>', subject: 'Your Bonafide Masks order has been shipped!', date,
  text: 'Dear Abhijit Jayakumar,\n\nThank you for your order from *Bonafide Masks! *We wanted to let you know\n' +
    'that your order (#2794306) was shipped UPS on 10/21/2026. You can track\nyour package at any time using the link below.\n\n' +
    '*Track Your Shipment:* 92612903031513543475456868\n<http://trackshipment.shipstation.com/?carrier_code=ups&tracking_number=92612903031513543475456868>\n\n' +
    'This shipment includes the following items:\n\n*Item #* *Description* *Qty*\nKN95-RSP-PWCM-MSK-10 White Powecom KN95-Earloop Style 2\n\n' +
    '*Thank you for your business and we look forward to serving you in the\nfuture! **Bona Fide Masks™*\n',
  html: ''
};

t('26-digit USPS-handoff number and ShipStation item table are read', () => {
  const p = parseEmail(SHIPSTATION);
  assert.strictEqual(p.kind, 'shipped');
  assert.strictEqual(p.tracking, '92612903031513543475456868');
  assert.strictEqual(p.carrier, 'USPS');
  assert.strictEqual(p.items, 'White Powecom KN95-Earloop Style ×2');
  assert.strictEqual(p.order_number, '2794306');
});

t('a shipped email replaces junk items like "Grand total:" and fills tracking', () => {
  const pkgs = [{ id: 13, items: 'Grand total:', merchant: 'Bona Fide Masks', carrier: 'UPS', status: 'ordered', eta: '', tracking: '',
    tracking_url: '', last_update: '2026-10-20T14:26:43', ordered_at: '2026-10-20T14:26:43', delivered_at: '', order_number: '2794306',
    notes: '', archived: false, image: '', merchant_domain: 'bonafidemasks.com', events: [] }];
  const k = applyEmail(pkgs, parseEmail(SHIPSTATION));
  assert.strictEqual(k.id, 13);
  assert.strictEqual(k.items, 'White Powecom KN95-Earloop Style ×2');
  assert.strictEqual(k.tracking, '92612903031513543475456868');
  assert.strictEqual(k.status, 'shipped');
});

t('a forwarded copy of the same email is not logged twice', () => {
  const pkgs = [];
  applyEmail(pkgs, parseEmail(SHIPSTATION));
  const fwd = Object.assign({}, SHIPSTATION, {
    from: 'Abhijit <abhijit340@gmail.com>', subject: 'Fwd: Your Bonafide Masks order has been shipped!', date: new Date(2026, 9, 25, 11, 36),
    text: '---------- Forwarded message ---------\nFrom: Bona Fide Masks™ <tracking@shipstation.com>\nDate: Wed, Oct 21, 2026\n' +
      'Subject: Your Bonafide Masks order has been shipped!\nTo: <abhijit340@gmail.com>\n\n' + SHIPSTATION.text
  });
  const k = applyEmail(pkgs, parseEmail(fwd));
  assert.strictEqual(pkgs.length, 1);
  assert.strictEqual(k.events.length, 1);
});

t('payment notices are not packages', () => {
  const p = parseEmail({ from: 'QuickBooks Bill Pay <quickbooks@notification.intuit.com>', subject: 'Payment on the way - $264.15 from Critical Energy Systems, Inc.',
    date, text: 'Your payment is on its way and should arrive by Oct 23.', html: '' });
  assert.strictEqual(p.kind, 'ignored');
});

t('totals, taxes and fees are not item names', () => {
  const p = parseEmail({ from: 'Total Wine & More <orders@totalwine.com>', subject: 'Thank you for your order!', date,
    text: 'Order #366135328\nAdditional Fee(s):\nDelivery Fee:\nPlanteray 3 Stars White Rum 750ml\n$22.99\nQty: 1\nGrand total:\n$31.99', html: '' });
  assert.ok(!/fee|grand total/i.test(p.items || ''), 'got: ' + p.items);
});

t('existing 22-digit USPS numbers still work', () => {
  const p = parseEmail({ from: 'Cafe Campesino <tracking@shipstation.com>', subject: 'Your Cafe Campesino order 73957 has shipped', date,
    text: 'your order 73957 was shipped via USPS Priority Mail on 10/13/2026.\nYou can track your package here: 9405550106151069020021.', html: '' });
  assert.strictEqual(p.tracking, '9405550106151069020021');
  assert.strictEqual(p.carrier, 'USPS');
});

console.log(n + ' passed');
