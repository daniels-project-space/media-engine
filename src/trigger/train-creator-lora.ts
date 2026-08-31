import { AbortTaskRunError, logger, task, wait } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";

import { api } from "../../convex/_generated/api";
import { creativeServiceToken } from "../lib/creative-service";
import {
  FAL_Z_IMAGE_TRAINER_ENDPOINT_ID,
  FAL_Z_IMAGE_TURBO_BASE_MODEL,
  buildFalZImageTrainerSubmitDescriptor,
  isFalZImageTrainerDispatchEnabled,
  parseFalZImageTrainerOutput,
  parseFalZImageTrainerQueueStatus,
  parseFalZImageTrainerQueueSubmit,
  type FalZImageTrainingType,
  type FrozenZImageTurboLoRATrainingJob,
} from "../lib/creator-promotion";
import { presignedGet, putObject } from "../lib/storage";
import { vaultService } from "../lib/vault";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const MAX_DATASET_ASSET_BYTES = 24 * 1024 * 1024;
const MAX_DATASET_BYTES = 256 * 1024 * 1024;
const MAX_MODEL_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_CONFIG_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_POLLS = 360;
const POLL_INTERVAL_SECONDS = 60;

type Payload = { creatorLoRATrainingJobId: string };
type ClaimedDatasetAsset = {
  assetId: string;
  storageKey: string;
  caption?: string;
  sha256?: string;
};
type ClaimedTrainingJob = {
  id: string;
  targetModel: typeof FAL_Z_IMAGE_TURBO_BASE_MODEL;
  triggerWord: string;
  datasetManifestHash: string;
  datasetAssetCount: number;
  falRequestId?: string;
  trainingParams: {
    trainingEndpoint: typeof FAL_Z_IMAGE_TRAINER_ENDPOINT_ID;
    inferenceEndpoint: "fal-ai/z-image/turbo/lora";
    baseModel: typeof FAL_Z_IMAGE_TURBO_BASE_MODEL;
    triggerWord: string;
    steps: number;
    learningRate: number;
    trainingType: FalZImageTrainingType;
    falTrainingType: FalZImageTrainingType;
    defaultCaption: string;
  };
  dataset: ClaimedDatasetAsset[];
  reused: boolean;
};
type DownloadedImage = { filename: string; bytes: Uint8Array; caption: string };

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string, maximum: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const trimmed = value.trim();
  if ((!trimmed && required) || trimmed.length > maximum) throw new Error(`${label} is invalid`);
  return trimmed || undefined;
}

function asInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function asFiniteNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function safeId(value: unknown, label: string): string {
  const result = asString(value, label, 240)!;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function safeDatasetKey(value: unknown): string {
  const key = asString(value, "frozen training source key", 1_024)!;
  if (!key.startsWith("creator-references/") || key.includes("..") || key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key)) {
    throw new Error("frozen training source key is not controlled");
  }
  return key;
}

function trainingType(value: unknown, label: string): FalZImageTrainingType {
  if (value === "content" || value === "style" || value === "balanced") return value;
  throw new Error(`${label} must be content, style, or balanced`);
}

