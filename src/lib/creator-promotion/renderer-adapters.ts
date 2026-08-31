import { z } from "zod";

import {
  CreatorRendererProviderSchema,
  FAL_Z_IMAGE_TURBO_LORA_RENDERER_CONFIG_KEYS,
  LTX_RENDERER_CONFIG_KEYS,
  NOVITA_RENDERER_CONFIG_KEYS,
  OFFICIAL_CREATOR_RENDERER_ENDPOINTS,
  type CreatorRendererProvider,
  type RendererEnvironment,
} from "./renderer-contracts";

/**
 * Server-only transport descriptions for the Creator Promotion render outbox.
 *
 * This file intentionally has no fetch implementation, no credential resolver,
 * and no side-effecting dispatcher. It turns an already-approved render intent
 * plus server-resolved input into a strict provider request description. A
 * separate audited worker must perform final approval, budget, and provenance
 * checks before it adds Authorization and actually sends either request.
 *
 * Do not import this module from a Client Component. It accepts short-lived
 * asset URLs and base64 only inside a Node.js server process, and never returns
 * credentials in its descriptors or normalized results.
 */

const OpaqueIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Expected a safe provider identifier");
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");
const Base64Schema = z
  .string()
  .min(4)
  .max(24 * 1024 * 1024)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Expected raw base64 without a data URL prefix");

const HttpsUrlSchema = z
  .string()
  .url()
  .max(8_192)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provider media URLs must use HTTPS" });
      }
      if (url.username || url.password) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provider media URLs cannot embed credentials" });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a valid HTTPS URL" });
    }
  });

export const CREATOR_RENDERER_ADAPTER_CONFIG_KEYS = Object.freeze({
  novita: NOVITA_RENDERER_CONFIG_KEYS,
  ltx: LTX_RENDERER_CONFIG_KEYS,
  fal_z_image_turbo_lora: FAL_Z_IMAGE_TURBO_LORA_RENDERER_CONFIG_KEYS,
} as const);

export const CreatorRendererAdapterConfigurationStatusSchema = z.enum([
  "ready",
  "not_configured",
  "misconfigured",
]);
export type CreatorRendererAdapterConfigurationStatus = z.infer<
  typeof CreatorRendererAdapterConfigurationStatusSchema
>;

/** Secret-safe readiness only; no token or source URL is ever returned. */
export const CreatorRendererAdapterConfigurationSchema = z
  .object({
    provider: CreatorRendererProviderSchema,
    status: CreatorRendererAdapterConfigurationStatusSchema,
    nodeServerRuntime: z.boolean(),
    canBuildTransportDescriptors: z.boolean(),
    missing: z.array(z.string()).readonly(),
    invalid: z.array(z.string()).readonly(),
    notes: z.array(z.string()).readonly(),
  })
  .strict();
export type CreatorRendererAdapterConfiguration = z.infer<
  typeof CreatorRendererAdapterConfigurationSchema
>;

export type CreatorRendererAdapterOptions = Readonly<{
  /** Use only from a server-side test or worker. Never pass this through HTTP. */
  environment?: RendererEnvironment;
}>;

/**
 * Checks only server-side implementation identifiers. The API token itself
 * belongs in the configured resolver/vault and never enters this module.
 */
export function checkCreatorRendererAdapterConfiguration(
  provider: CreatorRendererProvider,
  options: CreatorRendererAdapterOptions = {},
): CreatorRendererAdapterConfiguration {
  const environment = options.environment ?? defaultEnvironment();
  const requiredKeys = CREATOR_RENDERER_ADAPTER_CONFIG_KEYS[provider];
  const missing: string[] = requiredKeys.filter((key) => !valueOf(environment, key));
  const invalid: string[] = [];

  for (const key of requiredKeys) {
    const value = valueOf(environment, key);
    if (value && !isOpaqueServerImplementationId(value)) {
      invalid.push(`${key} must be an opaque server-only implementation identifier`);
    }
  }

  const nodeServerRuntime = isNodeServerRuntime();
  if (!nodeServerRuntime) {
    missing.push("a Node.js server runtime");
  }

  const status: CreatorRendererAdapterConfigurationStatus = invalid.length > 0
    ? "misconfigured"
    : missing.length > 0
      ? "not_configured"
      : "ready";

  return CreatorRendererAdapterConfigurationSchema.parse({
    provider,
    status,
    nodeServerRuntime,
    canBuildTransportDescriptors: status === "ready",
    missing,
    invalid,
    notes: [
      "No API token is read, returned, or embedded in an adapter descriptor.",
      "Descriptors are non-executable; only a separate audited server worker may dispatch them.",
      "Provider output must be rehosted and independently safety-reviewed before selection or publishing.",
    ],
  });
}

export function checkNovitaRendererAdapterConfiguration(
  options: CreatorRendererAdapterOptions = {},
): CreatorRendererAdapterConfiguration {
  return checkCreatorRendererAdapterConfiguration("novita", options);
}

