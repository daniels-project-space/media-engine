import { defineConfig } from "@trigger.dev/sdk/v3";
import { ffmpeg, additionalFiles, additionalPackages, syncEnvVars } from "@trigger.dev/build/extensions/core";

// The Trigger artifact must never depend on a mutable global CLI install. Keep
// this exact package revision in sync with the non-billable auth-check task.
export const CODEX_CLI_ARTIFACT_PACKAGE = "@openai/codex@0.145.0";

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
      // `additionalPackages` puts the package's `codex` bin on the worker
      // path. The version is intentionally exact, never `latest` or a range.
      additionalPackages({ packages: [CODEX_CLI_ARTIFACT_PACKAGE] }),
      syncEnvVars(() => process.env.VAULT_ACCESS_TOKEN
        ? { VAULT_ACCESS_TOKEN: process.env.VAULT_ACCESS_TOKEN }
        : undefined),
    ],
  },
});
