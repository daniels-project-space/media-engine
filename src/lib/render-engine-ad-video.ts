import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { vaultService } from "./vault";

const PROJECT = "media-engine";
const PREFIX = "projects/media-engine";
const SHA = /^[a-f0-9]{64}$/;
const MAX_FRAME = 29_999_999;
const MAX_VIDEO = 500_000_000;

export type EngineFrame = { key: string; sha256: string; bytes: number; contentType: "image/png" };
export type EngineAdScene = { index: number; idempotencyKey: string; engineJobId: string;
  providerRequestId: string; estimatedCostUsd: number; admittedCostUsd: number;
  outputKey: string; outputSha256: string; outputBytes: number };

function endpoint(): URL {
  const raw = process.env.RENDER_ENGINE_PROJECT_API_URL?.trim();
  if (!raw) throw new Error("Render Engine project API is not configured");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password)
    throw new Error("Render Engine project API must be an HTTPS origin");
  return url;
}

async function token(): Promise<string> {
  const direct = process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim();
  const value = direct || (await vaultService(PROJECT)).RENDER_ENGINE_PROJECT_TOKEN;
  if (!value || !SHA.test(value)) throw new Error("Media Engine project capability is unavailable");
  return value;
}

async function r2(): Promise<S3Client> {
  const cf = await vaultService("cloudflare");
  return new S3Client({ region: "auto", endpoint: cf.R2_ENDPOINT,
    credentials: { accessKeyId: cf.R2_ACCESS_KEY_ID, secretAccessKey: cf.R2_SECRET_ACCESS_KEY } });
}

async function readExact(client: S3Client, key: string, max: number,
  expected?: { bytes: number; sha256: string; contentType: string }): Promise<{ bytes: Buffer; contentType: string }> {
  const head = await client.send(new HeadObjectCommand({ Bucket: PROJECT, Key: key }));
  if (!head.ETag || !Number.isSafeInteger(head.ContentLength) || !head.ContentLength || head.ContentLength > max ||
      (expected && (head.ContentLength !== expected.bytes || head.ContentType !== expected.contentType ||
        head.Metadata?.sha256 !== expected.sha256))) throw new Error("Project R2 object metadata differs");
  const response = await client.send(new GetObjectCommand({ Bucket: PROJECT, Key: key, IfMatch: head.ETag }));
  if (!response.Body || !(Symbol.asyncIterator in response.Body)) throw new Error("Project R2 object body is unavailable");
  const chunks: Buffer[] = []; let length = 0;
  const digest = createHash("sha256");
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    length += chunk.byteLength;
    if (length > head.ContentLength || length > max) throw new Error("Project R2 object exceeds its receipt");
    digest.update(chunk); chunks.push(Buffer.from(chunk));
  }
  const sha256 = digest.digest("hex");
  if (length !== head.ContentLength || (expected && sha256 !== expected.sha256))
    throw new Error("Project R2 object failed full SHA-256 readback");
  return { bytes: Buffer.concat(chunks), contentType: head.ContentType ?? "" };
}

/** Preserve the approved image and existing center-crop portrait framing. */
export async function portraitFrame(source: Buffer): Promise<Buffer> {
  const metadata = await sharp(source, { failOn: "error", limitInputPixels: 36_000_000 }).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 ||
      metadata.width < 300 || metadata.height < 300 || metadata.width > 6000 || metadata.height > 6000)
    throw new Error("Approved reference image has unsupported dimensions");
  const result = await sharp(source, { failOn: "error", limitInputPixels: 36_000_000 })
    .rotate().resize(720, 1280, { fit: "cover", position: "centre" }).png().toBuffer();
  if (result.length > MAX_FRAME) throw new Error("Portrait first frame exceeds the Engine input limit");
  return result;
}