export function checkLtxRendererAdapterConfiguration(
  options: CreatorRendererAdapterOptions = {},
): CreatorRendererAdapterConfiguration {
  return checkCreatorRendererAdapterConfiguration("ltx", options);
}

/**
 * Fal's native Z-Image Turbo LoRA descriptor is defined separately because it
 * uses Key auth and a server-resolved model artifact rather than a source
 * image. This keeps the adapter health gate equivalent to Novita/LTX without
 * ever exposing the Fal key to a browser or a descriptor.
 */
export function checkFalZImageTurboLoRARendererAdapterConfiguration(
  options: CreatorRendererAdapterOptions = {},
): CreatorRendererAdapterConfiguration {
  return checkCreatorRendererAdapterConfiguration("fal_z_image_turbo_lora", options);
}

/** A source resolver produces these only inside the future server worker. */
export const ServerResolvedBase64ImageSchema = z
  .object({
    assetId: OpaqueIdSchema,
    contentDigest: Sha256DigestSchema,
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    /** Raw content only, with no `data:` prefix. Do not log this value. */
    base64: Base64Schema,
  })
  .strict();
export type ServerResolvedBase64Image = z.infer<typeof ServerResolvedBase64ImageSchema>;

/** Short-lived source URLs are accepted only on the server and must be re-resolved for retries. */
export const ServerResolvedImageUriSchema = z
  .object({
    assetId: OpaqueIdSchema,
    contentDigest: Sha256DigestSchema,
    mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    uri: HttpsUrlSchema,
    expiresAt: IsoDateTimeSchema.optional(),
  })
  .strict();
export type ServerResolvedImageUri = z.infer<typeof ServerResolvedImageUriSchema>;

const AuthorizationRequirementSchema = z
  .object({
    scheme: z.literal("Bearer"),
    source: z.literal("server_token_resolver"),
  })
  .strict();

const ProviderRequestHeadersSchema = z
  .object({
    contentType: z.literal("application/json"),
    authorization: AuthorizationRequirementSchema,
  })
  .strict();

const DescriptorAuditSchema = z
  .object({
    actionId: OpaqueIdSchema,
    idempotencyKey: z.string().trim().min(16).max(200),
    contentDigest: Sha256DigestSchema,
    executable: z.literal(false),
  })
  .strict();

export const NovitaGenerationControlsSchema = z
  .object({
    /** Explicit, catalog-validated settings; this adapter applies no provider defaults. */
    steps: z.number().int().min(1).max(150),
    guidanceScale: z.number().finite().min(0).max(30),
    samplerName: z.string().trim().min(1).max(160),
    clipSkip: z.number().int().min(1).max(12).optional(),
    /** Required for image-to-image only. */
    imageStrength: z.number().finite().gt(0).lte(1).optional(),
  })
  .strict();
export type NovitaGenerationControls = z.infer<typeof NovitaGenerationControlsSchema>;

export const NovitaAsyncSubmitPayloadSchema = z
  .object({
    extra: z
      .object({
        response_image_type: z.enum(["png", "webp", "jpeg"]),
        enable_nsfw_detection: z.literal(true),
        /** Conservative provider check; independent post-render review remains mandatory. */
        nsfw_detection_level: z.literal(2),
      })
      .strict(),
    request: z
      .object({
        model_name: z.string().trim().min(1).max(160),
        prompt: z.string().trim().min(1).max(4_000),
        negative_prompt: z.string().trim().max(2_000).optional(),
        width: z.number().int().min(128).max(2_048),
        height: z.number().int().min(128).max(2_048),
        image_num: z.number().int().min(1).max(4),
        steps: z.number().int().min(1).max(150),
        guidance_scale: z.number().finite().min(0).max(30),
        sampler_name: z.string().trim().min(1).max(160),
        clip_skip: z.number().int().min(1).max(12).optional(),
        seed: z.number().int().min(-1).max(2_147_483_647).optional(),
        image_base64: Base64Schema.optional(),
        strength: z.number().finite().gt(0).lte(1).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasImage = Boolean(value.request.image_base64);
    const hasStrength = value.request.strength !== undefined;
    if (hasImage !== hasStrength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["request"],
        message: "Novita image-to-image requires both image_base64 and strength",
      });
    }
  });
export type NovitaAsyncSubmitPayload = z.infer<typeof NovitaAsyncSubmitPayloadSchema>;

export const NovitaAsyncSubmitDescriptorSchema = z
  .object({
    ...DescriptorAuditSchema.shape,
    provider: z.literal("novita"),
    kind: z.literal("submit"),
    method: z.literal("POST"),
    url: z.union([
      z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitTextToImage),
      z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitImageToImage),
    ]),
    headers: ProviderRequestHeadersSchema,
    payload: NovitaAsyncSubmitPayloadSchema,
    requiresFinalApprovalVerification: z.literal(true),
    requiresSourceProvenanceVerification: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const imageToImage = value.url === OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitImageToImage;
    const hasImage = Boolean(value.payload.request.image_base64);
    if (imageToImage !== hasImage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["url"],
        message: "Novita endpoint does not match the generated request payload",
      });
    }
  });
