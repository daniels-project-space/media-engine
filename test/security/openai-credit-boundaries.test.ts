import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { checkChatGptCodexAuth, codexChildEnv, decodeChatGptAuthBundle, withChatGptCodexHome, type CodexCommandRunner } from "../../src/lib/llm";
import { MEDIA_ENGINE_CONVEX_URL } from "../../src/lib/ai-gate";
import { VAULT_SERVICES, vaultServiceName } from "../../src/lib/vault";
import { requireAuthenticatedAiEnable } from "../../convex/settings-access";
import { abortGeneratedCarousel } from "../../src/trigger/generate-carousel";
import { runScheduleTick } from "../../src/trigger/schedule-tick";
import { runCampaignTick } from "../../src/trigger/campaign-tick";
import { runCodexAuthCheck } from "../../src/trigger/codex-auth-check";
import { runPublishPost } from "../../src/trigger/publish-post";
import { POST as triggerPost } from "../../src/app/api/trigger/route";
import { POST as studioPost } from "../../src/app/api/studio/route";
import { POST as campaignPost } from "../../src/app/api/campaign/route";
import { POST as tickPost } from "../../src/app/api/tick/route";
import { POST as repurposePost } from "../../src/app/api/repurpose/route";
import { POST as clientPost } from "../../src/app/api/client/route";
import { POST as crossmarketPost } from "../../src/app/api/crossmarket/route";
import triggerConfig, { CODEX_CLI_ARTIFACT_PACKAGE } from "../../trigger.config";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const dns = require("node:dns") as typeof import("node:dns");
const chatGptBundle = Buffer.from(JSON.stringify({
  auth_mode: "chatgpt",
  tokens: {
    access_token: "access-token",
    refresh_token: "refresh-token",
    id_token: "id-token",
    account_id: "account-id",
  },
}), "utf8").toString("base64");

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

async function withBillingDisabled<T>(action: () => Promise<T>): Promise<T> {
  const previous = process.env.MEDIA_ENGINE_BILLING_DISABLED;
  process.env.MEDIA_ENGINE_BILLING_DISABLED = "1";
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env.MEDIA_ENGINE_BILLING_DISABLED;
    else process.env.MEDIA_ENGINE_BILLING_DISABLED = previous;
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

  const executableFiles = [
    ...(await allSourceFiles(path.join(root, "src"))),
    ...(await allSourceFiles(path.join(root, "convex"))),
    path.join(root, "next.config.ts"),
    path.join(root, "trigger.config.ts"),
  ];
  const source = await Promise.all(executableFiles.map((file) => readFile(file, "utf8")));
  const runtime = source.join("\n");
  assert.doesNotMatch(runtime, /https:\/\/(?:api\.)?openai\.com/i);
  assert.doesNotMatch(runtime, /from\s+["'](?:openai|@ai-sdk\/openai|@ai-sdk\/anthropic|@mastra\/core)["']/i);
});

test("runtime has no legacy Supabase client, function, environment, or project alias", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  for (const forbidden of ["supabase", "@supabase/supabase-js", "@supabase/ssr"]) {
    assert.equal(dependencies[forbidden], undefined, `${forbidden} must not be installed`);
  }

  // Keep this limited to executable TypeScript. The audit documentation may
  // name Supabase while recording the controller-side retirement receipt.
  const executableFiles = [
    ...(await allSourceFiles(path.join(root, "src"))),
    ...(await allSourceFiles(path.join(root, "convex"))),
    path.join(root, "next.config.ts"),
    path.join(root, "trigger.config.ts"),
  ];
  const source = await Promise.all(executableFiles.map((file) => readFile(file, "utf8")));
  const runtime = source.join("\n");
  assert.doesNotMatch(
    runtime,
    /(?:@supabase\/|\bsupabase(?:\.co|\.com)?\b|SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE(?:_KEY)?|ACCESS_TOKEN)|\/functions\/v1\/)/i,
  );
});

test("vault rejects OpenAI before DNS or fetch", async () => {
  const probe = await denyNetwork(async () => {
    assert.ok(VAULT_SERVICES.every((service) => !/(?:openai|open-ai|oa[i1])/.test(service)), "no OpenAI service alias may be allowlisted");
    assert.throws(() => vaultServiceName("openai"), /not permitted/);
    assert.throws(() => vaultServiceName("open-ai"), /not permitted/);
    assert.throws(() => vaultServiceName("openai-platform"), /not permitted/);
    assert.throws(() => vaultServiceName("anthropic"), /not permitted/);
    return "rejected";
  });
  assert.equal(probe.value, "rejected");
  assert.deepEqual(probe.fetches, []);
  assert.deepEqual(probe.dnsLookups, []);
});

