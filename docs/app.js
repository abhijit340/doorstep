// Static page: no data lives here. It asks your private Apps Script for the package
// list (using the secret link stored on this device) and draws it.
const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  del: k => { try { localStorage.removeItem(k); } catch (e) {} },
};
const KEEP_DELIVERED_DAYS = 30;
const STATUS_LABEL = {
  ordered: "Ordered", shipped: "Shipped", in_transit: "In transit",
  out_for_delivery: "Out for delivery", delivered: "Delivered",
};
const CARRIER_ICON = { UPS: "🟫", USPS: "📬", FedEx: "🟪", Amazon: "📦", DHL: "🟨" };

let view = "delivered";
let data = { packages: [], last_run: "" };
let current = null;

// Served by the tracker's own Apps Script (no hosted page, no key): talk to it directly.
const EMBED = typeof google !== "undefined" && !!(google.script && google.script.run);

function conn() {
  if (EMBED) return { embed: true };
  const link = store.get("pt.link");
  if (!link) return null;
  try {
    const u = new URL(link);
    const key = u.searchParams.get("key");
    if (!key || !/^https:\/\/script\.google\.com\//.test(link)) return null;
    return { base: u.origin + u.pathname, key };
  } catch (e) { return null; }
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeUrl(u) { return /^https:\/\//i.test(u || "") ? u : ""; }

function fmtDate(iso, withTime) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return iso;
  const opts = { weekday: "short", month: "short", day: "numeric" };
  if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleString(undefined, opts);
}
function dayDiff(ymd) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(ymd + "T00:00:00") - today) / 86400000);
}
function etaLabel(p) {
  if (p.received) return "Picked up " + fmtDate(p.received_at || p.last_update);
  if (p.archived && p.status !== "delivered") return "Archived";
  if (p.status === "delivered") return "Delivered " + fmtDate(p.delivered_at || p.last_update) + " — check for it";
  if (p.status === "out_for_delivery") return "Out for delivery today";
  if (!p.eta) return STATUS_LABEL[p.status] || "";
  const diff = dayDiff(p.eta);
  if (diff === 0) return "Arriving today";
  if (diff === 1) return "Arriving tomorrow";
  if (diff < 0) return "Was due " + fmtDate(p.eta);
  return "Arriving " + fmtDate(p.eta);
}
function etaClass(p) {
  if (p.received || p.archived) return "eta";
  if (p.status === "delivered") return "eta today";
  if (p.status === "out_for_delivery") return "eta today";
  if (!p.eta) return "eta";
  const diff = dayDiff(p.eta);
  return diff === 0 ? "eta today" : diff < 0 ? "eta late" : "eta";
}
function title(p) { return p.items || (p.merchant ? p.merchant + " order" : "Package"); }

function thumb(p) {
  const img = safeUrl(p.image);
  const fallback = esc(CARRIER_ICON[p.carrier] || "📦");
  if (img) return `<div class="thumb"><img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${fallback}"></div>`;
  if (p.merchant_domain && /^[a-z0-9.-]+$/i.test(p.merchant_domain)) {
    return `<div class="thumb"><img class="logo" src="https://www.google.com/s2/favicons?domain=${esc(p.merchant_domain)}&sz=128" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${fallback}"></div>`;
  }
  return `<div class="thumb">${fallback}</div>`;
}
// Broken images fall back to an icon.
document.addEventListener("error", e => {
  const t = e.target;
  if (t.tagName === "IMG" && t.dataset.fallback) t.parentNode.textContent = t.dataset.fallback;
}, true);

// Views: "delivered" = at the door, not yet picked up (stays until you tap Got it);
// "arriving" = still in transit; "done" = picked up or archived, last 30 days.
function viewOf(p) {
  if (p.archived || p.received) return "done";
  return p.status === "delivered" ? "delivered" : "arriving";
}
function inView(p) {
  if (viewOf(p) !== view) return false;
  if (view === "done") {
    const when = new Date(p.received_at || p.delivered_at || p.last_update);
    return isNaN(when) || (Date.now() - when) / 86400000 <= KEEP_DELIVERED_DAYS;
  }
  return true;
}
function sortKey(p) {
  if (view !== "arriving") return [0, -(new Date(p.received_at || p.delivered_at || p.last_update).getTime() || 0)];
  if (p.status === "out_for_delivery") return [0, 0];
  return [p.eta ? 1 : 2, p.eta ? new Date(p.eta).getTime() : -(new Date(p.last_update).getTime() || 0)];
}

