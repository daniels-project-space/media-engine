import { z } from "zod";

/**
 * Fail-closed contracts for creator-promotion rendering.
 *
 * This module deliberately describes work that a future server-only renderer
 * may perform. It does not contain a credential, call `fetch`, resolve an
 * asset URL, or execute a provider request. Source binary data and all rights,
 * consent, and safety evidence live in the asset/provenance service; this
 * boundary contains opaque references to those records only.
 */

export const CREATOR_RENDERER_PROVIDERS = ["novita", "ltx", "fal_z_image_turbo_lora"] as const;
export const CreatorRendererProviderSchema = z.enum(CREATOR_RENDERER_PROVIDERS);
export type CreatorRendererProvider = z.infer<typeof CreatorRendererProviderSchema>;

const IdentifierSchema = z.string().trim().min(1).max(200);
const ExternalRecordReferenceSchema = z
  .string()
  .trim()
  .min(3)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Expected an opaque external record reference");
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");
const IdempotencyKeySchema = z.string().trim().min(16).max(200);

/**
 * These are fixed, official upstream origins. They intentionally cannot be
 * overridden with a runtime environment variable.
 *
 * Novita documents its asynchronous image endpoints and task result endpoint
 * under api.novita.ai. LTX documents its production asynchronous image-to-video
 * flow under api.ltx.io/v2/image-to-video and polls that job by id.
 */
export const OFFICIAL_CREATOR_RENDERER_ORIGINS = Object.freeze({
  novita: "https://api.novita.ai",
  ltx: "https://api.ltx.io",
  fal_z_image_turbo_lora: "https://fal.run",
} as const);

export const OFFICIAL_CREATOR_RENDERER_ENDPOINTS = Object.freeze({
  novita: Object.freeze({
    submitTextToImage: "https://api.novita.ai/v3/async/txt2img",
    submitImageToImage: "https://api.novita.ai/v3/async/img2img",
    /** A dispatcher substitutes the opaque provider task id after submission. */
    pollTaskResult: "https://api.novita.ai/v3/async/task-result?task_id={taskId}",
  }),
  ltx: Object.freeze({
    submitImageToVideo: "https://api.ltx.io/v2/image-to-video",
    /** A dispatcher URL-encodes the provider job id before replacing this token. */
    pollImageToVideo: "https://api.ltx.io/v2/image-to-video/{jobId}",
  }),
  fal_z_image_turbo_lora: Object.freeze({
    /** Native Z-Image Turbo inference with a single server-resolved creator LoRA. */
    submitTextToImage: "https://fal.run/fal-ai/z-image/turbo/lora",
  }),
} as const);

/**
 * Asset data never crosses this contract. An approved server-side asset
 * resolver translates assetId into a short-lived provider-accessible input
 * only after it verifies the referenced provenance and consent records.
 */
