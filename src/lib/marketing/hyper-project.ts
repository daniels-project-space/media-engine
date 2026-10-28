import { z } from "zod";
import { vaultService } from "../vault";

const API = "https://hyper-render-service.vercel.app/api/engine";
const uuid = z.string().uuid();
const connectionSchema = z.object({ projectId: uuid, token: z.string().min(16).max(512),
  bucket: z.literal("media-engine"), prefix: z.string().min(1).max(300)
    .refine(value => !value.startsWith("/") && value.endsWith("/") && !value.includes("..")) }).strict();
const guideSchema = z.object({ project: z.object({ id: uuid, output: z.object({ bucket: z.string(), prefix: z.string() }) }) });
const environmentSchema = z.object({ id: uuid, modelId: z.string().min(1).max(100), prepared: z.boolean() });
const jobSchema = z.object({ id: uuid, projectId: uuid, modelId: z.string().min(1).max(100), state: z.string().min(1).max(40),
  generation: z.number().int().nonnegative(), errorCode: z.string().max(100).nullable().optional(),
  output: z.object({ projectId: uuid, jobId: uuid, generation: z.number().int().nonnegative(),
    bucket: z.string(), key: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(), contentType: z.string(), available: z.boolean() }).nullable().optional() });
const submissionSchema = z.object({
  environmentId: uuid,
  idempotencyKey: z.string().min(1).max(160),
  request: z.object({
    inputs: z.record(z.unknown()),
    settings: z.record(z.unknown()),
    inputRefs: z.array(z.object({ assetId: uuid, name: z.string().min(1).max(100), kind: z.literal("input") }).strict()).max(64),
    outputKind: z.literal("final"),
    finalRetention: z.literal("project-default"),
  }).strict(),
}).strict();
type Connection = z.infer<typeof connectionSchema>;

export class HyperJobSubmissionError extends Error {
  constructor(message: string, readonly outcomeUncertain: boolean) {
    super(message);
    this.name = "HyperJobSubmissionError";
  }
}

export class HyperProjectApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable: boolean) {
    super("New rendering service project request failed");
    this.name = "HyperProjectApiError";
  }
}

export function completedBriefRender(job: { modelId: string; state: string; receipt: { available: boolean } | null } | null, modelId: string) {
  if (!job || job.modelId !== modelId) throw new Error("The render job must use the model selected for this creative brief");
  if (job.state !== "completed" || !job.receipt?.available) throw new Error("Wait for this matching render to finish before importing it");
  return job;
}

async function apiGet(path: string, token: string, fetcher: typeof fetch) {
  const response = await fetcher(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    const code = status === 401 || status === 403 ? "HYPER_CONNECTION_REQUIRED"
      : status === 404 ? "HYPER_RESOURCE_NOT_FOUND"
        : status === 429 ? "HYPER_RATE_LIMITED"
          : status >= 500 ? "HYPER_SERVICE_UNAVAILABLE" : "HYPER_REQUEST_REJECTED";
    throw new HyperProjectApiError(status, code, status === 401 || status === 403 || status === 429 || status >= 500);
  }
  const body = await response.text();
  if (body.length > 250_000) throw new Error("Rendering service response exceeds limit");
  return JSON.parse(body) as unknown;
}

export async function hyperProjectConnection(marketingProjectId: string): Promise<Connection | null> {
  if (!/^[a-z0-9]{20,64}$/.test(marketingProjectId)) throw new Error("Invalid marketing project");
  const secret = (await vaultService("media-engine")).HYPER_RENDER_PROJECT_CONNECTIONS;
  if (!secret) return null;
  const entries = z.record(z.unknown()).parse(JSON.parse(secret));
  if (!Object.hasOwn(entries, marketingProjectId)) return null;
  const connection = connectionSchema.parse(entries[marketingProjectId]);
  for (const [id, value] of Object.entries(entries)) {
    if (id === marketingProjectId) continue;
    const other = connectionSchema.parse(value);
    if (other.projectId === connection.projectId || (other.bucket === connection.bucket &&
        (other.prefix.startsWith(connection.prefix) || connection.prefix.startsWith(other.prefix))))
      throw new Error("Render project connections must have isolated project IDs and storage prefixes");
  }
  return connection;
}

