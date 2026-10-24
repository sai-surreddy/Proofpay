// ProofPay engine: agreement lifecycle, the release policy, and every money movement.
// Rule of the system: the AI recommends, the policy decides, and every step is written to the audit log.
import { getState, save, newId } from "./db.js";
import * as paypal from "./paypal.js";

export const AUTO_RELEASE_CONFIDENCE = Number(process.env.AUTO_RELEASE_CONFIDENCE || 0.8);

export class EngineError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const ROLE_LABEL = { payer: "Payer", payee: "Payee", reviewer: "Reviewer", agent: "ProofPay agent", system: "System" };

export function log(project, actor, type, message, data) {
  project.log.push({ at: new Date().toISOString(), actor, actorLabel: ROLE_LABEL[actor] || actor, type, message, data });
}

export function getProject(id) {
  const project = getState().projects[id];
  if (!project) throw new EngineError("Agreement not found.", 404);
  return project;
}

export function getMilestone(project, mid) {
  const m = project.milestones.find((x) => x.id === mid);
  if (!m) throw new EngineError("Milestone not found.", 404);
  return m;
}

export function requireRole(role, ...allowed) {
  if (!allowed.includes(role)) {
    throw new EngineError(`Only the ${allowed.map((r) => ROLE_LABEL[r]).join(" or ")} can do this.`, 403);
  }
}

const toCents = (n) => Math.round(Number(n) * 100);

function normalizeMilestones(raw, totalCents) {
  const milestones = raw.map((m) => ({
    id: m.id || newId("ms"),
    title: String(m.title || "Milestone").slice(0, 120),
    description: String(m.description || "").slice(0, 1000),
    amountCents: Math.max(0, toCents(m.amount ?? (m.amountCents ?? 0) / 100)),
    acceptanceCriteria: (m.acceptanceCriteria || m.acceptance_criteria || []).map(String).filter(Boolean),
    requiredEvidence: (m.requiredEvidence || m.required_evidence || []).map(String).filter(Boolean),
    status: "open",
    attempts: [],
    payout: null,
    refund: null,
  }));
  if (!milestones.length) throw new EngineError("An agreement needs at least one milestone.");
  if (totalCents != null) {
    // Make the plan add up exactly: any rounding difference goes on the final milestone.
    const sum = milestones.reduce((s, m) => s + m.amountCents, 0);
    milestones[milestones.length - 1].amountCents += totalCents - sum;
    if (milestones[milestones.length - 1].amountCents < 0) throw new EngineError("Milestone amounts exceed the total.");
  }
  return milestones;
}

export function createProject({ input, draft }) {
  const totalCents = toCents(input.amount);
  const project = {
    id: newId("pp"),
    createdAt: new Date().toISOString(),
    category: input.category,
    description: input.description,
    title: draft.title,
    summary: draft.summary,
    riskNotes: draft.risk_notes || [],
    currency: input.currency,
    totalCents,
    payer: { name: input.payerName, email: input.payerEmail || null },
    payee: { name: input.payeeName, email: input.payeeEmail },
    status: "awaiting_approval",
    approvals: { payer: null, payee: null },
    funding: null,
    fundedAt: null,
    siteLocation: null,
    milestones: normalizeMilestones(draft.milestones, totalCents),
    log: [],
  };
  log(project, "payer", "created", `Agreement drafted from a plain-language description.`);
  log(project, "agent", "plan", `Agreement agent proposed ${project.milestones.length} milestones.`, {
    milestones: project.milestones.map((m) => ({ title: m.title, amountCents: m.amountCents })),
  });
  getState().projects[project.id] = project;
  save();
  return project;
}

export function editTerms(project, role, milestones) {
  requireRole(role, "payer", "payee");
  if (project.status !== "awaiting_approval") throw new EngineError("Terms are locked once both parties approve.");
  project.milestones = normalizeMilestones(milestones, null);
  project.totalCents = project.milestones.reduce((s, m) => s + m.amountCents, 0);
  if (project.totalCents <= 0) throw new EngineError("The total must be more than zero.");
  project.approvals = { payer: null, payee: null };
  log(project, role, "terms_edited", `Terms edited. Both parties need to approve again.`);
  save();
}

export function approveTerms(project, role) {
  requireRole(role, "payer", "payee");
  if (project.status !== "awaiting_approval") throw new EngineError("These terms are already locked.");
  project.approvals[role] = new Date().toISOString();
  log(project, role, "approved", `${ROLE_LABEL[role]} approved the milestones and acceptance criteria.`);
  if (project.approvals.payer && project.approvals.payee) {
    project.status = "awaiting_funding";
    log(project, "system", "locked", "Both parties approved. Terms are locked and ready to fund.");
  }
  save();
}

export function markFunded(project, funding) {
  if (project.status !== "awaiting_funding") throw new EngineError("This agreement is not waiting for funds.");
  project.funding = funding;
  project.fundedAt = new Date().toISOString();
  project.status = "active";
  const where = funding.mode === "paypal" ? `PayPal sandbox capture ${funding.captureId}` : "simulated funding";
  log(project, "payer", "funded", `${fmt(project.totalCents, project.currency)} is now held (${where}).`, funding);
  save();
}

export function fmt(cents, currency) {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}

export function balances(project) {
  const released = project.milestones.filter((m) => m.status === "released").reduce((s, m) => s + m.amountCents, 0);
  const refunded = project.milestones.filter((m) => m.status === "refunded").reduce((s, m) => s + m.amountCents, 0);
  const funded = project.funding ? project.totalCents : 0;
  return { funded, released, refunded, held: funded - released - refunded };
}