export const SourceReferenceAssetSchema = z
  .object({
    assetId: IdentifierSchema,
    organizationId: IdentifierSchema,
    contentItemId: IdentifierSchema,
    mediaType: z.literal("image"),
    contentDigest: Sha256DigestSchema,
    /** Reference into the canonical asset registry, not an image URL or blob. */
    assetRegistryRecordId: ExternalRecordReferenceSchema,
    /** Mandatory external record proving source ownership/licensing. */
    provenanceRecordId: ExternalRecordReferenceSchema,
    /** Mandatory external record proving this source passed content review. */
    safetyReviewRecordId: ExternalRecordReferenceSchema,
    provenanceStatus: z.enum([
      "verified_creator_owned",
      "verified_licensed",
      "verified_synthetic_authorized",
    ]),
    safety: z
      .object({
        reviewStatus: z.literal("approved"),
        audience: z.literal("general_audience"),
        containsSexualContent: z.literal(false),
        containsNudity: z.literal(false),
      })
      .strict(),
    depiction: z
      .object({
        kind: z.enum(["non_person", "synthetic_persona", "authorized_person"]),
        /** Required whenever a real person's likeness is represented. */
        likenessAuthorizationRecordId: ExternalRecordReferenceSchema.optional(),
        /** Required for a synthetic creator identity, never a source image. */
        syntheticIdentityRecordId: ExternalRecordReferenceSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.depiction.kind === "authorized_person" && !value.depiction.likenessAuthorizationRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depiction", "likenessAuthorizationRecordId"],
        message: "A real-person likeness requires an external authorization record",
      });
    }
    if (value.depiction.kind === "synthetic_persona" && !value.depiction.syntheticIdentityRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depiction", "syntheticIdentityRecordId"],
        message: "A synthetic persona requires an external identity record",
      });
    }
    if (value.depiction.kind === "non_person" && (
      value.depiction.likenessAuthorizationRecordId || value.depiction.syntheticIdentityRecordId
    )) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depiction"],
        message: "Non-person source assets must not carry person-identity records",
      });
    }
    if (value.depiction.kind === "authorized_person" && value.depiction.syntheticIdentityRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depiction", "syntheticIdentityRecordId"],
        message: "A real-person source cannot be represented as a synthetic persona",
      });
    }
    if (value.depiction.kind === "synthetic_persona" && value.depiction.likenessAuthorizationRecordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["depiction", "likenessAuthorizationRecordId"],
        message: "A synthetic-persona source must not claim a real-person likeness authorization",
      });
    }
  });
export type SourceReferenceAsset = z.infer<typeof SourceReferenceAssetSchema>;

const UnsafePromptPattern = /\b(?:nude|nudity|naked|porn(?:ography|ographic)?|nsfw|sex(?:ual|ually)?|fetish|onlyfans|deepfake|face[ -]?swap|celebrity[ -]?lookalike|impersonat(?:e|ion))\b/i;

/**
 * This is a deliberately conservative first line of defense. The required
 * external safety review in RenderRequestScope remains authoritative; lexical
 * filtering alone is never used to approve a request.
 */
export const SafeRendererPromptSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_000)
  .superRefine((value, ctx) => {
    if (UnsafePromptPattern.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Renderer prompt contains prohibited sexual or likeness-misuse language",
      });
    }
  });

const RendererNegativePromptSchema = z.string().trim().max(2_000).optional();

export const RenderSafetyConstraintsSchema = z
  .object({
    externalSafetyReviewRecordId: ExternalRecordReferenceSchema,
    externalProvenanceManifestRecordId: ExternalRecordReferenceSchema,
    generalAudienceOnly: z.literal(true),
    prohibitSexualContent: z.literal(true),
    prohibitNudity: z.literal(true),
    prohibitUnconsentedLikeness: z.literal(true),
    requireSyntheticContentDisclosure: z.literal(true),
  })
  .strict();

/**
 * Scope binds an approved render to one organization, one creator content
 * item, and one reviewed version. It is intentionally not a reusable API-key
 * scope or an account-wide rendering permission.
 */
export const RenderRequestScopeSchema = z
  .object({
    organizationId: IdentifierSchema,
    creatorProfileId: IdentifierSchema,
    contentItemId: IdentifierSchema,
    contentVersion: z.number().int().min(1).max(1_000_000),
    purpose: z.enum(["draft_preview", "scheduled_content", "approved_variant"]),
    intendedSurface: z.enum([
      "instagram_feed",
      "instagram_reel",
      "instagram_story",
      "brand_pitch_preview",
      "subscription_preview",
    ]),
    allowedProviders: z.array(CreatorRendererProviderSchema).min(1).max(2),
    allowedOutputKinds: z.array(z.enum(["image", "video"])).min(1).max(2),
    sourceAssetManifestDigest: Sha256DigestSchema,
    safety: RenderSafetyConstraintsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.allowedProviders).size !== value.allowedProviders.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedProviders"],
        message: "Renderer providers must not be duplicated",
      });
    }
    if (new Set(value.allowedOutputKinds).size !== value.allowedOutputKinds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedOutputKinds"],
        message: "Output kinds must not be duplicated",
      });
    }
  });
