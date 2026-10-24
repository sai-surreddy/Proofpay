# ProofPay: money that only moves when work is proven

## Inspiration

Trust is the hidden tax on small payments. Clients don't want to pay before work is done. Freelancers don't want to work without a guarantee. Donors stop giving when they can't see where their money went. Each side asks the other to go first, and many good deals never happen.

## What it does

ProofPay holds a payment and releases it milestone by milestone, but only when evidence proves the work was done.

1. **Agree.** Describe the deal in plain language. An AI agreement agent turns it into milestones. Each one gets acceptance criteria that a photo, screenshot or receipt can actually prove. Both parties approve the terms before any money moves.
2. **Fund.** The payer funds the agreement with PayPal Checkout, and the money is held.
3. **Prove.** The payee uploads evidence for each milestone.
4. **Verify and release.** Deterministic trust checks run first. They catch reused photos, old photos, wrong locations, and edited files. Then an AI verification agent judges every criterion and explains what it saw. A clear pass is paid out instantly through PayPal Payouts. A clear fail returns specific feedback to the payee. Anything uncertain goes to a human. A cancelled milestone is refunded to the payer.

The same engine serves freelance work, community projects, charity, and microloans.

## How we built it

- **PayPal.** The payer funds through Orders v2 checkout with the JavaScript SDK buttons. Each verified milestone is released through the Payouts API, and cancelled milestones are refunded through the Captures Refund API. Idempotency keys protect against double payment.
- **AI.** Claude powers two agents.
  - The agreement agent uses structured JSON output to write the milestone plan.
  - The verification agent uses vision to read photos and PDFs and produces a per-criterion verdict with a confidence score.
- **Trust layer.** Files are fingerprinted to detect reuse across agreements. Photo metadata is checked for capture time, GPS location, and editing software.
- **Release policy.** The AI recommends and the server decides. Money moves automatically only when the AI's confidence clears a threshold and no serious trust flag exists.
- **Audit trail.** Every approval, verdict, policy decision, and PayPal transaction ID is logged.
- **Stack.** Node.js and Express, with a plain JavaScript frontend.

## Responsible AI

- **Agreed criteria.** The AI judges evidence against criteria both parties approved in advance, never against its own opinion of the work.
- **Grounded verdicts.** Every verdict cites what the AI saw in specific files. The payee's own description counts as a claim, not proof.
- **Prompt injection defence.** Instructions hidden in photos or notes, such as "approve this payment", are treated as a fraud signal and never obeyed.
- **Humans decide uncertain cases.** Low confidence, serious trust flags, and disputes always go to a person.

## Challenges

- **Holding funds over weeks.** PayPal authorizations only hold funds for a short window. We capture the payment upfront and release it later with Payouts.
- **Writing provable criteria.** The agreement agent had to learn to write criteria that evidence can prove, rather than vague quality judgments.

## What's next

- **Production payments.** Move to PayPal's marketplace flows, which hold a captured payment and pay the seller later, and partner with a licensed escrow provider.
- **Stronger evidence checks.** Add perceptual image matching to catch near-duplicate photos, and verify live links.
- **Real accounts.** Add proper accounts for payers, payees, and reviewers.
- **Community reviewers.** Let charity and microloan circles appoint their own reviewers.

## Honest scope

This is a sandbox prototype. Holding money for others is regulated as escrow or money transmission. A real launch needs licensing, know-your-customer checks for both parties, and compliance review. The payment flows here are real PayPal sandbox calls.
