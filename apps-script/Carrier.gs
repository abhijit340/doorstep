/**
 * Carrier check: asks USPS directly about packages that shipped but haven't been marked delivered.
 * Shops that ship through ShipStation and similar send a "shipped" email and nothing after, so
 * without this a package can sit at "Shipped" after it's already in the mail room.
 *
 * Needs a free USPS developer app (developers.usps.com). Its Consumer Key and Secret are stored
 * in Script Properties as USPS_CLIENT_ID / USPS_CLIENT_SECRET via the Doorstep menu
 * ("Connect USPS tracking"). With no credentials this does nothing.
 *
 * USPS allows about 60 calls an hour, so each package is checked at most every 2 hours
 * (every 30 minutes once it's out for delivery), and at most 10 packages per run.
 */

var USPS_BASE = 'https://apis.usps.com';
var USPS_NUMBER_RE = /^(9[1-5]\d{18,24}|82\d{8}|[A-Z]{2}\d{9}US)$/;

/** Is this package one we can ask USPS about? */
function uspsCandidate_(k) {
  if (!k || k.archived || k.received || k.status === 'delivered') return false;
  var t = String(k.tracking || '').replace(/\s+/g, '').toUpperCase();
  if (!t) return false;
  return /usps|postal/i.test(k.carrier || '') || USPS_NUMBER_RE.test(t);
}

/**
 * Turn a USPS tracking response into { status, eta, at, summary } or null when it tells us nothing.
 * Reads the v3 fields defensively: statusCategory / status / statusSummary, expectedDeliveryDate
 * (or a timestamp), and the newest tracking event.
 */
function uspsStatus_(j) {
  if (!j || typeof j !== 'object') return null;
  if (Array.isArray(j)) j = j[0] || {};
  if (j.trackingResults && j.trackingResults.length) j = j.trackingResults[0];
  var events = j.trackingEvents || j.TrackingEvents || [];
  var newest = events.length ? events[0] : null;
  var words = [j.statusCategory, j.status, j.statusSummary, newest && newest.eventType].filter(Boolean).join(' | ');
  if (!words) return null;
  var w = words.toLowerCase();
  var status = null;
  if (/\bdelivered\b/.test(w) && !/undeliverable|not delivered|delivery attempted|attempted/.test(w)) status = 'delivered';
  else if (/out for delivery/.test(w)) status = 'out_for_delivery';
  else if (/in transit|arrived|departed|accepted|processed|on its way|moving through|picked up|shipping partner/.test(w)) status = 'in_transit';
  var eta = String(j.expectedDeliveryDate || j.expectedDeliveryTimeStamp || j.expectedDeliveryTimestamp || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eta)) eta = '';
  var at = String((newest && (newest.eventTimestamp || newest.GMTTimestamp)) || '').slice(0, 19);
  var summary = String(j.statusSummary || j.status || j.statusCategory || '').replace(/\s+/g, ' ').trim();
  if (!status && !eta) return null;
  return { status: status, eta: eta, at: at, summary: summary.slice(0, 200) };
}

/** Apply a USPS result to a package. Status only moves forward. Returns true if anything changed. */
function applyUsps_(k, r, now) {
  if (!r) return false;
  var changed = false;
  if (r.status && (STATUS_RANK[r.status] || 0) > (STATUS_RANK[k.status] || 0)) {
    k.status = r.status;
    k.last_update = stamp_(now);
    if (r.status === 'delivered') k.delivered_at = r.at || stamp_(now);
    k.events = (k.events || []).concat([{ s: r.status, at: r.at || stamp_(now), t: 'USPS: ' + (r.summary || r.status), f: 'USPS' }]);
    changed = true;
  }
  if (r.eta && r.eta !== k.eta && k.status !== 'delivered') { k.eta = r.eta; changed = true; }
  return changed;
}

// ---- Apps Script side (network, properties). Not run in the Node tests. ----

function uspsToken_() {
  var p = props_(), id = p.getProperty('USPS_CLIENT_ID'), secret = p.getProperty('USPS_CLIENT_SECRET');
  if (!id || !secret) return null;
  var cache = CacheService.getScriptCache(), cached = cache.get('USPS_TOKEN');
  if (cached) return cached;
  var res = UrlFetchApp.fetch(USPS_BASE + '/oauth2/v3/token', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ grant_type: 'client_credentials', client_id: id, client_secret: secret })
  });
  if (res.getResponseCode() !== 200) throw new Error('USPS sign-in failed (' + res.getResponseCode() + ')');
  var j = JSON.parse(res.getContentText());
  var ttl = Math.max(60, Math.min(21600, (Number(j.expires_in) || 3600) - 120));
  cache.put('USPS_TOKEN', j.access_token, ttl);
  return j.access_token;
}

function uspsLookup_(token, number) {
  var res = UrlFetchApp.fetch(USPS_BASE + '/tracking/v3/tracking/' + encodeURIComponent(number) + '?expand=DETAIL', {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 401 || code === 403) { CacheService.getScriptCache().remove('USPS_TOKEN'); throw new Error('USPS refused the request (' + code + ')'); }
  if (code === 429) throw new Error('USPS rate limit');
  if (code !== 200) return null;   // not found yet, or a number USPS doesn't know
  return uspsStatus_(JSON.parse(res.getContentText()));
}

/**
 * Check due USPS packages and update them in place. Called from poll() inside its lock.
 * Returns the number of packages changed; never throws (a USPS problem must not stop mail filing).
 */
function checkCarriers_(pkgs) {
  try {
    var due = [], now = new Date(), seen = {};
    try { seen = JSON.parse(props_().getProperty('USPS_CHECKED') || '{}'); } catch (e) { seen = {}; }
    pkgs.forEach(function (k) {
      if (!uspsCandidate_(k)) return;
      var gap = (k.status === 'out_for_delivery' ? 30 : 120) * 60 * 1000;
      if (seen[k.id] && now - new Date(seen[k.id]) < gap) return;
      due.push(k);
    });
    if (!due.length) return 0;
    var token = uspsToken_();
    if (!token) return 0;
    var changed = 0;
    due.slice(0, 10).forEach(function (k) {
      var r = uspsLookup_(token, String(k.tracking).replace(/\s+/g, '').toUpperCase());
      seen[k.id] = now.toISOString();
      if (applyUsps_(k, r, now)) changed++;
    });
    // Forget packages that are done, so the property stays small.
    var live = {};
    pkgs.forEach(function (k) { if (seen[k.id] && uspsCandidate_(k)) live[k.id] = seen[k.id]; });
    props_().setProperty('USPS_CHECKED', JSON.stringify(live));
    props_().setProperty('USPS_LAST', now.toISOString() + (changed ? ' · ' + changed + ' updated' : ''));
    return changed;
  } catch (e) {
    console.warn('USPS check skipped: ' + e);
    props_().setProperty('USPS_LAST', new Date().toISOString() + ' · error: ' + String(e.message || e).slice(0, 120));
    return 0;
  }
}

if (typeof module !== 'undefined') {
  module.exports = { uspsCandidate_: uspsCandidate_, uspsStatus_: uspsStatus_, applyUsps_: applyUsps_ };
}