export type RenderRequestScope = z.infer<typeof RenderRequestScopeSchema>;

export const RenderApprovalEvidenceSchema = z
  .object({
    approvalId: IdentifierSchema,
    status: z.literal("approved"),
    approvedBy: IdentifierSchema,
    approvedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    /** SHA-256 digest of the immutable action payload the approver reviewed. */
    actionDigest: Sha256DigestSchema,
    /** Must match the reviewed source-asset set, not merely the textual prompt. */
    sourceAssetManifestDigest: Sha256DigestSchema,
    policyVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export type RenderApprovalEvidence = z.infer<typeof RenderApprovalEvidenceSchema>;

const RenderActionEnvelopeSchema = z
  .object({
    actionId: IdentifierSchema,
    idempotencyKey: IdempotencyKeySchema,
    organizationId: IdentifierSchema,
    creatorProfileId: IdentifierSchema,
    contentItemId: IdentifierSchema,
    requestedBy: IdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    requestedFrom: z.enum(["operator", "scheduler"]),
    executionMode: z.literal("approval_required"),
    requiresIndividualApproval: z.literal(true),
    correlationId: IdentifierSchema,
    /** Digest of the entire immutable action as canonicalized by the control plane. */
    contentDigest: Sha256DigestSchema,
    scope: RenderRequestScopeSchema,
    /** Opaque asset record references only; never URL, base64, or binary media. */
    sourceAssets: z.array(SourceReferenceAssetSchema).max(4),
    approval: RenderApprovalEvidenceSchema,
  })
  .strict();

export const NovitaRenderPayloadSchema = z
  .object({
    operation: z.enum(["text_to_image", "image_to_image"]),
    /**
     * Model selection is validated again by the server dispatcher against the
     * provider catalog. Hard-coding model names here would go stale quickly.
     */
    modelName: z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._-]+$/),
    prompt: SafeRendererPromptSchema,
    negativePrompt: RendererNegativePromptSchema,
    width: z.number().int().min(256).max(2_048),
    height: z.number().int().min(256).max(2_048),
    imageCount: z.number().int().min(1).max(4),
    seed: z.number().int().min(-1).max(2_147_483_647).optional(),
    outputFormat: z.enum(["png", "webp", "jpeg"]),
    /** Required as a provider-side defense in depth, never disabled by this UI. */
    enableNsfwDetection: z.literal(true),
    /** Present only for image-to-image; resolves to provider input server-side. */
    sourceAssetId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.operation === "image_to_image" && !value.sourceAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceAssetId"],
        message: "Image-to-image rendering requires an approved source asset",
      });
    }
    if (value.operation === "text_to_image" && value.sourceAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceAssetId"],
        message: "Text-to-image rendering must not include an image-to-image source asset",
      });
    }
  });

export const LtxImageToVideoPayloadSchema = z
  .object({
    sourceAssetId: IdentifierSchema,
    lastFrameAssetId: IdentifierSchema.optional(),
    prompt: SafeRendererPromptSchema,
    /** Current official LTX 2.3 image-to-video model identifiers. */
    model: z.enum(["ltx-2-3-fast", "ltx-2-3-pro"]),
    /** The common safe range supported by both 2.5 image-to-video variants. */
    durationSeconds: z.union([z.literal(6), z.literal(8), z.literal(10)]),
    /** Current LTX 2.3 portrait and landscape output dimensions. */
    resolution: z.enum([
      "1920x1080",
      "1080x1920",
      "2560x1440",
      "1440x2560",
      "3840x2160",
      "2160x3840",
    ]),
    /** Restricting this boundary to 24 fps reduces unsupported model combinations. */
    fps: z.literal(24),
    /** Do not synthesize a voice or audio track through the creator-renderer path. */
    generateAudio: z.literal(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.lastFrameAssetId && value.lastFrameAssetId === value.sourceAssetId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lastFrameAssetId"],
        message: "The final-frame source must be a distinct approved asset",
      });
    }
  });

