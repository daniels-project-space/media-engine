import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import sharp from "sharp";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { creativeServiceToken } from "../lib/creative-service";
import { generateCreatorImage, readVerifiedCreatorImage } from "../lib/render-engine-creator-image";
import { presignedGet } from "../lib/storage";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

type Payload = { creatorRenderJobId: string };
type Provider = "render_engine" | "novita" | "ltx" | "fal_z_image_turbo_lora";
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
};

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

function asClaimedJob(value: unknown): ClaimedJob {
  const result = asRecord(value, "creator render claim");
  const job = asRecord(result.job, "creator render claim job");
  const provider = job.provider;
  const id = job.id;
  const attemptNumber = job.attemptNumber;
  const requestHash = job.requestHash;
  if (
    (provider !== "render_engine" && provider !== "novita" && provider !== "ltx" && provider !== "fal_z_image_turbo_lora") ||
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
  if (promptSnapshot.loraSnapshot !== undefined) {
    throw new Error("approved creator LoRA profile is unsupported by Render Engine");
  }
  return {
    provider: expectedProvider,
    prompt: asText(promptSnapshot.prompt, "approved render prompt", 4_000)!,
    promptLock: asText(promptSnapshot.promptLock, "approved prompt lock", 4_000, false),
    promptStyle: asText(promptSnapshot.promptStyle, "approved prompt style", 2_000, false),
    referenceNotes: asText(promptSnapshot.referenceNotes, "approved reference notes", 2_000, false),
    format: asText(content.format, "approved content format", 40)!,
    referenceAssetKeys,
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

async function sourceImage(key: string): Promise<{ mimeType: "image/png" | "image/jpeg" | "image/webp"; base64: string }> {
  const response = await fetch(await presignedGet(key, 15 * 60));
  if (!response.ok) throw new Error(`approved reference returned HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp") {
    throw new Error("approved reference is not a supported image");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 2_500_000) throw new Error("approved reference exceeds Render Engine input limit");
  return { mimeType, base64: bytes.toString("base64") };
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

async function runRenderEngine(
  convex: ConvexHttpClient,
  serviceToken: string,
  claim: ClaimedJob,
  content: ApprovedContent,
  triggerRunId: string,
): Promise<void> {
  if (!["image", "carousel", "story"].includes(content.format)) {
    throw new Error("Render Engine image route cannot execute this approved video or text format");
  }
  const references = await Promise.all(content.referenceAssetKeys.map(sourceImage));
  if (references.reduce((total, reference) => total + reference.base64.length, 0) > 3_700_000) {
    throw new Error("approved references exceed the Render Engine project API limit");
  }
  const receipt = await generateCreatorImage({
    idempotencyKey: `creator-image:${claim.job.id}:${claim.job.attemptNumber}:${claim.job.requestHash.slice(0, 16)}`,
    prompt: safePrompt(content),
    aspectRatio: content.format === "story" ? "9:16" : "4:5",
    referenceImages: references,
  });
  // The engine has already stored and hashed this output in Media Engine R2.
  // Verify it independently before making the object reviewable in Convex.
  const bytes = await readVerifiedCreatorImage(receipt);
  const metadata = await sharp(bytes).metadata();
  const ratio = content.format === "story" ? 9 / 16 : 4 / 5;
  const decodedType = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
  if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) < 1_900 ||
      Math.abs(metadata.width / metadata.height - ratio) > 0.08 || decodedType !== receipt.output.contentType) {
    throw new Error("Render Engine image failed Final decode, dimension, or aspect-ratio verification");
  }
  await recordCandidate(convex, serviceToken, claim.job, triggerRunId, 1, receipt.output.key, "image");
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
      if (claim.job.provider !== "render_engine") {
        throw new Error(`Legacy ${claim.job.provider} render route is retired; approve a new Render Engine content revision`);
      }
      await runRenderEngine(convex, serviceToken, claim, content, ctx.run.id);
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
