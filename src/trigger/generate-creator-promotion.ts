import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { createHash } from "node:crypto";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { creativeServiceToken } from "../lib/creative-service";
import {
  buildLtxAsyncImageToVideoSubmitDescriptor,
  buildLtxImageToVideoJobPollDescriptor,
  buildFalZImageTurboLoRAInferenceDescriptor,
  buildNovitaAsyncSubmitDescriptor,
  buildNovitaTaskPollDescriptor,
  checkFalZImageTurboLoRARendererAdapterConfiguration,
  checkLtxRendererAdapterConfiguration,
  checkNovitaRendererAdapterConfiguration,
  normalizeLtxAsyncSubmitResponse,
  normalizeLtxImageToVideoJobResult,
  normalizeNovitaAsyncSubmitResponse,
  normalizeNovitaTaskResult,
} from "../lib/creator-promotion";
import { presignedGet, putObject } from "../lib/storage";
import { vaultService } from "../lib/vault";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 96;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;

type Payload = { creatorRenderJobId: string };
type Provider = "novita" | "ltx" | "fal_z_image_turbo_lora";
type CreatorLoRASnapshot = {
  modelId: string;
  trainingJobId: string;
  targetModel: "z-image-turbo";
  triggerWord: string;
  modelArtifactKey: string;
  datasetManifestHash: string;
};
type ClaimedJob = {
  job: {
    id: Id<"creatorRenderJobs">;
    provider: Provider;
    attemptNumber: number;
    requestHash: string;
  };
  requestSnapshot: unknown;
};
type ApprovedContent = {
  provider: Provider;
  prompt: string;
  promptLock?: string;
  promptStyle?: string;
  referenceNotes?: string;
  format: string;
  referenceAssetKeys: string[];
  loraSnapshot?: CreatorLoRASnapshot;
};
type ResolvedSource = { key: string; uri: string; bytes: Buffer; contentType: string; digest: string };

