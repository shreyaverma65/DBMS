/* Baggage Desk - single page app (vanilla JS, hash routing) */
const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const state = { user: null, lookups: null };

/* ------------------------------------------------------------ helpers */
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isStaff = () => state.user && ["staff", "admin"].includes(state.user.role);
const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const when = (s) => s ? new Date(s.replace(" ", "T") + (s.includes("T") ? "" : "Z")).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const day = (s) => s ? new Date(s.length === 10 ? s + "T00:00:00" : s.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
const label = (s) => ({ lost_bag: "Lost bag", damaged_bag: "Damaged bag", missing_contents: "Missing contents", delay_expenses: "Delay expenses",
  under_review: "Under review", info_requested: "Info requested", partially_approved: "Partly approved", in_storage: "In storage",
  bank_transfer: "Bank transfer", upi: "UPI" }[s] || (s ? s[0].toUpperCase() + s.slice(1) : ""));
const chip = (s) => `<span class="chip ${esc(s)}">${esc(label(s))}</span>`;
const tag = (ref, big) => `<span class="tag${big ? " big" : ""}">${esc(ref)}</span>`;

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; renderNav(); }
    throw new Error(data.error || "Something went wrong. Try again.");
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const options = (list, val, text, selected) => list.map((o) => `<option value="${esc(o[val] ?? o)}" ${String(o[val] ?? o) === String(selected) ? "selected" : ""}>${esc(typeof text === "function" ? text(o) : text ? o[text] : label(o))}</option>`).join("");
const go = (hash) => { location.hash = hash; };
const empty = (title, text, cta = "") => `<div class="panel empty"><h3>${esc(title)}</h3><p style="margin-inline:auto">${esc(text)}</p>${cta}</div>`;

/* ------------------------------------------------------------ nav */
function renderNav() {
  const cur = location.hash || "#/";
  const link = (href, text) => `<a href="${href}" class="${cur === href || (href.length > 2 && cur.startsWith(href)) ? "active" : ""}">${text}</a>`;
  let html = "";
  if (state.user) {
    if (isStaff()) html += link("#/dashboard", "Dashboard") + link("#/reports", "All reports") + link("#/claims", "Claims") + link("#/found", "Found items");
    else html += link("#/reports", "My reports") + link("#/claims", "My claims") + link("#/reports/new", "Report a bag");
    html += `<span class="who">${esc(state.user.full_name)}</span><button id="logout">Sign out</button>`;
  } else {
    html += link("#/", "Track a bag") + link("#/login", "Sign in") + link("#/register", "Create account");
  }
  $nav.innerHTML = html;
  const lo = document.getElementById("logout");
  if (lo) lo.onclick = async () => { await api("/auth/logout", { method: "POST" }); state.user = null; renderNav(); go("#/"); toast("Signed out."); };
}

/* ------------------------------------------------------------ pages */
function pageHome() {
  if (state.user) return go(isStaff() ? "#/dashboard" : "#/reports");
  $app.innerHTML = `
  <section class="hero">
    <div>
      <h1>Bag didn't arrive?<br>We'll find it.</h1>
      <p class="lead">File a report in a few minutes, follow every step of the search, and claim compensation if your bag can't be recovered.</p>
      <div class="actions">
        <a class="btn" href="#/register">Report a missing bag</a>
        <a class="btn secondary" href="#/login">Sign in to your reports</a>
      </div>
    </div>
    <form class="panel tracker" id="track">
      <h3>Track a report</h3>
      <p class="hint">Use the reference number from your confirmation, for example LL-2026-00001.</p>
      <div class="field"><label for="ref">Reference number</label><input id="ref" name="ref" required placeholder="LL-2026-00001"></div>
      <div class="field"><label for="em">Email on the report</label><input id="em" name="email" type="email" required></div>
      <div class="error" id="terr" role="alert"></div>
      <button class="btn">Show status</button>
    </form>
  </section>
  <div id="trackResult"></div>`;
  document.getElementById("track").onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target), out = document.getElementById("trackResult");
    document.getElementById("terr").textContent = "";
    try {
      const { report: r } = await api(`/track?ref=${encodeURIComponent(d.ref)}&email=${encodeURIComponent(d.email)}`);
      out.innerHTML = `<div class="panel"><div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
        ${tag(r.reference_no, true)} ${chip(r.status)}
        <span>${esc(r.airline_name)} ${esc(r.flight_number)} · ${esc(r.origin)} to ${esc(r.destination)} · ${day(r.flight_date)}</span></div>
        <h3>Progress</h3>${timeline(r.history)}</div>`;
    } catch (err) { document.getElementById("terr").textContent = err.message; out.innerHTML = ""; }
  };
}

