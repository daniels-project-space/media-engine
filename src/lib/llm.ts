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

/** Raw Anthropic creds (for the Mastra AI-SDK provider to reuse the same auth). */
export async function anthropicCreds(): Promise<{ base: string; token?: string; apiKey?: string }> {
  const v = await tryVault("anthropic");
  const base = (v.ANTHROPIC_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/$/, "");
  const token = v.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_AUTH_TOKEN ?? (await localSubscriptionToken());
  const apiKey = v.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  return { base, token, apiKey };
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

/** Raw text completion on Claude Sonnet — the SUBSCRIPTION only. Primary path is
 *  the Claude CLI (self-managing OAuth, and it isn't blocked when the raw API is
 *  rate-limited); falls back to the subscription OAuth API for cloud runtimes
 *  where the CLI isn't installed. No third-party providers. */
export async function chat(opts: ChatOpts): Promise<string> {
  if (!(await aiEnabled())) {
    throw new Error("AI paused — re-enable in Settings to run the orchestrator");
  }
  try {
    return await cliChat(opts);
  } catch (cliErr) {
    try {
      return await anthropicChat(opts);
    } catch (apiErr) {
      throw new Error(
        `claude subscription unavailable — cli: ${cliErr instanceof Error ? cliErr.message : cliErr}; api: ${apiErr instanceof Error ? apiErr.message : apiErr}`,
      );
    }
  }
}

// Primary: Claude subscription via the Claude CLI. Reads the prompt on stdin,
// disables MCP/project config for a lean, fast completion. The CLI self-refreshes
// the OAuth token, so nothing expires; no key management on the VPS.
async function cliChat(opts: ChatOpts): Promise<string> {
  const { execFile } = await import("node:child_process");
  const bin = process.env.CLAUDE_CLI ?? "claude";
  const prompt = (opts.system ? opts.system + "\n\n" : "") + opts.user;
  return await new Promise<string>((resolve, reject) => {
    const child = execFile(
      bin,
      ["-p", "--model", opts.model ?? MODEL, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'],
      { cwd: "/tmp", timeout: 170_000, maxBuffer: 24 * 1024 * 1024, env: process.env },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude cli: ${(stderr || err.message || "").slice(0, 200)}`));
        const out = (stdout || "").trim();
        if (!out) return reject(new Error("claude cli: empty output"));
        resolve(out);
      },
    );
    child.stdin?.end(prompt);
  });
}

// Fallback: Claude subscription via the OAuth API (for cloud runtimes without the CLI).
async function anthropicChat(opts: ChatOpts): Promise<string> {
  const { base, headers } = await resolveAuth();
  const body: Record<string, unknown> = {
    model: opts.model ?? MODEL,
    max_tokens: opts.maxTokens ?? 2400,
    thinking: { type: "disabled" }, // keep planning calls tight; no adaptive thinking spend
    messages: [{ role: "user", content: opts.user }],
  };
  if (opts.system) body.system = opts.system;

  // The subscription is shared with interactive Claude use, so 429s are expected
  // under contention. Be patient: honor retry-after, otherwise back off harder on
  // 429 (rate-limit windows are seconds–minutes) so an autonomous run self-heals.
  const attempts = Number(process.env.ME_LLM_RETRIES ?? 6);
  let lastErr = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
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
    // 429 (subscription busy) / 5xx are retryable; 4xx else is fatal.
    if (r.status !== 429 && r.status < 500) throw new Error(lastErr);
    const retryAfter = Number(r.headers.get("retry-after")) || 0;
    const backoff = r.status === 429 ? Math.min(45_000, 8_000 * (attempt + 1)) : 1_500 * (attempt + 1);
    await new Promise((res) => setTimeout(res, retryAfter ? retryAfter * 1000 : backoff));
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