function requiredJobId(value: unknown): Id<"creatorRenderJobs"> {
  if (typeof value !== "string" || !value || value.length > 180) {
    throw new AbortTaskRunError("generate-creator-promotion requires a valid creatorRenderJobId");
  }
  return value as Id<"creatorRenderJobs">;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function asText(value: unknown, label: string, maximum: number, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const trimmed = value.trim();
  if ((!trimmed && required) || trimmed.length > maximum) throw new Error(`${label} is invalid`);
  return trimmed || undefined;
}

function controlledLoRAArtifactKey(value: unknown): string {
  const key = asText(value, "approved creator LoRA artifact key", 1_024)!;
  if (
    !key.startsWith("creator-loras/") ||
    key.includes("..") ||
    key.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error("approved creator LoRA artifact key is not controlled");
  }
  return key;
}

function approvedLoRASnapshot(value: unknown): CreatorLoRASnapshot {
  const snapshot = asRecord(value, "approved creator LoRA snapshot");
  const triggerWord = asText(snapshot.triggerWord, "approved creator LoRA trigger word", 200)!;
  if (/\r|\n/.test(triggerWord) || /\b(?:minor|underage|child|teen(?:age)?|schoolgirl|nudity|sexual|onlyfans)\b/i.test(triggerWord)) {
    throw new Error("approved creator LoRA trigger word violates the adult-only safety boundary");
  }
  const datasetManifestHash = asText(snapshot.datasetManifestHash, "approved creator LoRA dataset manifest hash", 64)!;
  if (!/^[a-f0-9]{64}$/i.test(datasetManifestHash)) {
    throw new Error("approved creator LoRA dataset manifest hash is invalid");
  }
  if (snapshot.targetModel !== "z-image-turbo") {
    throw new Error("approved creator LoRA snapshot is not native Z-Image Turbo");
  }
  return {
    modelId: asText(snapshot.modelId, "approved creator LoRA model id", 240)!,
    trainingJobId: asText(snapshot.trainingJobId, "approved creator LoRA training job id", 240)!,
    targetModel: "z-image-turbo",
    triggerWord,
    modelArtifactKey: controlledLoRAArtifactKey(snapshot.modelArtifactKey),
    datasetManifestHash,
  };
}

function asClaimedJob(value: unknown): ClaimedJob {
  const result = asRecord(value, "creator render claim");
  const job = asRecord(result.job, "creator render claim job");
  const provider = job.provider;
  const id = job.id;
  const attemptNumber = job.attemptNumber;
  const requestHash = job.requestHash;
  if (
    (provider !== "novita" && provider !== "ltx" && provider !== "fal_z_image_turbo_lora") ||
    typeof id !== "string" ||
    typeof attemptNumber !== "number" || !Number.isInteger(attemptNumber) || attemptNumber < 1 ||
    typeof requestHash !== "string" || !/^[a-f0-9]{64}$/i.test(requestHash)
  ) {
    throw new Error("creator render claim returned malformed job data");
  }
  return { job: { id: id as Id<"creatorRenderJobs">, provider, attemptNumber, requestHash }, requestSnapshot: result.requestSnapshot };
}

function approvedContent(requestSnapshot: unknown, expectedProvider: Provider): ApprovedContent {
  const request = asRecord(requestSnapshot, "creator render request snapshot");
  const approval = asRecord(request.approvalSnapshot, "creator render approval snapshot");
  const content = asRecord(approval.content, "creator render approved content");
  const promptSnapshot = asRecord(content.promptSnapshot, "creator render prompt snapshot");
  const provider = promptSnapshot.provider;
  if (provider !== expectedProvider) throw new Error("creator render provider no longer matches its approved snapshot");
  const referenceAssetKeys = content.referenceAssetKeys === undefined
    ? []
    : Array.isArray(content.referenceAssetKeys) && content.referenceAssetKeys.every((key) => typeof key === "string")
      ? content.referenceAssetKeys
      : (() => { throw new Error("creator render reference manifest is invalid"); })();
  for (const key of referenceAssetKeys) {
    if (!key.startsWith("creator-references/") || key.includes("..") || key.includes("\\")) {
      throw new Error("creator render reference manifest contains an uncontrolled key");
    }
  }
  const loraSnapshot = expectedProvider === "fal_z_image_turbo_lora"
    ? approvedLoRASnapshot(promptSnapshot.loraSnapshot)
    : (() => {
        if (promptSnapshot.loraSnapshot !== undefined) {
          throw new Error("a creator LoRA snapshot requires the Fal Z-Image Turbo LoRA provider");
        }
        return undefined;
      })();
  return {
    provider: expectedProvider,
    prompt: asText(promptSnapshot.prompt, "approved render prompt", 4_000)!,
    promptLock: asText(promptSnapshot.promptLock, "approved prompt lock", 4_000, false),
    promptStyle: asText(promptSnapshot.promptStyle, "approved prompt style", 2_000, false),
    referenceNotes: asText(promptSnapshot.referenceNotes, "approved reference notes", 2_000, false),
    format: asText(content.format, "approved content format", 40)!,
    referenceAssetKeys,
    ...(loraSnapshot ? { loraSnapshot } : {}),
  };
}

function safePrompt(content: ApprovedContent): string {
  const source = [content.promptLock, content.promptStyle, content.referenceNotes, content.prompt]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
  if (/\b(?:minor|underage|child|teen(?:age)?|schoolgirl)\b/i.test(source)) {
    throw new Error("creator render prompt violates the adult-only safety boundary");
  }
  return `${source}\n\nCreate a commercial social-media visual with an adult subject only. No nudity, sexual content, exploitation, or depiction of a real person without consent.`.slice(0, 5_000);
}

function safeFalLoRAPrompt(content: ApprovedContent, lora: CreatorLoRASnapshot): string {
  const safetyTail = "Create a commercial social-media visual with an adult subject only. No nudity, sexual content, exploitation, or depiction of a real person without consent.";
  const prompt = `Use the approved creator identity trigger ${lora.triggerWord}.\n\n${safePrompt(content)}`;
  if (prompt.length <= 4_000) return prompt;
  return `${prompt.slice(0, 3_750).trimEnd()}\n\n${safetyTail}`;
}

function dimensionsFor(format: string): { width: number; height: number } {
  return format === "reel" || format === "story" || format === "short"
    ? { width: 1080, height: 1920 }
    : { width: 1080, height: 1350 };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configuredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured for the creator renderer`);
  return value;
}

async function providerToken(provider: "novita" | "ltx"): Promise<string> {
  const envKey = provider === "novita" ? "NOVITA_API_KEY" : "LTXV_API_KEY";
  const direct = process.env[envKey]?.trim();
  if (direct) return direct;
  const vault = await vaultService("media-engine").catch(() => ({} as Record<string, string>));
  const fallback = vault[envKey]?.trim();
  if (!fallback) throw new Error(`${envKey} is not configured; the creator renderer remains fail-closed`);
  return fallback;
}

async function falKey(): Promise<string> {
  const vault = await vaultService("fal");
  const key = vault.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY is not available from the Fal vault; creator LoRA rendering remains fail-closed");
  return key;
}

function assertSafeProviderUrl(value: string): string {
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
    throw new Error("provider returned an unsafe output URL");
  }
  return url.toString();
}

function approvedFalInferenceEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "fal.run" ||
    url.pathname !== "/fal-ai/z-image/turbo/lora" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error("Fal inference descriptor did not resolve to the approved Z-Image Turbo LoRA endpoint");
  }
  return url.toString();
}

async function fetchJson(url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`renderer provider returned HTTP ${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new Error("renderer provider returned invalid JSON");
  }
}

async function fetchFalJson(url: string, key: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(approvedFalInferenceEndpoint(url), {
    ...init,
    redirect: "error",
    headers: {
      authorization: `Key ${key}`,
      accept: "application/json",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 1_000);
    throw new Error(`Fal Z-Image Turbo LoRA returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Fal Z-Image Turbo LoRA returned invalid JSON");
  }
}

function falImageSizeFor(format: string): "portrait_4_3" | "portrait_16_9" {
  return format === "reel" || format === "story" || format === "short"
    ? "portrait_16_9"
    : "portrait_4_3";
}

function falOutputUrls(value: unknown): string[] {
  const output = asRecord(value, "Fal Z-Image Turbo LoRA response");
  if (!Array.isArray(output.images) || output.images.length < 1 || output.images.length > 4) {
    throw new Error("Fal Z-Image Turbo LoRA returned no reviewable image outputs");
  }
  if (
    !Array.isArray(output.has_nsfw_concepts) ||
    output.has_nsfw_concepts.length !== output.images.length ||
    output.has_nsfw_concepts.some((flag) => typeof flag !== "boolean")
  ) {
    throw new Error("Fal Z-Image Turbo LoRA response omitted required safety results");
  }
  if (output.has_nsfw_concepts.some((flag) => flag)) {
    throw new Error("Fal Z-Image Turbo LoRA safety checker flagged generated output");
  }
  return output.images.map((image, index) => {
    const record = asRecord(image, `Fal Z-Image Turbo LoRA image ${index + 1}`);
    return assertSafeProviderUrl(asText(record.url, `Fal Z-Image Turbo LoRA image ${index + 1} URL`, 8_192)!);
  });
}

async function resolveSource(key: string): Promise<ResolvedSource> {
  const uri = await presignedGet(key, 60 * 60);
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`approved source asset returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) throw new Error("approved render source is not an image");
  const headerSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(headerSize) && headerSize > MAX_OUTPUT_BYTES) throw new Error("approved render source exceeds the size limit");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error("approved render source exceeds the size limit");
  return { key, uri, bytes, contentType, digest: createHash("sha256").update(bytes).digest("hex") };
}

function extensionFor(contentType: string, mediaType: "image" | "video"): { extension: string; contentType: string } {
  const normalized = contentType.split(";", 1)[0]?.toLowerCase() ?? "";
  if (mediaType === "video" && normalized === "video/mp4") return { extension: "mp4", contentType: normalized };
  if (mediaType === "image" && normalized === "image/png") return { extension: "png", contentType: normalized };
  if (mediaType === "image" && normalized === "image/jpeg") return { extension: "jpg", contentType: normalized };
  if (mediaType === "image" && normalized === "image/webp") return { extension: "webp", contentType: normalized };
  throw new Error("provider output has an unsupported media type");
}

async function rehostOutput(
  sourceUrl: string,
  mediaType: "image" | "video",
  job: ClaimedJob["job"],
  candidateNumber: number,
): Promise<string> {
  const response = await fetch(assertSafeProviderUrl(sourceUrl));
  if (!response.ok) throw new Error(`provider output returned HTTP ${response.status}`);
  const headerSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(headerSize) && headerSize > MAX_OUTPUT_BYTES) throw new Error("provider output exceeds the size limit");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error("provider output exceeds the size limit");
  const media = extensionFor(response.headers.get("content-type") ?? "", mediaType);
  const key = `creator-renders/${job.id}/attempt-${job.attemptNumber}/candidate-${candidateNumber}.${media.extension}`;
  await putObject(key, bytes, media.contentType);
  return key;
}

async function recordCandidate(
  convex: ConvexHttpClient,
  serviceToken: string,
  job: ClaimedJob["job"],
  triggerRunId: string,
  candidateNumber: number,
  assetKey: string,
  mediaType: "image" | "video",
): Promise<void> {
  await convex.action(api.creatorPromotionsGateway.recordCreatorRenderCandidate, {
    serviceToken,
    payload: {
      jobId: job.id,
      triggerRunId,
      candidateKey: `candidate-${candidateNumber}`,
      assetKey,
      mediaType,
    },
  });
}

async function runNovita(
  convex: ConvexHttpClient,
  serviceToken: string,
  claim: ClaimedJob,
  content: ApprovedContent,
  triggerRunId: string,
): Promise<void> {
  const configuration = checkNovitaRendererAdapterConfiguration();
  if (configuration.status !== "ready") throw new Error(`Novita adapter is ${configuration.status}: ${configuration.missing.join(", ")}`);
  const token = await providerToken("novita");
  const source = content.referenceAssetKeys[0] ? await resolveSource(content.referenceAssetKeys[0]) : undefined;
  const dimensions = dimensionsFor(content.format);
  const build = buildNovitaAsyncSubmitDescriptor({
    audit: {
      actionId: `creator-render-${claim.job.id}`,
      contentDigest: claim.job.requestHash,
      idempotencyKey: `creator-render-${claim.job.id}-attempt-${claim.job.attemptNumber}`,
    },
    operation: source ? "image_to_image" : "text_to_image",
    modelName: configuredValue("CREATOR_NOVITA_MODEL"),
    prompt: safePrompt(content),
    negativePrompt: "nudity, sexual content, minor, underage, child, exploitative imagery, watermark, text overlay",
    width: dimensions.width,
    height: dimensions.height,
    imageCount: 1,
    outputFormat: "png",
    controls: { steps: 28, guidanceScale: 6.5, samplerName: "DPM++ 2M Karras", ...(source ? { imageStrength: 0.55 } : {}) },
    sourceAsset: source ? { assetId: source.digest, contentDigest: source.digest, base64: source.bytes.toString("base64"), mediaType: source.contentType } : undefined,
  });
  if (build.status !== "ready") throw new Error(`Novita descriptor cannot be built: ${build.errors.join("; ")}`);
  const accepted = normalizeNovitaAsyncSubmitResponse(await fetchJson(build.descriptor.url, token, { method: build.descriptor.method, body: JSON.stringify(build.descriptor.payload) }));
  if (!("taskId" in accepted)) throw new Error("Novita submit failed protocol validation");
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (poll) await delay(POLL_INTERVAL_MS);
    const polling = buildNovitaTaskPollDescriptor(accepted.taskId);
    if (polling.status !== "ready") throw new Error(`Novita poll descriptor cannot be built: ${polling.errors.join("; ")}`);
    const result = normalizeNovitaTaskResult(accepted.taskId, await fetchJson(polling.descriptor.url, token, { method: polling.descriptor.method }));
    if (result.state === "pending") continue;
    if (result.state === "failed") throw new Error(result.failureReason);
    if (result.state !== "succeeded" || !result.outputs?.length) throw new Error("Novita returned no reviewable output");
    for (const [index, output] of result.outputs.entries()) {
      const assetKey = await rehostOutput(output.sourceUrl, "image", claim.job, index + 1);
      await recordCandidate(convex, serviceToken, claim.job, triggerRunId, index + 1, assetKey, "image");
    }
    return;
  }
  throw new Error("Novita render polling timed out");
}