function timeline(items) {
  if (!items.length) return `<p class="hint">No updates yet.</p>`;
  return `<ul class="timeline">${items.map((h) => `<li><strong>${esc(label(h.new_status))}</strong>${h.changed_by ? ` <span class="hint">by ${esc(h.changed_by)}</span>` : ""}
    ${h.note ? `<div>${esc(h.note)}</div>` : ""}<time>${when(h.changed_at)}</time></li>`).join("")}</ul>`;
}

function authForm(mode) {
  const reg = mode === "register";
  $app.innerHTML = `<div style="max-width:460px;margin:1rem auto"><form class="panel" id="auth">
    <h2>${reg ? "Create your account" : "Sign in"}</h2>
    ${reg ? `<div class="field"><label for="fn">Full name</label><input id="fn" name="full_name" required autocomplete="name"></div>
             <div class="field"><label for="ph">Phone <span class="hint">(optional)</span></label><input id="ph" name="phone" autocomplete="tel"></div>` : ""}
    <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" required autocomplete="email"></div>
    <div class="field"><label for="p">Password ${reg ? `<span class="hint">(8+ characters)</span>` : ""}</label>
      <input id="p" name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? "new-password" : "current-password"}"></div>
    <div class="error" id="aerr" role="alert"></div>
    <button class="btn">${reg ? "Create account" : "Sign in"}</button>
    ${reg ? "" : `<p class="hint" style="margin-top:1rem">Demo logins (password <b>password123</b>): passenger <b>aarav@example.com</b>, staff <b>staff@airport.test</b></p>`}
  </form></div>`;
  document.getElementById("auth").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { user } = await api(reg ? "/auth/register" : "/auth/login", { method: "POST", body: formData(e.target) });
      state.user = user; renderNav(); toast(`Welcome, ${user.full_name.split(" ")[0]}.`);
      go(isStaff() ? "#/dashboard" : "#/reports");
    } catch (err) { document.getElementById("aerr").textContent = err.message; }
  };
}

async function pageReports() {
  if (!state.user) return go("#/login");
  $app.innerHTML = `<div class="page-head"><div><h2>${isStaff() ? "All baggage reports" : "My reports"}</h2>
      <p>${isStaff() ? "Search and update every open case." : "Every bag you have reported, with its latest status."}</p></div>
      ${isStaff() ? "" : `<a class="btn" href="#/reports/new">Report a bag</a>`}</div>
    <div class="filters">
      <input id="q" type="search" placeholder="Search reference, tag, passenger, flight" aria-label="Search reports">
      <select id="st" aria-label="Filter by status"><option value="">All statuses</option>${options(state.lookups.report_statuses, null, null)}</select>
    </div><div id="rlist" class="list"></div>`;
  const load = async () => {
    const q = document.getElementById("q").value, st = document.getElementById("st").value;
    const { reports } = await api(`/reports?q=${encodeURIComponent(q)}&status=${st}`);
    document.getElementById("rlist").innerHTML = reports.length ? reports.map((r) => `
      <a class="card-row" href="#/reports/${r.report_id}">
        ${tag(r.reference_no)}
        <div><strong>${esc(label(r.report_type))} bag · ${esc(r.color || "")} ${esc(r.brand || r.bag_type)}</strong>
          <span class="meta">${esc(r.airline_code)} ${esc(r.flight_number)} · ${esc(r.origin)} to ${esc(r.destination)} · ${day(r.flight_date)}${isStaff() ? " · " + esc(r.passenger_name) : ""}</span></div>
        ${chip(r.status)}</a>`).join("")
      : empty("No reports found", isStaff() ? "Try a different search or status." : "When you report a bag it will appear here.",
              isStaff() ? "" : `<a class="btn" href="#/reports/new">Report a bag</a>`);
  };
  let t; document.getElementById("q").oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  document.getElementById("st").onchange = load;
  await load();
}

