// ProofPay frontend: a small hash-routed single-page app, no build step.
const $app = document.getElementById("app");
let config = null;
let role = loadRole();

// ---------------------------------------------------------------- Helpers

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const money = (cents, cur) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD" }).format((cents || 0) / 100);

const when = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function loadRole() {
  try {
    return localStorage.getItem("proofpay.role") || "payer";
  } catch {
    return "payer";
  }
}
function setRole(r) {
  role = r;
  try {
    localStorage.setItem("proofpay.role", r);
  } catch {}
  document.querySelectorAll(".role-switch button").forEach((b) => b.classList.toggle("active", b.dataset.role === r));
  route();
}

const API_BASE = window.PROOFPAY_API_BASE || "";
const assetUrl = (u) => (u && u.startsWith("/") && API_BASE ? `${API_BASE}${u}` : u);

async function api(path, opts = {}) {
  const headers = { "x-role": role, ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const url = (path.startsWith("/api") || path.startsWith("/uploads")) && API_BASE ? `${API_BASE}${path}` : path;
  const res = await fetch(url, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `toast show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), isError ? 6000 : 3200);
}

let overlayTimers = [];
function showOverlay(title, steps) {
  const o = document.getElementById("overlay");
  document.getElementById("overlay-title").textContent = title;
  const ol = document.getElementById("overlay-steps");
  ol.innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join("");
  o.hidden = false;
  const items = [...ol.children];
  items[0]?.classList.add("active");
  overlayTimers = items.slice(1).map((li, i) =>
    setTimeout(() => {
      items[i].classList.replace("active", "done");
      li.classList.add("active");
    }, (i + 1) * 1800)
  );
}
function hideOverlay() {
  overlayTimers.forEach(clearTimeout);
  document.getElementById("overlay").hidden = true;
}

async function busy(btn, fn) {
  const label = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Working…";
  }
  try {
    return await fn();
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  }
}

const STATUS = {
  awaiting_approval: ["Agree on terms", "blue"],
  awaiting_funding: ["Waiting for funds", "amber"],
  active: ["Funds held", "blue"],
  completed: ["Completed", "green"],
  cancelled: ["Cancelled", ""],
};
const MS_STATUS = {
  open: ["Awaiting proof", ""],
  verifying: ["Verifying", "violet"],
  rejected: ["Not released", "red"],
  in_review: ["Human review", "violet"],
  released: ["Paid out", "green"],
  release_failed: ["Payout failed", "red"],
  refunded: ["Refunded", ""],
};
const chip = ([label, color]) => `<span class="chip ${color}">${esc(label)}</span>`;

function moneyBar(b, total) {
  const pct = (x) => (total ? (x / total) * 100 : 0);
  return `<div class="bar" aria-hidden="true">
    <span class="released" style="width:${pct(b.released)}%"></span>
    <span class="held" style="width:${pct(b.held)}%"></span>
    <span class="refunded" style="width:${pct(b.refunded)}%"></span>
  </div>`;
}

// ---------------------------------------------------------------- Router

window.addEventListener("hashchange", route);
async function route() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/p\/([\w-]+)/);
  try {
    if (hash.startsWith("#/new")) return renderNew();
    if (m) return await renderProject(m[1]);
    return await renderHome();
  } catch (e) {
    $app.innerHTML = `<div class="card pad empty" style="margin-top:24px">${esc(e.message)}<br><br><a href="#/">Back to agreements</a></div>`;
  }
}

// ---------------------------------------------------------------- Home

async function renderHome() {
  const list = await api("/api/projects");
  $app.innerHTML = `
  <section class="hero">
    <div>
      <h1>Money that only moves when <em>work is proven</em>.</h1>
      <p class="lead">Describe a deal in plain words. An AI agent turns it into milestones both sides agree to. The money is held, and each milestone is paid out through PayPal only when the evidence checks out.</p>
      <div class="row">
        <a class="btn primary" href="#/new">Start an agreement</a>
        <span class="muted small">Freelance work · community projects · charity · microloans</span>
      </div>
    </div>
    <div class="flow">
      ${[
        ["Agree", "AI writes milestones with checkable criteria. Both parties approve."],
        ["Fund", "The payer funds the whole agreement with PayPal. Money is held."],
        ["Prove", "The payee uploads photos, screenshots or PDFs for each milestone."],
        ["Release", "AI judges evidence; policy releases the payout or routes to a human."],
      ]
        .map(
          ([t, d], i) =>
            `<div class="card flow-step"><div class="num">${i + 1}</div><div><b>${t}</b><span>${d}</span></div></div>`
        )
        .join("")}
    </div>
  </section>
  <div class="section-title"><h2>Agreements</h2><span class="muted small">${list.length} total</span></div>
  <div class="list">
    ${
      list.length
        ? list
            .map(
              (p) => `
      <a class="card proj" href="#/p/${p.id}">
        <div>
          <div class="row"><h3>${esc(p.title)}</h3>${chip(STATUS[p.status] || [p.status, ""])}</div>
          <div class="meta">${esc(p.payer)} → ${esc(p.payee)} · ${esc(p.category)} · ${p.milestones.filter((s) => s === "released").length}/${p.milestones.length} milestones paid</div>
        </div>
        <div class="amt">${money(p.totalCents, p.currency)}</div>
        ${p.balances.funded ? moneyBar(p.balances, p.totalCents) : ""}
      </a>`
            )
            .join("")
        : `<div class="card empty">No agreements yet. <a href="#/new">Create the first one</a>.</div>`
    }
  </div>`;
}

// ---------------------------------------------------------------- New agreement

const SAMPLES = {
  freelance: {
    label: "Freelance",
    hint: "Client and freelancer",
    amount: 600,
    payer: "Maya (client)",
    payee: "Arjun (designer)",
    text: "I'm hiring Arjun to design and build a one-page website for my bakery, Maya's Bakes. It needs a hero section with our logo, a menu section with at least 8 items and prices, a photo gallery, and a contact form. It must look good on mobile and be live on a public URL. First I want to approve a design mockup before he builds it. Budget is $600, done within 2 weeks.",
  },
  community: {
    label: "Community",
    hint: "Neighbours funding a fix",
    amount: 1200,
    payer: "Greenview Residents",
    payee: "Ravi Painters",
    text: "Our residents' association is paying Ravi Painters to repaint the children's playground in Greenview Park. The work: scrape and sand the old flaking paint on the slide frame and swings, apply rust-proof primer, then two coats of bright blue paint, and repaint the yellow safety lines on the ground around the equipment. The site should be cleaned up afterwards with no paint cans left behind. Total $1,200.",
  },
  charity: {
    label: "Charity",
    hint: "Donors and a project",
    amount: 2500,
    payer: "Donor circle",
    payee: "Hope Learning Center",
    text: "A group of donors is funding Hope Learning Center to set up a small computer lab for 20 students. The center will buy 10 refurbished laptops, install 2 desks and 20 chairs, set up internet, and hold the first weekly coding class with students attending. Donors want receipts for purchases and photos of the room set up and the first class. Total $2,500.",
  },
  microloan: {
    label: "Microloan",
    hint: "Loan released in stages",
    amount: 800,
    payer: "Lending circle",
    payee: "Lakshmi's Tailoring",
    text: "Our lending circle is giving Lakshmi an $800 microloan to grow her tailoring business. The plan: buy a second sewing machine, buy fabric stock, and set up a small stall at the Saturday market with a sign showing her prices. Release the money in stages as each step is done, with receipts and photos.",
  },
};

function renderNew() {
  let cat = "freelance";
  $app.innerHTML = `
  <div class="new-wrap">
    <a class="back" href="#/">← Agreements</a>
    <div class="card pad">
      <h1 style="font-size:24px;font-weight:800">New agreement</h1>
      <p class="muted" style="margin:6px 0 18px">Describe the deal the way you would to a friend. The agreement agent turns it into milestones with criteria that evidence can prove.</p>
      <div class="cats">
        ${Object.entries(SAMPLES)
          .map(([k, s]) => `<button type="button" class="cat" data-cat="${k}"><b>${s.label}</b><span>${s.hint}</span></button>`)
          .join("")}
      </div>
      <form id="new-form" class="stack">
        <div>
          <label for="desc">What is the deal?</label>
          <textarea id="desc" name="description" rows="6" required></textarea>
          <div class="hint">Mention deliverables, deadlines, and how you'd know it's done.</div>
        </div>
        <div class="grid2">
          <div><label for="amount">Total amount</label><input id="amount" name="amount" type="number" min="1" step="0.01" required /></div>
          <div><label for="currency">Currency</label>
            <select id="currency" name="currency"><option>USD</option><option>EUR</option><option>GBP</option><option>AUD</option><option>CAD</option></select>
          </div>
        </div>
        <div class="grid2">
          <div><label for="payerName">Payer name</label><input id="payerName" name="payerName" required /></div>
          <div><label for="payerEmail">Payer email <span class="muted">(optional)</span></label><input id="payerEmail" name="payerEmail" type="email" /></div>
        </div>
        <div class="grid2">
          <div><label for="payeeName">Payee name</label><input id="payeeName" name="payeeName" required /></div>
          <div><label for="payeeEmail">Payee PayPal email</label><input id="payeeEmail" name="payeeEmail" type="email" required />
            <div class="hint">${config.paypal.mode === "sandbox" ? "Use a PayPal sandbox personal account email. Payouts are sent here." : "The payee's PayPal email. Payouts are sent here."}</div>
          </div>
        </div>
        <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">Draft milestones with AI</button></div>
      </form>
    </div>
  </div>`;

  const form = document.getElementById("new-form");
  const fill = (k) => {
    cat = k;
    const s = SAMPLES[k];
    document.querySelectorAll(".cat").forEach((b) => b.classList.toggle("active", b.dataset.cat === k));
    form.description.value = s.text;
    form.amount.value = s.amount;
    form.payerName.value = s.payer;
    form.payeeName.value = s.payee;
    if (!form.payeeEmail.value && config.paypal.mode === "simulated") form.payeeEmail.value = "payee@example.com";
  };
  document.querySelectorAll(".cat").forEach((b) => b.addEventListener("click", () => fill(b.dataset.cat)));
  fill("freelance");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.category = cat;
    showOverlay("Agreement agent is drafting", [
      "Reading the deal",
      "Splitting the work into milestones",
      "Writing criteria that evidence can prove",
      "Flagging ambiguities to settle first",
    ]);
    try {
      const p = await api("/api/projects", { body: data });
      location.hash = `#/p/${p.id}`;
    } catch (err) {
      toast(err.message, true);
    } finally {
      hideOverlay();
    }
  });
}