test("unauthenticated callers cannot enable the AI kill switch", () => {
  assert.throws(
    () => requireAuthenticatedAiEnable("aiEnabled", true, false),
    /Authentication is required to enable AI generation/,
  );
  assert.doesNotThrow(() => requireAuthenticatedAiEnable("aiEnabled", false, false));
  assert.doesNotThrow(() => requireAuthenticatedAiEnable("aiEnabled", true, true));
});

test("the public settings mutation applies the kill-switch identity check", async () => {
  const settingsSource = await readFile(path.join(root, "convex/settings.ts"), "utf8");
  assert.match(
    settingsSource,
    /requireAuthenticatedAiEnable\(key, value, \(await ctx\.auth\.getUserIdentity\(\)\) !== null\)/,
  );
});

test("the kill switch always reads Media Engine's Convex deployment", async () => {
  assert.equal(MEDIA_ENGINE_CONVEX_URL, "https://blissful-sardine-231.convex.cloud");
  const gateSource = await readFile(path.join(root, "src/lib/ai-gate.ts"), "utf8");
  assert.doesNotMatch(gateSource, /NEXT_PUBLIC_CONVEX_URL/);
});

test("Codex child environment removes every API, vault, and access token", () => {
  const child = codexChildEnv("/ephemeral-codex", {
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
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "VAULT_ACCESS_TOKEN", "CODEX_AUTH_JSON_B64",
  ]) {
    assert.equal(child[key], "", `${key} must be blanked`);
  }
  assert.equal(child.HOME, "/ephemeral-codex");
  assert.equal(child.CODEX_HOME, "/ephemeral-codex");
  assert.deepEqual(Object.keys(child).sort(), [
    "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "CODEX_AUTH_JSON_B64", "CODEX_HOME",
    "HOME", "LANG", "LC_ALL", "NODE_ENV", "NO_COLOR", "OPENAI_API_KEY", "OPENAI_BASE_URL", "PATH", "TMPDIR", "VAULT_ACCESS_TOKEN",
  ].sort());
});

test("Codex auth bundle is ChatGPT-only, uses locked ephemeral files, and cleans up", async () => {
  let home = "";
  const observed = await withChatGptCodexHome(chatGptBundle, async (candidate) => {
    home = candidate;
    const [directory, auth, config] = await Promise.all([
      stat(candidate),
      stat(path.join(candidate, "auth.json")),
      stat(path.join(candidate, "config.toml")),
    ]);
    const authJson = JSON.parse(await readFile(path.join(candidate, "auth.json"), "utf8")) as Record<string, unknown>;
    return {
      directoryMode: directory.mode & 0o777,
      authMode: auth.mode & 0o777,
      configMode: config.mode & 0o777,
      authJson,
      config: await readFile(path.join(candidate, "config.toml"), "utf8"),
    };
  });
  assert.equal(observed.directoryMode, 0o700);
  assert.equal(observed.authMode, 0o600);
  assert.equal(observed.configMode, 0o600);
  assert.deepEqual(observed.authJson, {
    OPENAI_API_KEY: null,
    tokens: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      account_id: "account-id",
    },
  });
  assert.match(observed.config, /forced_login_method = "chatgpt"/);
  await assert.rejects(access(home));
});

test("Codex auth rejects API-key, access-token, and ambiguous bundles before filesystem access", async () => {
  const invalid = [
    undefined,
    Buffer.from(JSON.stringify({ auth_mode: "api_key", tokens: {} }), "utf8").toString("base64"),
    Buffer.from(JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: "sk-unsafe", tokens: {} }), "utf8").toString("base64"),
    Buffer.from(JSON.stringify({ auth_mode: "chatgpt", CODEX_API_KEY: "unsafe", tokens: {} }), "utf8").toString("base64"),
    Buffer.from(JSON.stringify({ auth_mode: "chatgpt", CODEX_ACCESS_TOKEN: "unsafe", tokens: {} }), "utf8").toString("base64"),
    Buffer.from(JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: "a", refresh_token: "r", id_token: "i" } }), "utf8").toString("base64"),
  ];
  for (const encoded of invalid) {
    let filesystemTouched = false;
    await assert.rejects(withChatGptCodexHome(encoded, async () => "unreachable", {
      mkdtemp: async () => { filesystemTouched = true; return "/unreachable"; },
      chmod: async () => { filesystemTouched = true; },
      writeFile: async () => { filesystemTouched = true; },
      rm: async () => { filesystemTouched = true; },
    }), /requires a ChatGPT subscription login/);
    assert.equal(filesystemTouched, false);
  }
  assert.deepEqual(decodeChatGptAuthBundle(chatGptBundle).auth_mode, "chatgpt");
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

  const campaignScheduler = await denyNetwork(async () => {
    await assert.rejects(
      runCampaignTick(async () => false, async () => ({ processed: 0, log: [] })),
      /AI generation is paused/,
    );
    return "paused";
  });
  assert.equal(campaignScheduler.value, "paused");
  assert.deepEqual(campaignScheduler.fetches, []);
  assert.deepEqual(campaignScheduler.dnsLookups, []);

  const publisher = await denyNetwork(async () => {
    await assert.rejects(runPublishPost({ postId: "ignored" }, async () => false), /AI generation is paused/);
    return "paused";
  });
  assert.equal(publisher.value, "paused");
  assert.deepEqual(publisher.fetches, []);
  assert.deepEqual(publisher.dnsLookups, []);
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