export const NovitaRenderActionSchema = RenderActionEnvelopeSchema.extend({
  provider: z.literal("novita"),
  type: z.literal("novita.render_image"),
  payload: NovitaRenderPayloadSchema,
}).strict();

export const LtxImageToVideoActionSchema = RenderActionEnvelopeSchema.extend({
  provider: z.literal("ltx"),
  type: z.literal("ltx.render_image_to_video"),
  payload: LtxImageToVideoPayloadSchema,
}).strict();

export const CreatorRendererActionSchema = z
  .discriminatedUnion("type", [NovitaRenderActionSchema, LtxImageToVideoActionSchema])
  .superRefine((action, ctx) => {
    if (action.organizationId !== action.scope.organizationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "organizationId"],
        message: "Action organization must match the approved render scope",
      });
    }
    if (action.creatorProfileId !== action.scope.creatorProfileId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "creatorProfileId"],
        message: "Action creator must match the approved render scope",
      });
    }
    if (action.contentItemId !== action.scope.contentItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "contentItemId"],
        message: "Action content item must match the approved render scope",
      });
    }
    if (action.approval.actionDigest !== action.contentDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval", "actionDigest"],
        message: "Approval action digest does not match the immutable action",
      });
    }
    if (action.approval.sourceAssetManifestDigest !== action.scope.sourceAssetManifestDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approval", "sourceAssetManifestDigest"],
        message: "Approval source-asset digest does not match the approved render scope",
      });
    }
    if (!action.scope.allowedProviders.includes(action.provider)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "allowedProviders"],
        message: "The provider is outside the approved render scope",
      });
    }

    const requiredOutputKind = action.type === "novita.render_image" ? "image" : "video";
    if (!action.scope.allowedOutputKinds.includes(requiredOutputKind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "allowedOutputKinds"],
        message: `The scope does not permit ${requiredOutputKind} output`,
      });
    }

    const sourceAssetIds = new Set(action.sourceAssets.map((asset) => asset.assetId));
    if (sourceAssetIds.size !== action.sourceAssets.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceAssets"],
        message: "Source assets must not be duplicated",
      });
    }
    for (const asset of action.sourceAssets) {
      if (asset.organizationId !== action.organizationId || asset.contentItemId !== action.contentItemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceAssets"],
          message: "Every source asset must belong to the action organization and content item",
        });
        break;
      }
    }

    if (action.type === "novita.render_image") {
      if (action.payload.operation === "image_to_image" && !sourceAssetIds.has(action.payload.sourceAssetId!)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", "sourceAssetId"],
          message: "The Novita source asset must be in the approved source-asset manifest",
        });
      }
      if (action.payload.operation === "text_to_image" && action.sourceAssets.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceAssets"],
          message: "Text-to-image actions must not attach source image assets",
        });
      }
    }

    if (action.type === "ltx.render_image_to_video") {
      if (!sourceAssetIds.has(action.payload.sourceAssetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", "sourceAssetId"],
          message: "The LTX first-frame asset must be in the approved source-asset manifest",
        });
      }
      if (action.payload.lastFrameAssetId && !sourceAssetIds.has(action.payload.lastFrameAssetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", "lastFrameAssetId"],
          message: "The LTX final-frame asset must be in the approved source-asset manifest",
        });
      }
    }
  });
export type CreatorRendererAction = z.infer<typeof CreatorRendererActionSchema>;

declare const verifiedApprovedRendererAction: unique symbol;
export type VerifiedApprovedRendererAction = CreatorRendererAction & {
  readonly [verifiedApprovedRendererAction]: true;
};

