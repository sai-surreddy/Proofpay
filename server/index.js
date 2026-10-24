import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  process.loadEnvFile(); // reads .env if present (Node 20.12+)
} catch {
  // no .env file: run in demo mode
}

const express = (await import("express")).default;
const multer = (await import("multer")).default;
const { getState, save, newId, withLock, UPLOAD_DIR } = await import("./db.js");
const ai = await import("./ai.js");
const paypal = await import("./paypal.js");
const { inspectFile, runTrustChecks } = await import("./trust.js");
const engine = await import("./engine.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Enable CORS for cross-origin hosting (e.g. Vercel frontend calling Render backend)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, x-role");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Health check endpoint for Render / monitoring
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(here, "..", "public")));
app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: false }));

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["application/pdf", "pdf"],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 8 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new engine.EngineError(`"${file.originalname}" is not supported. Use JPG, PNG, WEBP, GIF or PDF.`));
  },
});

function paypalMode() {
  if (paypal.paypalEnabled()) return "sandbox";
  return ai.simulation() ? "simulated" : "not_configured";
}

const role = (req) => String(req.get("x-role") || req.body?.role || "").toLowerCase();

function view(project) {
  return { ...project, balances: engine.balances(project), autoReleaseConfidence: engine.AUTO_RELEASE_CONFIDENCE };
}

// ---------------------------------------------------------------- Config

app.get("/api/config", (_req, res) => {
  res.json({
    ai: ai.aiStatus(),
    paypal: {
      mode: paypalMode(),
      clientId: paypal.paypalEnabled() ? process.env.PAYPAL_CLIENT_ID : null,
    },
    autoReleaseConfidence: engine.AUTO_RELEASE_CONFIDENCE,
  });
});

// ---------------------------------------------------------------- Agreements

app.get("/api/projects", (_req, res) => {
  const list = Object.values(getState().projects)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      status: p.status,
      currency: p.currency,
      totalCents: p.totalCents,
      payer: p.payer.name,
      payee: p.payee.name,
      createdAt: p.createdAt,
      balances: engine.balances(p),
      milestones: p.milestones.map((m) => m.status),
    }));
  res.json(list);
});