function pageNewReport() {
  if (!state.user) return go("#/login");
  const L = state.lookups, today = new Date().toISOString().slice(0, 10);
  $app.innerHTML = `<div class="page-head"><div><h2>Report a bag</h2><p>The more detail you give, the faster we can match it.</p></div></div>
  <form id="rf" style="max-width:820px">
    <fieldset><legend>What happened</legend>
      <div class="row">
        <div class="field"><label for="rt">Problem</label><select id="rt" name="report_type"><option value="lost">Bag lost</option><option value="delayed">Bag delayed</option><option value="damaged">Bag damaged</option></select></div>
        <div class="field"><label for="tg">Bag tag number <span class="hint">(on your tag receipt)</span></label><input id="tg" name="tag_number" maxlength="12"></div>
      </div></fieldset>
    <fieldset><legend>Your flight</legend>
      <div class="row">
        <div class="field"><label for="al">Airline</label><select id="al" name="airline_id" required>${options(L.airlines, "airline_id", (a) => `${a.name} (${a.code})`)}</select></div>
        <div class="field"><label for="fnum">Flight number</label><input id="fnum" name="flight_number" required placeholder="6E2041"></div>
        <div class="field"><label for="fd">Flight date</label><input id="fd" name="flight_date" type="date" max="${today}" value="${today}" required></div>
      </div>
      <div class="row">
        <div class="field"><label for="or">From</label><select id="or" name="origin_airport_id">${options(L.airports, "airport_id", (a) => `${a.city} (${a.iata_code})`)}</select></div>
        <div class="field"><label for="de">To</label><select id="de" name="dest_airport_id">${options(L.airports, "airport_id", (a) => `${a.city} (${a.iata_code})`, L.airports[1]?.airport_id)}</select></div>
      </div></fieldset>
    <fieldset><legend>Your bag</legend>
      <div class="row">
        <div class="field"><label for="bt">Type</label><select id="bt" name="bag_type">${options(L.bag_types)}</select></div>
        <div class="field"><label for="co">Colour</label><input id="co" name="color" placeholder="Black"></div>
        <div class="field"><label for="br">Brand</label><input id="br" name="brand" placeholder="Samsonite"></div>
        <div class="field"><label for="wt">Weight (kg)</label><input id="wt" name="weight_kg" type="number" min="1" step="0.5"></div>
      </div>
      <div class="field"><label for="ds">Describe it</label><textarea id="ds" name="description" required placeholder="Straps, stickers, ribbons, damage, anything that makes it stand out"></textarea></div>
      <div class="field"><label for="cs">Main contents</label><textarea id="cs" name="contents_summary"></textarea></div>
      <div class="field"><label for="da">Delivery address <span class="hint">(where to send it once found)</span></label><input id="da" name="delivery_address"></div>
    </fieldset>
    <div class="error" id="rerr" role="alert"></div>
    <button class="btn">Submit report</button>
  </form>`;
  document.getElementById("rf").onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { report } = await api("/reports", { method: "POST", body: formData(e.target) });
      toast(`Report ${report.reference_no} filed.`); go("#/reports/" + report.report_id);
    } catch (err) { document.getElementById("rerr").textContent = err.message; }
  };
}

