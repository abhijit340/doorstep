/**
 * Pure parsing and linking rules: no Apps Script services in this file, so the
 * same code runs under Node for tests (tests/parse_test.js).
 */

var CARRIER_DOMAINS = {
  'ups.com': 'UPS', 'usps.com': 'USPS', 'fedex.com': 'FedEx', 'dhl.com': 'DHL',
  'amazon.com': 'Amazon', 'ontrac.com': 'OnTrac', 'lasership.com': 'LaserShip'
};

// Order matters: specific formats before generic ones.
var TRACKING_PATTERNS = [
  ['UPS', /\b(1Z[0-9A-Z]{16})\b/],
  ['Amazon', /\b(TBA\d{12,15})\b/],
  ['USPS', /\b(9[2345]\d{20}|9\d{21}|[A-Z]{2}\d{9}US)\b/],
  ['FedEx', /\b(\d{12}|\d{15}|\d{20})\b/],
  ['DHL', /\b(\d{10})\b/]
];

var TRACKING_URLS = {
  'UPS': 'https://www.ups.com/track?tracknum={t}',
  'USPS': 'https://tools.usps.com/go/TrackConfirmAction?tLabels={t}',
  'FedEx': 'https://www.fedex.com/fedextrack/?trknbr={t}',
  'DHL': 'https://www.dhl.com/us-en/home/tracking.html?tracking-id={t}',
  'OnTrac': 'https://www.ontrac.com/tracking/?number={t}',
  'LaserShip': 'https://www.lasership.com/track/{t}'
};

var MONTH_NUM = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, dec: 12
};
var MONTHS_RE = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec';

var STATUS_FOR_KIND = {
  order: 'ordered', shipped: 'shipped', update: 'in_transit',
  out_for_delivery: 'out_for_delivery', delivered: 'delivered'
};
var STATUS_RANK = { ordered: 0, shipped: 1, in_transit: 2, out_for_delivery: 3, delivered: 4 };

function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function ymd_(d) { return d.getFullYear() + '-' + pad2_(d.getMonth() + 1) + '-' + pad2_(d.getDate()); }
function stamp_(d) {
  return ymd_(d) + 'T' + pad2_(d.getHours()) + ':' + pad2_(d.getMinutes()) + ':' + pad2_(d.getSeconds());
}

var ENTITIES = { ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
  reg: '®', trade: '™', copy: '©', middot: '·', bull: '•' };

function decodeEntities(t) {
  return String(t || '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, function (m, n) {
      return String.fromCharCode(Number(n));
    }).replace(/&#x([0-9a-f]+);/gi, function (m, n) {
      return String.fromCharCode(parseInt(n, 16));
    }).replace(/&(ndash|mdash|rsquo|lsquo|rdquo|ldquo|hellip|reg|trade|copy|middot|bull);/g, function (m, n) {
      return ENTITIES[n];
    });
}

function htmlToText(html) {
  var t = String(html || '');
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>/gi, '\n');
  t = t.replace(/<\/td>/gi, '  ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  t = t.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  return t.trim();
}

function parseFrom(raw) {
  var m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(raw || '');
  var name = m ? m[1].trim() : '';
  var addr = (m ? m[2] : String(raw || '')).trim().toLowerCase();
  return { name: name || addr.split('@')[0], addr: addr };
}