app.post("/api/projects", async (req, res) => {
  const b = req.body || {};
  const input = {
    description: String(b.description || "").trim(),
    amount: Number(b.amount),
    currency: String(b.currency || "USD").toUpperCase(),
    category: String(b.category || "freelance"),
    payerName: String(b.payerName || "").trim() || "Payer",
    payerEmail: String(b.payerEmail || "").trim() || null,
    payeeName: String(b.payeeName || "").trim() || "Payee",
    payeeEmail: String(b.payeeEmail || "").trim(),
  };
  if (input.description.length < 20) throw new engine.EngineError("Describe the deal in at least a sentence or two.");
  if (!(input.amount > 0) || input.amount > 100000) throw new engine.EngineError("Enter an amount between 0 and 100,000.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.payeeEmail)) {
    throw new engine.EngineError("Enter the payee's PayPal email so verified milestones can be paid out.");
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new engine.EngineError("Currency must be a 3-letter code like USD.");
  const draft = await ai.draftAgreement(input);
  const project = engine.createProject({ input, draft });
  res.status(201).json(view(project));
});

app.get("/api/projects/:id", (req, res) => {
  res.json(view(engine.getProject(req.params.id)));
});

app.put("/api/projects/:id/terms", (req, res) => {
  const project = engine.getProject(req.params.id);
  engine.editTerms(project, role(req), req.body?.milestones || []);
  res.json(view(project));
});

app.post("/api/projects/:id/approve", (req, res) => {
  const project = engine.getProject(req.params.id);
  engine.approveTerms(project, role(req));
  res.json(view(project));
});

// ---------------------------------------------------------------- Funding

app.post("/api/projects/:id/fund/order", async (req, res) => {
  const project = engine.getProject(req.params.id);
  engine.requireRole(role(req), "payer");
  if (project.status !== "awaiting_funding") throw new engine.EngineError("This agreement is not waiting for funds.");
  if (!paypal.paypalEnabled()) throw new engine.EngineError("PayPal is not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.");
  const order = await paypal.createOrder({
    projectId: project.id,
    amountCents: project.totalCents,
    currency: project.currency,
    description: `ProofPay: ${project.title}`,
  });
  engine.log(project, "payer", "order_created", `PayPal order ${order.orderId} created for ${engine.fmt(project.totalCents, project.currency)}.`);
  save();
  res.json(order);
});

app.post("/api/projects/:id/fund/capture", async (req, res) => {
  const project = engine.getProject(req.params.id);
  engine.requireRole(role(req), "payer");
  const orderId = String(req.body?.orderId || "");
  await withLock(project.id, async () => {
    const cap = await paypal.captureOrder(orderId);
    if (cap.status !== "COMPLETED" || !cap.captureId) {
      throw new engine.EngineError(`PayPal did not complete the payment (status ${cap.status}).`);
    }
    engine.markFunded(project, { mode: "paypal", orderId, captureId: cap.captureId, payerEmail: cap.payerEmail });
  });
  res.json(view(project));
});

app.post("/api/projects/:id/fund/simulate", async (req, res) => {
  const project = engine.getProject(req.params.id);
  engine.requireRole(role(req), "payer");
  if (paypalMode() !== "simulated") throw new engine.EngineError("Simulated funding is off. Fund through PayPal.");
  await withLock(project.id, async () => {
    engine.markFunded(project, { mode: "simulated", orderId: `SIM-ORDER-${project.id.slice(3).toUpperCase()}`, captureId: null });
  });
  res.json(view(project));
});

// ---------------------------------------------------------------- Evidence and verification

app.post("/api/projects/:id/milestones/:mid/evidence", upload.array("files", 8), async (req, res) => {
  const project = engine.getProject(req.params.id);
  const milestone = engine.getMilestone(project, req.params.mid);
  engine.requireRole(role(req), "payee");
  if (project.status !== "active") throw new engine.EngineError("Evidence can be submitted once the agreement is funded.");
  if (!["open", "rejected"].includes(milestone.status)) {
    throw new engine.EngineError(`This milestone is "${milestone.status}" and is not accepting evidence.`);
  }
  const uploaded = req.files || [];
  const note = String(req.body?.note || "").slice(0, 4000);
  const links = String(req.body?.links || "")
    .split(/\s+/)
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, 10);
  if (!uploaded.length) throw new engine.EngineError("Upload at least one photo, screenshot or PDF.");

  await withLock(`${project.id}:${milestone.id}`, async () => {
    const previousStatus = milestone.status;
    if (!["open", "rejected"].includes(previousStatus)) {
      throw new engine.EngineError(`This milestone is "${previousStatus}" and is not accepting evidence.`);
    }
    milestone.status = "verifying";
    save();
    try {
      await processEvidence();
    } finally {
      if (milestone.status === "verifying") {
        milestone.status = previousStatus;
        save();
      }
    }
  });
  res.json(view(project));

  async function processEvidence() {
    const files = [];
    for (const f of uploaded) {
      const { sha256, meta } = await inspectFile(f.buffer, f.mimetype);
      const stored = `${sha256.slice(0, 24)}.${ALLOWED.get(f.mimetype)}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, stored), f.buffer);
      files.push({ name: f.originalname, mime: f.mimetype, size: f.size, sha256, meta, url: `/uploads/${stored}`, buffer: f.buffer });
    }

    const state = getState();
    const { flags } = runTrustChecks({ files, project, hashIndex: state.evidenceHashes, milestoneId: milestone.id });
    const attempt = {
      id: newId("att"),
      at: new Date().toISOString(),
      note,
      links,
      files: files.map(({ buffer, ...rest }) => rest),
      trustFlags: flags,
      ai: null,
      aiError: null,
      decision: null,
    };
    engine.log(project, "payee", "evidence", `Submitted ${files.length} file(s) for "${milestone.title}".`, {
      files: attempt.files.map((f) => ({ name: f.name, sha256: f.sha256 })),
    });

    try {
      attempt.ai = await ai.verifyEvidence({
        project,
        milestone,
        files,
        note,
        links,
        trustFlags: flags,
        previousAttempts: milestone.attempts.filter((a) => a.ai).map((a) => a.ai),
      });
    } catch (err) {
      attempt.aiError = err.message;
    }
    attempt.decision = engine.decide(attempt.ai, flags, attempt.aiError);
    milestone.attempts.push(attempt);
    for (const f of attempt.files) {
      state.evidenceHashes[f.sha256] ??= { projectId: project.id, milestoneId: milestone.id, attemptId: attempt.id };
    }

    if (attempt.ai) {
      engine.log(
        project,
        "agent",
        "verdict",
        `Verification agent: ${attempt.ai.verdict.replace(/_/g, " ")} (${Math.round(attempt.ai.confidence * 100)}% confidence). ${attempt.ai.summary}`
      );
    } else {
      engine.log(project, "agent", "verdict_error", attempt.aiError);
    }

    if (attempt.decision.outcome === "auto_release") {
      await engine.releaseMilestone(project, milestone, "agent", attempt.decision.reason);
    } else if (attempt.decision.outcome === "auto_reject") {
      milestone.status = "rejected";
      engine.log(project, "agent", "rejected", `Not released. ${attempt.decision.reason}`);
    } else {
      milestone.status = "in_review";
      engine.log(project, "system", "review", `Sent to human review. ${attempt.decision.reason}`);
    }
    save();
  }
});

app.post("/api/projects/:id/milestones/:mid/review", async (req, res) => {
  const project = engine.getProject(req.params.id);
  const milestone = engine.getMilestone(project, req.params.mid);
  const r = role(req);
  engine.requireRole(r, "payer", "reviewer");
  const decision = req.body?.decision;
  const note = String(req.body?.note || "").trim().slice(0, 1000);
  await withLock(`${project.id}:${milestone.id}`, async () => {
    if (milestone.status !== "in_review") throw new engine.EngineError("This milestone is not waiting for review.");
    if (decision === "approve") {
      await engine.releaseMilestone(project, milestone, r, `Approved after human review.${note ? ` Note: ${note}` : ""}`);
    } else if (decision === "reject") {
      milestone.status = "rejected";
      engine.log(project, r, "rejected", `Rejected after human review.${note ? ` Note: ${note}` : ""}`);
      save();
    } else {
      throw new engine.EngineError("Decision must be approve or reject.");
    }
  });
  res.json(view(project));
});

app.post("/api/projects/:id/milestones/:mid/dispute", async (req, res) => {
  const project = engine.getProject(req.params.id);
  const milestone = engine.getMilestone(project, req.params.mid);
  engine.requireRole(role(req), "payee");
  const reason = String(req.body?.reason || "").trim().slice(0, 1000);
  if (!reason) throw new engine.EngineError("Explain why the rejection is wrong.");
  await withLock(`${project.id}:${milestone.id}`, async () => {
    if (milestone.status !== "rejected") throw new engine.EngineError("Only a rejected milestone can be disputed.");
    milestone.status = "in_review";
    milestone.dispute = { at: new Date().toISOString(), reason };
    engine.log(project, "payee", "disputed", `Disputed the rejection: ${reason}`);
    save();
  });
  res.json(view(project));
});

app.post("/api/projects/:id/milestones/:mid/refund", async (req, res) => {
  const project = engine.getProject(req.params.id);
  const milestone = engine.getMilestone(project, req.params.mid);
  const r = role(req);
  engine.requireRole(r, "payer", "reviewer");
  const reason = String(req.body?.reason || "Milestone cancelled.").trim().slice(0, 500);
  await withLock(`${project.id}:${milestone.id}`, () => engine.refundMilestone(project, milestone, r, reason));
  res.json(view(project));
});

app.post("/api/projects/:id/milestones/:mid/retry-release", async (req, res) => {
  const project = engine.getProject(req.params.id);
  const milestone = engine.getMilestone(project, req.params.mid);
  const r = role(req);
  engine.requireRole(r, "payer", "reviewer");
  await withLock(`${project.id}:${milestone.id}`, async () => {
    if (milestone.status !== "release_failed") throw new engine.EngineError("Only a failed payout can be retried.");
    await engine.releaseMilestone(project, milestone, r, "Payout retried.");
  });
  res.json(view(project));
});

app.post("/api/projects/:id/milestones/:mid/payout-status", async (req, res) => {
  const project = engine.getProject(req.params.id);
  const milestone = engine.getMilestone(project, req.params.mid);
  await engine.refreshPayout(project, milestone);
  res.json(view(project));
});

// ---------------------------------------------------------------- Errors

app.use("/api", (_req, _res, next) => next(new engine.EngineError("Not found.", 404)));

app.use((err, _req, res, _next) => {
  let status = err.status && err.status < 500 ? err.status : 500;
  let message = err.message || "Something went wrong.";
  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "Each file must be under 20 MB." : message;
  } else if (err instanceof paypal.PayPalError) {
    status = 502;
  } else if (err instanceof ai.AIError) {
    status = 502;
  } else if (status === 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

const isDirectRun = Boolean(
  !process.env.VERCEL &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
);

if (isDirectRun) {
  app.listen(PORT, HOST, () => {
    console.log(`\nProofPay running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    const a = ai.aiStatus();
    const aiLine = a.enabled
      ? `${a.provider} (text: ${a.text}, vision: ${a.vision})`
      : a.provider === "simulated"
      ? "simulated"
      : "NOT CONFIGURED - add NVIDIA_API_KEY or ANTHROPIC_API_KEY to .env";
    const payLine = {
      sandbox: "sandbox",
      simulated: "simulated",
      not_configured: "NOT CONFIGURED - add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env",
    }[paypalMode()];
    console.log(`  AI:     ${aiLine}`);
    console.log(`  PayPal: ${payLine}`);
    console.log(`  Test your keys any time with: npm run doctor\n`);
  });
}

export default app;