// ---------------------------------------------------------------- Project

let editing = false;

async function renderProject(id) {
  const p = await api(`/api/projects/${id}`);
  const b = p.balances;
  const stepIdx = { awaiting_approval: 0, awaiting_funding: 1, active: 2, completed: 4 }[p.status] ?? 0;
  const steps = ["Agree", "Fund", "Prove", "Paid"];

  $app.innerHTML = `
  <a class="back" href="#/">← Agreements</a>
  <div class="proj-head">
    <div class="card pad">
      <div class="row">${chip(STATUS[p.status] || [p.status, ""])}<span class="chip">${esc(p.category)}</span></div>
      <h1 style="margin-top:10px">${esc(p.title)}</h1>
      <p class="muted" style="margin-top:6px">${esc(p.summary)}</p>
      <div class="parties">
        <div class="party">Payer <b>${esc(p.payer.name)}</b></div>
        <div class="party">Payee <b>${esc(p.payee.name)}</b> <span class="muted">${esc(p.payee.email || "")}</span></div>
      </div>
      <div class="stepper">${steps
        .map((s, i) => `<div class="s ${i < stepIdx ? "done" : i === stepIdx ? "now" : ""}">${s}</div>`)
        .join("")}</div>
    </div>
    <div class="card pad">
      <div class="muted small">Agreement total</div>
      <div style="font-size:28px;font-weight:800;letter-spacing:-0.02em">${money(p.totalCents, p.currency)}</div>
      <div style="margin-top:10px">${moneyBar(b, p.totalCents)}</div>
      <div class="legend"><span><i style="background:var(--released)"></i>Released</span><span><i style="background:var(--held)"></i>Held</span><span><i style="background:var(--refunded)"></i>Refunded</span></div>
      <div class="vault">
        <div><b>${money(b.held, p.currency)}</b><span>Held</span></div>
        <div><b>${money(b.released, p.currency)}</b><span>Released</span></div>
        <div><b>${money(b.refunded, p.currency)}</b><span>Refunded</span></div>
      </div>
      ${
        p.funding
          ? `<div class="tiny muted" style="margin-top:10px">${
              p.funding.mode === "paypal" ? `PayPal sandbox capture <span class="mono">${esc(p.funding.captureId)}</span>` : "Simulated funding"
            }</div>`
          : ""
      }
    </div>
  </div>

  <div class="layout">
    <div class="stack">
      ${actionPanel(p)}
      ${p.riskNotes?.length && p.status === "awaiting_approval"
        ? `<div class="callout amber"><b>Settle these before you approve</b><ul>${p.riskNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`
        : ""}
      ${p.milestones.map((m, i) => milestoneCard(p, m, i)).join("")}
    </div>
    <aside class="card log">
      <h3>Audit trail</h3>
      <p class="tiny muted">Every decision and money movement, in order.</p>
      <ol>${[...p.log]
        .reverse()
        .map((e) => {
          const cls = e.actor === "agent" ? "agent" : ["released", "funded", "refunded"].includes(e.type) ? "money" : /fail|reject|error/.test(e.type) ? "bad" : "";
          return `<li class="${cls}"><span class="who">${esc(e.actorLabel)}</span> ${esc(e.message)}<time>${when(e.at)}</time></li>`;
        })
        .join("")}</ol>
    </aside>
  </div>`;

  wireProject(p);
}

function actionPanel(p) {
  if (p.status === "awaiting_approval") {
    const mine = p.approvals[role];
    return `<div class="card action">
      <h3>Both parties approve the terms</h3>
      <p class="muted small">Nothing moves until the payer and payee agree on the milestones and what counts as proof. Editing resets approvals.</p>
      <div class="approvals">
        ${["payer", "payee"]
          .map((r) => `<span class="chip ${p.approvals[r] ? "green" : ""}">${p.approvals[r] ? "✓" : "○"} ${r === "payer" ? "Payer" : "Payee"} ${p.approvals[r] ? "approved" : "pending"}</span>`)
          .join("")}
      </div>
      <div class="row">
        ${role === "reviewer"
          ? `<span class="muted small">Switch to Payer or Payee to approve.</span>`
          : mine
          ? `<span class="muted small">You approved. Switch roles to approve as the other party.</span>`
          : `<button class="btn primary" id="approve-btn">Approve terms as ${role === "payer" ? "Payer" : "Payee"}</button>`}
        ${role !== "reviewer" ? `<button class="btn ghost" id="edit-btn">${editing ? "Cancel editing" : "Edit terms"}</button>` : ""}
        ${editing ? `<button class="btn success" id="save-terms">Save terms</button>` : ""}
      </div>
    </div>`;
  }
  if (p.status === "awaiting_funding") {
    if (role !== "payer") {
      return `<div class="card action"><h3>Waiting for the payer to fund</h3><p class="muted small">Switch to Payer to fund ${money(p.totalCents, p.currency)} through PayPal.</p></div>`;
    }
    return `<div class="card action">
      <h3>Fund the agreement</h3>
      <p class="muted small">Pay ${money(p.totalCents, p.currency)} now. It is held and released one milestone at a time, only when proof checks out. Cancelled milestones are refunded.</p>
      ${
        config.paypal.mode === "sandbox"
          ? `<div id="paypal-buttons"></div><p class="tiny muted">Log in with a PayPal sandbox personal account.</p>`
          : config.paypal.mode === "simulated"
          ? `<div class="row" style="margin-top:12px"><button class="btn primary" id="sim-fund">Fund ${money(p.totalCents, p.currency)} (simulated)</button><span class="tiny muted">Simulation mode is on.</span></div>`
          : `<div class="callout amber" style="margin-top:12px"><b>PayPal is not connected.</b> Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the .env file and restart the server.</div>`
      }
    </div>`;
  }
  if (p.status === "active") {
    const tip = {
      payer: "Milestones you can act on show review and refund buttons. Switch to Payee to submit proof.",
      payee: "Upload proof on any open milestone. The AI checks it against the agreed criteria.",
      reviewer: "You can decide any milestone that the AI sent to human review.",
    }[role];
    return `<div class="callout blue"><b>Funds are held.</b> ${esc(tip)}</div>`;
  }
  if (p.status === "completed") {
    return `<div class="callout blue"><b>Agreement complete.</b> ${money(p.balances.released, p.currency)} released and ${money(p.balances.refunded, p.currency)} refunded.</div>`;
  }
  return "";
}

function milestoneCard(p, m, i) {
  const last = m.attempts[m.attempts.length - 1];
  const older = m.attempts.slice(0, -1).reverse();
  const canEdit = editing && p.status === "awaiting_approval";
  return `<div class="card ms ${m.status}" data-mid="${m.id}">
    <div class="ms-head">
      <div class="ms-num">${m.status === "released" ? "✓" : i + 1}</div>
      <div class="ms-title"><div class="row"><h3>${esc(m.title)}</h3>${p.funding ? chip(MS_STATUS[m.status] || [m.status, ""]) : ""}</div><p>${esc(m.description)}</p></div>
      <div class="ms-amt">${money(m.amountCents, p.currency)}</div>
    </div>
    ${
      canEdit
        ? `<div class="edit-ms">
        <div class="grid3"><div><label>Title</label><input data-f="title" value="${esc(m.title)}"></div><div><label>Amount</label><input data-f="amount" type="number" step="0.01" min="0" value="${(m.amountCents / 100).toFixed(2)}"></div></div>
        <div><label>Description</label><input data-f="description" value="${esc(m.description)}"></div>
        <div><label>Acceptance criteria (one per line)</label><textarea data-f="acceptanceCriteria" rows="4">${esc(m.acceptanceCriteria.join("\n"))}</textarea></div>
        <div><label>Evidence to upload (one per line)</label><textarea data-f="requiredEvidence" rows="3">${esc(m.requiredEvidence.join("\n"))}</textarea></div>
      </div>`
        : `<div class="ms-body">
      <div class="cols">
        <div><h4>Proven when</h4><ul>${m.acceptanceCriteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
        <div><h4>Evidence to upload</h4><ul>${m.requiredEvidence.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
      </div>
      ${last ? attemptView(p, last, true) : ""}
      ${moneyResult(p, m)}
      ${milestoneActions(p, m)}
      ${older.length ? `<details class="older"><summary>${older.length} earlier attempt${older.length > 1 ? "s" : ""}</summary>${older.map((a) => attemptView(p, a, false)).join("")}</details>` : ""}
    </div>`
    }
  </div>`;
}

function attemptView(p, a, latest) {
  const cls = a.ai ? a.ai.verdict : "error";
  const label = a.ai
    ? { approve: "Approved by AI", reject: "Rejected by AI", needs_human_review: "AI asked for a human" }[a.ai.verdict]
    : "AI unavailable";
  const pct = a.ai ? Math.round(a.ai.confidence * 100) : 0;
  const bar = Math.round(p.autoReleaseConfidence * 100);
  const outcome = { auto_release: "Auto-released", auto_reject: "Not released", human_review: "Routed to human review" }[a.decision?.outcome] || "";
  return `<div class="verdict ${cls}">
    <div class="verdict-top">
      <span class="verdict-badge">${esc(label)}</span>
      <span class="tiny muted">${when(a.at)}</span>
      ${a.ai ? `<span class="conf" title="Auto-release needs ${bar}%">Confidence ${pct}%<span class="meter"><span style="width:${pct}%"></span><i style="left:${bar}%"></i></span></span>` : ""}
    </div>
    <div class="verdict-body">
      ${a.files.length ? `<div class="thumbs">${a.files.map((f) => thumb(f)).join("")}</div>` : ""}
      ${a.note ? `<div class="small"><b>Payee's note:</b> <span class="muted">${esc(a.note)}</span></div>` : ""}
      ${a.ai ? `<div>${esc(a.ai.summary)}</div>` : `<div>${esc(a.aiError)}</div>`}
      ${
        a.ai?.criteria?.length
          ? `<div class="crit">${a.ai.criteria
              .map(
                (c) => `<div class="crit-row"><span class="crit-icon ${c.status}">${{ met: "✓", not_met: "✕", unclear: "?" }[c.status]}</span><div><b>${esc(c.criterion)}</b><p>${esc(c.observation)}</p></div></div>`
              )
              .join("")}</div>`
          : ""
      }
      ${
        a.trustFlags.length || a.ai?.concerns?.length
          ? `<div class="flags">${a.trustFlags.map((f) => `<div class="flag ${f.severity}">Trust check: ${esc(f.message)}</div>`).join("")}${(a.ai?.concerns || [])
              .map((c) => `<div class="flag medium">AI concern: ${esc(c)}</div>`)
              .join("")}</div>`
          : `<div class="flag info">Trust checks passed: no reused files, no date or location problems.</div>`
      }
      ${a.decision ? `<div class="policy"><b>Release policy: ${esc(outcome)}.</b> ${esc(a.decision.reason)}</div>` : ""}
      ${latest && a.ai?.feedback_to_payee ? `<div class="feedback"><b>To ${esc(p.payee.name)}:</b> ${esc(a.ai.feedback_to_payee)}</div>` : ""}
    </div>
  </div>`;
}

function thumb(f) {
  const title = `${f.name}${f.meta?.takenAt ? ` · taken ${f.meta.takenAt.slice(0, 10)}` : ""}`;
  const src = assetUrl(f.url);
  if (f.mime.startsWith("image/")) {
    return `<a class="thumb" href="${esc(src)}" target="_blank" rel="noopener" title="${esc(title)}"><img src="${esc(src)}" alt="${esc(f.name)}" loading="lazy"></a>`;
  }
  return `<a class="thumb" href="${esc(src)}" target="_blank" rel="noopener" title="${esc(title)}">PDF</a>`;
}

function moneyResult(p, m) {
  if (m.status === "released" && m.payout) {
    const paypalLink = m.payout.mode === "paypal";
    return `<div class="payout"><b>${money(m.amountCents, p.currency)} paid to ${esc(p.payee.name)}</b>
      <div class="tiny" style="margin-top:4px">${paypalLink ? "PayPal Payouts batch" : "Simulated payout"} <span class="mono">${esc(m.payout.payoutBatchId)}</span> · status ${esc(m.payout.itemStatus || m.payout.status)}
      ${paypalLink ? ` · <a href="#" data-act="payout-status" data-mid="${m.id}">refresh</a>` : ""}</div></div>`;
  }
  if (m.status === "release_failed") {
    return `<div class="payout failed"><b>Payout failed</b><div class="tiny" style="margin-top:4px">${esc(m.payout?.error)}</div></div>`;
  }
  if (m.status === "refunded" && m.refund) {
    return `<div class="payout refund"><b>${money(m.amountCents, p.currency)} refunded to ${esc(p.payer.name)}</b><div class="tiny" style="margin-top:4px">${esc(m.refund.reason)} · <span class="mono">${esc(m.refund.refundId)}</span></div></div>`;
  }
  return "";
}

function milestoneActions(p, m) {
  if (p.status !== "active") return "";
  const out = [];
  if (role === "payee" && ["open", "rejected"].includes(m.status)) {
    out.push(`<form class="upload" data-mid="${m.id}">
      <label>${m.status === "rejected" ? "Submit new proof" : "Submit proof for this milestone"}</label>
      <label class="drop"><input type="file" name="files" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" multiple>
        <span>Drop photos, screenshots or PDFs here, or click to choose</span></label>
      <div class="thumbs preview"></div>
      <div class="grid2" style="margin-top:10px">
        <div><label>Note to the payer</label><textarea name="note" rows="2" placeholder="What did you finish?"></textarea></div>
        <div><label>Links <span class="muted">(optional)</span></label><textarea name="links" rows="2" placeholder="https://…"></textarea></div>
      </div>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn primary" type="submit">Submit for AI verification</button></div>
    </form>`);
  }
  if (role === "payee" && m.status === "rejected") {
    out.push(`<div class="row" style="margin-top:10px"><button class="btn ghost small" data-act="dispute" data-mid="${m.id}">Dispute this decision</button></div>`);
  }
  if (["payer", "reviewer"].includes(role) && m.status === "in_review") {
    out.push(`<div class="review-box">
      <h4>Your decision${m.dispute ? " (payee disputed)" : ""}</h4>
      ${m.dispute ? `<p class="small" style="margin-bottom:8px"><b>Payee says:</b> ${esc(m.dispute.reason)}</p>` : ""}
      <textarea data-review-note="${m.id}" rows="2" placeholder="Optional note for the audit trail"></textarea>
      <div class="row" style="margin-top:10px">
        <button class="btn success" data-act="review-approve" data-mid="${m.id}">Approve and release ${money(m.amountCents, p.currency)}</button>
        <button class="btn danger" data-act="review-reject" data-mid="${m.id}">Reject</button>
      </div>
    </div>`);
  }
  if (["payer", "reviewer"].includes(role) && m.status === "release_failed") {
    out.push(`<div class="row" style="margin-top:10px"><button class="btn primary small" data-act="retry" data-mid="${m.id}">Retry payout</button></div>`);
  }
  if (["payer", "reviewer"].includes(role) && ["open", "rejected", "in_review", "release_failed"].includes(m.status)) {
    out.push(`<div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn danger small" data-act="refund" data-mid="${m.id}">Cancel milestone and refund</button></div>`);
  }
  return out.join("");
}

function wireProject(p) {
  const base = `/api/projects/${p.id}`;
  const reload = () => renderProject(p.id);

  document.getElementById("approve-btn")?.addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      await api(`${base}/approve`, { method: "POST" });
      toast("Terms approved");
      await reload();
    })
  );
  document.getElementById("edit-btn")?.addEventListener("click", () => {
    editing = !editing;
    reload();
  });
  document.getElementById("save-terms")?.addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      const milestones = [...document.querySelectorAll(".ms")].map((card) => {
        const v = (f) => card.querySelector(`[data-f="${f}"]`).value;
        const lines = (f) => v(f).split("\n").map((s) => s.trim()).filter(Boolean);
        return { id: card.dataset.mid, title: v("title"), description: v("description"), amount: Number(v("amount")), acceptanceCriteria: lines("acceptanceCriteria"), requiredEvidence: lines("requiredEvidence") };
      });
      await api(`${base}/terms`, { method: "PUT", body: { milestones } });
      editing = false;
      toast("Terms saved. Both parties need to approve again.");
      await reload();
    })
  );

  document.getElementById("sim-fund")?.addEventListener("click", (e) =>
    busy(e.currentTarget, async () => {
      await api(`${base}/fund/simulate`, { method: "POST" });
      toast("Funds are now held");
      await reload();
    })
  );
  if (document.getElementById("paypal-buttons")) mountPayPal(p, reload);

  document.querySelectorAll("form.upload").forEach((form) => wireUpload(p, form, reload));

  document.querySelectorAll("[data-act]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const mid = el.dataset.mid;
      const url = `${base}/milestones/${mid}`;
      const act = el.dataset.act;
      busy(el, async () => {
        if (act === "review-approve" || act === "review-reject") {
          const note = document.querySelector(`[data-review-note="${mid}"]`)?.value || "";
          await api(`${url}/review`, { body: { decision: act === "review-approve" ? "approve" : "reject", note } });
          toast(act === "review-approve" ? "Approved and released" : "Rejected");
        } else if (act === "dispute") {
          const reason = prompt("Why is this rejection wrong? A reviewer will see your explanation.");
          if (!reason) return;
          await api(`${url}/dispute`, { body: { reason } });
          toast("Dispute sent to human review");
        } else if (act === "refund") {
          const reason = prompt("Reason for cancelling this milestone (shown in the audit trail):", "Work not delivered.");
          if (reason === null) return;
          await api(`${url}/refund`, { body: { reason } });
          toast("Refunded to the payer");
        } else if (act === "retry") {
          await api(`${url}/retry-release`, { method: "POST" });
        } else if (act === "payout-status") {
          await api(`${url}/payout-status`, { method: "POST" });
        }
        await reload();
      });
    })
  );
}

