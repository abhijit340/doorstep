// Run: node tests/parse_test.js
// Loads apps-script/Parse.gs (plain JS) and feeds it synthetic shipping emails.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Parse.gs'), 'utf8');
const mod = { exports: {} };
vm.runInNewContext(src, { module: mod, console });
const { parseEmail, applyEmail, findImage, merchantDomain } = mod.exports;

const at = (m, d, h) => new Date(2026, m - 1, d, h, 0, 0);
const SAMPLES = [
  { from: 'Xero Shoes <orders@xeroshoes.com>', subject: 'Order #XS-184233 confirmed', date: at(10, 1, 9),
    text: "Thanks for your order!\nOrder #XS-184233\n\nPrio Men's Running Shoe - Black / 10.5\nQty 1  $89.99\n\nSubtotal $89.99",
    html: '<img src="https://cdn.example.com/logo.png" width="120"><img src="https://cdn.shopify.com/s/files/1/products/prio.jpg" width="200">' },
  { from: 'Xero Shoes <orders@xeroshoes.com>', subject: 'Your order XS-184233 has shipped!', date: at(10, 3, 14),
    text: 'Good news, your order is on its way.\nOrder #XS-184233\nCarrier: UPS\nTracking number: 1Z999AA10123456784\nEstimated delivery: Wednesday, October 7' },
  { from: 'UPS <pkginfo@ups.com>', subject: 'UPS Update: Package Scheduled for Delivery Tomorrow', date: at(10, 6, 7),
    text: 'Tracking Number: 1Z999AA10123456784\nScheduled Delivery: Wednesday, 10/07/2026 by 9:00 P.M.' },
  { from: 'UPS <pkginfo@ups.com>', subject: 'UPS Update: Package Delivered', date: at(10, 7, 13),
    text: 'Tracking Number: 1Z999AA10123456784\nYour package was delivered at the front door.' },
  { from: '"Amazon.com" <shipment-tracking@amazon.com>', subject: 'Shipped: "Darn Tough Hiker Micro Crew Cushion Socks"', date: at(10, 9, 10),
    text: '', html: '<p>Arriving Thursday, October 15</p><img src="https://m.media-amazon.com/images/I/81abc.jpg"><a href="https://www.amazon.com/progress-tracker/package/ref=abc?itemId=xyz&amp;x=1">Track your package</a>' },
  { from: 'USPS <auto-reply@usps.com>', subject: 'USPS® Expected Delivery by Monday, October 12', date: at(10, 9, 8),
    text: 'Tracking Number: 9400111899223147896541\nExpected Delivery by Monday, October 12, 2026' },
  { from: 'REI <rei@notifications.rei.com>', subject: 'Your REI order has shipped', date: at(10, 9, 12),
    text: 'Order number: 61008844\nFedEx tracking: 782391264052\nArriving Oct 14' },
  { from: 'Newsletter <news@store.com>', subject: '20% off this weekend only!', date: at(10, 9, 13), text: 'Big sale. Shop now.' },
  { from: 'Ali from HiringCafe <ali@hiring.cafe>', subject: '18 new jobs for Mechanical engineer in Seattle, WA', date: at(10, 9, 11),
    text: 'Senior Mechanical Engineer\nTracking information for your applications is in your dashboard.' },
  { from: 'UPS <pkginfo@ups.com>', subject: 'Your package will be delivered tomorrow', date: at(10, 9, 9),
    text: 'Tracking Number: 1Z999AA10999999999' },
];

const pkgs = [];
SAMPLES.forEach((s, i) => {
  const p = parseEmail(s);
  console.log(`${i + 1}. ${p.kind.padEnd(16)} ${(p.carrier || '-').padEnd(7)} ${(p.tracking || '-').padEnd(24)} eta=${p.eta}  items=${JSON.stringify(p.items)}`);
  if (p.kind !== 'ignored') applyEmail(pkgs, p);
});
console.log('\nPackages:');
pkgs.forEach(k => console.log(`  #${k.id} [${k.status}] ${k.merchant || '-'} | ${k.carrier || '-'} | eta=${k.eta} | ${k.items} | img=${k.image ? 'yes' : 'no'}`));

assert.strictEqual(pkgs.length, 5, 'expected 5 packages');
const xero = pkgs.find(k => k.merchant === 'Xero Shoes');
assert.strictEqual(xero.status, 'delivered');
assert.strictEqual(xero.tracking, '1Z999AA10123456784');
assert.strictEqual(xero.eta, '2026-10-07');
assert.ok(/Prio/.test(xero.items));
assert.ok(/shopify/.test(xero.image), 'product image, not the logo');
assert.strictEqual(xero.events.length, 4);
assert.strictEqual(xero.merchant_domain, 'xeroshoes.com');
const amz = pkgs.find(k => k.carrier === 'Amazon');
assert.ok(/Darn Tough/.test(amz.items));
assert.ok(/progress-tracker/.test(amz.tracking_url) && !/&amp;/.test(amz.tracking_url));
assert.strictEqual(amz.eta, '2026-10-15');
assert.ok(/media-amazon/.test(amz.image));
const usps = pkgs.find(k => k.carrier === 'USPS');
assert.strictEqual(usps.tracking, '9400111899223147896541');
assert.strictEqual(usps.merchant, '', 'carrier is not the merchant');
const rei = pkgs.find(k => k.merchant === 'REI');
assert.strictEqual(rei.carrier, 'FedEx');
assert.strictEqual(rei.merchant_domain, 'rei.com');
const pending = pkgs.find(k => k.tracking === '1Z999AA10999999999');
assert.notStrictEqual(pending.status, 'delivered', '"will be delivered" is not delivered');
assert.strictEqual(pending.eta, '2026-10-10');
assert.strictEqual(pending.items, '', 'no item name invented from the subject');
assert.strictEqual(parseEmail(SAMPLES[8]).kind, 'ignored', 'job alert ignored');
assert.strictEqual(merchantDomain('a@mail.shop.co.uk'), 'shop.co.uk');
assert.strictEqual(findImage('<img src="https://x.com/pixel.gif" width="1" height="1">'), null);
console.log('\nall good');