async function pageReport(id) {
  if (!state.user) return go("#/login");
  const { report: r } = await api("/reports/" + id);
  const mine = r.user_id === state.user.user_id;
  const canClaim = mine && !["delivered"].includes(r.status);
  $app.innerHTML = `
  <p><a href="#/reports">Back to reports</a></p>
  <div class="page-head"><div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap">${tag(r.reference_no, true)} ${chip(r.status)}</div>
    <p>Filed ${when(r.reported_at)}</p></div>
  <div class="grid sidebar">
    <div>
      <section class="panel"><h3>The bag</h3><dl class="kv">
        <dt>Problem</dt><dd>${esc(label(r.report_type))}</dd>
        <dt>Flight</dt><dd>${esc(r.airline_name)} ${esc(r.flight_number)} · ${esc(r.origin)} to ${esc(r.destination)} · ${day(r.flight_date)}</dd>
        <dt>Bag</dt><dd>${esc(r.color || "")} ${esc(r.brand || "")} ${esc(r.bag_type)}${r.weight_kg ? ", " + r.weight_kg + " kg" : ""}</dd>
        <dt>Tag number</dt><dd>${esc(r.tag_number || "Not provided")}</dd>
        <dt>Description</dt><dd>${esc(r.description)}</dd>
        ${r.contents_summary ? `<dt>Contents</dt><dd>${esc(r.contents_summary)}</dd>` : ""}
        ${r.delivery_address ? `<dt>Deliver to</dt><dd>${esc(r.delivery_address)}</dd>` : ""}
        ${isStaff() ? `<dt>Passenger</dt><dd>${esc(r.passenger_name)} (${esc(r.passenger_email)})</dd><dt>Handler</dt><dd>${esc(r.assigned_staff || "Unassigned")}</dd>` : ""}
      </dl></section>
      ${r.matches.length ? `<section class="panel"><h3>Bag found</h3>${r.matches.map((m) => `<p>${esc(m.description)}<br><span class="hint">Held at ${esc(m.found_at)} · ${esc(m.storage_location || "")} · match ${m.match_score}%</span></p>`).join("")}</section>` : ""}
      <section class="panel"><h3>Messages</h3>
        <div class="thread">${r.messages.length ? r.messages.map((m) => `<div class="msg ${m.role !== "passenger" ? "staff" : ""}"><small>${esc(m.full_name)} · ${when(m.created_at)}</small>${esc(m.body)}</div>`).join("") : `<p class="hint">No messages yet.</p>`}</div>
        <form id="mf"><div class="field"><label for="mb">Write a message</label><textarea id="mb" name="body" required></textarea></div><button class="btn small">Send message</button></form>
      </section>
      <section class="panel"><div class="page-head" style="margin:0"><h3>Claims</h3>
        ${canClaim ? `<button class="btn small" id="newClaim">File a claim</button>` : ""}</div>
        <div id="claimForm"></div>
        ${r.claims.length ? `<div class="table-wrap"><table><thead><tr><th>Claim</th><th>Type</th><th class="num">Claimed</th><th>Status</th></tr></thead><tbody>
          ${r.claims.map((c) => `<tr class="link" onclick="location.hash='#/claims/${c.claim_id}'"><td>${esc(c.claim_no)}</td><td>${esc(label(c.claim_type))}</td><td class="num">${money(c.claimed_amount)}</td><td>${chip(c.status)}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="hint">No claims filed for this report.</p>`}
      </section>
    </div>
    <aside>
      <section class="panel"><h3>Progress</h3>${timeline(r.history)}</section>
      ${isStaff() ? staffPanel(r) : ""}
    </aside>
  </div>`;

  document.getElementById("mf").onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/reports/${id}/messages`, { method: "POST", body: formData(e.target) }); toast("Message sent."); pageReport(id); }
    catch (err) { toast(err.message); }
  };
  const nc = document.getElementById("newClaim");
  if (nc) nc.onclick = () => claimForm(r);
  if (isStaff()) wireStaffPanel(r);
}

function staffPanel(r) {
  return `<section class="panel"><h3>Update case</h3>
    <form id="sf"><div class="field"><label for="ss">Status</label><select id="ss" name="status">${options(state.lookups.report_statuses, null, null, r.status)}</select></div>
    <div class="field"><label for="sn">Note for the passenger</label><textarea id="sn" name="note"></textarea></div>
    <button class="btn small">Save status</button></form></section>
    <section class="panel"><h3>Possible matches</h3><div id="sugg"><p class="hint">Searching found items...</p></div></section>`;
}

