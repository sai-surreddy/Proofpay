// Model providers. ProofPay's agents speak one neutral format; this file translates it for each provider.
//   nvidia: free hosted models on build.nvidia.com (OpenAI-compatible API)
//   claude: Anthropic's Claude via the official SDK
// Content parts: { type: "text", text } | { type: "image", buffer } | { type: "pdf", buffer, name }
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

export class AIError extends Error {}

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export const NVIDIA_DEFAULTS = {
  text: "deepseek-ai/deepseek-v4.1-flash",
  vision: "meta/muse-glimmer-30b",
};
const CLAUDE_DEFAULT = "claude-opus-5-5";
const CLAUDE_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

export function provider() {
  const wanted = (process.env.AI_PROVIDER || "").toLowerCase();
  const hasNvidia = Boolean(process.env.NVIDIA_API_KEY);
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  if (wanted === "nvidia") return hasNvidia ? "nvidia" : null;
  if (wanted === "claude") return hasClaude ? "claude" : null;
  if (hasNvidia) return "nvidia";
  if (hasClaude) return "claude";
  return null;
}

export function models() {
  const p = provider();
  if (p === "nvidia") {
    return {
      text: process.env.NVIDIA_TEXT_MODEL || NVIDIA_DEFAULTS.text,
      vision: process.env.NVIDIA_VISION_MODEL || NVIDIA_DEFAULTS.vision,
    };
  }
  if (p === "claude") {
    const m = process.env.CLAUDE_MODEL || CLAUDE_DEFAULT;
    return { text: m, vision: m };
  }
  return { text: null, vision: null };
}

/**
 * Ask the model for a JSON object that matches `schema`.
 * @param {{system: string, parts: Array, schema: object, kind: "text"|"vision", validate: (o:any)=>string|null}} req
 */
export async function generateJSON(req) {
  const p = provider();
  if (p === "claude") return claudeJSON(req);
  if (p === "nvidia") return nvidiaJSON(req);
  throw new AIError("No AI provider is configured. Add NVIDIA_API_KEY or ANTHROPIC_API_KEY to .env.");
}

// ---------------------------------------------------------------- Images

async function toJpeg(buffer, maxSide, quality) {
  return sharp(buffer, { animated: false })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

// Hosted NVIDIA endpoints are happiest with small inline images, so shrink until under ~180 KB.
async function smallJpeg(buffer) {
  for (const [side, q] of [[1024, 80], [896, 70], [768, 60], [640, 55]]) {
    const out = await toJpeg(buffer, side, q);
    if (out.length <= 180_000) return out;
  }
  return toJpeg(buffer, 512, 50);
}

// ---------------------------------------------------------------- NVIDIA

function extractJSON(text) {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// The free tier is shared, so busy (429) and overloaded (5xx) answers are retried with a growing wait.
async function nvidiaChat(model, messages) {
  const waits = [3_000, 8_000, 15_000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await nvidiaChatOnce(model, messages);
    } catch (err) {
      const retryable = err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= waits.length) throw err;
      console.warn(`NVIDIA ${err.status} on ${model}; retrying in ${waits[attempt] / 1000}s`);
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

async function nvidiaChatOnce(model, messages) {
  let res;
  try {
    res = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0.2, top_p: 0.9, max_tokens: 8192, stream: false }),
      signal: AbortSignal.timeout(280_000),
    });
  } catch (err) {
    throw new AIError(`Could not reach NVIDIA (${err.name === "TimeoutError" ? "timed out" : err.message}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.detail || body?.error?.message || body?.title || JSON.stringify(body).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new AIError("The NVIDIA API key was rejected.");
    if (res.status === 404) throw new AIError(`NVIDIA model "${model}" is not available to this key. Run "npm run models" to pick another.`);
    const err = new AIError(
      res.status === 429
        ? "NVIDIA free-tier rate limit reached. Wait a minute and try again."
        : res.status >= 500
        ? `NVIDIA is busy right now (${res.status}: ${detail}). Try again in a minute.`
        : `NVIDIA ${res.status}: ${detail}`
    );
    err.status = res.status;
    throw err;
  }
  return body?.choices?.[0]?.message?.content ?? "";
}

async function nvidiaJSON({ system, parts, schema, kind, validate }) {
  const model = models()[kind];
  const instructions = `${system}

Reply with ONLY one JSON object, no prose and no code fences. It must match this JSON Schema exactly:
${JSON.stringify(schema)}`;

  const hasImages = parts.some((p) => p.type === "image");
  let content;
  if (!hasImages) {
    content = [instructions, ...parts.map((p) => (p.type === "text" ? p.text : `[PDF "${p.name}" attached but cannot be read by this model]`))].join("\n\n");
  } else {
    content = [{ type: "text", text: instructions }];
    for (const p of parts) {
      if (p.type === "text") content.push({ type: "text", text: p.text });
      else if (p.type === "image") {
        const jpeg = await smallJpeg(p.buffer);
        content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } });
      } else if (p.type === "pdf") {
        content.push({ type: "text", text: `[PDF "${p.name}" was uploaded, but this model cannot read PDFs. Treat its contents as unverified.]` });
      }
    }
  }

  // System prompt goes into the user turn: some vision models reject a system role next to images.
  const messages = [{ role: "user", content }];
  let reply = await nvidiaChat(model, messages);
  let parsed = extractJSON(reply);
  let problem = parsed ? validate(parsed) : "not valid JSON";
  if (problem) {
    messages.push({ role: "assistant", content: reply || "(empty)" });
    messages.push({ role: "user", content: `That reply was invalid (${problem}). Reply again with ONLY the JSON object that matches the schema.` });
    reply = await nvidiaChat(model, messages);
    parsed = extractJSON(reply);
    problem = parsed ? validate(parsed) : "not valid JSON";
  }
  if (problem) throw new AIError(`The model ${model} did not return a usable answer (${problem}).`);
  return parsed;
}

// ---------------------------------------------------------------- Claude

let claudeClient = null;

async function claudeJSON({ system, parts, schema, validate }) {
  claudeClient ??= new Anthropic();
  const model = models().text;
  const content = [];
  for (const p of parts) {
    if (p.type === "text") content.push({ type: "text", text: p.text });
    else if (p.type === "image") {
      const jpeg = await toJpeg(p.buffer, 1568, 85);
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } });
    } else if (p.type === "pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p.buffer.toString("base64") } });
    }
  }
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: process.env.AI_EFFORT || "medium", format: { type: "json_schema", schema } },
  };
  let response;
  try {
    response = CLAUDE_FALLBACK_MODELS.has(model)
      ? await claudeClient.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : await claudeClient.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIError("The Anthropic API key is invalid.");
    if (err instanceof Anthropic.RateLimitError) throw new AIError("Claude is rate limited. Try again in a minute.");
    if (err instanceof Anthropic.APIError) throw new AIError(`Claude request failed (${err.status}): ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") throw new AIError("The AI declined to evaluate this request.");
  if (response.stop_reason === "max_tokens") throw new AIError("The AI response was cut off. Please try again.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const parsed = extractJSON(text);
  const problem = parsed ? validate(parsed) : "not valid JSON";
  if (problem) throw new AIError(`Claude returned an unusable answer (${problem}).`);
  return parsed;
}
