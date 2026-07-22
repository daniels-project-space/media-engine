import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { aiEnabled } from "./ai-gate";

// All reasoning runs through a ChatGPT-authenticated Codex CLI worker. This
// module deliberately has no HTTP provider fallback and never reads the vault.
export const MODEL = "Codex CLI (ChatGPT subscription)";
export const MODELS = { plan: MODEL, fast: MODEL, vision: MODEL } as const;

export type ChatOpts = {
  system?: string;
  user: string;
  // Retained for existing call sites. Codex selects the subscription model.
  model?: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
};

const run = promisify(execFile);
const CODEX_STATUS_TIMEOUT_MS = 10_000;

/**
 * `codex login status` is intentionally the authentication authority here.
 * A zero exit only means that *some* credentials exist, while this workload
 * accepts only the ChatGPT subscription login and must reject saved API-key
 * and access-token modes.
 */
export function isChatGptLoginStatus(status: string): boolean {
  // Codex's successful subscription status is exactly this stdout line. Do
  // not match a help message, error, diagnostic, or a status that merely
  // mentions ChatGPT: all of those must leave generation paused.
  return status.trim() === "Logged in using ChatGPT";
}

/**
 * Give the specialist only its persisted ChatGPT CLI login and basic process
 * settings. In particular, it cannot inherit this application's vault access
 * token, Codex API/access token, or any OpenAI/Anthropic API-key variables.
 */
export function codexChildEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = parent.HOME ?? "/tmp";
  return {
    PATH: parent.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    TMPDIR: parent.TMPDIR ?? "/tmp",
    NODE_ENV: parent.NODE_ENV ?? "production",
    LANG: parent.LANG ?? "C.UTF-8",
    LC_ALL: parent.LC_ALL ?? "C.UTF-8",
    NO_COLOR: "1",
    // CODEX_HOME is a path, not a credential; the pinned worker image mounts
    // the subscription-authenticated CLI state there.
    CODEX_HOME: parent.CODEX_HOME ?? `${home}/.codex`,
    OPENAI_API_KEY: "",
    CODEX_API_KEY: "",
    CODEX_ACCESS_TOKEN: "",
    OPENAI_BASE_URL: "",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "",
    ANTHROPIC_BASE_URL: "",
    VAULT_ACCESS_TOKEN: "",
  };
}

async function requireChatGptLogin(cli: string): Promise<void> {
  try {
    const { stdout } = await run(cli, ["login", "status"], {
      cwd: "/tmp",
      timeout: CODEX_STATUS_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env: codexChildEnv(),
    });
    if (isChatGptLoginStatus(stdout)) return;
  } catch {
    // Do not reveal saved-profile details. All unsuccessful checks have the
    // same fail-closed result below.
  }
  throw new Error("Codex CLI requires a ChatGPT subscription login; API-key and access-token authentication are disabled");
}

export async function chat(opts: ChatOpts): Promise<string> {
  if (!(await aiEnabled())) throw new Error("AI paused — re-enable in Settings to run the orchestrator");

  const prompt = [
    "You are a Media Engine reasoning worker.",
    "Return only the requested answer. Do not run shell commands, inspect files, use tools, make network requests, or take external actions.",
    opts.maxTokens ? `Keep the answer within approximately ${opts.maxTokens} tokens.` : "",
    opts.system ? `SYSTEM:\n${opts.system}` : "",
    `USER:\n${opts.user}`,
  ].filter(Boolean).join("\n\n");

  try {
    const cli = process.env.CODEX_CLI ?? "codex";
    await requireChatGptLogin(cli);
    const { stdout } = await run(cli, [
      // This is defense in depth for the status gate above. The CLI itself
      // rejects any non-ChatGPT saved credential before it can run a prompt.
      "--config", 'forced_login_method="chatgpt"',
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--color", "never",
      prompt,
    ], {
      cwd: "/tmp",
      timeout: 170_000,
      maxBuffer: 24 * 1024 * 1024,
      env: codexChildEnv(),
    });
    const out = stdout.trim();
    if (!out) throw new Error("empty response");
    return out;
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220);
    throw new Error(`Codex CLI subscription worker unavailable: ${detail}`);
  }
}

export async function chatJson<T = Record<string, unknown>>(opts: ChatOpts): Promise<T> {
  return parseJson<T>(await chat(opts));
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