export type NovitaAsyncSubmitDescriptor = z.infer<typeof NovitaAsyncSubmitDescriptorSchema>;

export const NovitaTaskPollDescriptorSchema = z
  .object({
    provider: z.literal("novita"),
    kind: z.literal("poll"),
    method: z.literal("GET"),
    url: HttpsUrlSchema,
    taskId: OpaqueIdSchema,
    headers: z
      .object({
        authorization: AuthorizationRequirementSchema,
      })
      .strict(),
    executable: z.literal(false),
  })
  .strict();
export type NovitaTaskPollDescriptor = z.infer<typeof NovitaTaskPollDescriptorSchema>;

/** Current LTX 2.3 image-to-video contract; older 2/2.5 names are not remapped. */
export const LtxCurrentImageToVideoModelSchema = z.enum(["ltx-2-3-fast", "ltx-2-3-pro"]);
export type LtxCurrentImageToVideoModel = z.infer<typeof LtxCurrentImageToVideoModelSchema>;

const LtxResolutionSchema = z.enum([
  "1920x1080",
  "1080x1920",
  "2560x1440",
  "1440x2560",
  "3840x2160",
  "2160x3840",
]);
const LtxFpsSchema = z.union([z.literal(24), z.literal(25), z.literal(48), z.literal(50)]);
const LtxDurationSchema = z.union([
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(14),
  z.literal(16),
  z.literal(18),
  z.literal(20),
]);

export const LtxAsyncImageToVideoPayloadSchema = z
  .object({
    image_uri: HttpsUrlSchema,
    prompt: z.string().trim().min(1).max(5_000),
    model: LtxCurrentImageToVideoModelSchema,
    duration: LtxDurationSchema,
    resolution: LtxResolutionSchema,
    fps: LtxFpsSchema,
    generate_audio: z.literal(false),
    last_frame_uri: HttpsUrlSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const is1080 = value.resolution === "1920x1080" || value.resolution === "1080x1920";
    const shortDuration = value.duration === 6 || value.duration === 8 || value.duration === 10;
    if (value.model === "ltx-2-3-pro" && !shortDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duration"],
        message: "LTX 2.3 Pro supports 6, 8, or 10 second image-to-video requests",
      });
    }
    if (value.model === "ltx-2-3-fast" && (!is1080 || (value.fps !== 24 && value.fps !== 25)) && !shortDuration) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["duration"],
        message: "Long LTX 2.3 Fast durations require 1080p at 24 or 25 fps",
      });
    }
  });
export type LtxAsyncImageToVideoPayload = z.infer<typeof LtxAsyncImageToVideoPayloadSchema>;

export const LtxAsyncImageToVideoSubmitDescriptorSchema = z
  .object({
    ...DescriptorAuditSchema.shape,
    provider: z.literal("ltx"),
    kind: z.literal("submit"),
    method: z.literal("POST"),
    url: z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.submitImageToVideo),
    headers: ProviderRequestHeadersSchema,
    payload: LtxAsyncImageToVideoPayloadSchema,
    requiresFinalApprovalVerification: z.literal(true),
    requiresSourceProvenanceVerification: z.literal(true),
  })
  .strict();
export type LtxAsyncImageToVideoSubmitDescriptor = z.infer<
  typeof LtxAsyncImageToVideoSubmitDescriptorSchema
>;

export const LtxJobPollDescriptorSchema = z
  .object({
    provider: z.literal("ltx"),
    kind: z.literal("poll"),
    method: z.literal("GET"),
    url: HttpsUrlSchema,
    jobId: OpaqueIdSchema,
    endpoint: z.literal("image-to-video"),
    headers: z
      .object({
        authorization: AuthorizationRequirementSchema,
      })
      .strict(),
    executable: z.literal(false),
  })
  .strict();
export type LtxJobPollDescriptor = z.infer<typeof LtxJobPollDescriptorSchema>;

export const RendererAdapterBuildFailureSchema = z
  .object({
    status: z.enum(["not_configured", "misconfigured", "invalid_request"]),
    provider: CreatorRendererProviderSchema,
    missing: z.array(z.string()).readonly(),
    invalid: z.array(z.string()).readonly(),
    errors: z.array(z.string()).readonly(),
  })
  .strict();
export type RendererAdapterBuildFailure = z.infer<typeof RendererAdapterBuildFailureSchema>;

export type NovitaAsyncSubmitBuildResult =
  | { status: "ready"; descriptor: NovitaAsyncSubmitDescriptor }
  | RendererAdapterBuildFailure;
export type LtxAsyncSubmitBuildResult =
  | { status: "ready"; descriptor: LtxAsyncImageToVideoSubmitDescriptor }
  | RendererAdapterBuildFailure;