function parseClaim(value: unknown): ClaimedTrainingJob {
  const claimed = asRecord(value, "LoRA training claim");
  const rawJob = asRecord(claimed.job, "LoRA training claim job");
  const rawParams = asRecord(rawJob.trainingParams, "frozen Fal training parameters");
  const rawAssets = claimed.datasetManifest;
  if (!Array.isArray(rawAssets)) throw new Error("frozen LoRA dataset manifest is invalid");

  const targetModel = rawJob.targetModel;
  if (targetModel !== FAL_Z_IMAGE_TURBO_BASE_MODEL) throw new Error("LoRA job does not target Z-Image Turbo");
  const steps = asInteger(rawParams.steps, "Fal training steps", 100, 10_000);
  if (steps % 100 !== 0) throw new Error("Fal training steps must be in 100-step increments");
  const resolvedTrainingType = trainingType(rawParams.trainingType, "Fal training type");
  if (trainingType(rawParams.falTrainingType, "Fal training type") !== resolvedTrainingType) {
    throw new Error("frozen Fal training modes do not agree");
  }
  if (rawParams.trainingEndpoint !== FAL_Z_IMAGE_TRAINER_ENDPOINT_ID) {
    throw new Error("frozen training endpoint is not Fal Z-Image Trainer");
  }
  if (rawParams.inferenceEndpoint !== "fal-ai/z-image/turbo/lora" || rawParams.baseModel !== FAL_Z_IMAGE_TURBO_BASE_MODEL) {
    throw new Error("frozen inference target is not native Z-Image Turbo LoRA");
  }

  const triggerWord = asString(rawJob.triggerWord, "frozen LoRA trigger word", 200)!;
  const parameterTriggerWord = asString(rawParams.triggerWord, "frozen Fal trigger word", 200)!;
  if (triggerWord !== parameterTriggerWord) throw new Error("frozen trigger words do not agree");
  const dataset = rawAssets.map((entry, index): ClaimedDatasetAsset => {
    const asset = asRecord(entry, `frozen LoRA dataset asset ${index + 1}`);
    asString(asset.rightsStatus, `frozen LoRA dataset asset ${index + 1} rights status`, 120);
    asString(asset.consentAttestedBy, `frozen LoRA dataset asset ${index + 1} consent attester`, 200);
    asFiniteNumber(asset.consentAttestedAt, `frozen LoRA dataset asset ${index + 1} consent timestamp`, 1, Number.MAX_SAFE_INTEGER);
    const sha256 = asset.sha256 === undefined ? undefined : asString(asset.sha256, `frozen LoRA source digest ${index + 1}`, 64)!;
    if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error(`frozen LoRA source digest ${index + 1} is invalid`);
    return {
      assetId: safeId(asset.assetId, `frozen LoRA dataset asset ${index + 1} id`),
      storageKey: safeDatasetKey(asset.storageKey),
      ...(asset.caption === undefined ? {} : { caption: asString(asset.caption, `frozen LoRA caption ${index + 1}`, 1_000)! }),
      ...(sha256 ? { sha256 } : {}),
    };
  });
  if (dataset.length < 10 || dataset.length > 100) throw new Error("Fal LoRA dataset must contain 10–100 frozen approved images");
  if (new Set(dataset.map((asset) => asset.storageKey)).size !== dataset.length) throw new Error("frozen LoRA dataset contains duplicate source keys");
  if (asInteger(rawJob.datasetAssetCount, "frozen LoRA dataset asset count", 10, 100) !== dataset.length) {
    throw new Error("frozen LoRA dataset asset count does not match its manifest");
  }

  const falRequestId = rawJob.falRequestId === undefined ? undefined : safeId(rawJob.falRequestId, "Fal request id");
  return {
    id: safeId(rawJob.id, "LoRA training job id"),
    targetModel,
    triggerWord,
    datasetManifestHash: asString(rawJob.datasetManifestHash, "frozen LoRA dataset hash", 64)!,
    datasetAssetCount: dataset.length,
    ...(falRequestId ? { falRequestId } : {}),
    trainingParams: {
      trainingEndpoint: FAL_Z_IMAGE_TRAINER_ENDPOINT_ID,
      inferenceEndpoint: "fal-ai/z-image/turbo/lora",
      baseModel: FAL_Z_IMAGE_TURBO_BASE_MODEL,
      triggerWord,
      steps,
      learningRate: asFiniteNumber(rawParams.learningRate, "Fal learning rate", Number.EPSILON, 1),
      trainingType: resolvedTrainingType,
      falTrainingType: resolvedTrainingType,
      defaultCaption: asString(rawParams.defaultCaption, "frozen Fal default caption", 1_000)!,
    },
    dataset,
    reused: claimed.reused === true,
  };
}

function assertLiveTrainingGate(): void {
  if (!isFalZImageTrainerDispatchEnabled()) {
    throw new Error("CREATOR_LORA_TRAINING_ENABLED is not true; Fal training remains fail-closed");
  }
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Fal creator LoRA training cannot run outside a production worker");
  }
}

async function falKey(): Promise<string> {
  const vault = await vaultService("fal");
  const key = vault.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not available from the Fal vault");
  return key;
}

function safeRemoteUrl(value: string, label: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1"
  ) {
    throw new Error(`${label} is unsafe`);
  }
  return url.toString();
}

