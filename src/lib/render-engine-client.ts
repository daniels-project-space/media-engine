import { vaultService } from "./vault";

const PROJECT_NAME = "media-engine";
const PROJECT_BUCKET = "media-engine";
const JOB_ID = /^[a-z0-9]{32}$/;
const TOKEN = /^[a-f0-9]{64}$/;

export type RenderEngineProjectJob = {
  jobId: string;
  status: string;
  profileId: string | null;
  lane: string;
  createdAt: number;
  completedAt: number | null;
  progress: string | null;
  output: null | {
    bucket: typeof PROJECT_BUCKET;
    key: string;
    bytes: number;
    sha256: string;
    contentType: string;
    verifiedAt: number;
  };
};

export class RenderEngineConfigurationError extends Error {}
export class RenderEngineResponseError extends Error {}

function endpoint(): URL {
  const configured = process.env.RENDER_ENGINE_PROJECT_API_URL?.trim();
  if (!configured) throw new RenderEngineConfigurationError("Render Engine project API URL is not configured");
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new RenderEngineConfigurationError("Render Engine project API URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new RenderEngineConfigurationError("Render Engine project API URL must be an HTTPS origin");
  }
  return url;
}

async function projectToken(): Promise<string> {
  const direct = process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim();
  const token = direct || (await vaultService("media-engine").catch(() => ({} as Record<string, string>))).RENDER_ENGINE_PROJECT_TOKEN;
  if (!token || !TOKEN.test(token)) throw new RenderEngineConfigurationError("Media Engine Render Engine project capability is not configured");
  return token;
}

function parseProjectJob(value: unknown, requestedId: string): RenderEngineProjectJob {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RenderEngineResponseError("Render Engine returned an invalid job");
  const job = value as Record<string, unknown>;
  if (job.jobId !== requestedId || typeof job.status !== "string" ||
      (job.profileId !== null && typeof job.profileId !== "string") ||
      typeof job.lane !== "string" || !Number.isSafeInteger(job.createdAt) ||
      (job.completedAt !== null && !Number.isSafeInteger(job.completedAt)) ||
      (job.progress !== null && typeof job.progress !== "string")) {
    throw new RenderEngineResponseError("Render Engine returned an invalid job");
  }
  if (job.output !== null) {
    const output = job.output;
    if (!output || typeof output !== "object" || Array.isArray(output)) throw new RenderEngineResponseError("Render Engine returned an invalid output receipt");
    const receipt = output as Record<string, unknown>;
    if (job.status !== "completed" || receipt.bucket !== PROJECT_BUCKET ||
        typeof receipt.key !== "string" || !receipt.key.startsWith("projects/") ||
        !receipt.key.includes(`/jobs/${requestedId}/`) ||
        !Number.isSafeInteger(receipt.bytes) || (receipt.bytes as number) < 1 ||
        typeof receipt.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
        typeof receipt.contentType !== "string" ||
        !Number.isSafeInteger(receipt.verifiedAt)) {
      throw new RenderEngineResponseError("Render Engine returned an invalid output receipt");
    }
  }
  return value as RenderEngineProjectJob;
}

/** Read-only project-scoped lookup. This never provisions or dispatches a GPU. */
export async function getRenderEngineProjectJob(jobId: string, fetcher: typeof fetch = fetch): Promise<RenderEngineProjectJob | null> {
  if (!JOB_ID.test(jobId)) throw new RangeError("Invalid Render Engine job ID");
  const url = new URL("/client/jobs", endpoint());
  url.searchParams.set("projectName", PROJECT_NAME);
  url.searchParams.set("jobId", jobId);
  const token = await projectToken();
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new RenderEngineResponseError("Render Engine job lookup failed");
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new RenderEngineResponseError(`Render Engine job lookup returned HTTP ${response.status}`);
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new RenderEngineResponseError("Render Engine returned invalid JSON"); }
  return parseProjectJob(body, jobId);
}
