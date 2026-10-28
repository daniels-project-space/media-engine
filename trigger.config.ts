import { defineConfig } from "@trigger.dev/sdk/v3";
import { ffmpeg, additionalFiles, additionalPackages, syncEnvVars } from "@trigger.dev/build/extensions/core";

function triggerRuntimeEnvironment(): Record<string, string> | undefined {
  const keys = [
    "VAULT_ACCESS_TOKEN",
    "FORM_SEVEN_OUTBOX_DRAIN_URL",
    "FORM_SEVEN_OUTBOX_DRAIN_TOKEN",
    // These flags are permissions, not proof of live qualification. All are
    // absent/disabled by default; account IDs are an explicit dispatch allowlist.
    "MARKETING_AUTOMATION_ENABLED",
    "MARKETING_ZERNIO_QUALIFIED",
    "MARKETING_PUBLISH_ENABLED",
    "MARKETING_ADS_ENABLED",
    "MARKETING_METRICS_ENABLED",
    "MARKETING_AUTHORISED_ACCOUNT_IDS",
    "MARKETING_PRICING_VERIFIED_AT",
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
      // The reasoning worker shells out to this CLI. Pin the version already
      // used by the owner; do not silently switch providers or model quality.
      additionalPackages({ packages: ["@openai/codex@0.163.0"] }),
      additionalFiles({ files: ["./assets/brand.ttf"] }),
      syncEnvVars(triggerRuntimeEnvironment),
    ],
  },
});