test("disabled billed routes fail before Convex, vault, Trigger, or providers", async () => {
  const probe = await denyNetwork(() => withBillingDisabled(async () => {
    const responses = await Promise.all([
      triggerPost(new Request("https://media-engine.invalid/api/trigger", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "short", imageUrl: "https://example.invalid/source.png", streamSlug: "test", title: "test" }),
      }) as never),
      triggerPost(new Request("https://media-engine.invalid/api/trigger", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "publish", postId: "ignored" }),
      }) as never),
      studioPost(new Request("https://media-engine.invalid/api/studio", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "plan", projectId: "ignored" }),
      }) as never),
      campaignPost(new Request("https://media-engine.invalid/api/campaign", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: "a valid campaign brief" }),
      }) as never),
      tickPost(),
      repurposePost(new Request("https://media-engine.invalid/api/repurpose", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetId: "ignored", platform: "instagram", mode: "reframe" }),
      }) as never),
      clientPost(new Request("https://media-engine.invalid/api/client", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test client", brief: "A product brief" }),
      }) as never),
      crossmarketPost(),
    ]);
    return Promise.all(responses.map(async (response) => ({ status: response.status, body: await response.json() as { error?: string } })));
  }));
  assert.equal(probe.value.length, 8);
  for (const response of probe.value) {
    assert.equal(response.status, 503);
    assert.match(response.body.error ?? "", /AI generation is paused/);
  }
  assert.deepEqual(probe.fetches, []);
  assert.deepEqual(probe.dnsLookups, []);
});