export type NovitaTaskPollBuildResult =
  | { status: "ready"; descriptor: NovitaTaskPollDescriptor }
  | RendererAdapterBuildFailure;
export type LtxJobPollBuildResult =
  | { status: "ready"; descriptor: LtxJobPollDescriptor }
  | RendererAdapterBuildFailure;

export const NovitaSubmitBuildInputSchema = z
  .object({
    audit: DescriptorAuditSchema,
    operation: z.enum(["text_to_image", "image_to_image"]),
    modelName: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(4_000),
    negativePrompt: z.string().trim().max(2_000).optional(),
    width: z.number().int().min(128).max(2_048),
    height: z.number().int().min(128).max(2_048),
    imageCount: z.number().int().min(1).max(4),
    seed: z.number().int().min(-1).max(2_147_483_647).optional(),
    outputFormat: z.enum(["png", "webp", "jpeg"]),
    controls: NovitaGenerationControlsSchema,
    sourceAsset: ServerResolvedBase64ImageSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasSource = Boolean(value.sourceAsset);
    const hasStrength = value.controls.imageStrength !== undefined;
    if (value.operation === "image_to_image" && (!hasSource || !hasStrength)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceAsset"],
        message: "Image-to-image requires a server-resolved source and explicit image strength",
      });
    }
    if (value.operation === "text_to_image" && (hasSource || hasStrength)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceAsset"],
        message: "Text-to-image cannot carry an image-to-image source or strength",
      });
    }
  });
export type NovitaSubmitBuildInput = z.infer<typeof NovitaSubmitBuildInputSchema>;

/**
 * Builds a transport description for Novita's documented v3 async txt2img or
 * img2img endpoints. It returns `not_configured` rather than a descriptor when
 * the server-only resolver/dispatcher identifiers have not been provisioned.
 */
export function buildNovitaAsyncSubmitDescriptor(
  input: unknown,
  options: CreatorRendererAdapterOptions = {},
): NovitaAsyncSubmitBuildResult {
  const configuration = checkNovitaRendererAdapterConfiguration(options);
  if (configuration.status !== "ready") return configurationFailure(configuration);

  const parsed = NovitaSubmitBuildInputSchema.safeParse(input);
  if (!parsed.success) return invalidInputFailure("novita", parsed.error.issues.map((issue) => issue.message));
  const value = parsed.data;
  const imageToImage = value.operation === "image_to_image";

  return {
    status: "ready",
    descriptor: NovitaAsyncSubmitDescriptorSchema.parse({
      ...value.audit,
      provider: "novita",
      kind: "submit",
      method: "POST",
      url: imageToImage
        ? OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitImageToImage
        : OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitTextToImage,
      headers: standardProviderHeaders(),
      payload: {
        extra: {
          response_image_type: value.outputFormat,
          enable_nsfw_detection: true,
          nsfw_detection_level: 2,
        },
        request: {
          model_name: value.modelName,
          prompt: value.prompt,
          negative_prompt: value.negativePrompt,
          width: value.width,
          height: value.height,
          image_num: value.imageCount,
          steps: value.controls.steps,
          guidance_scale: value.controls.guidanceScale,
          sampler_name: value.controls.samplerName,
          clip_skip: value.controls.clipSkip,
          seed: value.seed,
          image_base64: value.sourceAsset?.base64,
          strength: value.controls.imageStrength,
        },
      },
      requiresFinalApprovalVerification: true,
      requiresSourceProvenanceVerification: true,
    }),
  };
}

export const LtxSubmitBuildInputSchema = z
  .object({
    audit: DescriptorAuditSchema,
    sourceAsset: ServerResolvedImageUriSchema,
    lastFrameAsset: ServerResolvedImageUriSchema.optional(),
    prompt: z.string().trim().min(1).max(5_000),
    model: LtxCurrentImageToVideoModelSchema,
    duration: LtxDurationSchema,
    resolution: LtxResolutionSchema,
    fps: LtxFpsSchema,
    generateAudio: z.literal(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.lastFrameAsset?.assetId === value.sourceAsset.assetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastFrameAsset"],
        message: "LTX final-frame input must be a distinct approved asset",
      });
    }
  });
export type LtxSubmitBuildInput = z.infer<typeof LtxSubmitBuildInputSchema>;

/** Builds LTX's official async v2/image-to-video payload without dispatching it. */
export function buildLtxAsyncImageToVideoSubmitDescriptor(
  input: unknown,
  options: CreatorRendererAdapterOptions = {},
): LtxAsyncSubmitBuildResult {
  const configuration = checkLtxRendererAdapterConfiguration(options);
  if (configuration.status !== "ready") return configurationFailure(configuration);

  const parsed = LtxSubmitBuildInputSchema.safeParse(input);
  if (!parsed.success) return invalidInputFailure("ltx", parsed.error.issues.map((issue) => issue.message));
  const value = parsed.data;

  return {
    status: "ready",
    descriptor: LtxAsyncImageToVideoSubmitDescriptorSchema.parse({
      ...value.audit,
      provider: "ltx",
      kind: "submit",
      method: "POST",
      url: OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.submitImageToVideo,
      headers: standardProviderHeaders(),
      payload: {
        image_uri: value.sourceAsset.uri,
        prompt: value.prompt,
        model: value.model,
        duration: value.duration,
        resolution: value.resolution,
        fps: value.fps,
        generate_audio: false,
        last_frame_uri: value.lastFrameAsset?.uri,
      },
      requiresFinalApprovalVerification: true,
      requiresSourceProvenanceVerification: true,
    }),
  };
}