// ---------------------------------------------------------------- Release policy

export function decide(ai, trustFlags, aiError) {
  const serious = trustFlags.filter((f) => f.severity === "high");
  if (aiError) return { outcome: "human_review", reason: `The AI could not finish: ${aiError}` };
  if (serious.length) {
    return { outcome: "human_review", reason: "Automated trust checks found a serious issue, so a person must decide." };
  }
  const pct = Math.round(AUTO_RELEASE_CONFIDENCE * 100);
  if (ai.verdict === "approve" && ai.confidence >= AUTO_RELEASE_CONFIDENCE) {
    return { outcome: "auto_release", reason: `Every criterion met with confidence at or above ${pct}%.` };
  }
  if (ai.verdict === "approve") {
    return { outcome: "human_review", reason: `AI leaned approve, but confidence was below the ${pct}% auto-release bar.` };
  }
  if (ai.verdict === "reject" && ai.confidence >= AUTO_RELEASE_CONFIDENCE) {
    return { outcome: "auto_reject", reason: "One or more criteria were clearly not met. The payee can resubmit or dispute." };
  }
  if (ai.verdict === "reject") {
    return { outcome: "human_review", reason: `AI leaned reject, but confidence was below ${pct}%.` };
  }
  return { outcome: "human_review", reason: "The AI asked for a human to look at this evidence." };
}

// ---------------------------------------------------------------- Money movement

export async function releaseMilestone(project, milestone, actor, reason) {
  if (!["verifying", "in_review", "rejected", "release_failed"].includes(milestone.status)) {
    throw new EngineError(`This milestone cannot be released from status "${milestone.status}".`);
  }
  if (!project.payee.email) throw new EngineError("The payee has no PayPal email on file.");

  const batchId = `pp-${milestone.id}-${(milestone.payout?.tries || 0) + 1}`;
  const note = `ProofPay released ${fmt(milestone.amountCents, project.currency)} for "${milestone.title}" (${project.title}). ${reason}`;
  try {
    let result;
    if (project.funding.mode === "paypal") {
      result = await paypal.sendPayout({
        batchId,
        receiverEmail: project.payee.email,
        amountCents: milestone.amountCents,
        currency: project.currency,
        note,
        itemId: milestone.id,
      });
    } else {
      result = { payoutBatchId: `SIM-PAYOUT-${milestone.id.slice(3).toUpperCase()}`, status: "SUCCESS" };
    }
    milestone.payout = {
      mode: project.funding.mode,
      batchId,
      payoutBatchId: result.payoutBatchId,
      status: result.status,
      at: new Date().toISOString(),
      tries: (milestone.payout?.tries || 0) + 1,
    };
    milestone.status = "released";
    log(
      project,
      actor,
      "released",
      `Released ${fmt(milestone.amountCents, project.currency)} to ${project.payee.name} for "${milestone.title}". ${reason}`,
      { payoutBatchId: result.payoutBatchId, status: result.status, mode: project.funding.mode }
    );
    anchorSiteLocation(project, milestone);
  } catch (err) {
    milestone.status = "release_failed";
    milestone.payout = { ...(milestone.payout || {}), error: err.message, tries: (milestone.payout?.tries || 0) + 1 };
    log(project, "system", "release_failed", `Payout for "${milestone.title}" failed: ${err.message}`);
  }
  checkCompletion(project);
  save();
}

export async function refundMilestone(project, milestone, actor, reason) {
  if (!["open", "rejected", "in_review", "release_failed"].includes(milestone.status)) {
    throw new EngineError(`This milestone cannot be refunded from status "${milestone.status}".`);
  }
  if (!project.funding) throw new EngineError("Nothing has been funded yet.");
  let result;
  if (project.funding.mode === "paypal") {
    result = await paypal.refundCapture({
      captureId: project.funding.captureId,
      amountCents: milestone.amountCents,
      currency: project.currency,
      note: `Refund for "${milestone.title}": ${reason}`,
      requestId: `refund-${milestone.id}`,
    });
  } else {
    result = { refundId: `SIM-REFUND-${milestone.id.slice(3).toUpperCase()}`, status: "COMPLETED" };
  }
  milestone.refund = { ...result, at: new Date().toISOString(), reason };
  milestone.status = "refunded";
  log(
    project,
    actor,
    "refunded",
    `Refunded ${fmt(milestone.amountCents, project.currency)} to ${project.payer.name} for "${milestone.title}". ${reason}`,
    result
  );
  checkCompletion(project);
  save();
}

export async function refreshPayout(project, milestone) {
  if (milestone.payout?.mode !== "paypal" || !milestone.payout.payoutBatchId) return;
  const status = await paypal.getPayout(milestone.payout.payoutBatchId);
  milestone.payout = { ...milestone.payout, status: status.status, itemStatus: status.itemStatus, transactionId: status.transactionId };
  save();
}

function anchorSiteLocation(project, milestone) {
  if (project.siteLocation) return;
  const attempt = milestone.attempts[milestone.attempts.length - 1];
  const gps = attempt?.files.find((f) => f.meta?.lat != null);
  if (gps) {
    project.siteLocation = { lat: gps.meta.lat, lng: gps.meta.lng };
    log(project, "system", "site_anchored", "Job site location anchored from verified photo GPS. Later photos are checked against it.");
  }
}

function checkCompletion(project) {
  if (project.milestones.every((m) => ["released", "refunded"].includes(m.status)) && project.status === "active") {
    project.status = "completed";
    log(project, "system", "completed", "All milestones settled. Agreement complete.");
  }
}