function classify(subject, body) {
  var s = subject.toLowerCase();
  var b = body.toLowerCase();
  var future = /\b(will be|to be|scheduled to be|expected to be) delivered/.test(s);
  if ((!future && /\b(has been delivered|was delivered|delivered\b)/.test(s)) ||
      /\b(package|order|shipment)\b[^.\n]{0,40}\b(has been|was) delivered/.test(b)) return 'delivered';
  if (s.indexOf('out for delivery') >= 0 || b.slice(0, 1500).indexOf('out for delivery') >= 0) return 'out_for_delivery';
  if (/\b(shipped|on its way|on the way|is on its way|has shipped|tracking number|shipment confirmation)\b/.test(s)) return 'shipped';
  if (/\b(delay|delayed|exception|update on your|arriving (early|late|today|tomorrow)|new delivery date|rescheduled|scheduled for delivery|expected delivery|delivery (today|tomorrow|update)|package update)\b/.test(s)) return 'update';
  if (/\b(order confirmation|order confirmed|thanks? for your order|thank you for your (order|purchase)|we('ve| have) received your order|your order\b|order #|order number|receipt for)\b/.test(s)) return 'order';
  if (/\b(shipped|shipment|tracking)\b/.test(s)) return 'shipped';
  return 'ignored';
}

function findTracking(text) {
  var low = text.toLowerCase();
  for (var i = 0; i < TRACKING_PATTERNS.length; i++) {
    var carrier = TRACKING_PATTERNS[i][0];
    // Numeric-only formats are too generic to trust without the carrier named nearby.
    if ((carrier === 'FedEx' || carrier === 'DHL') && low.indexOf(carrier.toLowerCase()) < 0) continue;
    var m = TRACKING_PATTERNS[i][1].exec(text);
    if (m) return { tracking: m[1], carrier: carrier };
  }
  var g = /tracking\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9]{8,34})\b/i.exec(text);
  if (g && /\d/.test(g[1])) return { tracking: g[1], carrier: null };
  return { tracking: null, carrier: null };
}

function findCarrier(text, fromAddr) {
  for (var dom in CARRIER_DOMAINS) {
    if (fromAddr.slice(-dom.length) === dom) return CARRIER_DOMAINS[dom];
  }
  var low = text.toLowerCase();
  var names = ['UPS', 'USPS', 'FedEx', 'DHL', 'OnTrac', 'LaserShip'];
  for (var i = 0; i < names.length; i++) {
    if (new RegExp('\\b' + names[i].toLowerCase() + '\\b').test(low)) return names[i];
  }
  return null;
}

function findMerchant(fromName, fromAddr) {
  var name = fromName.replace(/\b(shipping|orders?|no-?reply|notifications?|customer (service|care)|team|support|updates?)\b/gi, '');
  name = name.replace(/[|\-–—:]+.*$/, '').replace(/^[\s,.]+|[\s,.]+$/g, '');
  if (name && ['info', 'hello', 'mail', 'noreply'].indexOf(name.toLowerCase()) < 0) return name;
  var d = merchantDomain(fromAddr);
  return d ? d.split('.')[0].replace(/^./, function (c) { return c.toUpperCase(); }) : 'Unknown';
}

/** Registrable-looking domain of the sender, e.g. "mail.rei.com" -> "rei.com". */
function merchantDomain(fromAddr) {
  var host = (fromAddr.split('@')[1] || '').toLowerCase();
  if (!host) return '';
  var parts = host.split('.');
  if (parts.length <= 2) return host;
  var twoLevel = /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  return parts.slice(twoLevel ? -3 : -2).join('.');
}

function findOrderNumber(text) {
  var re = /\border\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{4,24})\b/gi;
  var m;
  while ((m = re.exec(text))) {
    var c = m[1];
    if (/\d/.test(c) && !/^(number|confirm\w*|details?|status|total|date)$/i.test(c)) return c;
  }
  return null;
}

function findEta(text, received) {
  var day = 86400000;
  var t = /(?:arriv\w*|deliver\w*)\W{0,20}(today|tomorrow)/i.exec(text);
  if (t) return ymd_(new Date(received.getTime() + (t[1].toLowerCase() === 'tomorrow' ? day : 0)));
  var re = new RegExp(
    '(?:arriv\\w*|expected|estimated|delivery date|deliver\\w*|get it|by)\\W{0,40}(?:\\(\\d+ items?\\)\\W{0,5})?' +
    '(?:(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?\\.?,?\\s*)?' +
    '(?:(' + MONTHS_RE + ')\\.?\\s+(\\d{1,2})|(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?)', 'gi');
  var m;
  while ((m = re.exec(text))) {
    var month, dayNum, year = received.getFullYear();
    if (m[1]) { month = MONTH_NUM[m[1].toLowerCase()]; dayNum = Number(m[2]); }
    else {
      month = Number(m[3]); dayNum = Number(m[4]);
      if (m[5]) { year = Number(m[5]); if (year < 100) year += 2000; }
    }
    if (!(month >= 1 && month <= 12 && dayNum >= 1 && dayNum <= 31)) continue;
    var d = new Date(year, month - 1, dayNum);
    if (d.getMonth() !== month - 1) continue;
    if (d.getTime() < received.getTime() - 7 * day) d = new Date(year + 1, month - 1, dayNum);
    if (d.getTime() > received.getTime() + 60 * day) continue;
    return ymd_(d);
  }
  return null;
}