function render() {
  const list = $("list");
  const rows = data.packages.filter(inView).sort((a, b) => {
    const x = sortKey(a), y = sortKey(b);
    return x[0] - y[0] || x[1] - y[1];
  });
  const EMPTY = { delivered: "Nothing waiting for you.", arriving: "Nothing on the way.", done: "Nothing picked up in the last 30 days." };
  list.innerHTML = rows.length ? "" : `<div class="empty">${EMPTY[view]}</div>`;
  for (const p of rows) {
    const el = document.createElement("div");
    el.className = "card" + (view === "delivered" ? " waiting" : "");
    el.innerHTML = `${thumb(p)}
      <div class="body">
        <div class="items">${esc(title(p))}</div>
        <div class="${etaClass(p)}">${esc(etaLabel(p))}</div>
        <div class="meta">${p.merchant ? `<span class="chip">${esc(p.merchant)}</span>` : ""}${p.carrier ? `<span class="chip">${esc(p.carrier)}</span>` : ""}${esc(STATUS_LABEL[p.status] || "")}${trackLink(p) && p.status !== "delivered" ? ` · <a class="track" href="${esc(trackLink(p))}" target="_blank" rel="noopener noreferrer">Track</a>` : ""}</div>
      </div>
      ${view === "delivered" ? `<button class="gotit" aria-label="Mark as received">Got it</button>` : ""}`;
    el.onclick = () => openSheet(p.id);
    const tr = el.querySelector("a.track");
    if (tr) tr.onclick = e => e.stopPropagation();
    const got = el.querySelector(".gotit");
    if (got) got.onclick = e => { e.stopPropagation(); edit(p, { received: true }); };
    list.appendChild(el);
  }
  // Tab counts, and the home-screen icon badge for packages waiting at the door.
  const n = v => data.packages.filter(p => viewOf(p) === v).length;
  const waiting = n("delivered");
  $("count-delivered").textContent = waiting ? waiting : "";
  $("count-arriving").textContent = n("arriving") || "";
  if (navigator.setAppBadge) { try { waiting ? navigator.setAppBadge(waiting) : navigator.clearAppBadge(); } catch (e) {} }
  const st = $("status");
  st.className = "";
  st.textContent = data.last_run ? `Mail checked ${fmtDate(data.last_run, true)}` : "Mail not checked yet";
}

function showError(msg) { const st = $("status"); st.className = "err"; st.textContent = msg; }

