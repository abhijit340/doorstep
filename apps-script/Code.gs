/**
 * Package Tracker: reads shipping emails from this account's inbox (read-only),
 * keeps one row per package in the "Packages" tab, and serves that list to the
 * phone page for anyone holding the secret key.
 *
 * One-time: run setup() from the editor. It creates the tabs, the key and the
 * 15-minute trigger, then logs the key.
 */

var TAB_PKG = 'Packages';
var TAB_MAIL = 'Emails';
// Human-readable columns first; bookkeeping columns at the end.
var COLS = ['items', 'merchant', 'carrier', 'status', 'eta', 'tracking', 'tracking_url', 'last_update',
            'ordered_at', 'delivered_at', 'order_number', 'notes', 'archived', 'image', 'merchant_domain',
            'id', 'events'];
var MAIL_COLS = ['message_id', 'received', 'from', 'subject', 'kind', 'package_id'];
var EDITABLE = ['items', 'merchant', 'carrier', 'status', 'eta', 'tracking', 'tracking_url', 'notes', 'archived', 'image'];

function props_() { return PropertiesService.getScriptProperties(); }

function tab_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  // Plain text everywhere: tracking numbers are too long for number cells, and dates must stay as typed.
  sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/** Run once from the editor. Safe to run again. */
function setup() {
  tab_(TAB_PKG, COLS);
  tab_(TAB_MAIL, MAIL_COLS);
  var p = props_();
  if (!p.getProperty('KEY')) p.setProperty('KEY', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'poll') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(15).create();
  var result = poll();
  Logger.log('Setup done. ' + JSON.stringify(result));
  Logger.log('KEY: ' + p.getProperty('KEY'));
}

/** Replace the key. Anyone using the old one loses access. */
function rotateKey() {
  props_().setProperty('KEY', (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''));
  Logger.log('KEY: ' + props_().getProperty('KEY'));
}

function readPackages_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_PKG);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).getDisplayValues();
  var out = [];
  rows.forEach(function (r) {
    var o = {};
    COLS.forEach(function (c, i) { o[c] = r[i]; });
    if (!o.id && !o.items && !o.tracking && !o.merchant) return;   // blank row
    o.id = Number(o.id) || 0;
    o.archived = /^(true|yes|1|x)$/i.test(String(o.archived).trim());
    try { o.events = o.events ? JSON.parse(o.events) : []; } catch (e) { o.events = []; }
    out.push(o);
  });
  // Rows typed in by hand have no id yet.
  var maxId = out.reduce(function (m, o) { return Math.max(m, o.id); }, 0);
  out.forEach(function (o) {
    if (!o.id) { o.id = ++maxId; if (!o.status) o.status = 'shipped'; if (!o.last_update) o.last_update = stamp_(new Date()); }
  });
  return out;
}

function writePackages_(pkgs) {
  var sh = tab_(TAB_PKG, COLS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, COLS.length).clearContent();
  if (!pkgs.length) return;
  var rows = pkgs.map(function (o) {
    return COLS.map(function (c) {
      if (c === 'events') return JSON.stringify(o.events || []);
      if (c === 'archived') return o.archived ? 'TRUE' : '';
      return o[c] === null || o[c] === undefined ? '' : String(o[c]);
    });
  });
  sh.getRange(2, 1, rows.length, COLS.length).setNumberFormat('@').setValues(rows);
}

function header_(payload, name) {
  var hs = payload.headers || [];
  for (var i = 0; i < hs.length; i++) if (hs[i].name.toLowerCase() === name) return hs[i].value;
  return '';
}

function bodies_(part, acc) {
  if (part.parts) part.parts.forEach(function (p) { bodies_(p, acc); });
  var isAttachment = part.filename && part.filename.length;
  if (!isAttachment && part.body && part.body.data && (part.mimeType === 'text/plain' || part.mimeType === 'text/html')) {
    var text = Utilities.newBlob(Utilities.base64DecodeWebSafe(part.body.data)).getDataAsString();
    if (part.mimeType === 'text/plain') acc.text += text + '\n'; else acc.html += text + '\n';
  }
  return acc;
}