/** Fixed-provider poll URL builders; no caller-controlled host is accepted. */
export function buildNovitaTaskResultUrl(taskId: unknown): string | null {
  const parsed = OpaqueIdSchema.safeParse(taskId);
  if (!parsed.success) return null;
  const url = new URL(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.pollTaskResult);
  url.searchParams.set("task_id", parsed.data);
  return url.toString();
}

export function buildLtxImageToVideoJobUrl(jobId: unknown): string | null {
  const parsed = OpaqueIdSchema.safeParse(jobId);
  if (!parsed.success) return null;
  return OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.pollImageToVideo.replace(
    "{jobId}",
    encodeURIComponent(parsed.data),
  );
}

export function buildNovitaTaskPollDescriptor(
  taskId: unknown,
  options: CreatorRendererAdapterOptions = {},
): NovitaTaskPollBuildResult {
  const configuration = checkNovitaRendererAdapterConfiguration(options);
  if (configuration.status !== "ready") return configurationFailure(configuration);
  const url = buildNovitaTaskResultUrl(taskId);
  const parsedTaskId = OpaqueIdSchema.safeParse(taskId);
  if (!url || !parsedTaskId.success) return invalidInputFailure("novita", ["A safe Novita task id is required"]);
  return {
    status: "ready",
    descriptor: NovitaTaskPollDescriptorSchema.parse({
      provider: "novita",
      kind: "poll",
      method: "GET",
      url,
      taskId: parsedTaskId.data,
      headers: { authorization: { scheme: "Bearer", source: "server_token_resolver" } },
      executable: false,
    }),
  };
}

export function buildLtxImageToVideoJobPollDescriptor(
  jobId: unknown,
  options: CreatorRendererAdapterOptions = {},
): LtxJobPollBuildResult {
  const configuration = checkLtxRendererAdapterConfiguration(options);
  if (configuration.status !== "ready") return configurationFailure(configuration);
  const url = buildLtxImageToVideoJobUrl(jobId);
  const parsedJobId = OpaqueIdSchema.safeParse(jobId);
  if (!url || !parsedJobId.success) return invalidInputFailure("ltx", ["A safe LTX job id is required"]);
  return {
    status: "ready",
    descriptor: LtxJobPollDescriptorSchema.parse({
      provider: "ltx",
      kind: "poll",
      method: "GET",
      url,
      jobId: parsedJobId.data,
      endpoint: "image-to-video",
      headers: { authorization: { scheme: "Bearer", source: "server_token_resolver" } },
      executable: false,
    }),
  };
}

/** Canonical accepted-task result; it is not a render success or a selectable asset. */
export const NovitaTaskAcceptedResultSchema = z
  .object({
    provider: z.literal("novita"),
    state: z.literal("accepted"),
    taskId: OpaqueIdSchema,
    pollUrl: HttpsUrlSchema,
    requiresImmediatePoll: z.literal(true),
  })
  .strict();
export type NovitaTaskAcceptedResult = z.infer<typeof NovitaTaskAcceptedResultSchema>;

export const LtxJobAcceptedResultSchema = z
  .object({
    provider: z.literal("ltx"),
    state: z.literal("accepted"),
    jobId: OpaqueIdSchema,
    createdAt: IsoDateTimeSchema.optional(),
    pollUrl: HttpsUrlSchema,
    requiresImmediatePoll: z.literal(true),
  })
  .strict();
export type LtxJobAcceptedResult = z.infer<typeof LtxJobAcceptedResultSchema>;

export const RendererProviderProtocolFailureSchema = z
  .object({
    provider: CreatorRendererProviderSchema,
    state: z.literal("invalid_provider_response"),
    jobId: OpaqueIdSchema,
    error: z.string().min(1).max(1_000),
  })
  .strict();
export type RendererProviderProtocolFailure = z.infer<typeof RendererProviderProtocolFailureSchema>;

const NovitaProviderProtocolFailureSchema = RendererProviderProtocolFailureSchema.extend({
  provider: z.literal("novita"),
});
const LtxProviderProtocolFailureSchema = RendererProviderProtocolFailureSchema.extend({
  provider: z.literal("ltx"),
});

