import { hyperProjectConnection, inspectHyperEnvironment, inspectHyperProject } from "./hyper-project";
import { hyperRenderReadiness } from "./hyper-render-readiness";

const requiredGpuProfile = { initial: "rtx3090", future: "rtx5090" } as const;

type Dependencies = {
  connection: typeof hyperProjectConnection;
  catalogue: typeof hyperRenderReadiness;
  environment: typeof inspectHyperEnvironment;
  project: typeof inspectHyperProject;
};
const defaults: Dependencies = { connection: hyperProjectConnection, catalogue: hyperRenderReadiness, environment: inspectHyperEnvironment, project: inspectHyperProject };

/** No write, provider submission, capacity reservation, or financial approval. */
export async function checkHyperPreflight(input: { projectId: string; environmentId?: string; brief: { modelId: string; stale: boolean } }, deps: Dependencies = defaults) {
  const [connectionResult, catalogueResult] = await Promise.allSettled([
    deps.connection(input.projectId), deps.catalogue(),
  ]);
  const connection = connectionResult.status === "fulfilled" ? connectionResult.value : null;
  const catalogue = catalogueResult.status === "fulfilled" ? catalogueResult.value : null;
  const model = catalogue?.models.find(item => item.id === input.brief.modelId) ?? null;
  const hardware = catalogue?.hardware ?? null;
  const gpuProfileVerified = hardware?.initial === requiredGpuProfile.initial && hardware.future === requiredGpuProfile.future;
  const environment = connection && input.environmentId ? await deps.environment(connection, input.environmentId, input.brief.modelId) : null;
  if (connection && !input.environmentId) await deps.project(connection);
  return { model, hardware, gpuProfileVerified, catalogueAvailable: catalogue !== null, briefStale: input.brief.stale, projectConnection: connectionResult.status === "rejected" ? "unavailable" : connection ? "verified" : "missing",
    environment, checkedAt: new Date().toISOString(), dispatchEnabled: false, monetaryCapVerified: false,
    capacityVerified: false, outputVerified: false };
}