async function call(body) {
  const c = conn();
  if (!c) throw new Error("not connected");
  let res;
  if (c.embed) {
    res = { json: () => new Promise((ok, fail) =>
      google.script.run.withSuccessHandler(ok).withFailureHandler(fail).api(body || null)) };
  } else if (body) {
    // text/plain keeps this a "simple" request, which Apps Script web apps accept cross-origin.
    res = await fetch(c.base, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
                                body: JSON.stringify(Object.assign({ key: c.key }, body)) });
  } else {
    res = await fetch(`${c.base}?key=${encodeURIComponent(c.key)}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error === "bad key" ? "That link's key was not accepted." : (json.error || "Request failed"));
  data = { packages: json.packages || [], last_run: json.last_run || "" };
  store.set("pt.cache", JSON.stringify(data));
  return data;
}

async function load(body) {
  $("refresh").classList.add("spin");
  try { await call(body); render(); }
  catch (e) { showError(navigator.onLine === false ? "Offline — showing the last saved list." : "Couldn't update: " + e.message); }
  finally { $("refresh").classList.remove("spin"); }
}

function openSheet(id) {
  const p = data.packages.find(x => x.id === id);
  if (!p) return;
  current = p;
  const opts = Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${p.status === k ? "selected" : ""}>${v}</option>`).join("");
  const track = trackLink(p);
  $("detail").innerHTML = `
    <div class="hero">${thumb(p)}<div><h2>${esc(title(p))}</h2><div class="${etaClass(p)}">${esc(etaLabel(p))}</div></div></div>
    <div class="row">
      <button id="received" class="${p.received ? "" : "primary"}">${p.received ? "Not picked up yet" : "Got it — mark received"}</button>
    </div>
    <div class="row">
      ${track ? `<a href="${esc(track)}" target="_blank" rel="noopener noreferrer">Track on ${esc(p.carrier || "carrier site")}</a>` : ""}
      ${p.tracking ? `<button id="copy">Copy ${esc(p.tracking)}</button>` : ""}
    </div>
    <label>What's in it</label><input id="f-items" value="${esc(p.items)}">
    <label>Store</label><input id="f-merchant" value="${esc(p.merchant)}">
    <label>Carrier</label><input id="f-carrier" value="${esc(p.carrier)}">
    <label>Tracking number</label><input id="f-tracking" value="${esc(p.tracking)}">
    <label>Expected</label><input id="f-eta" type="date" value="${esc(p.eta)}">
    <label>Status</label><select id="f-status">${opts}</select>
    <label>Notes</label><textarea id="f-notes" rows="2">${esc(p.notes)}</textarea>
    <div class="row">
      <button id="save" class="primary">Save</button>
      <button id="archive">${p.archived ? "Unarchive" : "Archive"}</button>
    </div>
    <ul class="timeline">${(p.events || []).map((e, i) => `<li><div>${esc(STATUS_LABEL[e.s] || e.s)} — ${esc(cleanSubject(e.t))}</div>
      <div class="when">${esc(fmtDate(e.at, true))}${e.f ? " · " + esc(e.f) : ""}</div>
      ${cleanSubject(e.t) ? `<div class="ev-actions"><a href="${esc(gmailSearch(e.t))}" target="_blank" rel="noopener noreferrer">Find in Gmail</a>
        <button class="linkish" data-copy-subject="${i}">Copy subject</button></div>` : ""}</li>`).join("")}</ul>`;
  $("sheet").classList.remove("hidden");
  $("save").onclick = () => {
    const v = f => $(f).value;
    edit(p, { items: v("f-items"), merchant: v("f-merchant"), carrier: v("f-carrier"), tracking: v("f-tracking"),
              eta: v("f-eta"), status: v("f-status"), notes: v("f-notes") });
  };
  $("archive").onclick = () => edit(p, { archived: !p.archived });
  $("received").onclick = () => edit(p, { received: !p.received });
  const copy = $("copy");
  if (copy) copy.onclick = () => navigator.clipboard && navigator.clipboard.writeText(p.tracking);
  document.querySelectorAll("[data-copy-subject]").forEach(b => {
    b.onclick = () => {
      const s = cleanSubject((p.events[Number(b.dataset.copySubject)] || {}).t);
      if (navigator.clipboard) navigator.clipboard.writeText(s).then(() => { b.textContent = "Copied"; }, () => {});
    };
  });
}

/**
 * Where to track a package: the carrier's page for its number (built fresh, so a number fixed
 * by hand still links), else the link from the email, else a web search for the number.
 */
const CARRIER_TRACK = {
  usps: "https://tools.usps.com/go/TrackConfirmAction?tLabels=",
  ups: "https://www.ups.com/track?tracknum=",
  fedex: "https://www.fedex.com/fedextrack/?trknbr=",
  dhl: "https://www.dhl.com/us-en/home/tracking.html?tracking-id=",
  ontrac: "https://www.ontrac.com/tracking/?number=",
  lasership: "https://www.lasership.com/track/",
};
function trackLink(p) {
  const num = String(p.tracking || "").replace(/\s+/g, "");
  let c = String(p.carrier || "").toLowerCase().replace(/[^a-z]/g, "");
  if (num && !CARRIER_TRACK[c]) {
    if (/^1Z[0-9A-Z]{16}$/i.test(num)) c = "ups";
    else if (/^(9[1-5]\d{18,32}|[A-Z]{2}\d{9}US)$/i.test(num)) c = "usps";
  }
  if (num && CARRIER_TRACK[c]) return CARRIER_TRACK[c] + encodeURIComponent(num);
  const fromEmail = safeUrl(p.tracking_url);
  if (fromEmail) return fromEmail;
  return num ? "https://www.google.com/search?q=" + encodeURIComponent("track package " + num) : "";
}