/**
 * Native Fal Z-Image Turbo inference is text-only in this first version.
 * A completed creator model is frozen into the approved content snapshot;
 * the worker resolves its controlled artifact only for this one request.
 */
async function runFalZImageTurboLoRA(
  convex: ConvexHttpClient,
  serviceToken: string,
  claim: ClaimedJob,
  content: ApprovedContent,
  triggerRunId: string,
): Promise<void> {
  const configuration = checkFalZImageTurboLoRARendererAdapterConfiguration();
  if (configuration.status !== "ready") {
    throw new Error(`Fal Z-Image Turbo LoRA adapter is ${configuration.status}: ${configuration.missing.join(", ")}`);
  }
  if (content.referenceAssetKeys.length > 0) {
    throw new Error("Fal Z-Image Turbo LoRA v1 is text-only and does not accept creator reference images");
  }
  const lora = content.loraSnapshot;
  if (!lora) throw new Error("Fal Z-Image Turbo LoRA render is missing its immutable approved model snapshot");

  // Do not use modelArtifactUrl from the snapshot: a fresh, short-lived URL is
  // issued from controlled storage immediately before the provider call.
  const loraPath = await presignedGet(lora.modelArtifactKey, 15 * 60);
  const descriptor = buildFalZImageTurboLoRAInferenceDescriptor({
    prompt: safeFalLoRAPrompt(content, lora),
    loraPath,
    scale: 0.8,
    imageSize: falImageSizeFor(content.format),
    numInferenceSteps: 8,
    numImages: 1,
    outputFormat: "png",
    acceleration: "regular",
  });
  const result = await fetchFalJson(
    descriptor.url,
    await falKey(),
    { method: descriptor.method, body: JSON.stringify(descriptor.payload) },
  );
  const outputs = falOutputUrls(result);
  for (const [index, sourceUrl] of outputs.entries()) {
    const assetKey = await rehostOutput(sourceUrl, "image", claim.job, index + 1);
    await recordCandidate(convex, serviceToken, claim.job, triggerRunId, index + 1, assetKey, "image");
  }
}

