// Run: node tests/notify_test.js
// Loads Code.gs + Parse.gs with fake Google services and checks the notification rules.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const sent = [];
const props = { LAST_RUN: '2026-10-15T00:00:00Z', NOTIFY_EMAIL: 'me@example.com' };
const triggers = [];
const ctx = {
  console, module: { exports: {} },
  MailApp: { sendEmail: m => sent.push(m) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'tracker@example.com' }), getScriptTimeZone: () => 'America/Los_Angeles' },
  Utilities: { formatDate: () => '2026-10-16' },
  ScriptApp: {
    getService: () => ({ getUrl: () => '' }),
    getProjectTriggers: () => triggers,
    newTrigger: fn => ({ timeBased: () => ({ atHour: () => ({ everyDays: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) }),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
};
vm.createContext(ctx);
for (const f of ['Parse.gs', 'Code.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx);

const pk = (o) => Object.assign({ id: 1, items: '', merchant: '', carrier: '', status: 'shipped', eta: '', tracking_url: '', archived: false, received: false }, o);
ctx.readPackages_ = () => [
  pk({ id: 1, items: 'Scale', merchant: 'Kick Ave', eta: '2026-10-16', tracking_url: 'https://tools.usps.com/x' }),
  pk({ id: 2, items: 'Headlamps', status: 'out_for_delivery' }),
  pk({ id: 3, items: 'Tomorrow thing', eta: '2026-10-17' }),
  pk({ id: 4, items: 'Already here', eta: '2026-10-16', status: 'delivered' }),
  pk({ id: 5, items: 'Got it already', eta: '2026-10-16', received: true }),
];
ctx.morningDigest();
assert.strictEqual(sent.length, 1);
assert.strictEqual(sent[0].to, 'me@example.com');
assert.strictEqual(sent[0].subject, 'Doorstep: Arriving today: Scale, Headlamps');
assert.ok(/href="https:\/\/tools\.usps\.com\/x"/.test(sent[0].htmlBody));

// Nothing due: no email.
sent.length = 0;
ctx.readPackages_ = () => [pk({ id: 3, items: 'Tomorrow thing', eta: '2026-10-17' })];
ctx.morningDigest();
assert.strictEqual(sent.length, 0);

// Turned off: no email.
props.NOTIFY = 'off';
ctx.readPackages_ = () => [pk({ id: 2, items: 'Headlamps', status: 'out_for_delivery' })];
ctx.morningDigest();
assert.strictEqual(sent.length, 0);
delete props.NOTIFY;

// The digest trigger is created once.
ctx.ensureDigestTrigger_(); ctx.ensureDigestTrigger_();
assert.strictEqual(triggers.filter(t => t.getHandlerFunction() === 'morningDigest').length, 1);

console.log('notify: all good');
