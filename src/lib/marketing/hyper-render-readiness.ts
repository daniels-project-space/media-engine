import { z } from "zod";

// This is the public catalogue of the newer Hyper service, not the legacy
// Render Engine project API. It contains no project credentials or job data.
const CATALOGUE_URL = "https://hyper-render-service.vercel.app/api/engine/models";

const catalogue = z.object({
  hardware: z.object({ initial: z.string(), future: z.string() }),
  models: z.array(z.object({
    id: z.string().min(1).max(100),
    nativeQualified: z.boolean(),
    qualifiedGpuTypes: z.array(z.string()).max(10),
    readiness: z.string().max(100),
  })).max(100),
});

export async function hyperRenderReadiness(fetcher: typeof fetch = fetch) {
  const response = await fetcher(CATALOGUE_URL, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Render catalogue unavailable");
  const body = await response.text();
  if (body.length > 500_000) throw new Error("Render catalogue too large");
  const parsed = catalogue.parse(JSON.parse(body));
  return {
    ...parsed,
    checkedAt: new Date().toISOString(),
    // A catalogue qualification does not prove project access, available
    // capacity, authorization to spend, or a working R2 delivery path.
    projectConnectionVerified: false,
    dispatchEnabled: false,
  };
}
