import { defineConfig } from "@trigger.dev/sdk/v3";

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
});