async function fetchJson(url: string, key: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(safeRemoteUrl(url, "Fal queue URL"), {
    ...init,
    redirect: "error",
    headers: {
      authorization: `Key ${key}`,
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 1_000);
    throw new Error(`Fal returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Fal returned invalid JSON");
  }
}

function imageFileExtension(contentType: string): string {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  throw new Error("frozen LoRA dataset asset is not a supported image type");
}

async function downloadFrozenImage(asset: ClaimedDatasetAsset, index: number, defaultCaption: string): Promise<DownloadedImage> {
  const response = await fetch(await presignedGet(asset.storageKey, 60 * 60), { redirect: "error" });
  if (!response.ok) throw new Error(`frozen LoRA dataset asset returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_DATASET_ASSET_BYTES) throw new Error("frozen LoRA dataset asset exceeds the byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DATASET_ASSET_BYTES) throw new Error("frozen LoRA dataset asset exceeds the byte limit");
  if (asset.sha256 && createHash("sha256").update(bytes).digest("hex") !== asset.sha256.toLowerCase()) {
    throw new Error("frozen LoRA dataset asset no longer matches its approved digest");
  }
  const extension = imageFileExtension(response.headers.get("content-type") ?? "");
  return {
    filename: `${String(index + 1).padStart(3, "0")}.${extension}`,
    bytes,
    caption: asset.caption ?? defaultCaption,
  };
}

async function packageFrozenDataset(job: ClaimedTrainingJob): Promise<{ key: string; url: string }> {
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  for (const [index, asset] of job.dataset.entries()) {
    const image = await downloadFrozenImage(asset, index, job.trainingParams.defaultCaption);
    totalBytes += image.bytes.byteLength;
    if (totalBytes > MAX_DATASET_BYTES) throw new Error("frozen LoRA dataset exceeds the byte limit");
    const stem = image.filename.slice(0, image.filename.lastIndexOf("."));
    files[image.filename] = image.bytes;
    // Fal pairs image ROOT.EXT with ROOT.txt. Missing individual captions fall
    // back to the already-frozen default caption, never a worker-generated one.
    files[`${stem}.txt`] = strToU8(image.caption);
  }
  const archive = zipSync(files, { level: 6 });
  if (archive.byteLength === 0 || archive.byteLength > MAX_DATASET_BYTES) throw new Error("frozen LoRA ZIP exceeds the byte limit");
  const digest = createHash("sha256").update(archive).digest("hex");
  const key = `creator-lora-training/${job.id}/dataset-${digest}.zip`;
  await putObject(key, archive, "application/zip");
  return { key, url: await presignedGet(key, 4 * 60 * 60) };
}

async function downloadOutput(url: string, maximumBytes: number, label: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetch(safeRemoteUrl(url, label), { redirect: "error" });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumBytes) throw new Error(`${label} exceeds the byte limit`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) throw new Error(`${label} exceeds the byte limit`);
  return { bytes, contentType: response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream" };
}

function responsePayload(value: unknown): unknown {
  const record = asRecord(value, "Fal result");
  if (record.status === "ERROR") throw new Error(asString(record.error, "Fal error", 2_000, false) ?? "Fal training failed");
  if (record.payload !== undefined) return record.payload;
  if (record.data !== undefined) return record.data;
  return value;
}

function queueUrls(requestId: string): { statusUrl: string; responseUrl: string } {
  const encoded = encodeURIComponent(requestId);
  const base = `https://queue.fal.run/${FAL_Z_IMAGE_TRAINER_ENDPOINT_ID}/requests/${encoded}`;
  return { statusUrl: `${base}/status`, responseUrl: `${base}/response` };
}

async function completeTraining(
  convex: ConvexHttpClient,
  serviceToken: string,
  job: ClaimedTrainingJob,
  triggerRunId: string,
  falRequestId: string,
  response: unknown,
): Promise<void> {
  const output = parseFalZImageTrainerOutput(responsePayload(response));
  const model = await downloadOutput(output.diffusersLoraUrl, MAX_MODEL_ARTIFACT_BYTES, "Fal LoRA artifact");
  const config = await downloadOutput(output.configUrl, MAX_CONFIG_ARTIFACT_BYTES, "Fal LoRA config artifact");
  const modelArtifactKey = `creator-loras/${job.id}/model.safetensors`;
  const configArtifactKey = `creator-loras/${job.id}/config.json`;
  await putObject(modelArtifactKey, model.bytes, model.contentType);
  await putObject(configArtifactKey, config.bytes, config.contentType);
  await convex.action(api.creatorPromotionsGateway.completeLoRATrainingJob, {
    serviceToken,
    payload: {
      jobId: job.id,
      triggerRunId,
      falRequestId,
      modelArtifactKey,
      falResultMetadata: {
        status: "COMPLETED",
        trainingSteps: job.trainingParams.steps,
        trainingImages: job.datasetAssetCount,
      },
    },
  });
}

export const trainCreatorLoRA = task({
  id: "train-creator-lora",
  maxDuration: 900,
  machine: "small-1x",
  // A post-submit retry without a persisted Fal request ID could create a
  // second paid training run. The backend keeps an explicit recovery path.
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const jobId = safeId(payload.creatorLoRATrainingJobId, "creatorLoRATrainingJobId");
    assertLiveTrainingGate();
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    let job: ClaimedTrainingJob | undefined;
    let providerSubmissionAccepted = false;
    let providerSubmissionPersisted = false;
    let pollingWindowElapsed = false;
    let falRequestId: string | undefined;

    try {
      job = parseClaim(await convex.action(api.creatorPromotionsGateway.claimLoRATrainingJob, {
        serviceToken,
        payload: { jobId, triggerRunId: ctx.run.id },
      }));
      const key = await falKey();
      const urls = job.falRequestId ? queueUrls(job.falRequestId) : undefined;
      let statusUrl = urls?.statusUrl;
      let responseUrl = urls?.responseUrl;
      falRequestId = job.falRequestId;
      providerSubmissionPersisted = Boolean(falRequestId);

      if (!falRequestId) {
        const dataset = await packageFrozenDataset(job);
        const frozen: FrozenZImageTurboLoRATrainingJob = {
          id: job.id,
          baseModel: job.targetModel,
          datasetManifestDigest: job.datasetManifestHash,
          triggerWord: job.triggerWord,
          defaultCaption: job.trainingParams.defaultCaption,
          steps: job.trainingParams.steps,
          learningRate: job.trainingParams.learningRate,
          trainingType: job.trainingParams.falTrainingType,
          idempotencyKey: `creator-lora:${job.id}:${job.datasetManifestHash}`.slice(0, 200),
        };
        const descriptor = buildFalZImageTrainerSubmitDescriptor(frozen, {
          imageDataUrl: dataset.url,
          steps: frozen.steps,
          learningRate: frozen.learningRate,
          defaultCaption: frozen.defaultCaption,
          trainingType: frozen.trainingType,
        });
        const accepted = await fetchJson(descriptor.url, key, {
          method: descriptor.method,
          headers: { "content-type": descriptor.headers.contentType, "x-fal-store-io": descriptor.headers.storeIo },
          body: JSON.stringify(descriptor.payload),
        });
        const queued = parseFalZImageTrainerQueueSubmit(accepted);
        providerSubmissionAccepted = true;
        falRequestId = queued.requestId;
        statusUrl = queued.statusUrl;
        responseUrl = queued.responseUrl;
        await convex.action(api.creatorPromotionsGateway.recordLoRATrainingProviderSubmission, {
          serviceToken,
          payload: { jobId: job.id, triggerRunId: ctx.run.id, falRequestId },
        });
        providerSubmissionPersisted = true;
      }

      if (!falRequestId || !statusUrl || !responseUrl) throw new Error("Fal queue submission did not provide durable request state");
      for (let poll = 0; poll < MAX_POLLS; poll += 1) {
        const status = parseFalZImageTrainerQueueStatus(await fetchJson(statusUrl, key), falRequestId);
        if (status.status === "COMPLETED") {
          await completeTraining(convex, serviceToken, job, ctx.run.id, falRequestId, await fetchJson(responseUrl, key));
          logger.log("creator Z-Image Turbo LoRA training completed", { creatorLoRATrainingJobId: job.id, falRequestId });
          return;
        }
        await wait.for({ seconds: POLL_INTERVAL_SECONDS });
      }
      // Do not mark an already-submitted paid request as failed merely because
      // this worker exceeded its observation window. The durable request id
      // enables a later operator-approved recovery poll without resubmission.
      pollingWindowElapsed = true;
      throw new Error("Fal training is still pending after the bounded polling window");
    } catch (error) {
      const message = error instanceof Error ? error.message : "creator LoRA training failed";
      if (job && !pollingWindowElapsed && (!providerSubmissionAccepted || providerSubmissionPersisted)) {
        await convex.action(api.creatorPromotionsGateway.failLoRATrainingJob, {
          serviceToken,
          payload: { jobId: job.id, triggerRunId: ctx.run.id, error: message.slice(0, 2_000), ...(falRequestId ? { falRequestId } : {}) },
        }).catch((recordError) => logger.error("could not record creator LoRA training failure", {
          creatorLoRATrainingJobId: job?.id,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        }));
      } else if (job) {
        logger.error(pollingWindowElapsed
          ? "Fal creator LoRA training is still pending; leaving durable request running for recovery polling"
          : "Fal accepted creator LoRA training but submission id was not persisted; leaving job running to prevent duplicate billing", {
          creatorLoRATrainingJobId: job.id,
        });
      }
      throw new AbortTaskRunError(message);
    }
  },
});
