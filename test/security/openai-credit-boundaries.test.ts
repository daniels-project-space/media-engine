import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { checkChatGptCodexAuth, codexChildEnv, type CodexCommandRunner } from "../../src/lib/llm";
import { vaultServiceName } from "../../src/lib/vault";
import { abortGeneratedCarousel } from "../../src/trigger/generate-carousel";
import { runScheduleTick } from "../../src/trigger/schedule-tick";
import { runCodexAuthCheck } from "../../src/trigger/codex-auth-check";
import { POST as triggerPost } from "../../src/app/api/trigger/route";
import triggerConfig, { CODEX_CLI_ARTIFACT_PACKAGE } from "../../trigger.config";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const dns = require("node:dns") as typeof import("node:dns");

async function denyNetwork<T>(action: () => Promise<T>): Promise<{ value: T; fetches: string[]; dnsLookups: string[] }> {
  const fetches: string[] = [];
  const dnsLookups: string[] = [];
  const originalFetch = globalThis.fetch;
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    throw new Error(`unexpected fetch: ${String(input)}`);
  }) as typeof fetch;
  dns.lookup = ((hostname: string) => {
    dnsLookups.push(hostname);
    throw new Error(`unexpected DNS lookup: ${hostname}`);
  }) as unknown as typeof dns.lookup;
  dns.promises.lookup = (async (hostname: string) => {
    dnsLookups.push(hostname);
    throw new Error(`unexpected DNS lookup: ${hostname}`);
  }) as typeof dns.promises.lookup;

  try {
    return { value: await action(), fetches, dnsLookups };
  } finally {
    globalThis.fetch = originalFetch;
    dns.lookup = originalLookup;
    dns.promises.lookup = originalPromiseLookup;
  }
}

async function allSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const children = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) return allSourceFiles(filename);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [filename] : [];
  }));
  return children.flat();
}

test("SDK and runtime source contain no OpenAI client, host, or model path", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const forbidden of ["openai", "@ai-sdk/openai", "@ai-sdk/anthropic", "@mastra/core"]) {
    assert.equal(dependencies[forbidden], undefined, `${forbidden} must not be installed`);
  }

  const source = await Promise.all((await allSourceFiles(path.join(root, "src"))).map((file) => readFile(file, "utf8")));
  const runtime = source.join("\n");
  assert.doesNotMatch(runtime, /https:\/\/(?:api\.)?openai\.com/i);
  assert.doesNotMatch(runtime, /from\s+["'](?:openai|@ai-sdk\/openai|@ai-sdk\/anthropic|@mastra\/core)["']/i);
});

test("vault rejects OpenAI before DNS or fetch", async () => {
  const probe = await denyNetwork(async () => {
    assert.throws(() => vaultServiceName("openai"), /not permitted/);
    assert.throws(() => vaultServiceName("anthropic"), /not permitted/);
    return "rejected";
  });
  assert.equal(probe.value, "rejected");
  assert.deepEqual(probe.fetches, []);
  assert.deepEqual(probe.dnsLookups, []);
});

test("Codex child environment removes every API, vault, and access token", () => {
  const child = codexChildEnv({
    HOME: "/worker",
    OPENAI_API_KEY: "must-not-inherit",
    OPENAI_BASE_URL: "https://api.openai.com",
    CODEX_API_KEY: "must-not-inherit",
    CODEX_ACCESS_TOKEN: "must-not-inherit",
    ANTHROPIC_API_KEY: "must-not-inherit",
    ANTHROPIC_AUTH_TOKEN: "must-not-inherit",
    ANTHROPIC_BASE_URL: "https://example.invalid",
    VAULT_ACCESS_TOKEN: "must-not-inherit",
  } as unknown as NodeJS.ProcessEnv);
  for (const key of [
    "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN",
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "VAULT_ACCESS_TOKEN",
  ]) {
    assert.equal(child[key], "", `${key} must be blanked`);
  }
  assert.equal(child.HOME, "/worker");
});

test("paused image task and scheduler fail before any network or dispatch", async () => {
  const carousel = await denyNetwork(async () => {
    await assert.rejects(abortGeneratedCarousel(), /Image generation is paused/);
    return "paused";
  });
  assert.equal(carousel.value, "paused");
  assert.deepEqual(carousel.fetches, []);
  assert.deepEqual(carousel.dnsLookups, []);

  const scheduler = await denyNetwork(async () => {
    await assert.rejects(runScheduleTick(async () => false), /AI generation is paused/);
    return "paused";
  });
  assert.equal(scheduler.value, "paused");
  assert.deepEqual(scheduler.fetches, []);
  assert.deepEqual(scheduler.dnsLookups, []);

  const scheduleSource = await readFile(path.join(root, "src/trigger/schedule-tick.ts"), "utf8");
  assert.doesNotMatch(scheduleSource, /\bcron\s*:/);
});

test("direct image route returns 503 before vault or Trigger dispatch", async () => {
  const probe = await denyNetwork(async () => {
    const response = await triggerPost(new Request("https://media-engine.invalid/api/trigger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "generate", postId: "ignored" }),
    }) as never);
    return { status: response.status, body: await response.json() as { error?: string } };
  });
  assert.equal(probe.value.status, 503);
  assert.match(probe.value.body.error ?? "", /Image generation is paused/);
  assert.deepEqual(probe.fetches, []);
  assert.deepEqual(probe.dnsLookups, []);
});

test("non-billable Codex auth probe accepts ChatGPT only and records its exact revision", async () => {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const command: CodexCommandRunner = async (_cli, args, options) => {
    calls.push({ args, env: options.env });
    if (args.join(" ") === "login status") return { stdout: "Logged in using ChatGPT\n" };
    if (args.join(" ") === "--version") return { stdout: "codex-cli 0.145.0\n" };
    throw new Error(`unexpected command ${args.join(" ")}`);
  };

  const probe = await denyNetwork(() => runCodexAuthCheck(() => checkChatGptCodexAuth("codex", command)));
  assert.deepEqual(probe.value, { login: "chatgpt", revision: "codex-cli 0.145.0" });
  assert.deepEqual(calls.map((call) => call.args), [["login", "status"], ["--version"]]);
  assert.ok(calls.every((call) => call.env.OPENAI_API_KEY === "" && call.env.CODEX_ACCESS_TOKEN === "" && call.env.VAULT_ACCESS_TOKEN === ""));
  assert.deepEqual(probe.fetches, []);
  assert.deepEqual(probe.dnsLookups, []);

  const apiKeyOnly: CodexCommandRunner = async () => ({ stdout: "Logged in using an API key\n" });
  await assert.rejects(checkChatGptCodexAuth("codex", apiKeyOnly), /requires a ChatGPT subscription login/);

  assert.equal(CODEX_CLI_ARTIFACT_PACKAGE, "@openai/codex@0.145.0");
  const extension = triggerConfig.build?.extensions?.find((candidate) => candidate.name === "additionalPackages");
  assert.ok(extension?.onBuildStart, "Codex must be installed in the deployment artifact");
  const layers: Array<{ dependencies?: Record<string, string> }> = [];
  await extension.onBuildStart({
    target: "deploy",
    addLayer: (layer: { id: string; dependencies?: Record<string, string> }) => layers.push(layer),
  } as never);
  assert.deepEqual(layers, [{ dependencies: { "@openai/codex": "0.145.0" }, id: "additionalPackages" }]);
});