/** The email's own subject, without any "Fwd:" / "FW:" / "Re:" prefixes. */
function cleanSubject(s) {
  return String(s || "").replace(/^\s*((fwd?|fw|re)\s*:\s*)+/i, "").trim();
}

/** A Gmail search for that subject, in whichever account the phone is signed into. */
function gmailSearch(s) {
  return "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent('subject:"' + cleanSubject(s).replace(/"/g, "") + '"');
}

async function edit(p, fields) {
  // Show the change right away; the server's answer replaces it a moment later.
  Object.assign(p, fields);
  if (fields.received === true) { p.received_at = p.received_at || new Date().toISOString(); if (p.status !== "delivered") p.status = "delivered"; }
  if (fields.received === false) p.received_at = "";
  $("sheet").classList.add("hidden");
  render();
  await load({ action: "edit", id: p.id, fields });
}

function start() {
  // A setup link can carry the connection in its hash: …/#link=<encoded exec url with key>
  const m = /[#&]link=([^&]+)/.exec(location.hash);
  if (m) {
    store.set("pt.link", decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname);
  }
  if (!conn()) {
    $("setup").classList.remove("hidden");
    $("app").classList.add("hidden");
    $("refresh").classList.add("hidden");
    return;
  }
  $("setup").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("refresh").classList.remove("hidden");
  try { const c = JSON.parse(store.get("pt.cache") || "null"); if (c) { data = c; } } catch (e) {}
  pickDefaultView();
  render();
  load().then(() => { if (!userPickedView) { pickDefaultView(); render(); } });
}

// Open on Delivered when something is waiting at the door, otherwise on On the way.
let userPickedView = false;
function pickDefaultView() {
  const waiting = data.packages.some(p => viewOf(p) === "delivered");
  setView(waiting ? "delivered" : "arriving");
}
function setView(v) {
  view = v;
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x.dataset.view === v));
}

$("connect").onclick = () => {
  store.set("pt.link", $("link").value.trim());
  if (!conn()) { store.del("pt.link"); $("setup-err").textContent = "That doesn't look like the private link (it should start with https://script.google.com/ and end with ?key=…)."; return; }
  start();
};
$("disconnect").onclick = e => { e.preventDefault(); store.del("pt.link"); store.del("pt.cache"); data = { packages: [], last_run: "" }; start(); };
$("close").onclick = () => $("sheet").classList.add("hidden");
$("sheet").onclick = e => { if (e.target === $("sheet")) $("sheet").classList.add("hidden"); };
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  userPickedView = true; setView(b.dataset.view); render();
});
// Check mail now: runs the script's mail check, then says what changed. Also pulls any new app version.
$("refresh").onclick = async () => {
  const btn = $("refresh"), label = $("refresh-label");
  if (btn.disabled) return;
  const before = new Map(data.packages.map(p => [p.id, p.last_update]));
  btn.disabled = true; label.textContent = "Checking…";
  navigator.serviceWorker?.getRegistration().then(r => r && r.update()).catch(() => {});
  await load({ action: "refresh" });
  btn.disabled = false; label.textContent = "Check mail";
  if ($("status").className === "err") return;
  const changed = data.packages.filter(p => before.get(p.id) !== p.last_update).length;
  $("status").textContent = changed
    ? `Checked mail just now · ${changed} package${changed > 1 ? "s" : ""} updated`
    : "Checked mail just now · nothing new";
};
document.addEventListener("visibilitychange", () => { if (!document.hidden && conn()) load(); });

if (EMBED) document.querySelectorAll(".hosted-only").forEach(el => el.remove());
else if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
start();
