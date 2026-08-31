import { z } from "zod";

/**
 * Official Fal boundaries for Creator Promotion LoRA training.
 *
 * This module is intentionally transport-only: it describes the documented
 * queue protocol but never reads a key, resolves a vault value, or performs a
 * network request. A server-only Trigger worker owns all of those effects.
 *
 * Fal documentation, verified 2026-08-14:
 * - trainer: `fal-ai/z-image-trainer`
 * - inference with resulting weights: `fal-ai/z-image/turbo/lora`
 * - queue endpoint: `https://queue.fal.run/fal-ai/z-image-trainer`
 */

export const FAL_Z_IMAGE_TRAINER_ENDPOINT_ID = "fal-ai/z-image-trainer" as const;
export const FAL_Z_IMAGE_TURBO_LORA_ENDPOINT_ID = "fal-ai/z-image/turbo/lora" as const;
export const FAL_Z_IMAGE_TURBO_BASE_MODEL = "z-image-turbo" as const;
export const FAL_Z_IMAGE_TRAINER_QUEUE_URL = `https://queue.fal.run/${FAL_Z_IMAGE_TRAINER_ENDPOINT_ID}` as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_URL_LENGTH = 8_192;

const HttpsUrlSchema = z
  .string()
  .url()
  .max(MAX_URL_LENGTH)
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an HTTPS URL" });
      }
      if (url.username || url.password) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "URLs must not embed credentials" });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a valid HTTPS URL" });
    }
  });

const QueueRequestIdSchema = z.string().trim().min(3).max(240).regex(SAFE_ID, "Expected a safe Fal request id");
const ObjectKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .superRefine((value, context) => {
    if (value.includes("..") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Object key is unsafe" });
    }
  });

export const FalZImageTrainingTypeSchema = z.enum(["content", "style", "balanced"]);
export type FalZImageTrainingType = z.infer<typeof FalZImageTrainingTypeSchema>;