/** Fetch new mail, file it, save. Runs every 15 minutes and on demand from the page. */
function poll() {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var mailTab = tab_(TAB_MAIL, MAIL_COLS);
    var seen = {};
    if (mailTab.getLastRow() > 1) {
      mailTab.getRange(2, 1, mailTab.getLastRow() - 1, 1).getDisplayValues().forEach(function (r) { seen[r[0]] = true; });
    }
    var firstRun = !props_().getProperty('LAST_RUN');
    var q = 'in:inbox newer_than:' + (firstRun ? 30 : 3) + 'd';
    var ids = [], token;
    do {
      var page = Gmail.Users.Messages.list('me', { q: q, maxResults: 100, pageToken: token });
      (page.messages || []).forEach(function (m) { if (!seen[m.id]) ids.push(m.id); });
      token = page.nextPageToken;
    } while (token && ids.length < 300);

    var msgs = ids.map(function (id) {
      var full = Gmail.Users.Messages.get('me', id, { format: 'full' });
      var b = bodies_(full.payload, { text: '', html: '' });
      return { id: id, from: header_(full.payload, 'from'), subject: header_(full.payload, 'subject'),
               date: new Date(Number(full.internalDate)), text: b.html ? htmlToText(b.html) : b.text, html: b.html };
    });
    msgs.sort(function (a, b) { return a.date - b.date; });   // oldest first, so status moves forward

    var pkgs = readPackages_();
    var log = [], filed = 0;
    msgs.forEach(function (m) {
      var p = parseEmail(m), pkgId = '';
      if (p.kind !== 'ignored') { pkgId = applyEmail(pkgs, p).id; filed++; }
      log.push([m.id, p.received, m.from, p.subject, p.kind, String(pkgId)]);
    });
    if (filed) writePackages_(pkgs);
    if (log.length) {
      mailTab.getRange(mailTab.getLastRow() + 1, 1, log.length, MAIL_COLS.length).setNumberFormat('@').setValues(log);
    }
    props_().setProperty('LAST_RUN', new Date().toISOString());
    return { emails: msgs.length, filed: filed, packages: pkgs.length };
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function keyOk_(key) {
  var real = props_().getProperty('KEY');
  return !!real && key === real;
}

function snapshot_() {
  return { ok: true, packages: readPackages_(), last_run: props_().getProperty('LAST_RUN') || '' };
}

function doGet(e) {
  if (!keyOk_(e && e.parameter && e.parameter.key)) return json_({ ok: false, error: 'bad key' });
  return json_(snapshot_());
}

/** Body: {key, action: 'edit', id, fields: {...}} or {key, action: 'refresh'}. */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad request' }); }
  if (!keyOk_(req.key)) return json_({ ok: false, error: 'bad key' });
  if (req.action === 'refresh') {
    try { poll(); } catch (err) { return json_({ ok: false, error: String(err) }); }
    return json_(snapshot_());
  }
  if (req.action === 'edit') {
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try {
      var pkgs = readPackages_();
      var pkg = pkgs.filter(function (p) { return p.id === Number(req.id); })[0];
      if (!pkg) return json_({ ok: false, error: 'no such package' });
      EDITABLE.forEach(function (f) {
        if (req.fields && req.fields[f] !== undefined) pkg[f] = f === 'archived' ? !!req.fields[f] : String(req.fields[f]);
      });
      if (pkg.status === 'delivered' && !pkg.delivered_at) pkg.delivered_at = stamp_(new Date());
      writePackages_(pkgs);
    } finally {
      lock.releaseLock();
    }
    return json_(snapshot_());
  }
  return json_({ ok: false, error: 'unknown action' });
}