function wireUpload(p, form, reload) {
  const input = form.querySelector('input[type="file"]');
  const drop = form.querySelector(".drop");
  const preview = form.querySelector(".preview");
  let files = [];
  const show = () => {
    preview.innerHTML = files
      .map((f) => (f.type.startsWith("image/") ? `<span class="thumb"><img src="${URL.createObjectURL(f)}" alt=""></span>` : `<span class="thumb">PDF</span>`))
      .join("");
  };
  input.addEventListener("change", () => {
    files = [...input.files];
    show();
  });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add("over"))));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.remove("over"))));
  drop.addEventListener("drop", (e) => {
    files = [...e.dataTransfer.files];
    show();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!files.length) return toast("Add at least one photo, screenshot or PDF.", true);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("note", form.note.value);
    fd.append("links", form.links.value);
    showOverlay("Verifying the evidence", [
      "Fingerprinting files and reading photo metadata",
      "Running trust checks: reuse, dates, location, edits",
      `${config.ai.enabled ? config.ai.vision : "AI"} is checking every acceptance criterion`,
      "Applying the release policy",
      "Moving money through PayPal",
    ]);
    try {
      await api(`/api/projects/${p.id}/milestones/${form.dataset.mid}/evidence`, { body: fd });
    } catch (err) {
      toast(err.message, true);
    } finally {
      hideOverlay();
    }
    await reload();
  });
}

