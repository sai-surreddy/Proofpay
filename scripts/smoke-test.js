// End-to-end smoke test in demo mode (no keys needed).
// Starts the server on a spare port with a throwaway data folder and drives the full lifecycle.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "proofpay-test-"));
const env = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir };
for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "NVIDIA_API_KEY", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "AI_PROVIDER"]) env[k] = "";
env.SIMULATION_MODE = "true";

const server = spawn(process.execPath, ["server/index.js"], { env, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => d.toString().includes("running") && resolve());
  server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
});

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

async function call(role, method, url, body) {
  const headers = { "x-role": role };
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body });
  return { status: res.status, data: await res.json() };
}

const png = (r, g, b) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer();
const form = async (buf, name) => {
  const fd = new FormData();
  fd.append("files", new Blob([buf], { type: "image/png" }), name);
  fd.append("note", "Done.");
  return fd;
};

try {
  const cfg = await call("payer", "GET", "/api/config");
  check(cfg.data.paypal.mode === "simulated" && !cfg.data.ai.enabled, "config reports simulation mode");

  const created = await call("payer", "POST", "/api/projects", {
    description: "Paint the fence around the community garden in two coats of green paint.",
    amount: 300,
    currency: "USD",
    payerName: "Garden club",
    payeeName: "Sam",
    payeeEmail: "sam@example.com",
  });
  check(created.status === 201, "agreement drafted");
  const p = created.data;
  const total = p.milestones.reduce((s, m) => s + m.amountCents, 0);
  check(total === 30000, "milestones add up to the total");

  const early = await call("payee", "POST", `/api/projects/${p.id}/fund/simulate`);
  check(early.status === 403, "payee cannot fund");

  await call("payer", "POST", `/api/projects/${p.id}/approve`);
  const both = await call("payee", "POST", `/api/projects/${p.id}/approve`);
  check(both.data.status === "awaiting_funding", "both approvals lock the terms");

  const funded = await call("payer", "POST", `/api/projects/${p.id}/fund/simulate`);
  check(funded.data.status === "active" && funded.data.balances.held === 30000, "funding holds the full amount");

  const [m1, m2, m3] = funded.data.milestones;
  const imgA = await png(20, 160, 60);
  const ev = await call("payee", "POST", `/api/projects/${p.id}/milestones/${m1.id}/evidence`, await form(imgA, "fence.png"));
  const m1After = ev.data.milestones[0];
  check(m1After.status === "in_review", "offline AI routes evidence to human review");
  check(m1After.attempts[0].files[0].sha256.length === 64, "evidence fingerprinted");

  const notAllowed = await call("payee", "POST", `/api/projects/${p.id}/milestones/${m1.id}/review`, { decision: "approve" });
  check(notAllowed.status === 403, "payee cannot approve their own work");

  const rel = await call("payer", "POST", `/api/projects/${p.id}/milestones/${m1.id}/review`, { decision: "approve" });
  check(rel.data.milestones[0].status === "released" && rel.data.balances.released === m1.amountCents, "human approval releases the payout");

  const dupe = await call("payee", "POST", `/api/projects/${p.id}/milestones/${m2.id}/evidence`, await form(imgA, "again.png"));
  const flags = dupe.data.milestones[1].attempts[0].trustFlags;
  check(flags.some((f) => f.code === "duplicate_evidence"), "reused photo is flagged as duplicate");

  const rej = await call("reviewer", "POST", `/api/projects/${p.id}/milestones/${m2.id}/review`, { decision: "reject", note: "Same photo as before." });
  check(rej.data.milestones[1].status === "rejected", "reviewer can reject");

  const disp = await call("payee", "POST", `/api/projects/${p.id}/milestones/${m2.id}/dispute`, { reason: "Wrong file, sorry." });
  check(disp.data.milestones[1].status === "in_review", "payee can dispute a rejection");

  const ref = await call("payer", "POST", `/api/projects/${p.id}/milestones/${m2.id}/refund`, { reason: "Cancelled." });
  check(ref.data.milestones[1].status === "refunded", "payer can refund a milestone");

  const imgB = await png(200, 40, 40);
  await call("payee", "POST", `/api/projects/${p.id}/milestones/${m3.id}/evidence`, await form(imgB, "final.png"));
  const done = await call("payer", "POST", `/api/projects/${p.id}/milestones/${m3.id}/review`, { decision: "approve" });
  check(done.data.status === "completed", "agreement completes when every milestone is settled");
  check(done.data.balances.held === 0, "nothing left held at the end");
  check(done.data.log.length >= 10, `audit trail recorded (${done.data.log.length} entries)`);

  const twice = await call("payer", "POST", `/api/projects/${p.id}/milestones/${m3.id}/review`, { decision: "approve" });
  check(twice.status === 400, "a released milestone cannot be released again");
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
