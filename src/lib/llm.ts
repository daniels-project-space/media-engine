import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
const CODEX_AUTH_ERROR = "Codex CLI requires a ChatGPT subscription login; API-key and access-token authentication are disabled";

type CodexTokens = {
  access_token: string;
  refresh_token: string;
  id_token: string;
  account_id: string;
};

export type CodexAuthBundle = {
  auth_mode: "chatgpt";
  tokens: CodexTokens;
};

export type CodexAuthFilesystem = {
  mkdtemp(prefix: string): Promise<string>;
  chmod(filename: string, mode: number): Promise<void>;
  writeFile(filename: string, data: string, options: { encoding: "utf8"; mode: number }): Promise<void>;
  rm(filename: string, options: { recursive: true; force: true }): Promise<void>;
};

const codexAuthFilesystem: CodexAuthFilesystem = { mkdtemp, chmod, writeFile, rm };

export type CodexCommandRunner = (
  cli: string,
  args: string[],
  options: {
    cwd: string;
    timeout: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

const runCodexCommand: CodexCommandRunner = async (cli, args, options) => {
  // `execFile` rejects non-zero exits, but exposes both captured streams on
  // the error object. Return them as a receipt either way; callers accept only
  // the exact clean status line on exit 0 and never log its diagnostics.
  try {
    const { stdout, stderr } = await run(cli, args, options);
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: unknown; stderr?: unknown; code?: unknown };
    return {
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
      exitCode: typeof result.code === "number" ? result.code : 1,
    };
  }
};

/**
 * `codex login status` is intentionally the authentication authority here.
 * A zero exit only means that *some* credentials exist, while this workload
 * accepts only the ChatGPT subscription login and must reject saved API-key
 * and access-token modes.
 */
export function isChatGptLoginStatus(stdout: string, stderr = "", exitCode = 0): boolean {
  // Codex's successful subscription status is exactly one stdout line and no
  // stderr. Do not normalize it: help text, warnings, diagnostics, or a
  // status that merely mentions ChatGPT must leave generation paused.
  return exitCode === 0
    && stderr === ""
    && /^(?:Logged in using ChatGPT)(?:\r?\n)?$/.test(stdout);
}

/**
 * Give the specialist only its persisted ChatGPT CLI login and basic process
 * settings. In particular, it cannot inherit this application's vault access
 * token, Codex API/access token, or any OpenAI/Anthropic API-key variables.
 */
export function codexChildEnv(home: string, parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    PATH: parent.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: home,
    CODEX_HOME: home,
    TMPDIR: "/tmp",
    NODE_ENV: "production",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    NO_COLOR: "1",
    // The one-time bundle is consumed before this process starts. Do not pass
    // it or any host credential through to Codex.
    CODEX_AUTH_JSON_B64: "",
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Decode the single Trigger-provided credential without touching the
 * filesystem. The envelope is intentionally small and exact: accepting raw
 * auth.json (or extra credential fields) would make an API-key mode ambiguous.
 */
export function decodeChatGptAuthBundle(encoded: string | undefined): CodexAuthBundle {
  if (!encoded || encoded !== encoded.trim() || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(CODEX_AUTH_ERROR);
  }

  let parsed: unknown;
  try {
    const json = Buffer.from(encoded, "base64").toString("utf8");
    if (Buffer.from(json, "utf8").toString("base64") !== encoded) throw new Error("non-canonical base64");
    parsed = JSON.parse(json);
  } catch {
    throw new Error(CODEX_AUTH_ERROR);
  }

  if (!isPlainRecord(parsed) || Object.keys(parsed).length !== 2 || parsed.auth_mode !== "chatgpt" || !isPlainRecord(parsed.tokens)) {
    throw new Error(CODEX_AUTH_ERROR);
  }
  const tokens = parsed.tokens;
  const tokenKeys = ["access_token", "refresh_token", "id_token", "account_id"] as const;
  if (Object.keys(tokens).length !== tokenKeys.length || !tokenKeys.every((key) => typeof tokens[key] === "string" && tokens[key].trim().length > 0)) {
    throw new Error(CODEX_AUTH_ERROR);
  }

  return {
    auth_mode: "chatgpt",
    tokens: {
      access_token: tokens.access_token as string,
      refresh_token: tokens.refresh_token as string,
      id_token: tokens.id_token as string,
      account_id: tokens.account_id as string,
    },
  };
}

function codexAuthJson(bundle: CodexAuthBundle): string {
  // This is the Codex CLI file credential shape. `OPENAI_API_KEY` remains
  // explicitly null; no API-key credential can be represented in this file.
  return `${JSON.stringify({ OPENAI_API_KEY: null, tokens: bundle.tokens })}\n`;
}

const codexConfig = [
  'cli_auth_credentials_store = "file"',
  'forced_login_method = "chatgpt"',
  "",
].join("\n");

/**
 * Materialize a validated ChatGPT bundle only for one Codex invocation. The
 * validation above is deliberately complete before any directory is created.
 */
export async function withChatGptCodexHome<T>(
  encoded: string | undefined,
  action: (home: string) => Promise<T>,
  filesystem: CodexAuthFilesystem = codexAuthFilesystem,
): Promise<T> {
  const bundle = decodeChatGptAuthBundle(encoded);
  let home: string | undefined;
  try {
    home = await filesystem.mkdtemp(path.join(tmpdir(), "media-engine-codex-"));
    await filesystem.chmod(home, 0o700);
    await filesystem.writeFile(path.join(home, "auth.json"), codexAuthJson(bundle), { encoding: "utf8", mode: 0o600 });
    await filesystem.chmod(path.join(home, "auth.json"), 0o600);
    await filesystem.writeFile(path.join(home, "config.toml"), codexConfig, { encoding: "utf8", mode: 0o600 });
    await filesystem.chmod(path.join(home, "config.toml"), 0o600);
    return await action(home);
  } finally {
    if (home) await filesystem.rm(home, { recursive: true, force: true });
  }
}

/**
 * A non-generating probe for the worker image. It only reads the local Codex
 * login state and CLI version; it never sends a model prompt or API request.
 */
export async function checkChatGptCodexAuth(
  cli: string = process.env.CODEX_CLI ?? "codex",
  command: CodexCommandRunner = runCodexCommand,
  encodedAuth: string | undefined = process.env.CODEX_AUTH_JSON_B64,
): Promise<{ revision: string }> {
  return withChatGptCodexHome(encodedAuth, async (home) => {
    const env = codexChildEnv(home);
    await requireChatGptLogin(cli, env, command);
    try {
      const version = await command(cli, ["--version"], {
        cwd: "/tmp",
        timeout: CODEX_STATUS_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        env,
      });
      if (version.exitCode !== 0 || version.stderr !== "") throw new Error("invalid Codex CLI revision receipt");
      const revision = version.stdout.trim();
      if (!revision) throw new Error("empty Codex CLI revision");
      return { revision };
    } catch {
      // Do not reveal saved-profile details. All unsuccessful checks have the
      // same fail-closed result below.
    }
    throw new Error(CODEX_AUTH_ERROR);
  });
}

async function requireChatGptLogin(
  cli: string,
  env: NodeJS.ProcessEnv,
  command: CodexCommandRunner = runCodexCommand,
): Promise<void> {
  try {
    const { stdout, stderr, exitCode } = await command(cli, ["login", "status"], {
      cwd: "/tmp",
      timeout: CODEX_STATUS_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      env,
    });
    if (isChatGptLoginStatus(stdout, stderr, exitCode)) return;
  } catch {
    // Do not reveal saved-profile details. All unsuccessful checks have the
    // same fail-closed result below.
  }
  throw new Error(CODEX_AUTH_ERROR);
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
    return await withChatGptCodexHome(process.env.CODEX_AUTH_JSON_B64, async (home) => {
      const env = codexChildEnv(home);
      await requireChatGptLogin(cli, env);
      const { stdout } = await run(cli, [
      // This is defense in depth for the status gate above. The CLI itself
      // rejects any non-ChatGPT saved credential before it can run a prompt.
      "--config", 'forced_login_method="chatgpt"',
      "exec",
      "--ephemeral",
      "--ignore-rules",
      "--sandbox", "read-only",
      "--skip-git-repo-check",
      "--color", "never",
      prompt,
    ], {
      cwd: "/tmp",
      timeout: 170_000,
      maxBuffer: 24 * 1024 * 1024,
        env,
      });
      const out = stdout.trim();
      if (!out) throw new Error("empty response");
      return out;
    });
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
