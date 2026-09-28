import { createHash } from "node:crypto";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { vaultService } from "./vault";

const PROJECT = "media-engine";
const KEY = /^[A-Za-z0-9:_-]{16,200}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;

type Receipt = {
  status: "complete";
  model: "nano-banana-pro";
  provider: "google" | "fal";
  projectId: string;
  jobId: string;
  output: { bucket: "media-engine"; key: string; bytes: number; sha256: string; contentType: string };
};

function origin(): URL {
  const raw = process.env.RENDER_ENGINE_PROJECT_API_URL;
  if (!raw) throw new Error("Render Engine project API is not configured");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("Render Engine project API must be an HTTPS origin");
  }
  return url;
}

async function capability(): Promise<string> {
  const direct = process.env.RENDER_ENGINE_PROJECT_TOKEN?.trim();
  const token = direct || (await vaultService(PROJECT)).RENDER_ENGINE_PROJECT_TOKEN;
  if (!token || !SHA.test(token)) throw new Error("Media Engine Render Engine capability is unavailable");
  return token;
}

function parseReceipt(value: unknown, references: number): Receipt {
  if (!value || typeof value !== "object") throw new Error("Render Engine omitted the image receipt");
  const receipt = value as Record<string, unknown>;
  const output = receipt.output as Record<string, unknown> | undefined;
  if (receipt.status !== "complete" || receipt.model !== "nano-banana-pro" ||
      (receipt.provider !== "google" && receipt.provider !== "fal") ||
      (references > 0 && receipt.provider !== "google") ||
      typeof receipt.jobId !== "string" || !/^hosted-[a-f0-9]{32}$/.test(receipt.jobId) ||
      typeof receipt.projectId !== "string" || !/^[A-Za-z0-9_.-]+$/.test(receipt.projectId) ||
      !output || output.bucket !== PROJECT ||
      typeof output.key !== "string" || !output.key.startsWith(`projects/media-engine/jobs/${receipt.jobId}/`) ||
      !output.key.includes(`/jobs/${receipt.jobId}/`) ||
      !Number.isSafeInteger(output.bytes) || (output.bytes as number) < 1 || (output.bytes as number) > MAX_BYTES ||
      typeof output.sha256 !== "string" || !SHA.test(output.sha256) ||
      !["image/png", "image/jpeg", "image/webp"].includes(String(output.contentType))) {
    throw new Error("Render Engine returned an invalid Media Engine R2 image receipt");
  }
  return value as Receipt;
}

export async function generateCreatorImage(input: {
  idempotencyKey: string;
  prompt: string;
  aspectRatio: "9:16" | "4:5";
  referenceImages: { mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string }[];
}, fetcher: typeof fetch = fetch): Promise<Receipt> {
  if (!KEY.test(input.idempotencyKey) || input.referenceImages.length > 5) throw new Error("Invalid creator image request");
  const token = await capability();
  const url = new URL("/client/hosted-generations", origin());
  url.searchParams.set("projectName", PROJECT);
  url.searchParams.set("idempotencyKey", input.idempotencyKey);
  const headers = { authorization: `Bearer ${token}` };
  const status = await fetcher(url, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (status.ok) {
    const state = await status.json() as { status?: string; receipt?: unknown };
    if (state.status === "complete") return parseReceipt(state.receipt, input.referenceImages.length);
    if (state.status !== "running" && state.status !== "uncertain") throw new Error(`Render Engine image request is ${state.status ?? "invalid"}; no resubmission`);
  } else if (status.status === 404) {
    // The only submission point. An ambiguous POST is never repeated.
    const submission = await fetcher(new URL("/client/hosted-generations", origin()), {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, cache: "no-store",
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({ projectName: PROJECT, idempotencyKey: input.idempotencyKey, allowPaidDispatch: true,
        input: { model: "nano-banana-pro", prompt: input.prompt, resolution: "2K", aspectRatio: input.aspectRatio,
          referenceImages: input.referenceImages } }),
    });
    if (submission.ok && submission.status !== 202) return parseReceipt(await submission.json(), input.referenceImages.length);
    if (submission.status !== 202 && submission.status !== 502 && submission.status !== 504) {
      throw new Error(`Render Engine image admission returned HTTP ${submission.status}`);
    }
  } else {
    throw new Error(`Render Engine image status returned HTTP ${status.status}`);
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const polled = await fetcher(url, { method: "GET", headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!polled.ok) throw new Error(`Render Engine image status returned HTTP ${polled.status}`);
    const state = await polled.json() as { status?: string; receipt?: unknown };
    if (state.status === "complete") return parseReceipt(state.receipt, input.referenceImages.length);
    if (state.status !== "running" && state.status !== "uncertain") throw new Error(`Render Engine image request is ${state.status ?? "invalid"}`);
  }
  throw new Error("Render Engine image remains in progress; inspect the same idempotency key before retrying");
}

/** Independent readback from this project's R2 bucket before a candidate is recorded. */
export async function readVerifiedCreatorImage(receipt: Receipt): Promise<Buffer> {
  const cf = await vaultService("cloudflare");
  const client = new S3Client({ region: "auto", endpoint: cf.R2_ENDPOINT,
    credentials: { accessKeyId: cf.R2_ACCESS_KEY_ID, secretAccessKey: cf.R2_SECRET_ACCESS_KEY } });
  try {
    const expected = receipt.output;
    const head = await client.send(new HeadObjectCommand({ Bucket: PROJECT, Key: expected.key }));
    if (!head.ETag || head.ContentLength !== expected.bytes || head.ContentType !== expected.contentType ||
        head.Metadata?.sha256 !== expected.sha256) throw new Error("Render Engine R2 metadata does not match its receipt");
    const object = await client.send(new GetObjectCommand({ Bucket: PROJECT, Key: expected.key, IfMatch: head.ETag }));
    if (!object.Body) throw new Error("Render Engine R2 output is missing");
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length !== expected.bytes || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
      throw new Error("Render Engine R2 output failed hash verification");
    }
    return bytes;
  } finally { client.destroy(); }
}
