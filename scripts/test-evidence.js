import fs from 'node:fs';
try { process.loadEnvFile(); } catch {}
const ai = await import('../server/ai.js');

const milestone = {
  title: 'Design Mockup Delivery',
  acceptanceCriteria: [
    'Mockup includes a hero section with a placeholder for the bakery logo.',
    'Mockup shows a menu section listing at least 8 items with prices.',
    'Mockup includes a photo gallery layout with placeholders for at least 6 images.',
    'Mockup includes a contact form with name, email, and message fields.',
    'Mockup provides separate desktop and mobile views demonstrating responsive breakpoints.'
  ],
  requiredEvidence: [
    'PDF or image file of the desktop mockup with all sections labeled.',
    'PDF or image file of the mobile mockup with all sections labeled.',
    'Side‑by‑side screenshot showing desktop and mobile views together.'
  ]
};

const buf = fs.readFileSync('public/mayas_bakes_mockup_evidence.png');
const files = [{
  name: 'mayas_bakes_mockup_evidence.png',
  mime: 'image/png',
  buffer: buf
}];

console.log('Running AI verification on generated mockup with NVIDIA vision model...');
const verdict = await ai.verifyEvidence({
  project: {
    title: "Maya's Bakes One-Page Website",
    summary: "One-page responsive website for Maya's Bakes with hero, menu, gallery, and contact form.",
    currency: "USD"
  },
  milestone,
  note: "Delivering the complete design mockup for Maya's Bakes showing side-by-side desktop (1200px) and mobile (375px) responsive breakpoints, with hero section and bakery logo placeholder, full menu of 8 items with prices, 6 photo gallery placeholders, and working contact form with name, email and message fields.",
  files,
  links: [],
  trustFlags: [],
  previousAttempts: []
});

console.log('--- Verdict Result ---');
console.log('Verdict:', verdict.verdict);
console.log('Confidence:', verdict.confidence);
console.log('Summary:', verdict.summary);
console.log('Criteria Checks:', JSON.stringify(verdict.criteria_checks, null, 2));
console.log('Feedback:', verdict.feedback_to_payee);