export type RenderApprovalVerificationResult =
  | { ok: true; action: VerifiedApprovedRendererAction }
  | { ok: false; errors: string[] };

/**
 * Verifies syntax, approval hash binding, and expiration immediately before a
 * future dispatcher accepts the work. It does not calculate a digest itself:
 * canonical hashing belongs to the audit/control-plane service.
 */
export function verifyApprovedCreatorRendererAction(
  input: unknown,
  now = new Date(),
): RenderApprovalVerificationResult {
  const parsed = CreatorRendererActionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) };
  }

  const action = parsed.data;
  const errors: string[] = [];
  const approvedAt = new Date(action.approval.approvedAt);
  const expiresAt = new Date(action.approval.expiresAt);

  if (Number.isNaN(approvedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    errors.push("Approval timestamps are invalid");
  } else {
    if (expiresAt <= approvedAt) errors.push("Approval expiry must be after approval time");
    if (expiresAt <= now) errors.push("Renderer action approval has expired");
  }

  if (action.approval.actionDigest !== action.contentDigest) {
    errors.push("Approved action digest does not match the render action");
  }
  if (action.approval.sourceAssetManifestDigest !== action.scope.sourceAssetManifestDigest) {
    errors.push("Approved source-asset manifest does not match the render scope");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    action: Object.freeze({ ...action }) as VerifiedApprovedRendererAction,
  };
}

/**
 * The environment holds only implementation identifiers, never an API key or
 * bearer token. A configured name is insufficient: an actual server-only
 * runtime installation must also supply each function below before readiness
 * becomes true.
 */
export const NOVITA_RENDERER_CONFIG_KEYS = [
  "NOVITA_SERVER_TOKEN_RESOLVER",
  "NOVITA_SOURCE_ASSET_RESOLVER",
  "NOVITA_APPROVED_DISPATCHER",
] as const;

export const LTX_RENDERER_CONFIG_KEYS = [
  "LTX_SERVER_TOKEN_RESOLVER",
  "LTX_SOURCE_ASSET_RESOLVER",
  "LTX_APPROVED_DISPATCHER",
] as const;

/**
 * These identifiers gate the server-only Fal worker. They name integrations,
 * not credentials: FAL_KEY remains isolated in the Fal vault.
 */
export const FAL_Z_IMAGE_TURBO_LORA_RENDERER_CONFIG_KEYS = [
  "FAL_SERVER_TOKEN_RESOLVER",
  "FAL_SOURCE_ASSET_RESOLVER",
  "FAL_APPROVED_DISPATCHER",
] as const;

const RENDERER_CONFIG_KEYS = Object.freeze({
  novita: NOVITA_RENDERER_CONFIG_KEYS,
  ltx: LTX_RENDERER_CONFIG_KEYS,
  fal_z_image_turbo_lora: FAL_Z_IMAGE_TURBO_LORA_RENDERER_CONFIG_KEYS,
} as const);

export type RendererEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * A runtime installation is supplied by the server-only worker, not this
 * module. Its callbacks are deliberately typed as opaque because this module
 * must neither see credentials nor initiate provider side effects.
 */
export type RendererRuntimeInstallation = Readonly<{
  serverRuntime: true;
  tokenResolverId: string;
  sourceAssetResolverId: string;
  dispatcherId: string;
  resolveProviderToken: (provider: CreatorRendererProvider) => Promise<unknown>;
  resolveApprovedSourceAsset: (asset: SourceReferenceAsset) => Promise<unknown>;
  dispatchApprovedRender: (descriptor: CreatorRendererActionDescriptor) => Promise<unknown>;
}>;

export const RendererProviderConfigurationStatusSchema = z.enum([
  "ready",
  "not_configured",
  "misconfigured",
]);
export type RendererProviderConfigurationStatus = z.infer<
  typeof RendererProviderConfigurationStatusSchema
>;