test("non-billable Codex auth probe accepts ChatGPT only and records its exact revision", async () => {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const command: CodexCommandRunner = async (_cli, args, options) => {
    calls.push({ args, env: options.env });
    if (args.join(" ") === "login status") {
      return {
        stdout: "",
        stderr: [
          "warning: config key renamed",
          "warning: use codex config migrate",
          "warning: profile cache is deprecated",
          "warning: diagnostic 4",
          "warning: diagnostic 5",
          "warning: diagnostic 6",
          "Logged in using ChatGPT",
        ].join("\n"),
        exitCode: 0,
      };
    }
    if (args.join(" ") === "--version") {
      return {
        stdout: "codex-cli 0.145.0\n",
        stderr: [
          "warning: config key renamed",
          "warning: use codex config migrate",
          "warning: profile cache is deprecated",
          "warning: diagnostic 4",
          "warning: diagnostic 5",
          "warning: diagnostic 6",
        ].join("\n"),
        exitCode: 0,
      };
    }
    throw new Error(`unexpected command ${args.join(" ")}`);
  };

  const probe = await denyNetwork(() => runCodexAuthCheck(() => checkChatGptCodexAuth("codex", command, chatGptBundle)));
  assert.deepEqual(probe.value, { login: "chatgpt", revision: "codex-cli 0.145.0" });
  assert.deepEqual(calls.map((call) => call.args), [["login", "status"], ["--version"]]);
  assert.ok(calls.every((call) => call.env.OPENAI_API_KEY === "" && call.env.CODEX_ACCESS_TOKEN === "" && call.env.VAULT_ACCESS_TOKEN === ""));
  assert.deepEqual(probe.fetches, []);
  assert.deepEqual(probe.dnsLookups, []);

  const invalidStatusReceipts: CodexCommandRunner[] = [
    async () => ({ stdout: "Logged in using an API key\n", stderr: "", exitCode: 0 }),
    async () => ({ stdout: "", stderr: "warning: legacy config\n", exitCode: 0 }),
    async () => ({ stdout: "Logged in using ChatGPT\n", stderr: "Logged in using ChatGPT\n", exitCode: 0 }),
    async () => ({ stdout: "Logged in using ChatGPT\n", stderr: "Not logged in\n", exitCode: 0 }),
    async () => ({ stdout: "Logged in using ChatGPT\n", stderr: "Logged in using an access token\n", exitCode: 0 }),
    async () => ({ stdout: "Usage: codex login status\n", stderr: "", exitCode: 0 }),
    async () => ({ stdout: "Logged in using ChatGPT\n", stderr: "", exitCode: 1 }),
    async () => ({ stdout: " Logged in using ChatGPT\n", stderr: "", exitCode: 0 }),
    async () => ({ stdout: "warning: Logged in using ChatGPT\n", stderr: "", exitCode: 0 }),
  ];
  for (const commandWithBadReceipt of invalidStatusReceipts) {
    await assert.rejects(checkChatGptCodexAuth("codex", commandWithBadReceipt, chatGptBundle), /requires a ChatGPT subscription login/);
  }

  const invalidVersionReceipts: CodexCommandRunner[] = [
    async (_cli, args) => args.join(" ") === "login status"
      ? { stdout: "Logged in using ChatGPT\n", stderr: "", exitCode: 0 }
      : { stdout: "codex-cli 0.145.1\n", stderr: "", exitCode: 0 },
    async (_cli, args) => args.join(" ") === "login status"
      ? { stdout: "Logged in using ChatGPT\n", stderr: "", exitCode: 0 }
      : { stdout: "codex-cli 0.145.0\n", stderr: "codex-cli 0.145.0\n", exitCode: 0 },
    async (_cli, args) => args.join(" ") === "login status"
      ? { stdout: "Logged in using ChatGPT\n", stderr: "", exitCode: 0 }
      : { stdout: "warning: codex-cli 0.145.0\n", stderr: "", exitCode: 0 },
    async (_cli, args) => args.join(" ") === "login status"
      ? { stdout: "Logged in using ChatGPT\n", stderr: "", exitCode: 0 }
      : { stdout: "codex-cli 0.145.0\n", stderr: "", exitCode: 1 },
  ];
  for (const commandWithBadReceipt of invalidVersionReceipts) {
    await assert.rejects(checkChatGptCodexAuth("codex", commandWithBadReceipt, chatGptBundle), /requires a ChatGPT subscription login/);
  }

  assert.equal(CODEX_CLI_ARTIFACT_PACKAGE, "@openai/codex@0.145.0");
  const extension = triggerConfig.build?.extensions?.find((candidate) => candidate.name === "additionalPackages");
  assert.ok(extension?.onBuildStart, "Codex must be installed in the deployment artifact");
  const layers: Array<{ dependencies?: Record<string, string> }> = [];
  await extension.onBuildStart({
    target: "deploy",
    addLayer: (layer: { id: string; dependencies?: Record<string, string> }) => layers.push(layer),
  } as never);
  assert.deepEqual(layers, [{ dependencies: { "@openai/codex": "0.145.0" }, id: "additionalPackages" }]);
  const synced = triggerConfig.build?.extensions?.find((candidate) => candidate.name === "SyncEnvVarsExtension");
  assert.ok(synced?.onBuildComplete, "Trigger must sync only the sealed Codex auth bundle");
  const previousBundle = process.env.CODEX_AUTH_JSON_B64;
  process.env.CODEX_AUTH_JSON_B64 = "sealed-chatgpt-bundle";
  const syncLayers: Array<{ deploy?: { env?: Record<string, string> }; id?: string }> = [];
  try {
    await synced.onBuildComplete?.({
      target: "deploy",
      config: { project: "proj_snvnjoxqowcfsutewkzz" },
      logger: { spinner: () => ({ stop: () => undefined }) },
      addLayer: (layer: { deploy?: { env?: Record<string, string> }; id?: string }) => syncLayers.push(layer),
    } as never, { deploy: { env: {} } } as never);
  } finally {
    if (previousBundle === undefined) delete process.env.CODEX_AUTH_JSON_B64;
    else process.env.CODEX_AUTH_JSON_B64 = previousBundle;
  }
  assert.deepEqual(syncLayers, [{
    id: "sync-env-vars",
    deploy: { env: { CODEX_AUTH_JSON_B64: "sealed-chatgpt-bundle" }, override: true, parentEnv: undefined },
  }]);
});