async function wireStaffPanel(r) {
  document.getElementById("sf").onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/reports/${r.report_id}/status`, { method: "PATCH", body: formData(e.target) }); toast("Status updated."); pageReport(r.report_id); }
    catch (err) { toast(err.message); }
  };
  const box = document.getElementById("sugg");
  try {
    const { suggestions } = await api(`/reports/${r.report_id}/suggestions`);
    box.innerHTML = suggestions.length ? suggestions.map((s) => `<div class="suggest"><span class="score">${s.match_score}%</span>
      <div>${esc(s.description)}</div><div class="hint">${esc(s.airport)} · ${esc(s.storage_location || "")}</div>
      <button class="btn small" data-found="${s.found_id}" style="margin-top:.5rem">Confirm match</button></div>`).join("")
      : `<p class="hint">No similar items in storage.</p>`;
    box.querySelectorAll("[data-found]").forEach((b) => b.onclick = async () => {
      try { await api(`/reports/${r.report_id}/match`, { method: "POST", body: { found_id: b.dataset.found } }); toast("Match confirmed."); pageReport(r.report_id); }
      catch (err) { toast(err.message); }
    });
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

function claimForm(r) {
  const box = document.getElementById("claimForm");
  box.innerHTML = `<form id="cf" class="panel" style="background:#f7f8fa;margin-bottom:1rem">
    <div class="row"><div class="field"><label for="ct">Claim type</label><select id="ct" name="claim_type">${options(state.lookups.claim_types)}</select></div></div>
    <div class="field"><label for="cd">What are you claiming for?</label><textarea id="cd" name="description" required></textarea></div>
    <label>Items <span class="hint">(name, quantity, value each in ₹)</span></label><div id="items"></div>
    <button type="button" class="btn secondary small" id="addItem">Add item</button>
    <p class="total">Total <span id="tot">₹0</span></p>
    <div class="error" id="cerr" role="alert"></div>
    <button class="btn small">Submit claim</button></form>`;
  const items = document.getElementById("items");
  const recalc = () => {
    let t = 0; items.querySelectorAll(".item-row").forEach((row) => { t += (+row.querySelector(".q").value || 0) * (+row.querySelector(".v").value || 0); });
    document.getElementById("tot").textContent = money(t);
  };
  const add = () => {
    const row = document.createElement("div"); row.className = "item-row";
    row.innerHTML = `<input class="n" placeholder="Item" aria-label="Item name"><input class="q" type="number" min="1" value="1" aria-label="Quantity"><input class="v" type="number" min="0" placeholder="0" aria-label="Value each"><button type="button" class="btn danger small" aria-label="Remove item">×</button>`;
    row.oninput = recalc; row.querySelector("button").onclick = () => { row.remove(); recalc(); };
    items.appendChild(row);
  };
  add();
  document.getElementById("addItem").onclick = add;
  document.getElementById("cf").onsubmit = async (e) => {
    e.preventDefault();
    const list = [...items.querySelectorAll(".item-row")].map((row) => ({ item_name: row.querySelector(".n").value, quantity: +row.querySelector(".q").value, unit_value: +row.querySelector(".v").value })).filter((i) => i.item_name.trim());
    try {
      const { claim } = await api("/claims", { method: "POST", body: { ...formData(e.target), report_id: r.report_id, items: list } });
      toast(`Claim ${claim.claim_no} submitted.`); go("#/claims/" + claim.claim_id);
    } catch (err) { document.getElementById("cerr").textContent = err.message; }
  };
}

async function pageClaims() {
  if (!state.user) return go("#/login");
  const { claims } = await api("/claims");
  $app.innerHTML = `<div class="page-head"><div><h2>${isStaff() ? "Claims queue" : "My claims"}</h2><p>${isStaff() ? "Review, decide and pay compensation claims." : "Track compensation for your bags."}</p></div></div>
  ${claims.length ? `<div class="panel table-wrap"><table><thead><tr><th>Claim</th><th>Report</th>${isStaff() ? "<th>Claimant</th>" : ""}<th>Type</th><th class="num">Claimed</th><th class="num">Approved</th><th>Status</th></tr></thead><tbody>
    ${claims.map((c) => `<tr class="link" onclick="location.hash='#/claims/${c.claim_id}'"><td>${esc(c.claim_no)}</td><td>${esc(c.reference_no)}</td>${isStaff() ? `<td>${esc(c.claimant)}</td>` : ""}
      <td>${esc(label(c.claim_type))}</td><td class="num">${money(c.claimed_amount)}</td><td class="num">${c.approved_amount != null ? money(c.approved_amount) : "-"}</td><td>${chip(c.status)}</td></tr>`).join("")}</tbody></table></div>`
    : empty("No claims yet", "Open one of your reports to file a compensation claim.", `<a class="btn" href="#/reports">Go to my reports</a>`)}`;
}

async function pageClaim(id) {
  if (!state.user) return go("#/login");
  const { claim: c } = await api("/claims/" + id);
  const total = c.items.reduce((s, i) => s + i.line_total, 0);
  const decidable = isStaff() && c.status !== "paid";
  $app.innerHTML = `<p><a href="#/claims">Back to claims</a></p>
  <div class="page-head"><div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap"><h2 style="margin:0">${esc(c.claim_no)}</h2>${chip(c.status)}</div>
    <p>For report <a href="#/reports/${c.report_id}">${esc(c.reference_no)}</a></p></div>
  <div class="grid sidebar"><div>
    <section class="panel"><h3>${esc(label(c.claim_type))}</h3><p>${esc(c.description)}</p>
      <div class="table-wrap"><table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Each</th><th class="num">Total</th></tr></thead><tbody>
      ${c.items.map((i) => `<tr><td>${esc(i.item_name)}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unit_value)}</td><td class="num">${money(i.line_total)}</td></tr>`).join("")}
      <tr><td colspan="3"><b>Claimed</b></td><td class="num"><b>${money(total)}</b></td></tr>
      ${c.approved_amount != null ? `<tr><td colspan="3"><b>Approved</b></td><td class="num"><b>${money(c.approved_amount)}</b></td></tr>` : ""}</tbody></table></div>
      ${c.resolution_note ? `<div class="notice" style="margin-top:1rem"><b>Note from the desk:</b> ${esc(c.resolution_note)}</div>` : ""}
      ${c.paid_amount ? `<div class="notice">Paid ${money(c.paid_amount)} on ${day(c.paid_at)}.</div>` : ""}
    </section></div>
    <aside><section class="panel"><h3>Progress</h3>${timeline(c.history)}</section>
    ${decidable ? `<section class="panel"><h3>Decision</h3><form id="df">
      <div class="field"><label for="dst">Outcome</label><select id="dst" name="status">
        <option value="under_review">Mark under review</option><option value="info_requested">Request more information</option>
        <option value="approved">Approve in full</option><option value="partially_approved">Approve part</option><option value="rejected">Reject</option></select></div>
      <div class="field" id="amtBox" hidden><label for="amt">Approved amount (₹)</label><input id="amt" name="approved_amount" type="number" min="1" max="${c.claimed_amount}"></div>
      <div class="field"><label for="dn">Note to the passenger</label><textarea id="dn" name="note"></textarea></div>
      <div class="error" id="derr" role="alert"></div><button class="btn small">Save decision</button></form></section>` : ""}
    ${isStaff() && ["approved", "partially_approved"].includes(c.status) ? `<section class="panel"><h3>Pay ${money(c.approved_amount)}</h3><form id="pf">
      <div class="field"><label for="pm">Method</label><select id="pm" name="method"><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="voucher">Voucher</option><option value="cheque">Cheque</option></select></div>
      <div class="field"><label for="px">Transaction reference</label><input id="px" name="txn_reference"></div><button class="btn small">Record payment</button></form></section>` : ""}
    </aside></div>`;
  const df = document.getElementById("df");
  if (df) {
    const sync = () => { document.getElementById("amtBox").hidden = df.status.value !== "partially_approved"; };
    df.status.onchange = sync; sync();
    df.onsubmit = async (e) => {
      e.preventDefault();
      try { await api(`/claims/${id}/decision`, { method: "PATCH", body: formData(df) }); toast("Decision saved."); pageClaim(id); }
      catch (err) { document.getElementById("derr").textContent = err.message; }
    };
  }
  const pf = document.getElementById("pf");
  if (pf) pf.onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/claims/${id}/pay`, { method: "POST", body: formData(pf) }); toast("Payment recorded."); pageClaim(id); }
    catch (err) { toast(err.message); }
  };
}