let paypalSdkCurrency = null;
function loadPayPalSdk(currency) {
  if (window.paypal && paypalSdkCurrency === currency) return Promise.resolve(window.paypal);
  document.getElementById("paypal-sdk")?.remove();
  delete window.paypal;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.id = "paypal-sdk";
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypal.clientId)}&currency=${currency}&intent=capture`;
    s.onload = () => {
      paypalSdkCurrency = currency;
      resolve(window.paypal);
    };
    s.onerror = () => reject(new Error("Could not load PayPal checkout."));
    document.head.appendChild(s);
  });
}

async function mountPayPal(p, reload) {
  try {
    const paypal = await loadPayPalSdk(p.currency);
    await paypal
      .Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay" },
        createOrder: async () => (await api(`/api/projects/${p.id}/fund/order`, { method: "POST" })).orderId,
        onApprove: async (data) => {
          showOverlay("Securing the funds", ["Capturing the PayPal payment", "Holding funds against milestones"]);
          try {
            await api(`/api/projects/${p.id}/fund/capture`, { body: { orderId: data.orderID } });
            toast("Payment captured. Funds are held.");
          } catch (err) {
            toast(err.message, true);
          } finally {
            hideOverlay();
          }
          await reload();
        },
        onError: (err) => toast(err?.message || "PayPal checkout failed.", true),
      })
      .render("#paypal-buttons");
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------- Boot

async function boot() {
  config = await api("/api/config");
  document.getElementById("modes").innerHTML = `
    <span class="mode ${config.ai.enabled ? "on" : "sim"}" title="${esc(config.ai.enabled ? `text: ${config.ai.text} | vision: ${config.ai.vision}` : "")}"><span class="dot"></span>AI: ${esc(
      config.ai.enabled ? (config.ai.provider === "nvidia" ? "NVIDIA" : "Claude") : config.ai.provider === "simulated" ? "simulated" : "not connected"
    )}</span>
    <span class="mode ${config.paypal.mode === "sandbox" ? "on" : "sim"}"><span class="dot"></span>PayPal: ${
      { sandbox: "sandbox", simulated: "simulated", not_configured: "not connected" }[config.paypal.mode]
    }</span>`;
  document.querySelectorAll(".role-switch button").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.role)));
  document.querySelectorAll(".role-switch button").forEach((b) => b.classList.toggle("active", b.dataset.role === role));
  route();
}
boot();