async function runLtx(
  convex: ConvexHttpClient,
  serviceToken: string,
  claim: ClaimedJob,
  content: ApprovedContent,
  triggerRunId: string,
): Promise<void> {
  const configuration = checkLtxRendererAdapterConfiguration();
  if (configuration.status !== "ready") throw new Error(`LTX adapter is ${configuration.status}: ${configuration.missing.join(", ")}`);
  if (!content.referenceAssetKeys[0]) throw new Error("LTX image-to-video requires an approved creator reference image");
  const token = await providerToken("ltx");
  const source = await resolveSource(content.referenceAssetKeys[0]);
  const build = buildLtxAsyncImageToVideoSubmitDescriptor({
    audit: {
      actionId: `creator-render-${claim.job.id}`,
      contentDigest: claim.job.requestHash,
      idempotencyKey: `creator-render-${claim.job.id}-attempt-${claim.job.attemptNumber}`,
    },
    sourceAsset: { assetId: source.digest, contentDigest: source.digest, uri: source.uri, expiresAt: new Date(Date.now() + 55 * 60 * 1000).toISOString(), mediaType: source.contentType },
    prompt: safePrompt(content),
    model: configuredValue("CREATOR_LTX_MODEL"),
    duration: 5,
    resolution: configuredValue("CREATOR_LTX_RESOLUTION"),
    fps: 24,
    generateAudio: false,
  });
  if (build.status !== "ready") throw new Error(`LTX descriptor cannot be built: ${build.errors.join("; ")}`);
  const accepted = normalizeLtxAsyncSubmitResponse(await fetchJson(build.descriptor.url, token, { method: build.descriptor.method, body: JSON.stringify(build.descriptor.payload) }));
  if (!("jobId" in accepted)) throw new Error("LTX submit failed protocol validation");
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    if (poll) await delay(POLL_INTERVAL_MS);
    const polling = buildLtxImageToVideoJobPollDescriptor(accepted.jobId);
    if (polling.status !== "ready") throw new Error(`LTX poll descriptor cannot be built: ${polling.errors.join("; ")}`);
    const result = normalizeLtxImageToVideoJobResult(accepted.jobId, await fetchJson(polling.descriptor.url, token, { method: polling.descriptor.method }));
    if (result.state === "pending") continue;
    if (result.state === "failed") throw new Error(result.failureReason);
    if (result.state !== "succeeded" || !result.output) throw new Error("LTX returned no reviewable output");
    const assetKey = await rehostOutput(result.output.sourceUrl, "video", claim.job, 1);
    await recordCandidate(convex, serviceToken, claim.job, triggerRunId, 1, assetKey, "video");
    return;
  }
  throw new Error("LTX render polling timed out");
}