async function pageFound() {
  if (!isStaff()) return go("#/");
  const { items } = await api("/found");
  const L = state.lookups;
  $app.innerHTML = `<div class="page-head"><div><h2>Found items</h2><p>Unclaimed bags in storage. Log new arrivals so they can be matched.</p></div></div>
  <div class="grid sidebar"><div class="panel table-wrap"><table><thead><tr><th>Tag</th><th>Item</th><th>Airport</th><th>Found</th><th>Location</th><th>Status</th></tr></thead><tbody>
  ${items.map((i) => `<tr><td>${esc(i.tag_number || "-")}</td><td>${esc(i.color || "")} ${esc(i.brand || "")} ${esc(i.bag_type)}<br><span class="hint">${esc(i.description)}</span></td><td>${esc(i.airport)}</td><td>${day(i.found_date)}</td><td>${esc(i.storage_location || "")}</td><td>${chip(i.status)}</td></tr>`).join("")}</tbody></table></div>
  <form class="panel" id="ff"><h3>Log a found bag</h3>
    <div class="field"><label for="ft">Tag number</label><input id="ft" name="tag_number"></div>
    <div class="row"><div class="field"><label for="fb">Type</label><select id="fb" name="bag_type">${options(L.bag_types)}</select></div>
    <div class="field"><label for="fc">Colour</label><input id="fc" name="color"></div></div>
    <div class="field"><label for="fbr">Brand</label><input id="fbr" name="brand"></div>
    <div class="field"><label for="fa">Found at</label><select id="fa" name="found_airport_id">${options(L.airports, "airport_id", (a) => `${a.city} (${a.iata_code})`)}</select></div>
    <div class="field"><label for="fl">Storage location</label><input id="fl" name="storage_location" placeholder="Shelf B-12"></div>
    <div class="field"><label for="fd2">Description</label><textarea id="fd2" name="description" required></textarea></div>
    <div class="error" id="ferr" role="alert"></div><button class="btn small">Log bag</button></form></div>`;
  document.getElementById("ff").onsubmit = async (e) => {
    e.preventDefault();
    try { await api("/found", { method: "POST", body: formData(e.target) }); toast("Found bag logged."); pageFound(); }
    catch (err) { document.getElementById("ferr").textContent = err.message; }
  };
}