/** Immutable source entry from the backend's reviewed dataset manifest. */
export const FrozenLoRATrainingAssetSchema = z
  .object({
    key: ObjectKeySchema,
    digest: z.string().regex(SHA256, "Expected a SHA-256 digest"),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    /** A per-image caption becomes `ROOT.txt` beside that image in the ZIP. */
    caption: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();
export type FrozenLoRATrainingAsset = z.infer<typeof FrozenLoRATrainingAssetSchema>;

/**
 * This is the immutable work order supplied by the trusted Convex claim.
 * `baseModel` is intentionally an internal invariant, not an unknown field
 * sent to Fal: the official trainer endpoint is already Z-Image Turbo native.
 */
export const FrozenZImageTurboLoRATrainingJobSchema = z
  .object({
    id: z.string().trim().min(3).max(240).regex(SAFE_ID, "Expected a safe job id"),
    baseModel: z.literal(FAL_Z_IMAGE_TURBO_BASE_MODEL),
    datasetManifestDigest: z.string().regex(SHA256, "Expected a dataset manifest SHA-256 digest"),
    triggerWord: z.string().trim().min(1).max(200),
    defaultCaption: z.string().trim().min(1).max(1_000),
    steps: z.number().int().min(100).max(10_000).multipleOf(100),
    learningRate: z.number().finite().gt(0).lte(1),
    trainingType: FalZImageTrainingTypeSchema,
    /** Immutable claim idempotency key; never reuse it across an attempted run. */
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();
export type FrozenZImageTurboLoRATrainingJob = z.infer<typeof FrozenZImageTurboLoRATrainingJobSchema>;

export const FalZImageTrainerQueueRequestSchema = z
  .object({
    /** An expiring server-created URL for a ZIP built from the frozen manifest. */
    imageDataUrl: HttpsUrlSchema,
    steps: z.number().int().min(100).max(10_000).multipleOf(100),
    learningRate: z.number().finite().gt(0).lte(1),
    defaultCaption: z.string().trim().min(1).max(1_000),
    trainingType: FalZImageTrainingTypeSchema,
  })
  .strict();
export type FalZImageTrainerQueueRequest = z.infer<typeof FalZImageTrainerQueueRequestSchema>;

export const FalZImageTrainerSubmitDescriptorSchema = z
  .object({
    endpointId: z.literal(FAL_Z_IMAGE_TRAINER_ENDPOINT_ID),
    url: z.literal(FAL_Z_IMAGE_TRAINER_QUEUE_URL),
    method: z.literal("POST"),
    /** The executor resolves `FAL_KEY` only in its server-only process. */
    authorization: z.object({ scheme: z.literal("Key"), source: z.literal("server_vault:FAL_KEY") }).strict(),
    headers: z.object({ contentType: z.literal("application/json"), storeIo: z.literal("0") }).strict(),
    payload: z
      .object({
        image_data_url: HttpsUrlSchema,
        steps: z.number().int().min(100).max(10_000).multipleOf(100),
        learning_rate: z.number().finite().gt(0).lte(1),
        default_caption: z.string().trim().min(1).max(1_000),
        training_type: FalZImageTrainingTypeSchema,
      })
      .strict(),
    audit: z
      .object({
        baseModel: z.literal(FAL_Z_IMAGE_TURBO_BASE_MODEL),
        idempotencyKey: z.string().trim().min(16).max(200),
        executable: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type FalZImageTrainerSubmitDescriptor = z.infer<typeof FalZImageTrainerSubmitDescriptorSchema>;

/** Builds the exact documented queue payload, without dispatching it. */
export function buildFalZImageTrainerSubmitDescriptor(
  job: FrozenZImageTurboLoRATrainingJob,
  request: FalZImageTrainerQueueRequest,
): FalZImageTrainerSubmitDescriptor {
  const frozen = FrozenZImageTurboLoRATrainingJobSchema.parse(job);
  const parsed = FalZImageTrainerQueueRequestSchema.parse(request);
  if (
    frozen.steps !== parsed.steps ||
    frozen.learningRate !== parsed.learningRate ||
    frozen.defaultCaption !== parsed.defaultCaption ||
    frozen.trainingType !== parsed.trainingType
  ) {
    throw new Error("Fal LoRA request no longer matches its immutable claimed training job");
  }
  return FalZImageTrainerSubmitDescriptorSchema.parse({
    endpointId: FAL_Z_IMAGE_TRAINER_ENDPOINT_ID,
    url: FAL_Z_IMAGE_TRAINER_QUEUE_URL,
    method: "POST",
    authorization: { scheme: "Key", source: "server_vault:FAL_KEY" },
    headers: { contentType: "application/json", storeIo: "0" },
    payload: {
      image_data_url: parsed.imageDataUrl,
      steps: parsed.steps,
      learning_rate: parsed.learningRate,
      default_caption: parsed.defaultCaption,
      training_type: parsed.trainingType,
    },
    audit: { baseModel: FAL_Z_IMAGE_TURBO_BASE_MODEL, idempotencyKey: frozen.idempotencyKey, executable: false },
  });
}

const FalQueueUrlSchema = HttpsUrlSchema.superRefine((value, context) => {
  const url = new URL(value);
  const expectedPrefix = `/${FAL_Z_IMAGE_TRAINER_ENDPOINT_ID}/requests/`;
  if (url.hostname !== "queue.fal.run" || !url.pathname.startsWith(expectedPrefix)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Queue URL is outside the approved Fal trainer endpoint" });
  }
});

export const FalZImageTrainerQueuedRequestSchema = z
  .object({
    requestId: QueueRequestIdSchema,
    statusUrl: FalQueueUrlSchema,
    responseUrl: FalQueueUrlSchema,
  })
  .strict();
export type FalZImageTrainerQueuedRequest = z.infer<typeof FalZImageTrainerQueuedRequestSchema>;

/** Parses a raw Fal queue-submit response after the executor receives it. */
export function parseFalZImageTrainerQueueSubmit(value: unknown): FalZImageTrainerQueuedRequest {
  const raw = z
    .object({
      request_id: QueueRequestIdSchema,
      status_url: HttpsUrlSchema,
      response_url: HttpsUrlSchema,
    })
    .passthrough()
    .parse(value);
  return FalZImageTrainerQueuedRequestSchema.parse({
    requestId: raw.request_id,
    statusUrl: raw.status_url,
    responseUrl: raw.response_url,
  });
}

export const FalZImageTrainerQueueStatusSchema = z.enum(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]);
export type FalZImageTrainerQueueStatus = z.infer<typeof FalZImageTrainerQueueStatusSchema>;

export const FalZImageTrainerPollResultSchema = z
  .object({
    status: FalZImageTrainerQueueStatusSchema,
    requestId: QueueRequestIdSchema,
  })
  .strict();
export type FalZImageTrainerPollResult = z.infer<typeof FalZImageTrainerPollResultSchema>;

/** Parses status without treating unknown provider states as success. */
export function parseFalZImageTrainerQueueStatus(value: unknown, expectedRequestId: string): FalZImageTrainerPollResult {
  const raw = z
    .object({ status: z.string(), request_id: QueueRequestIdSchema })
    .passthrough()
    .parse(value);
  if (raw.request_id !== expectedRequestId) throw new Error("Fal queue status request id mismatch");
  return FalZImageTrainerPollResultSchema.parse({ status: raw.status, requestId: raw.request_id });
}

const FalOutputFileSchema = z
  .object({
    url: HttpsUrlSchema,
    content_type: z.string().trim().min(1).max(200).optional(),
    file_name: z.string().trim().min(1).max(300).optional(),
    file_size: z.number().int().positive().max(2 * 1024 * 1024 * 1024).optional(),
  })
  .strict();

export const FalZImageTrainerOutputSchema = z
  .object({
    diffusersLoraUrl: HttpsUrlSchema,
    configUrl: HttpsUrlSchema,
  })
  .strict();
export type FalZImageTrainerOutput = z.infer<typeof FalZImageTrainerOutputSchema>;

/** Extracts only the two documented trainer artifacts from a completed response. */
export function parseFalZImageTrainerOutput(value: unknown): FalZImageTrainerOutput {
  const raw = z
    .object({
      diffusers_lora_file: FalOutputFileSchema,
      config_file: FalOutputFileSchema,
    })
    .passthrough()
    .parse(value);
  return FalZImageTrainerOutputSchema.parse({
    diffusersLoraUrl: raw.diffusers_lora_file.url,
    configUrl: raw.config_file.url,
  });
}

/**
 * Strict, non-executing descriptor for applying a completed Creator LoRA to
 * Fal's native Z-Image Turbo LoRA inference endpoint. The approved Creator
 * Promotion worker resolves the short-lived controlled weight URL just in
 * time, adds Key auth server-side, and rehosts its outputs before review.
 */
export const FalZImageTurboLoRAInferenceRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(4_000),
    loraPath: HttpsUrlSchema,
    /** Fal documents up to three LoRAs; Creator uses one identity LoRA here. */
    scale: z.number().finite().min(0).max(2).default(0.8),
    imageSize: z.enum(["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]),
    numInferenceSteps: z.number().int().min(1).max(8).default(8),
    numImages: z.number().int().min(1).max(4).default(1),
    outputFormat: z.enum(["jpeg", "png", "webp"]).default("png"),
    acceleration: z.enum(["none", "regular", "high"]).default("regular"),
    seed: z.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
  })
  .strict();
export type FalZImageTurboLoRAInferenceRequest = z.infer<typeof FalZImageTurboLoRAInferenceRequestSchema>;

export const FalZImageTurboLoRAInferenceDescriptorSchema = z
  .object({
    endpointId: z.literal(FAL_Z_IMAGE_TURBO_LORA_ENDPOINT_ID),
    url: z.literal("https://fal.run/fal-ai/z-image/turbo/lora"),
    method: z.literal("POST"),
    authorization: z.object({ scheme: z.literal("Key"), source: z.literal("server_vault:FAL_KEY") }).strict(),
    payload: z
      .object({
        prompt: z.string().trim().min(1).max(4_000),
        image_size: z.enum(["square_hd", "square", "portrait_4_3", "portrait_16_9", "landscape_4_3", "landscape_16_9"]),
        num_inference_steps: z.number().int().min(1).max(8),
        sync_mode: z.literal(false),
        num_images: z.number().int().min(1).max(4),
        enable_safety_checker: z.literal(true),
        output_format: z.enum(["jpeg", "png", "webp"]),
        acceleration: z.enum(["none", "regular", "high"]),
        enable_prompt_expansion: z.literal(false),
        loras: z.array(z.object({ path: HttpsUrlSchema, scale: z.number().finite().min(0).max(2) }).strict()).length(1),
        seed: z.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
      })
      .strict(),
    audit: z.object({ baseModel: z.literal(FAL_Z_IMAGE_TURBO_BASE_MODEL), executable: z.literal(false) }).strict(),
  })
  .strict();
export type FalZImageTurboLoRAInferenceDescriptor = z.infer<typeof FalZImageTurboLoRAInferenceDescriptorSchema>;

export function buildFalZImageTurboLoRAInferenceDescriptor(
  request: FalZImageTurboLoRAInferenceRequest,
): FalZImageTurboLoRAInferenceDescriptor {
  const parsed = FalZImageTurboLoRAInferenceRequestSchema.parse(request);
  return FalZImageTurboLoRAInferenceDescriptorSchema.parse({
    endpointId: FAL_Z_IMAGE_TURBO_LORA_ENDPOINT_ID,
    url: "https://fal.run/fal-ai/z-image/turbo/lora",
    method: "POST",
    authorization: { scheme: "Key", source: "server_vault:FAL_KEY" },
    payload: {
      prompt: parsed.prompt,
      image_size: parsed.imageSize,
      num_inference_steps: parsed.numInferenceSteps,
      sync_mode: false,
      num_images: parsed.numImages,
      enable_safety_checker: true,
      output_format: parsed.outputFormat,
      acceleration: parsed.acceleration,
      enable_prompt_expansion: false,
      loras: [{ path: parsed.loraPath, scale: parsed.scale }],
      ...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
    },
    audit: { baseModel: FAL_Z_IMAGE_TURBO_BASE_MODEL, executable: false },
  });
}

/** Configuration is an explicit production gate; a missing gate is never permissive. */
export function isFalZImageTrainerDispatchEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.CREATOR_LORA_TRAINING_ENABLED === "true";
}