/** Parses Novita's documented `{ task_id }` asynchronous submit response. */
export function normalizeNovitaAsyncSubmitResponse(
  response: unknown,
): NovitaTaskAcceptedResult | RendererProviderProtocolFailure {
  const parsed = z.object({ task_id: OpaqueIdSchema }).passthrough().safeParse(response);
  if (!parsed.success) return protocolFailure("novita", "unknown", "Novita submit response did not include a valid task_id");
  const pollUrl = buildNovitaTaskResultUrl(parsed.data.task_id);
  if (!pollUrl) return protocolFailure("novita", parsed.data.task_id, "Novita task_id could not form a safe poll URL");
  return NovitaTaskAcceptedResultSchema.parse({
    provider: "novita",
    state: "accepted",
    taskId: parsed.data.task_id,
    pollUrl,
    requiresImmediatePoll: true,
  });
}

/** Parses LTX's documented `{ id, created_at }` asynchronous submit response. */
export function normalizeLtxAsyncSubmitResponse(
  response: unknown,
): LtxJobAcceptedResult | RendererProviderProtocolFailure {
  const parsed = z
    .object({
      id: OpaqueIdSchema,
      created_at: IsoDateTimeSchema.optional(),
    })
    .passthrough()
    .safeParse(response);
  if (!parsed.success) return protocolFailure("ltx", "unknown", "LTX submit response did not include a valid job id");
  const pollUrl = buildLtxImageToVideoJobUrl(parsed.data.id);
  if (!pollUrl) return protocolFailure("ltx", parsed.data.id, "LTX job id could not form a safe poll URL");
  return LtxJobAcceptedResultSchema.parse({
    provider: "ltx",
    state: "accepted",
    jobId: parsed.data.id,
    createdAt: parsed.data.created_at,
    pollUrl,
    requiresImmediatePoll: true,
  });
}

const NovitaOutputSchema = z
  .object({
    kind: z.literal("image"),
    sourceUrl: HttpsUrlSchema,
    providerTtlSeconds: z.number().int().positive().optional(),
    requiresImmediateRehost: z.literal(true),
    requiresIndependentSafetyReview: z.literal(true),
    automaticSelectionEligible: z.literal(false),
  })
  .strict();

export const NovitaNormalizedTaskResultSchema = z.discriminatedUnion("state", [
  z
    .object({
      provider: z.literal("novita"),
      state: z.literal("pending"),
      taskId: OpaqueIdSchema,
      providerStatus: z.enum(["TASK_STATUS_QUEUED", "TASK_STATUS_PROCESSING"]),
      etaSeconds: z.number().int().nonnegative().optional(),
      progressPercent: z.number().min(0).max(100).optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("novita"),
      state: z.literal("succeeded"),
      taskId: OpaqueIdSchema,
      providerStatus: z.literal("TASK_STATUS_SUCCEED"),
      outputs: z.array(NovitaOutputSchema).min(1).max(4),
      providerReportedNsfwDetection: z.boolean(),
      requiresIndependentSafetyReview: z.literal(true),
      automaticSelectionEligible: z.literal(false),
    })
    .strict(),
  z
    .object({
      provider: z.literal("novita"),
      state: z.literal("failed"),
      taskId: OpaqueIdSchema,
      providerStatus: z.literal("TASK_STATUS_FAILED"),
      failureReason: z.string().min(1).max(1_000),
    })
    .strict(),
  NovitaProviderProtocolFailureSchema,
]);
export type NovitaNormalizedTaskResult = z.infer<typeof NovitaNormalizedTaskResultSchema>;

/**
 * Normalizes Novita's shared task-result response. Success only means the
 * provider exposed temporary output URLs; it never marks a candidate safe,
 * selected, stored, or ready to publish.
 */