async function pageDashboard() {
  if (!isStaff()) return go("#/");
  const s = await api("/stats");
  const bars = (obj) => { const max = Math.max(1, ...Object.values(obj)); return Object.entries(obj).map(([k, v]) => `<div class="bar"><span>${esc(label(k))}</span><i style="width:${(v / max) * 100}%"></i><b>${v}</b></div>`).join("") || `<p class="hint">No data yet.</p>`; };
  $app.innerHTML = `<div class="page-head"><div><h2>Desk overview</h2><p>What needs attention right now.</p></div></div>
  <div class="tiles">
    <div class="tile"><b>${s.open_reports}</b><span>Open cases</span></div>
    <div class="tile"><b>${s.pending_claims}</b><span>Claims awaiting a decision</span></div>
    <div class="tile"><b>${s.found_in_storage}</b><span>Bags in storage</span></div>
    <div class="tile"><b>${s.recovery_rate ?? 0}%</b><span>Reports resolved</span></div>
    <div class="tile"><b>${money(s.money.paid)}</b><span>Paid out of ${money(s.money.claimed)} claimed</span></div>
  </div>
  <div class="grid two"><section class="panel"><h3>Reports by status</h3>${bars(s.reports_by_status)}</section>
  <section class="panel"><h3>Claims by status</h3>${bars(s.claims_by_status)}</section></div>
  <section class="panel"><h3>Airline performance</h3><div class="table-wrap"><table><thead><tr><th>Airline</th><th class="num">Reports</th><th class="num">Resolved</th><th class="num">Unresolved</th><th class="num">Avg days to resolve</th></tr></thead><tbody>
  ${s.airlines.map((a) => `<tr><td>${esc(a.name)} (${esc(a.code)})</td><td class="num">${a.total_reports}</td><td class="num">${a.resolved}</td><td class="num">${a.unresolved}</td><td class="num">${a.avg_days_to_resolve ?? "-"}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ------------------------------------------------------------ router */
const routes = [
  [/^#\/?$/, pageHome], [/^#\/login$/, () => authForm("login")], [/^#\/register$/, () => authForm("register")],
  [/^#\/dashboard$/, pageDashboard], [/^#\/reports$/, pageReports], [/^#\/reports\/new$/, pageNewReport],
  [/^#\/reports\/(\d+)$/, pageReport], [/^#\/claims$/, pageClaims], [/^#\/claims\/(\d+)$/, pageClaim], [/^#\/found$/, pageFound],
];
async function route() {
  const hash = location.hash || "#/";
  renderNav();
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(...m.slice(1)); }
      catch (err) { $app.innerHTML = empty("Couldn't load this page", err.message, `<a class="btn" href="#/">Back to start</a>`); }
      $app.focus({ preventScroll: true }); window.scrollTo(0, 0); return;
    }
  }
  $app.innerHTML = empty("Page not found", "That address doesn't exist.", `<a class="btn" href="#/">Back to start</a>`);
}

(async function boot() {
  try {
    const [{ user }, lookups] = await Promise.all([api("/auth/me"), api("/lookups")]);
    state.user = user; state.lookups = lookups;
  } catch (e) { $app.innerHTML = empty("Can't reach the server", "Start the backend with `python app.py` and reload."); return; }
  window.addEventListener("hashchange", route);
  route();
})();