async function projectAndJob(connection: Connection, jobId?: string, fetcher: typeof fetch = fetch) {
  const projectId = connectionSchema.parse(connection).projectId;
  const guide = guideSchema.parse(await apiGet(`/projects/${projectId}/integration`, connection.token, fetcher));
  if (guide.project.id !== projectId || guide.project.output.bucket !== connection.bucket || guide.project.output.prefix !== connection.prefix)
    throw new Error("Render project storage configuration does not match its authorized connection");
  const base = { connected: true, projectId, bucket: connection.bucket, prefix: connection.prefix,
    checkedAt: new Date().toISOString(), dispatchEnabled: false };
  if (!jobId) return { base, job: null };
  const safeJobId = uuid.parse(jobId);
  const job = jobSchema.parse(await apiGet(`/projects/${projectId}/jobs/${safeJobId}`, connection.token, fetcher));
  if (job.id !== safeJobId || job.projectId !== projectId) throw new Error("Render job belongs to a different project");
  if (job.output && (job.state !== "completed" || job.output.projectId !== projectId ||
      job.output.jobId !== job.id || job.output.generation !== job.generation ||
      job.output.bucket !== connection.bucket || !job.output.key.startsWith(connection.prefix)))
    throw new Error("Render receipt does not match the authorized project and job");
  return { base, job };
}

export async function getHyperImportReceipt(connection: Connection, jobId: string, fetcher: typeof fetch = fetch) {
  const { job } = await projectAndJob(connection, jobId, fetcher);
  if (!job || job.state !== "completed" || !job.output || !job.output.available)
    throw new Error("The new render job has no available completed output receipt");
  return job.output;
}

export async function inspectHyperProject(connection: Connection, jobId?: string, fetcher: typeof fetch = fetch) {
  const { base, job } = await projectAndJob(connection, jobId, fetcher);
  if (!job) return { ...base, job: null };
  return { ...base, job: { id: job.id, state: job.state, modelId: job.modelId, errorCode: job.errorCode ?? null,
    receipt: job.output ? { sha256: job.output.sha256, bytes: job.output.bytes, contentType: job.output.contentType,
      available: job.output.available, objectHashVerifiedByMediaEngine: false } : null } };
}

/** Read-only check: preparation and a matching model do not qualify execution. */
export async function inspectHyperEnvironment(connection: Connection, environmentId: string, modelId: string, fetcher: typeof fetch = fetch) {
  await projectAndJob(connection, undefined, fetcher);
  const id = uuid.parse(environmentId);
  const environment = environmentSchema.parse(await apiGet(`/projects/${connection.projectId}/environments/${id}`, connection.token, fetcher));
  if (environment.id !== id) throw new Error("Render environment does not match the requested project environment");
  return { id: environment.id, modelId: environment.modelId, modelMatches: environment.modelId === modelId, prepared: environment.prepared };
}

/** Submit one immutable, project-scoped job after the caller's live readiness gates pass. */
export async function submitHyperProjectJob(
  connectionValue: Connection,
  inputValue: z.input<typeof submissionSchema> & { modelId: string },
  fetcher: typeof fetch = fetch,
) {
  const connection = connectionSchema.parse(connectionValue);
  const input = submissionSchema.extend({ modelId: z.string().min(1).max(100) }).strict().parse(inputValue);
  await projectAndJob(connection, undefined, fetcher);

  const environment = environmentSchema.parse(await apiGet(
    `/projects/${connection.projectId}/environments/${input.environmentId}`,
    connection.token,
    fetcher,
  ));
  if (environment.id !== input.environmentId || environment.modelId !== input.modelId || !environment.prepared)
    throw new Error("The selected Hyper environment must be prepared for this model before submission");

  let response: Response;
  try {
    response = await fetcher(`${API}/projects/${connection.projectId}/jobs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${connection.token}`,
        accept: "application/json",
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({ environmentId: input.environmentId, idempotencyKey: input.idempotencyKey, ...input.request }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new HyperJobSubmissionError("Hyper submission outcome is uncertain; retry only this unchanged request", true);
  }

  if (response.status !== 202) {
    await response.body?.cancel();
    throw new HyperJobSubmissionError(
      response.status >= 500
        ? "Hyper submission outcome is uncertain; retry only this unchanged request"
        : "Hyper rejected the media request; review the environment and request before retrying",
      response.status >= 500,
    );
  }

  try {
    const body = await response.text();
    if (body.length > 250_000) throw new Error("response too large");
    const job = jobSchema.parse(JSON.parse(body));
    if (job.projectId !== connection.projectId || job.modelId !== input.modelId)
      throw new Error("job scope mismatch");
    return { id: job.id, projectId: job.projectId, modelId: job.modelId, state: job.state, generation: job.generation };
  } catch {
    throw new HyperJobSubmissionError(
      "Hyper accepted the request but its job receipt could not be verified; retry only this unchanged request",
      true,
    );
  }
}
