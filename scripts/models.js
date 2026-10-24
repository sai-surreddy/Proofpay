// Tries candidate NVIDIA models with YOUR key and reports which ones work for ProofPay.
// Usage: npm run models
try {
  process.loadEnvFile();
} catch {}
process.env.AI_PROVIDER = "nvidia";

const { generateJSON } = await import("../server/llm.js");
const sharp = (await import("sharp")).default;

if (!process.env.NVIDIA_API_KEY) {
  console.error("Add NVIDIA_API_KEY to .env first (get one at https://build.nvidia.com).");
  process.exit(1);
}

const TEXT = [
  "deepseek-ai/deepseek-v4.1-flash",
  "z-ai/glm-5.3",
  "moonshotai/kimi-k3",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
];
const VISION = [
  "meta/muse-glimmer-30b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "meta/llama-3.2-90b-vision-instruct",
  "google/gemma-3-12b-it",
];

// Live list, so you can see what else is available.
try {
  const r = await fetch("https://integrate.api.nvidia.com/v1/models");
  const ids = new Set(((await r.json()).data || []).map((m) => m.id));
  for (const m of [...TEXT, ...VISION]) if (!ids.has(m)) console.log(`note: ${m} is not in NVIDIA's public list right now`);
} catch {}

const image = await sharp({
  create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 90, b: 220 } },
})
  .composite([{ input: Buffer.from(`<svg width="512" height="512"><text x="256" y="340" font-size="260" font-family="Arial" font-weight="bold" fill="white" text-anchor="middle">7</text></svg>`) }])
  .png()
  .toBuffer();

async function time(fn) {
  const t = Date.now();
  try {
    const out = await fn();
    return { ok: true, ms: Date.now() - t, out };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, err: e.message };
  }
}

console.log("\nText models (used to write milestone plans)");
for (const model of TEXT) {
  process.env.NVIDIA_TEXT_MODEL = model;
  const r = await time(() =>
    generateJSON({
      system: "You write tiny project plans.",
      parts: [{ type: "text", text: "Split 'paint a fence for $100' into exactly 2 milestones whose amounts add up to 100." }],
      schema: {
        type: "object",
        required: ["milestones"],
        properties: { milestones: { type: "array", items: { type: "object", required: ["title", "amount"], properties: { title: { type: "string" }, amount: { type: "number" } } } } },
      },
      kind: "text",
      validate: (o) =>
        Array.isArray(o.milestones) && o.milestones.length === 2 && Math.round(o.milestones.reduce((s, m) => s + Number(m.amount), 0)) === 100
          ? null
          : "plan does not have 2 milestones adding to 100",
    })
  );
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${model.padEnd(45)} ${(r.ms / 1000).toFixed(1)}s${r.ok ? "" : `  ${r.err}`}`);
}

console.log("\nVision models (used to judge evidence photos)");
for (const model of VISION) {
  process.env.NVIDIA_VISION_MODEL = model;
  const r = await time(() =>
    generateJSON({
      system: "You describe images precisely.",
      parts: [{ type: "text", text: "What is the background color and what number is written on this image?" }, { type: "image", buffer: image }],
      schema: { type: "object", required: ["color", "number"], properties: { color: { type: "string" }, number: { type: "integer" } } },
      kind: "vision",
      validate: (o) => (/blue/i.test(o.color) && Number(o.number) === 7 ? null : `saw color "${o.color}" and number ${o.number}`),
    })
  );
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${model.padEnd(45)} ${(r.ms / 1000).toFixed(1)}s${r.ok ? "" : `  ${r.err}`}`);
}

console.log("\nPut your picks in .env as NVIDIA_TEXT_MODEL and NVIDIA_VISION_MODEL. Prefer the fastest PASS.\n");
