import { vaultService } from "./vault";
import { aiEnabled } from "./ai-gate";

// DRY OpenRouter helper. Mirrors the call sites in plan-week / plan-ad-script /
// remix (deepseek-v4-flash for planning, gemini-2.5-flash for vision) so the new
// orchestrator reasons through the same cheap tiers and the same `aiEnabled`
// kill switch. Reasoning only — this never renders an asset.

export const MODELS = {
  plan: "deepseek/deepseek-v4-flash",
  fast: "deepseek/deepseek-v4-flash",
  vision: "google/gemini-2.5-flash",
} as const;

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

export type ChatOpts = {
  system?: string;
  user: string;
  model?: string;
  /** ask for a JSON object back and parse it */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

/** Raw text completion. Throws if AI is paused or the key is missing. */
export async function chat(opts: ChatOpts): Promise<string> {
  if (!(await aiEnabled())) {
    throw new Error("AI paused — re-enable in Settings to run the orchestrator");
  }
  const { OPENROUTER_API_KEY } = await vaultService("openrouter");
  if (!OPENROUTER_API_KEY) throw new Error("vault openrouter key missing");

  const messages: { role: string; content: string }[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body: Record<string, unknown> = {
    model: opts.model ?? MODELS.plan,
    messages,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.maxTokens ?? 2400,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const r = await fetch(OR_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${data.error?.message ?? JSON.stringify(data).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content ?? "";
}

/** JSON completion — asks for a JSON object and parses it, tolerating fences. */
export async function chatJson<T = Record<string, unknown>>(opts: ChatOpts): Promise<T> {
  const raw = await chat({ ...opts, json: true });
  return parseJson<T>(raw);
}

/** Best-effort JSON extraction from an LLM response (handles ```json fences). */
export function parseJson<T = Record<string, unknown>>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error(`LLM did not return JSON: ${raw.slice(0, 160)}`);
  }
}