export const RendererProviderHealthSchema = z
  .object({
    provider: CreatorRendererProviderSchema,
    status: RendererProviderConfigurationStatusSchema,
    canResolveServerCredentials: z.boolean(),
    canResolveApprovedSourceAssets: z.boolean(),
    canDispatchApprovedActions: z.boolean(),
    missing: z.array(z.string()).readonly(),
    invalid: z.array(z.string()).readonly(),
    notes: z.array(z.string()).readonly(),
  })
  .strict();
export type RendererProviderHealth = z.infer<typeof RendererProviderHealthSchema>;

export type RendererHealthOptions = Readonly<{
  environment?: RendererEnvironment;
  /** Omit this in UI/browser code. A missing runtime always fail-closes. */
  runtime?: RendererRuntimeInstallation;
}>;

export function checkNovitaRendererHealth(
  options: RendererHealthOptions = {},
): RendererProviderHealth {
  return checkRendererProviderHealth("novita", options);
}

export function checkLtxRendererHealth(
  options: RendererHealthOptions = {},
): RendererProviderHealth {
  return checkRendererProviderHealth("ltx", options);
}

export function checkFalZImageTurboLoRARendererHealth(
  options: RendererHealthOptions = {},
): RendererProviderHealth {
  return checkRendererProviderHealth("fal_z_image_turbo_lora", options);
}

export function checkRendererProviderHealth(
  provider: CreatorRendererProvider,
  options: RendererHealthOptions = {},
): RendererProviderHealth {
  const environment = options.environment ?? defaultRendererEnvironment();
  const requiredKeys = RENDERER_CONFIG_KEYS[provider];
  const missing: string[] = requiredKeys.filter((key) => !valueOf(environment, key));
  const invalid: string[] = [];
  const runtime = options.runtime;

  for (const key of requiredKeys) {
    const value = valueOf(environment, key);
    if (value && !isOpaqueImplementationId(value)) {
      invalid.push(`${key} must be an opaque server-side implementation identifier`);
    }
  }

  if (!isServerRuntime()) {
    missing.push("a server runtime");
  }
  if (!runtime) {
    missing.push("a registered server-only token resolver implementation");
    missing.push("a registered server-only source-asset resolver implementation");
    missing.push("a registered approved renderer dispatcher implementation");
  } else {
    validateRendererRuntime(provider, environment, runtime, missing, invalid);
  }

  const status: RendererProviderConfigurationStatus = invalid.length > 0
    ? "misconfigured"
    : missing.length > 0
      ? "not_configured"
      : "ready";

  return {
    provider,
    status,
    canResolveServerCredentials: status === "ready",
    canResolveApprovedSourceAssets: status === "ready",
    canDispatchApprovedActions: status === "ready",
    missing,
    invalid,
    notes: [
      "This check never reads a provider API key or access token.",
      "A descriptor produced by this module remains non-executable; only an audited server dispatcher may submit it.",
      "The referenced asset-provenance, consent, and safety records must be validated by the source-asset resolver.",
    ],
  };
}

export function checkAllCreatorRendererProviders(
  options: RendererHealthOptions = {},
): Record<CreatorRendererProvider, RendererProviderHealth> {
  return {
    novita: checkRendererProviderHealth("novita", options),
    ltx: checkRendererProviderHealth("ltx", options),
    fal_z_image_turbo_lora: checkRendererProviderHealth("fal_z_image_turbo_lora", options),
  };
}

/** A dispatcher must call this final predicate immediately before submission. */
export function isRendererReadyForApprovedDispatch(health: RendererProviderHealth): boolean {
  return health.status === "ready" && health.canDispatchApprovedActions;
}

const DescriptorReadinessSchema = z
  .object({
    dispatchReady: z.boolean(),
    blockedReasons: z.array(z.string()).readonly(),
    requiresServerTokenResolver: z.literal(true),
    requiresSourceAssetResolver: z.literal(true),
    requiresApprovedDispatcher: z.literal(true),
  })
  .strict();