export const generateCreatorPromotion = task({
  id: "generate-creator-promotion",
  maxDuration: 900,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const jobId = requiredJobId(payload.creatorRenderJobId);
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    let claim: ClaimedJob | undefined;

    try {
      claim = asClaimedJob(await convex.action(api.creatorPromotionsGateway.claimCreatorRenderJob, {
        serviceToken,
        payload: { jobId, triggerRunId: ctx.run.id },
      }));
      const content = approvedContent(claim.requestSnapshot, claim.job.provider);
      if (claim.job.provider === "novita") {
        await runNovita(convex, serviceToken, claim, content, ctx.run.id);
      } else if (claim.job.provider === "ltx") {
        await runLtx(convex, serviceToken, claim, content, ctx.run.id);
      } else {
        await runFalZImageTurboLoRA(convex, serviceToken, claim, content, ctx.run.id);
      }
      logger.log("creator render candidates are ready for operator review", { creatorRenderJobId: claim.job.id, provider: claim.job.provider });
    } catch (error) {
      const message = error instanceof Error ? error.message : "creator renderer failed";
      if (claim) {
        await convex.action(api.creatorPromotionsGateway.failCreatorRenderJob, {
          serviceToken,
          payload: { jobId: claim.job.id, triggerRunId: ctx.run.id, error: message.slice(0, 2_000) },
        }).catch((recordError) => logger.error("could not record creator render failure", { creatorRenderJobId: claim?.job.id, error: recordError instanceof Error ? recordError.message : String(recordError) }));
      }
      throw new AbortTaskRunError(message);
    }
  },
});