/** Best-effort item names. Amazon puts them in the subject; stores list them in the order email. */
function findItems(subject, body, kind, htmlBody) {
  var m = /(?:shipped|delivered|ordered|arriving|on its way)\s*:\s*["“']?(.{6,120}?)["”']?\s*$/i.exec(subject);
  if (m && !/\border\b.*#/i.test(m[1]) && !/^(your|the|a|an|\d+ items?)\b/i.test(m[1])) return m[1].replace(/[\s.!]+$/, '');
  m = /["“]([^"”]{6,120})["”]/.exec(subject);
  if (m) return m[1];
  // Shipping notices rarely list items cleanly; the order confirmation does.
  if (kind !== 'order') return null;
  var out = [], seen = {};
  var lines = body.split(/\r?\n/);
  // Stores like REI print "Product Name Black Item #C13270" with "Qty: 3" nearby; trust those first.
  // The plain-text part can be mangled, so also look in the HTML part's text.
  var itemLines = lines.concat(String(htmlBody || '').split(/\r?\n/));
  var COLOR = '(?:black|white|gr[ae]y|blue|green|red|navy|tan|brown|olive|orange|yellow|pink|purple)';
  var itemRe = new RegExp('(?:^|\\|)\\s*([A-Za-z][^|]{3,100}?)\\s+(?:' + COLOR + '\\s+)?(?:item|style|sku)\\s*#\\s*[A-Z0-9-]+', 'i');
  for (var j = 0; j < itemLines.length && out.length < 3; j++) {
    var im = itemRe.exec(itemLines[j]);
    // Shopify's order summary: "Product Name × 1".
    var sm = !im && /^\s*([A-Za-z][^|\[\]]{3,100}?)\s+×\s*(\d+)\s*$/.exec(itemLines[j]);
    if (sm) {
      var nm = sm[1].trim() + (Number(sm[2]) > 1 ? ' ×' + sm[2] : '');
      if (!seen[nm.toLowerCase()]) { seen[nm.toLowerCase()] = true; out.push(nm); }
      continue;
    }
    if (!im) continue;
    var name = im[1].replace(/\[\]\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    var q = /\bqty:?\s*(\d+)/i.exec(itemLines.slice(j, j + 4).join(' '));
    if (q && Number(q[1]) > 1) name += ' ×' + q[1];
    if (!seen[name.toLowerCase()]) { seen[name.toLowerCase()] = true; out.push(name); }
  }
  if (out.length) return out.join('; ');
  var skipUntil = -1, lastAdded = -1;
  for (var i = 0; i < lines.length && out.length < 3; i++) {
    var line = lines[i].trim();
    // Name/address blocks: skip the few lines after a "Ship to" style header.
    if (/^(ship(ping)? to|shipping address|billing address|bill to|sold to|deliver(y|ing) to|customer information|recipient)\b/i.test(line)) { skipUntil = i + 3; continue; }
    if (i <= skipUntil) continue;
    // A street address line also means the line just before it was probably a name.
    if (/^\d+\s+\S+.*\b(st|street|ave|avenue|rd|road|blvd|way|dr|drive|ln|lane|ct|court|pl|place|pkwy|hwy)\b\.?(\s+(n|s|e|w|ne|nw|se|sw)\b)?/i.test(line)) {
      if (lastAdded === i - 1 && out.length) out.pop();
      continue;
    }
    if (/click here|shown below|summary|view (the |your )?(status|order)|unsubscribe|privacy|terms|customer service|contact us|order details|\bvia\b|ending in|\bmember\b|you paid|payment|receipt/i.test(line)) continue;
    if (/^\d/.test(line)) continue;
    if (line.length < 8 || line.length > 110) continue;
    if (/^(qty|quantity|price|subtotal|total|tax|shipping|order|item|sku|track|view|thank|hi |hello|your|we|the |this |if |to |for |please|questions|http|©|\d+ x )/i.test(line)) continue;
    if (/\b(arriv|carrier|estimated|delivery|shipped|tracking|on its way|good news)/i.test(line)) continue;
    if (/\$|\d{5,}|@|\bhttp/.test(line)) continue;
    if (/\b(qty|quantity)\b/i.test(line)) continue;
    var k = line.toLowerCase();
    if (!seen[k]) { seen[k] = true; out.push(line); lastAdded = i; }
  }
  return out.length ? out.join('; ') : null;
}

function trackingUrl(carrier, tracking, html) {
  if (tracking && TRACKING_URLS[carrier]) return TRACKING_URLS[carrier].replace('{t}', tracking);
  // Fall back to the first tracking-looking link in the email (Amazon, Shopify).
  var m = /href=["']([^"']*(?:track|progress-tracker|ship)[^"']*)["']/i.exec(html || '');
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

/** First image in the email that looks like a product photo rather than a logo or tracking pixel. */
function findImage(html) {
  var re = /<img\b[^>]*>/gi, tag, fallback = null;
  while ((tag = re.exec(html || ''))) {
    var t = tag[0];
    var src = (/\bsrc=["']([^"']+)["']/i.exec(t) || [])[1];
    if (!src || !/^https:\/\//i.test(src)) continue;
    src = src.replace(/&amp;/g, '&');
    var w = Number((/\bwidth=["']?(\d+)/i.exec(t) || [])[1] || 0);
    var h = Number((/\bheight=["']?(\d+)/i.exec(t) || [])[1] || 0);
    if ((w && w < 60) || (h && h < 60)) continue;
    if (/(logo|icon|spacer|pixel|beacon|open\.|\/o\/|facebook|twitter|instagram|youtube|badge|banner|header|footer|social|sprite|arrow|button|star|rating)/i.test(src + ' ' + t.replace(src, ''))) continue;
    if (/(product|item|images-amazon|media-amazon|ssl-images|cdn\.shopify\.com|\/products\/)/i.test(src)) return src;
    if (!fallback && (w >= 100 || h >= 100) && /\.(jpe?g|png|webp)(\?|$)/i.test(src)) fallback = src;
  }
  return fallback;
}

/** msg: {from, subject, date (Date), text, html}. Returns everything the rules could find. */
function parseEmail(msg) {
  var from = parseFrom(msg.from);
  var body = msg.text ? decodeEntities(msg.text) : htmlToText(msg.html);
  var subject = String(msg.subject || '').replace(/^(fwd?|fw):\s*/i, '');
  var htmlBody = msg.text && msg.html ? htmlToText(msg.html) : '';
  // Forwarded by hand: read the original sender and subject, and drop the forward header.
  var fwd = /-{5,}\s*Forwarded message\s*-{5,}\s*\n([\s\S]*?)\n\s*\n/i.exec(body);
  if (fwd) {
    var head = fwd[1];
    var ff = /^\s*From:\s*(.+)$/im.exec(head), fs = /^\s*Subject:\s*(.+)$/im.exec(head);
    if (ff) from = parseFrom(ff[1].replace(/\*/g, '').trim());
    if (fs) subject = fs[1].trim();
    body = body.slice(fwd.index + fwd[0].length);
    var hf = /Forwarded message[\s\S]*?Subject:[^\n]*\n(?:\s*To:[^\n]*\n)?/i.exec(htmlBody);
    if (hf) htmlBody = htmlBody.slice(hf.index + hf[0].length);
  }
  var text = subject + '\n' + body;
  var kind = classify(subject, body);
  // Event tickets are "orders" that never ship.
  if (/ticketmaster|livenation|axs\.com|stubhub|seatgeek|eventbrite|vividseats|dice\.fm|cashortrade|tock|opentable|resy/i.test(from.addr)) kind = 'ignored';
  var t = findTracking(text);
  var carrier = t.carrier || findCarrier(text, from.addr);
  // A carrier email we didn't recognise by subject, but it carries a real tracking number.
  if (kind === 'ignored' && t.tracking && t.carrier) kind = 'update';
  var real = kind !== 'ignored';
  var merchant = findMerchant(from.name, from.addr);
  // A UPS "your package is on its way" email: the merchant is unknown, not "UPS".
  var carrierIsMerchant = !!(carrier && merchant && merchant.toLowerCase().replace(/\.com$/, '') === carrier.toLowerCase());
  return {
    kind: kind,
    subject: subject,
    from_name: from.name,
    received: stamp_(msg.date),
    tracking: real ? t.tracking : null,
    carrier: carrier,
    merchant: carrierIsMerchant && carrier !== 'Amazon' ? null : merchant,
    merchant_domain: carrierIsMerchant && carrier !== 'Amazon' ? '' : merchantDomain(from.addr),
    order_number: real ? findOrderNumber(text) : null,
    items: real ? findItems(subject, body, kind, htmlBody) : null,
    eta: real ? findEta(text, msg.date) : null,
    tracking_url: real ? trackingUrl(carrier, t.tracking, msg.html) : null,
    image: real && (kind === 'order' || kind === 'shipped') ? findImage(msg.html) : null
  };
}

function findPackage(pkgs, p) {
  var i;
  if (p.tracking) for (i = 0; i < pkgs.length; i++) if (pkgs[i].tracking === p.tracking) return pkgs[i];
  if (p.order_number) for (i = pkgs.length - 1; i >= 0; i--) if (pkgs[i].order_number === p.order_number) return pkgs[i];
  if (p.merchant) {
    var now = new Date(p.received).getTime(), window = 21 * 86400000;
    for (i = pkgs.length - 1; i >= 0; i--) {
      var k = pkgs[i];
      if (k.merchant === p.merchant && !k.tracking && k.status === 'ordered' &&
          Math.abs(new Date(k.last_update).getTime() - now) <= window) return k;
    }
  }
  return null;
}

/** File one parsed email into the package list (mutates pkgs). Returns the package it touched. */
function applyEmail(pkgs, p) {
  var status = STATUS_FOR_KIND[p.kind];
  var pkg = findPackage(pkgs, p);
  if (!pkg) {
    var maxId = 0;
    for (var i = 0; i < pkgs.length; i++) maxId = Math.max(maxId, Number(pkgs[i].id) || 0);
    pkg = {
      id: maxId + 1, items: p.items || '', merchant: p.merchant || '', carrier: p.carrier || '',
      status: status, eta: p.eta || '', tracking: p.tracking || '', tracking_url: p.tracking_url || '',
      last_update: p.received, ordered_at: p.kind === 'order' ? p.received : '',
      delivered_at: p.kind === 'delivered' ? p.received : '', order_number: p.order_number || '',
      notes: '', archived: false, image: p.image || '', merchant_domain: p.merchant_domain || '', events: []
    };
    pkgs.push(pkg);
  } else {
    // Only move status forward, never back from delivered.
    if (STATUS_RANK[status] >= (STATUS_RANK[pkg.status] || 0)) pkg.status = status;
    var fill = ['tracking', 'carrier', 'order_number', 'items', 'eta', 'tracking_url', 'image', 'merchant', 'merchant_domain'];
    for (var j = 0; j < fill.length; j++) if (p[fill[j]] && !pkg[fill[j]]) pkg[fill[j]] = p[fill[j]];
    if (p.eta && (p.kind === 'update' || p.kind === 'shipped' || p.kind === 'out_for_delivery')) pkg.eta = p.eta;
    if (p.kind === 'delivered' && !pkg.delivered_at) pkg.delivered_at = p.received;
    if (p.kind === 'order' && !pkg.ordered_at) pkg.ordered_at = p.received;
    if (p.received > pkg.last_update) pkg.last_update = p.received;
  }
  pkg.events.unshift({ s: status, at: p.received, t: p.subject, f: p.from_name });
  if (pkg.events.length > 20) pkg.events.length = 20;
  return pkg;
}

if (typeof module !== 'undefined') {
  module.exports = { parseEmail: parseEmail, applyEmail: applyEmail, htmlToText: htmlToText,
                     findImage: findImage, merchantDomain: merchantDomain, classify: classify };
}