export function normalizeNovitaTaskResult(
  expectedTaskId: unknown,
  response: unknown,
): NovitaNormalizedTaskResult {
  const expected = OpaqueIdSchema.safeParse(expectedTaskId);
  if (!expected.success) return novitaProtocolFailure("unknown", "Expected Novita task id is invalid");
  const parsed = z
    .object({
      task_id: OpaqueIdSchema.optional(),
      task_status: z.string().optional(),
      task: z
        .object({
          task_id: OpaqueIdSchema.optional(),
          status: z.string().optional(),
          reason: z.string().optional(),
          eta: z.union([z.number(), z.string()]).optional(),
          progress_percent: z.union([z.number(), z.string()]).optional(),
        })
        .passthrough()
        .optional(),
      extra: z
        .object({
          enable_nsfw_detection: z.boolean().optional(),
        })
        .passthrough()
        .optional(),
      images: z
        .array(
          z
            .object({
              image_url: z.string().optional(),
              image_url_ttl: z.union([z.number(), z.string()]).optional(),
              image_type: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough()
    .safeParse(response);
  if (!parsed.success) return novitaProtocolFailure(expected.data, "Novita task-result response is not recognized");

  const reportedId = parsed.data.task?.task_id ?? parsed.data.task_id;
  if (!reportedId || reportedId !== expected.data) {
    return novitaProtocolFailure(expected.data, "Novita task-result id does not match the requested task");
  }
  const status = parsed.data.task?.status ?? parsed.data.task_status;
  if (status === "TASK_STATUS_QUEUED" || status === "TASK_STATUS_PROCESSING") {
    return NovitaNormalizedTaskResultSchema.parse({
      provider: "novita",
      state: "pending",
      taskId: expected.data,
      providerStatus: status,
      etaSeconds: positiveIntegerOrUndefined(parsed.data.task?.eta),
      progressPercent: boundedPercentOrUndefined(parsed.data.task?.progress_percent),
    });
  }
  if (status === "TASK_STATUS_FAILED") {
    return NovitaNormalizedTaskResultSchema.parse({
      provider: "novita",
      state: "failed",
      taskId: expected.data,
      providerStatus: "TASK_STATUS_FAILED",
      failureReason: parsed.data.task?.reason?.trim() || "Novita reported a failed task without a reason",
    });
  }
  if (status !== "TASK_STATUS_SUCCEED") {
    return novitaProtocolFailure(expected.data, "Novita returned an unknown task status");
  }

  const outputs = normalizeNovitaOutputs(parsed.data.images);
  if (!outputs) return novitaProtocolFailure(expected.data, "Novita succeeded without valid temporary image output URLs");
  return NovitaNormalizedTaskResultSchema.parse({
    provider: "novita",
    state: "succeeded",
    taskId: expected.data,
    providerStatus: "TASK_STATUS_SUCCEED",
    outputs,
    providerReportedNsfwDetection: parsed.data.extra?.enable_nsfw_detection === true,
    requiresIndependentSafetyReview: true,
    automaticSelectionEligible: false,
  });
}

const LtxVideoOutputSchema = z
  .object({
    kind: z.literal("video"),
    sourceUrl: HttpsUrlSchema,
    /** LTX documents output URLs as retained for up to 24 hours after terminal state. */
    providerRetention: z.literal("up_to_24_hours_after_terminal_state"),
    requiresImmediateRehost: z.literal(true),
    requiresIndependentSafetyReview: z.literal(true),
    automaticSelectionEligible: z.literal(false),
  })
  .strict();

export const LtxNormalizedJobResultSchema = z.discriminatedUnion("state", [
  z
    .object({
      provider: z.literal("ltx"),
      state: z.literal("pending"),
      jobId: OpaqueIdSchema,
      providerStatus: z.enum(["pending", "processing"]),
    })
    .strict(),
  z
    .object({
      provider: z.literal("ltx"),
      state: z.literal("succeeded"),
      jobId: OpaqueIdSchema,
      providerStatus: z.literal("completed"),
      output: LtxVideoOutputSchema,
      requiresIndependentSafetyReview: z.literal(true),
      automaticSelectionEligible: z.literal(false),
    })
    .strict(),
  z
    .object({
      provider: z.literal("ltx"),
      state: z.literal("failed"),
      jobId: OpaqueIdSchema,
      providerStatus: z.literal("failed"),
      failureReason: z.string().min(1).max(1_000),
    })
    .strict(),
  LtxProviderProtocolFailureSchema,
]);
export type LtxNormalizedJobResult = z.infer<typeof LtxNormalizedJobResultSchema>;

/**
 * Normalizes LTX v2 image-to-video status. As with Novita, a completed result
 * is only a temporary candidate: it must be copied to controlled storage and
 * pass post-render review before an operator can select or publish it.
 */
export function normalizeLtxImageToVideoJobResult(
  expectedJobId: unknown,
  response: unknown,
): LtxNormalizedJobResult {
  const expected = OpaqueIdSchema.safeParse(expectedJobId);
  if (!expected.success) return ltxProtocolFailure("unknown", "Expected LTX job id is invalid");
  const parsed = z
    .object({
      id: OpaqueIdSchema,
      status: z.string(),
      result: z
        .object({
          video_url: z.string().optional(),
        })
        .passthrough()
        .optional(),
      error: z.unknown().optional(),
    })
    .passthrough()
    .safeParse(response);
  if (!parsed.success) return ltxProtocolFailure(expected.data, "LTX job-status response is not recognized");
  if (parsed.data.id !== expected.data) {
    return ltxProtocolFailure(expected.data, "LTX job-status id does not match the requested job");
  }

  if (parsed.data.status === "pending" || parsed.data.status === "processing") {
    return LtxNormalizedJobResultSchema.parse({
      provider: "ltx",
      state: "pending",
      jobId: expected.data,
      providerStatus: parsed.data.status,
    });
  }
  if (parsed.data.status === "failed") {
    return LtxNormalizedJobResultSchema.parse({
      provider: "ltx",
      state: "failed",
      jobId: expected.data,
      providerStatus: "failed",
      failureReason: providerFailureMessage(parsed.data.error),
    });
  }
  if (parsed.data.status !== "completed") {
    return ltxProtocolFailure(expected.data, "LTX returned an unknown job status");
  }
  const url = HttpsUrlSchema.safeParse(parsed.data.result?.video_url);
  if (!url.success) return ltxProtocolFailure(expected.data, "LTX completed without a valid temporary video URL");
  return LtxNormalizedJobResultSchema.parse({
    provider: "ltx",
    state: "succeeded",
    jobId: expected.data,
    providerStatus: "completed",
    output: {
      kind: "video",
      sourceUrl: url.data,
      providerRetention: "up_to_24_hours_after_terminal_state",
      requiresImmediateRehost: true,
      requiresIndependentSafetyReview: true,
      automaticSelectionEligible: false,
    },
    requiresIndependentSafetyReview: true,
    automaticSelectionEligible: false,
  });
}

function standardProviderHeaders(): z.infer<typeof ProviderRequestHeadersSchema> {
  return {
    contentType: "application/json",
    authorization: { scheme: "Bearer", source: "server_token_resolver" },
  };
}

function configurationFailure(
  configuration: CreatorRendererAdapterConfiguration,
): RendererAdapterBuildFailure {
  return RendererAdapterBuildFailureSchema.parse({
    status: configuration.status === "misconfigured" ? "misconfigured" : "not_configured",
    provider: configuration.provider,
    missing: configuration.missing,
    invalid: configuration.invalid,
    errors: [],
  });
}

function invalidInputFailure(
  provider: CreatorRendererProvider,
  errors: string[],
): RendererAdapterBuildFailure {
  return RendererAdapterBuildFailureSchema.parse({
    status: "invalid_request",
    provider,
    missing: [],
    invalid: [],
    errors,
  });
}

function protocolFailure(
  provider: CreatorRendererProvider,
  jobId: string,
  error: string,
): RendererProviderProtocolFailure {
  return RendererProviderProtocolFailureSchema.parse({
    provider,
    state: "invalid_provider_response",
    // Preserve a valid id if available; otherwise use a stable sentinel that cannot be dispatched.
    jobId: OpaqueIdSchema.safeParse(jobId).success ? jobId : "unknown",
    error,
  });
}

function novitaProtocolFailure(
  jobId: string,
  error: string,
): z.infer<typeof NovitaProviderProtocolFailureSchema> {
  return NovitaProviderProtocolFailureSchema.parse({
    provider: "novita",
    state: "invalid_provider_response",
    jobId: OpaqueIdSchema.safeParse(jobId).success ? jobId : "unknown",
    error,
  });
}

function ltxProtocolFailure(
  jobId: string,
  error: string,
): z.infer<typeof LtxProviderProtocolFailureSchema> {
  return LtxProviderProtocolFailureSchema.parse({
    provider: "ltx",
    state: "invalid_provider_response",
    jobId: OpaqueIdSchema.safeParse(jobId).success ? jobId : "unknown",
    error,
  });
}

function normalizeNovitaOutputs(
  images: Array<{ image_url?: string; image_url_ttl?: number | string; image_type?: string }> | undefined,
): Array<z.infer<typeof NovitaOutputSchema>> | null {
  if (!images || images.length === 0 || images.length > 4) return null;
  const normalized: Array<z.infer<typeof NovitaOutputSchema>> = [];
  for (const image of images) {
    const url = HttpsUrlSchema.safeParse(image.image_url);
    if (!url.success) return null;
    // Image type is intentionally checked when present: unknown formats are not silently selected.
    if (image.image_type && !["png", "webp", "jpeg", "jpg"].includes(image.image_type.toLowerCase())) {
      return null;
    }
    normalized.push(
      NovitaOutputSchema.parse({
        kind: "image",
        sourceUrl: url.data,
        providerTtlSeconds: positiveIntegerOrUndefined(image.image_url_ttl),
        requiresImmediateRehost: true,
        requiresIndependentSafetyReview: true,
        automaticSelectionEligible: false,
      }),
    );
  }
  return normalized;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  const numberValue = typeof value === "string" ? Number(value) : value;
  return typeof numberValue === "number" && Number.isInteger(numberValue) && numberValue >= 0
    ? numberValue
    : undefined;
}

function boundedPercentOrUndefined(value: unknown): number | undefined {
  const numberValue = typeof value === "string" ? Number(value) : value;
  return typeof numberValue === "number" && Number.isFinite(numberValue) && numberValue >= 0 && numberValue <= 100
    ? numberValue
    : undefined;
}

function providerFailureMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim().slice(0, 1_000);
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; detail?: unknown; code?: unknown };
    for (const candidate of [value.message, value.detail, value.code]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 1_000);
    }
  }
  return "LTX reported a failed job without a usable error message";
}

function defaultEnvironment(): RendererEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

function valueOf(environment: RendererEnvironment, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

function isOpaqueServerImplementationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/.test(value);
}

function isNodeServerRuntime(): boolean {
  return typeof window === "undefined" && typeof process !== "undefined" && Boolean(process.versions?.node);
}
