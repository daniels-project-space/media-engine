import { defineConfig } from "@trigger.dev/sdk/v3";
import { ffmpeg, additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";

function triggerRuntimeEnvironment(): Record<string, string> | undefined {
  const keys = [
    "VAULT_ACCESS_TOKEN",
    "FORM_SEVEN_OUTBOX_DRAIN_URL",
    "FORM_SEVEN_OUTBOX_DRAIN_TOKEN",
    // Creator images use only the authenticated Render Engine project API.
    "RENDER_ENGINE_PROJECT_API_URL",
    // Meta dispatch accepts only existing official Professional-account
    // connections. Its access token is resolved inside the worker from the
    // server vault; neither token nor OAuth client secret is synced to Trigger.
    "META_GRAPH_API_VERSION",
    "META_ACCESS_TOKEN_RESOLVER",
    "CREATOR_META_INSTAGRAM_PUBLISH_ENABLED",
    // Separate fail-closed gate for normal-window customer replies. It does
    // not enable publishing, account creation, scheduling, or bulk messaging.
    "CREATOR_META_INSTAGRAM_REPLY_ENABLED",
    // Postiz credentials stay in the fixed server-only `postiz` Vault bucket.
    // Trigger receives only the non-secret dispatch gate/resolver declaration.
    "POSTIZ_APPROVED_DISPATCHER",
    "POSTIZ_API_KEY_RESOLVER",
    "CREATOR_POSTIZ_SCHEDULE_ENABLED",
    // Explicit non-secret production gate for the paid Fal LoRA trainer.
    // FAL_KEY remains server-only in the `fal` vault and is never synced.
    "CREATOR_LORA_TRAINING_ENABLED",
  ] as const;
  const values = Object.fromEntries(
    keys.flatMap((key) => {
      const value = process.env[key];
      return value ? [[key, value]] : [];
    }),
  );
  return Object.keys(values).length ? values : undefined;
}

export default defineConfig({
  // Hardcoded on purpose: env-fallback once deployed music-house tasks to a phantom project.
  project: "proj_snvnjoxqowcfsutewkzz",
  runtime: "node",
  logLevel: "log",
  maxDuration: 900,
  retries: {
    enabledInDev: true,
    default: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2, randomize: true },
  },
  dirs: ["./src/trigger"],
  build: {
    // Bundle the brand font so ffmpeg drawtext works in the fontless container.
    extensions: [
      ffmpeg({ version: "7" }),
      additionalFiles({ files: ["./assets/brand.ttf"] }),
      syncEnvVars(triggerRuntimeEnvironment),
    ],
  },
});