const DescriptorBaseSchema = z
  .object({
    actionId: IdentifierSchema,
    idempotencyKey: IdempotencyKeySchema,
    contentDigest: Sha256DigestSchema,
    provider: CreatorRendererProviderSchema,
    /** This module cannot execute a request, even if a worker reports ready. */
    executable: z.literal(false),
    sourceAssetRecordIds: z.array(IdentifierSchema).readonly(),
    readiness: DescriptorReadinessSchema,
  })
  .strict();

export const NovitaRendererActionDescriptorSchema = DescriptorBaseSchema.extend({
  provider: z.literal("novita"),
  type: z.literal("novita.render_image"),
  submit: z
    .object({
      method: z.literal("POST"),
      url: z.union([
        z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitTextToImage),
        z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitImageToImage),
      ]),
    })
    .strict(),
  poll: z
    .object({
      method: z.literal("GET"),
      urlTemplate: z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.pollTaskResult),
    })
    .strict(),
  requestTemplate: z
    .object({
      operation: z.enum(["text_to_image", "image_to_image"]),
      modelName: z.string(),
      prompt: z.string(),
      negativePrompt: z.string().optional(),
      width: z.number().int(),
      height: z.number().int(),
      imageCount: z.number().int(),
      seed: z.number().int().optional(),
      outputFormat: z.enum(["png", "webp", "jpeg"]),
      enableNsfwDetection: z.literal(true),
      /** An asset ID for a future resolver, never a base64 field. */
      sourceAssetId: IdentifierSchema.optional(),
    })
    .strict(),
}).strict();

export const LtxRendererActionDescriptorSchema = DescriptorBaseSchema.extend({
  provider: z.literal("ltx"),
  type: z.literal("ltx.render_image_to_video"),
  submit: z
    .object({
      method: z.literal("POST"),
      url: z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.submitImageToVideo),
    })
    .strict(),
  poll: z
    .object({
      method: z.literal("GET"),
      urlTemplate: z.literal(OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.pollImageToVideo),
    })
    .strict(),
  requestTemplate: z
    .object({
      sourceAssetId: IdentifierSchema,
      lastFrameAssetId: IdentifierSchema.optional(),
      prompt: z.string(),
      model: z.enum(["ltx-2-3-fast", "ltx-2-3-pro"]),
      durationSeconds: z.union([z.literal(6), z.literal(8), z.literal(10)]),
      resolution: z.enum([
        "1920x1080",
        "1080x1920",
        "2560x1440",
        "1440x2560",
        "3840x2160",
        "2160x3840",
      ]),
      fps: z.literal(24),
      generateAudio: z.literal(false),
    })
    .strict(),
}).strict();

export const CreatorRendererActionDescriptorSchema = z.discriminatedUnion("type", [
  NovitaRendererActionDescriptorSchema,
  LtxRendererActionDescriptorSchema,
]);
export type CreatorRendererActionDescriptor = z.infer<typeof CreatorRendererActionDescriptorSchema>;

/**
 * Produces a transport-safe description of one individually approved render.
 * It never constructs Authorization headers, asset URLs, binary payloads, or
 * a callable HTTP request. A future audited worker can consume this after its
 * own final ledger, budget, and provider-health checks.
 */
