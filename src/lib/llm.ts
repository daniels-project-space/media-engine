import { vaultService } from "./vault";
import { aiEnabled } from "./ai-gate";

// LLM brain for the ad-agency orchestrator. Runs on Claude Sonnet via Daniel's
// Claude subscription (OAuth), not OpenRouter. Auth is resolved flexibly so the
// same code works on the VPS (reads the local Claude Code creds) and in the
// cloud (reads a token synced into the vault):
//   1. vault  anthropic.ANTHROPIC_AUTH_TOKEN   (subscription OAuth — cloud)
//   2. env    ANTHROPIC_AUTH_TOKEN
//   3. /root/.claude/.credentials.json          (subscription OAuth — VPS)
//   4. vault/env ANTHROPIC_API_KEY              (console key fallback — x-api-key)
// Base URL: vault/env ANTHROPIC_BASE_URL (e.g. the 127.0.0.1:5588 passthrough on
// the VPS) else api.anthropic.com. Reasoning only — never renders an asset.

// "sonnet" per Daniel. Swap to "claude-sonnet-4-6" here (or set ME_LLM_MODEL) to
// match the automation's usual tier.
export const MODEL = process.env.ME_LLM_MODEL ?? "claude-sonnet-5";
export const MODELS = { plan: MODEL, fast: MODEL, vision: MODEL } as const;

const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA = "oauth-2025-04-20";

export type ChatOpts = {
  system?: string;
  user: string;
  model?: string;
  json?: boolean;
  /** accepted for call-site compatibility but NOT sent — Sonnet 5 rejects it */
  temperature?: number;
  maxTokens?: number;
};

async function tryVault(service: string): Promise<Record<string, string>> {
  try {
    return await vaultService(service);
  } catch {
    return {};
  }
}

/** Read the Claude Code subscription OAuth token from the local creds file (VPS only). */
async function localSubscriptionToken(): Promise<string | undefined> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile("/root/.claude/.credentials.json", "utf8");
    const d = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const o = d.claudeAiOauth;
    if (!o?.accessToken) return undefined;
    if (o.expiresAt && Date.now() > o.expiresAt - 60_000) return undefined; // stale — let vault/env win
    return o.accessToken;
  } catch {
    return undefined;
  }
}

type Auth = { base: string; headers: Record<string, string> };

async function resolveAuth(): Promise<Auth> {
  const v = await tryVault("anthropic");
  const base = (v.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
  };
  const oauth = v.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN ?? (await localSubscriptionToken());
  if (oauth) {
    headers["authorization"] = `Bearer ${oauth}`;
    headers["anthropic-beta"] = OAUTH_BETA;
    return { base, headers };
  }
  const apiKey = v.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    headers["x-api-key"] = apiKey;
    return { base, headers };
  }
  throw new Error("no Anthropic credential (subscription token or API key) available");
}

/** Raw text completion on Sonnet. Retries 429/5xx (subscription can be busy). */
export async function chat(opts: ChatOpts): Promise<string> {
  if (!(await aiEnabled())) {
    throw new Error("AI paused — re-enable in Settings to run the orchestrator");
  }
  const { base, headers } = await resolveAuth();
  const body: Record<string, unknown> = {
    model: opts.model ?? MODEL,
    max_tokens: opts.maxTokens ?? 2400,
    thinking: { type: "disabled" }, // keep planning calls tight; no adaptive thinking spend
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.system) body.system = opts.system;

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${base}/v1/messages`, { method: "POST", headers, body: JSON.stringify(body) });
    if (r.ok) {
      const data = (await r.json()) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
      };
      if (data.stop_reason === "refusal") throw new Error("Claude refused this request");
      return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    }
    const errText = await r.text();
    lastErr = `anthropic ${r.status}: ${errText.slice(0, 200)}`;
    // 429 (subscription busy) / 5xx are retryable; back off. 4xx else is fatal.
    if (r.status !== 429 && r.status < 500) throw new Error(lastErr);
    const retryAfter = Number(r.headers.get("retry-after")) || 0;
    await new Promise((res) => setTimeout(res, retryAfter ? retryAfter * 1000 : 1500 * (attempt + 1)));
  }
  throw new Error(lastErr || "anthropic: exhausted retries");
}

export async function chatJson<T = Record<string, unknown>>(opts: ChatOpts): Promise<T> {
  const raw = await chat(opts);
  return parseJson<T>(raw);
}

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