/** Create-only content-addressed input in the project's R2 bucket. */
export async function stageApprovedPortrait(referenceKey: string): Promise<EngineFrame> {
  if (!/^products\/client\/[A-Za-z0-9/_.-]{1,300}$/.test(referenceKey) || referenceKey.includes(".."))
    throw new Error("Approved client reference key is invalid");
  const client = await r2();
  try {
    const source = await readExact(client, referenceKey, MAX_FRAME);
    if (!["image/png", "image/jpeg", "image/webp"].includes(source.contentType))
      throw new Error("Approved reference is not a supported still image");
    const bytes = await portraitFrame(source.bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = `${PREFIX}/inputs/sha256/${sha256}.png`;
    try {
      await client.send(new PutObjectCommand({ Bucket: PROJECT, Key: key, Body: bytes,
        ContentType: "image/png", Metadata: { sha256 }, IfNoneMatch: "*" }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
    }
    await readExact(client, key, MAX_FRAME, { bytes: bytes.length, sha256, contentType: "image/png" });
    return { key, bytes: bytes.length, sha256, contentType: "image/png" };
  } finally { client.destroy(); }
}

/** Persist the assembled ad once and read back its full project-bucket hash. */
export async function putVerifiedAdArtifact(key: string, bytes: Buffer): Promise<{ key: string; sha256: string; bytes: number }> {
  if (!/^creative\/[a-z0-9]{32}\/ad\.mp4$/.test(key) || bytes.length < 1 || bytes.length > MAX_VIDEO)
    throw new Error("Invalid final ad artifact");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = await r2();
  try {
    try {
      await client.send(new PutObjectCommand({ Bucket: PROJECT, Key: key, Body: bytes,
        ContentType: "video/mp4", Metadata: { sha256 }, IfNoneMatch: "*" }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
    }
    await readExact(client, key, MAX_VIDEO, { bytes: bytes.length, sha256, contentType: "video/mp4" });
    return { key, sha256, bytes: bytes.length };
  } finally { client.destroy(); }
}

export function parseEngineAdGenerationStatus(value: unknown, key: string): { state: "running" | "uncertain" | "complete"; scene?: Omit<EngineAdScene, "index" | "idempotencyKey"> } {
  if (!value || typeof value !== "object") throw new Error("Engine returned an invalid generation status");
  const state = value as Record<string, unknown>;
  if (state.status === "running" || state.status === "uncertain") return { state: state.status };
  if (state.status !== "complete" || !state.receipt || typeof state.receipt !== "object")
    throw new Error(`Engine generation ${key} is ${String(state.status)}; inspect before retrying`);
  const receipt = state.receipt as Record<string, unknown>;
  const output = receipt.output as Record<string, unknown> | undefined;
  if (state.model !== "seedance-2.5-i2v" || receipt.model !== "seedance-2.5-i2v" ||
      state.provider !== "byteplus" || receipt.provider !== "byteplus" ||
      state.jobId !== receipt.jobId || state.providerRequestId !== receipt.providerRequestId ||
      typeof receipt.jobId !== "string" || !/^hosted-[a-f0-9]{32}$/.test(receipt.jobId) ||
      typeof receipt.providerRequestId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(receipt.providerRequestId) ||
      typeof receipt.projectId !== "string" || !receipt.projectId ||
      !Number.isFinite(receipt.estimatedCostUsd) || (receipt.estimatedCostUsd as number) <= 0 ||
      !Number.isFinite(state.admittedCostUsd) || (state.admittedCostUsd as number) <= 0 ||
      state.budgetReleasedUsd !== 0 || state.outputRetired !== false ||
      !output || output.bucket !== PROJECT || output.contentType !== "video/mp4" ||
      typeof output.key !== "string" || !output.key.startsWith(`${PREFIX}/jobs/${receipt.jobId}/`) ||
      !output.key.endsWith("/generation.mp4") || !Number.isSafeInteger(output.bytes) || (output.bytes as number) < 1 ||
      (output.bytes as number) > MAX_VIDEO || typeof output.sha256 !== "string" || !SHA.test(output.sha256))
    throw new Error("Engine returned an invalid owned Seedance output or cost receipt");
  return { state: "complete", scene: { engineJobId: receipt.jobId, providerRequestId: receipt.providerRequestId,
    estimatedCostUsd: receipt.estimatedCostUsd as number, admittedCostUsd: state.admittedCostUsd as number,
    outputKey: output.key, outputSha256: output.sha256, outputBytes: output.bytes as number } };
}

async function jsonResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length > 80_000) throw new Error("Engine status exceeded the response limit");
  try { return JSON.parse(body); }
  catch { throw new Error("Engine returned invalid JSON"); }
}

/** Same idempotency key is polled/recovered; a paid POST is issued at most once. */
export async function renderEngineAdScene(input: { renderJobId: string; index: number; prompt: string;
  durationSeconds: number; firstFrame: EngineFrame }, fetcher: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readOutput: (scene: Omit<EngineAdScene, "index" | "idempotencyKey">) => Promise<Buffer> = async scene => {
    const client = await r2();
    try {
      return (await readExact(client, scene.outputKey, MAX_VIDEO, {
        bytes: scene.outputBytes, sha256: scene.outputSha256, contentType: "video/mp4" })).bytes;
    } finally { client.destroy(); }
  }): Promise<{ scene: EngineAdScene; bytes: Buffer }> {
  if (!/^[a-z0-9]{32}$/.test(input.renderJobId) || !Number.isSafeInteger(input.index) || input.index < 1 || input.index > 6 ||
      !input.prompt.trim() || input.prompt.length > 20_000 || !Number.isSafeInteger(input.durationSeconds) ||
      input.durationSeconds < 4 || input.durationSeconds > 15 || !SHA.test(input.firstFrame.sha256) ||
      input.firstFrame.key !== `${PREFIX}/inputs/sha256/${input.firstFrame.sha256}.png` ||
      input.firstFrame.contentType !== "image/png" || !Number.isSafeInteger(input.firstFrame.bytes) || input.firstFrame.bytes < 1)
    throw new Error("Invalid approved Engine video shot");
  const idempotencyKey = `${input.renderJobId}:scene:${input.index}`;
  const origin = endpoint();
  const headers = { authorization: `Bearer ${await token()}` };
  const statusUrl = new URL("/client/hosted-generations", origin);
  statusUrl.searchParams.set("projectName", PROJECT);
  statusUrl.searchParams.set("idempotencyKey", idempotencyKey);
  const readStatus = async () => fetcher(statusUrl, { method: "GET", headers, cache: "no-store",
    redirect: "error", signal: AbortSignal.timeout(10_000) });
  let status = await readStatus();
  if (status.status === 404) {
    try {
      const posted = await fetcher(new URL("/client/hosted-generations", origin), { method: "POST",
        headers: { ...headers, "content-type": "application/json" }, cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ projectName: PROJECT, idempotencyKey, allowPaidDispatch: true,
          input: { model: "seedance-2.5-i2v", prompt: input.prompt, resolution: "720p",
            durationSeconds: input.durationSeconds, generateAudio: true,
            requiredAspectRatio: "9:16", firstFrame: input.firstFrame } }),
      });
      if (![200, 202, 502, 504].includes(posted.status))
        throw new Error(`Engine video admission returned HTTP ${posted.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Engine video admission returned HTTP")) throw error;
      // An uncertain POST may have reached BytePlus. Reconcile this key only.
    }
  } else if (!status.ok) throw new Error(`Engine video status returned HTTP ${status.status}`);
  for (let attempt = 0; attempt < 90; attempt++) {
    if (status.status === 404) {
      await pause(5_000);
      status = await readStatus();
      if (status.status === 404) continue;
    }
    if (!status.ok) throw new Error(`Engine video status returned HTTP ${status.status}; inspect ${idempotencyKey}`);
    const parsed = parseEngineAdGenerationStatus(await jsonResponse(status), idempotencyKey);
    if (parsed.state === "complete" && parsed.scene) {
      const bytes = await readOutput(parsed.scene);
      if (bytes.length !== parsed.scene.outputBytes || createHash("sha256").update(bytes).digest("hex") !== parsed.scene.outputSha256)
        throw new Error("Engine video output failed full SHA-256 readback");
      return { scene: { ...parsed.scene, index: input.index - 1, idempotencyKey }, bytes };
    }
    if (attempt === 2 || attempt === 20 || attempt === 50) {
      // The Engine recovery route only polls an already accepted provider ID.
      // It cannot create another billable generation.
      await fetcher(new URL("/client/hosted-generations/recover", origin), { method: "POST",
        headers: { ...headers, "content-type": "application/json" }, cache: "no-store", redirect: "error",
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ projectName: PROJECT, idempotencyKey }) }).catch(() => undefined);
    }
    await pause(5_000);
    status = await readStatus();
  }
  throw new Error(`Engine video remains unsettled; inspect ${idempotencyKey} before retrying`);
}
