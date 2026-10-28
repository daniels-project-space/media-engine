import { task, wait } from "@trigger.dev/sdk";
import { hyperProjectConnection, HyperProjectApiError, inspectHyperProject } from "../lib/marketing/hyper-project";
import { monitorHyperJob, type HyperWatchedJob } from "../lib/marketing/hyper-watch";
import { marketingCall } from "../lib/marketing/service";
import { marketingHyperImport } from "./marketing-hyper-import";

const projectIdPattern = /^[a-z0-9]{20,64}$/;
const jobIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export const marketingHyperWatch = task({
  id: "marketing-hyper-watch",
  maxDuration: 900,
  machine: "small-1x",
  retry: { maxAttempts: 4, minTimeoutInMs: 1_000, maxTimeoutInMs: 30_000, factor: 2, randomize: true },
  queue: { name: "marketing-media-watchers", concurrencyLimit: 8 },
  run: async (payload: { projectId: string; briefId: string; jobId: string; modelId: string }, { ctx }) => {
    if (!projectIdPattern.test(payload.projectId) || !jobIdPattern.test(payload.jobId) ||
        !projectIdPattern.test(payload.briefId) || !payload.modelId || payload.modelId.length > 100)
      throw new Error("Hyper watch request is invalid");

    const common = { projectId: payload.projectId, briefId: payload.briefId, jobId: payload.jobId, rightsConfirmed: true };
    const recordState = async (providerState: string, errorCode?: string) => {
      await marketingCall("trackHyperImport", { ...common, modelId: payload.modelId, providerState, ...(errorCode ? { errorCode } : {}) });
    };

    const result = await monitorHyperJob({
      observe: async () => {
        const connection = await hyperProjectConnection(payload.projectId);
        if (!connection) throw new HyperProjectApiError(401, "HYPER_CONNECTION_REQUIRED", true);
        const inspected = await inspectHyperProject(connection, payload.jobId);
        if (!inspected.job) throw new HyperProjectApiError(404, "HYPER_RESOURCE_NOT_FOUND", false);
        if (inspected.job.modelId !== payload.modelId) throw new HyperProjectApiError(409, "HYPER_MODEL_MISMATCH", false);
        return inspected.job as HyperWatchedJob;
      },
      record: async job => recordState(job.state, job.errorCode ?? undefined),
      importCompleted: async () => {
        const imported = await marketingCall<{ importId: string; attempt: number; status: string }>("requestHyperImport", common);
        if (imported.status !== "queued") return;
        await marketingHyperImport.trigger(
          { projectId: payload.projectId, importId: imported.importId, attempt: imported.attempt },
          { idempotencyKey: `hyper-import:${imported.importId}:${imported.attempt}`, idempotencyKeyTTL: "7d" },
        );
      },
      wait: async (seconds, poll) => {
        await wait.for({
          seconds,
          idempotencyKey: `${ctx.run.id}:hyper-watch:${poll}`,
          idempotencyKeyTTL: "25h",
        });
      },
      onObservationError: async error => {
        if (error instanceof HyperProjectApiError) {
          const providerState = error.code === "HYPER_CONNECTION_REQUIRED" ? "connection-required"
            : error.retryable ? "service-temporarily-unavailable" : "failed";
          await recordState(providerState, error.code);
          return { retry: error.retryable, providerState, errorCode: error.code };
        }
        await recordState("service-temporarily-unavailable", "HYPER_OBSERVATION_UNAVAILABLE");
        return { retry: true, providerState: "service-temporarily-unavailable", errorCode: "HYPER_OBSERVATION_UNAVAILABLE" };
      },
    });
    if (result.status === "observation-window-ended") await recordState("observation-window-ended");
    return result;
  },
});
