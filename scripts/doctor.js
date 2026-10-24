// Checks every external connection ProofPay needs, with your real keys.
// Usage: npm run doctor
//        npm run doctor -- --payout someone@personal.example.com   (also sends a 1.00 USD sandbox payout)
try {
  process.loadEnvFile();
} catch {}

const { generateJSON, provider, models } = await import("../server/llm.js");
const paypal = await import("../server/paypal.js");
const sharp = (await import("sharp")).default;

let failed = 0;
const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? `  (${detail})` : ""}`);
const bad = (label, err) => {
  failed++;
  console.log(`  FAIL  ${label}\n        ${err}`);
};

console.log("\nAI");
const p = provider();
if (!p) {
  bad("AI provider", "No key found. Add NVIDIA_API_KEY or ANTHROPIC_API_KEY to .env.");
} else {
  const m = models();
  console.log(`  using ${p}: text ${m.text}, vision ${m.vision}`);
  try {
    const out = await generateJSON({
      system: "You answer briefly.",
      parts: [{ type: "text", text: "Return the sum of 19 and 23." }],
      schema: { type: "object", required: ["sum"], properties: { sum: { type: "integer" } } },
      kind: "text",
      validate: (o) => (Number(o.sum) === 42 ? null : `got ${o.sum}`),
    });
    ok("text model returns valid JSON", `sum=${out.sum}`);
  } catch (e) {
    bad("text model", e.message);
  }
  try {
    const img = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 220, g: 30, b: 30 } } }).png().toBuffer();
    const out = await generateJSON({
      system: "You describe images precisely.",
      parts: [{ type: "text", text: "What color is this image?" }, { type: "image", buffer: img }],
      schema: { type: "object", required: ["color"], properties: { color: { type: "string" } } },
      kind: "vision",
      validate: (o) => (/red/i.test(o.color) ? null : `saw "${o.color}"`),
    });
    ok("vision model reads an image", `color=${out.color}`);
  } catch (e) {
    bad("vision model", e.message);
  }
}

console.log("\nPayPal sandbox");
if (!paypal.paypalEnabled()) {
  bad("PayPal keys", "Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.");
} else {
  try {
    const order = await paypal.createOrder({ projectId: "doctor", amountCents: 100, currency: "USD", description: "ProofPay connection test" });
    ok("login and Orders API", `test order ${order.orderId}, never captured`);
  } catch (e) {
    bad("Orders API", e.message);
  }
  const i = process.argv.indexOf("--payout");
  if (i > -1 && process.argv[i + 1]) {
    try {
      const r = await paypal.sendPayout({
        batchId: `doctor-${Date.now()}`,
        receiverEmail: process.argv[i + 1],
        amountCents: 100,
        currency: "USD",
        note: "ProofPay connection test",
        itemId: "doctor",
      });
      ok("Payouts API", `batch ${r.payoutBatchId}, ${r.status}`);
    } catch (e) {
      bad("Payouts API", `${e.message}\n        Open your sandbox app on developer.paypal.com and make sure "Payouts" is ticked under Features.`);
    }
  } else {
    console.log("  skip  Payouts API (run: npm run doctor -- --payout <sandbox personal email>)");
  }
}

console.log(failed ? `\n${failed} problem(s) found.\n` : "\nEverything is connected.\n");
process.exit(failed ? 1 : 0);