export function describeApprovedCreatorRendererAction(
  input: unknown,
  options: Readonly<{ now?: Date; providerHealth?: RendererProviderHealth }> = {},
): CreatorRendererActionDescriptor {
  const verification = verifyApprovedCreatorRendererAction(input, options.now);
  if (!verification.ok) {
    throw new Error(`Renderer action approval is not valid: ${verification.errors.join("; ")}`);
  }

  const action = verification.action;
  const health = options.providerHealth ?? checkRendererProviderHealth(action.provider);
  if (health.provider !== action.provider) {
    throw new Error("Renderer action received a health record for the wrong provider");
  }

  const readiness = Object.freeze({
    dispatchReady: isRendererReadyForApprovedDispatch(health),
    blockedReasons: Object.freeze([...health.missing, ...health.invalid]),
    requiresServerTokenResolver: true as const,
    requiresSourceAssetResolver: true as const,
    requiresApprovedDispatcher: true as const,
  });
  const base = {
    actionId: action.actionId,
    idempotencyKey: action.idempotencyKey,
    contentDigest: action.contentDigest,
    provider: action.provider,
    executable: false as const,
    sourceAssetRecordIds: Object.freeze(action.sourceAssets.map((asset) => asset.assetId)),
    readiness,
  };

  if (action.type === "novita.render_image") {
    const descriptor = {
      ...base,
      provider: "novita" as const,
      type: "novita.render_image" as const,
      submit: {
        method: "POST" as const,
        url: action.payload.operation === "text_to_image"
          ? OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitTextToImage
          : OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.submitImageToImage,
      },
      poll: {
        method: "GET" as const,
        urlTemplate: OFFICIAL_CREATOR_RENDERER_ENDPOINTS.novita.pollTaskResult,
      },
      requestTemplate: { ...action.payload },
    };
    return Object.freeze(NovitaRendererActionDescriptorSchema.parse(descriptor));
  }

  const descriptor = {
    ...base,
    provider: "ltx" as const,
    type: "ltx.render_image_to_video" as const,
    submit: {
      method: "POST" as const,
      url: OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.submitImageToVideo,
    },
    poll: {
      method: "GET" as const,
      urlTemplate: OFFICIAL_CREATOR_RENDERER_ENDPOINTS.ltx.pollImageToVideo,
    },
    requestTemplate: { ...action.payload },
  };
  return Object.freeze(LtxRendererActionDescriptorSchema.parse(descriptor));
}

function validateRendererRuntime(
  provider: CreatorRendererProvider,
  environment: RendererEnvironment,
  runtime: RendererRuntimeInstallation,
  missing: string[],
  invalid: string[],
): void {
  const [tokenResolverKey, sourceAssetResolverKey, dispatcherKey] = RENDERER_CONFIG_KEYS[provider];

  if (runtime.serverRuntime !== true) invalid.push("Renderer runtime must be server-only");
  if (typeof runtime.resolveProviderToken !== "function") {
    missing.push("an actual server-only token resolver function");
  }
  if (typeof runtime.resolveApprovedSourceAsset !== "function") {
    missing.push("an actual server-only source-asset resolver function");
  }
  if (typeof runtime.dispatchApprovedRender !== "function") {
    missing.push("an actual approved renderer dispatcher function");
  }

  validateRuntimeId(runtime.tokenResolverId, valueOf(environment, tokenResolverKey), tokenResolverKey, invalid);
  validateRuntimeId(
    runtime.sourceAssetResolverId,
    valueOf(environment, sourceAssetResolverKey),
    sourceAssetResolverKey,
    invalid,
  );
  validateRuntimeId(runtime.dispatcherId, valueOf(environment, dispatcherKey), dispatcherKey, invalid);
}

function validateRuntimeId(
  runtimeId: string,
  configuredId: string | undefined,
  configKey: string,
  invalid: string[],
): void {
  if (!isOpaqueImplementationId(runtimeId)) {
    invalid.push(`${configKey} runtime implementation id is invalid`);
  }
  if (configuredId && configuredId !== runtimeId) {
    invalid.push(`${configKey} does not match the registered runtime implementation`);
  }
}

function defaultRendererEnvironment(): RendererEnvironment {
  return typeof process === "undefined" ? {} : process.env;
}

function valueOf(environment: RendererEnvironment, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

function isOpaqueImplementationId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/.test(value);
}

function isServerRuntime(): boolean {
  return typeof window === "undefined";
}
