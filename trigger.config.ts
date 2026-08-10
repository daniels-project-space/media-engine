import { defineConfig } from "@trigger.dev/sdk/v3";
import { ffmpeg, additionalFiles, syncEnvVars } from "@trigger.dev/build/extensions/core";

function triggerRuntimeEnvironment(): Record<string, string> | undefined {
  const keys = [
    "VAULT_ACCESS_TOKEN",
    "FORM_SEVEN_OUTBOX_DRAIN_URL",
    "FORM_SEVEN_OUTBOX_DRAIN_TOKEN",
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
