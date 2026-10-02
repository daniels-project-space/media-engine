import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  assertNonBlank,
  assertDigest,
  ensureDefaultOrganization,
  findDefaultOrganization,
} from "./controlPlaneModel";

/**
 * Private Creator Promotion data model.
 *
 * This module is deliberately a planning and operator-review surface. It does
 * not contain a credential, OAuth code, publish/send implementation, browser
 * automation, account creation, engagement action, or a legacy dispatcher.
 * Provider calls, when they are eventually approved, must be admitted through
 * a separate audited action-ledger worker.
 */

const MAX_TEXT = 8_000;
const MAX_SHORT_TEXT = 500;
const MAX_ROWS = 250;
const MAX_DAILY_POSTS = 8;
const MAX_WEEKLY_POSTS = MAX_DAILY_POSTS * 7;
const MAX_CADENCE_GAP_DAYS = 31;
const MAX_INBOX_DRAFT_CONTEXT_CHARS = 1_200;
const MAX_INBOX_DRAFT_BOUNDARIES = 12;
const DEFAULT_AI_ASSISTANCE_DISCLOSURE = "I’m an AI assistant helping the creator with messages.";

const creatorArchetype = v.union(
  v.literal("flagship"),
  v.literal("lifestyle"),
  v.literal("creator"),
  v.literal("faceless"),
);
const creatorStage = v.union(
  v.literal("setup"),
  v.literal("growth"),
  v.literal("brand_ready"),
  v.literal("monetized"),
  v.literal("paused"),
);
const creatorGoal = v.union(
  v.literal("audience_growth"),
  v.literal("brand_partnerships"),
  v.literal("fanvue_conversion"),
);
const inboxPolicy = v.union(v.literal("draft_only"), v.literal("human_handoff"));
const socialPlatform = v.union(
  v.literal("instagram"),
  v.literal("fanvue"),
  v.literal("fansly"),
  v.literal("tiktok"),
  v.literal("youtube"),
  v.literal("pinterest"),
  v.literal("x"),
  v.literal("facebook"),
  v.literal("threads"),
  v.literal("linkedin"),
  v.literal("bluesky"),
  v.literal("email"),
  v.literal("other"),
);
const manualKycStatus = v.union(
  v.literal("not_applicable"),
  v.literal("pending"),
  v.literal("verified"),
  v.literal("rejected"),
);
const destinationKind = v.union(
  v.literal("brand_inquiry"),
  v.literal("link_in_bio"),
  v.literal("website"),
  v.literal("fanvue"),
  v.literal("other"),
);
const contentFormat = v.union(
  v.literal("image"),
  v.literal("carousel"),
  v.literal("reel"),
  v.literal("story"),
  v.literal("short"),
  v.literal("text"),
);
// A Postiz policy is deliberately part of an individually approved schedule,
// not a credential or mutable channel default. The worker maps these public
// product choices to provider fields only after it has claimed the frozen row.
const postizSettings = v.union(
  v.object({ __type: v.union(v.literal("instagram"), v.literal("instagram-standalone")) }),
  v.object({
    __type: v.literal("x"),
    replyAudience: v.union(
      v.literal("everyone"),
      v.literal("following"),
      v.literal("mentionedUsers"),
      v.literal("subscribers"),
      v.literal("verified"),
    ),
    madeWithAi: v.boolean(),
    paidPartnership: v.boolean(),
  }),
  v.object({
    __type: v.literal("tiktok"),
    privacyLevel: v.union(
      v.literal("PUBLIC_TO_EVERYONE"),
      v.literal("MUTUAL_FOLLOW_FRIENDS"),
      v.literal("FOLLOWER_OF_CREATOR"),
      v.literal("SELF_ONLY"),
    ),
    duet: v.boolean(),
    stitch: v.boolean(),
    comments: v.boolean(),
    autoAddMusic: v.union(v.literal("yes"), v.literal("no")),
    brandContent: v.boolean(),
    brandOrganic: v.boolean(),
    contentPostingMethod: v.union(v.literal("DIRECT_POST"), v.literal("UPLOAD")),
    videoMadeWithAi: v.boolean(),
  }),
  v.object({
    __type: v.literal("youtube"),
    visibility: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
    madeForKids: v.union(v.literal("yes"), v.literal("no")),
  }),
  v.object({ __type: v.literal("pinterest"), board: v.string() }),
  v.object({ __type: v.literal("facebook") }),
  v.object({ __type: v.literal("threads") }),
  v.object({ __type: v.literal("linkedin") }),
  v.object({ __type: v.literal("bluesky") }),
);
const postingFormatTargets = v.object({
  image: v.optional(v.number()),
  carousel: v.optional(v.number()),
  reel: v.optional(v.number()),
  story: v.optional(v.number()),
  short: v.optional(v.number()),
  text: v.optional(v.number()),
});
const funnelStage = v.union(
  v.literal("awareness"),
  v.literal("trust"),
  v.literal("consideration"),
  v.literal("conversion"),
  v.literal("retention"),
);
const funnelCampaignObjective = v.union(
  v.literal("brand_partnerships"),
  v.literal("subscription_conversion"),
  v.literal("website_conversion"),
  v.literal("lead_capture"),
  v.literal("other"),
);
const funnelStagePlan = v.object({
  stage: funnelStage,
  label: v.string(),
  purpose: v.string(),
  ctaText: v.string(),
});
const funnelComplianceInput = v.object({
  disclosureRequired: v.boolean(),
  disclosureText: v.optional(v.string()),
  ageGateRequired: v.boolean(),
  ageGateEvidenceReference: v.optional(v.string()),
  operatorAttestation: v.object({
    attestedBy: v.string(),
    statement: v.string(),
    confirmed: v.boolean(),
  }),
});
const funnelLinkPolicyInput = v.object({
  utmSource: v.string(),
  utmMedium: v.string(),
  utmCampaign: v.string(),
  utmContentPrefix: v.optional(v.string()),
});
const funnelEventType = v.union(
  v.literal("link_click"),
  v.literal("lead"),
  v.literal("brand_inquiry"),
  v.literal("signup"),
  v.literal("subscription"),
  v.literal("revenue_observed"),
  v.literal("other"),
);
const renderProvider = v.union(
  v.literal("novita"),
  v.literal("ltx"),
  // Only an explicitly snapshotted, ready creator model may use this path.
  v.literal("fal_z_image_turbo_lora"),
  v.literal("unassigned"),
);
const inboxIntent = v.union(
  v.literal("general"),
  v.literal("brand_inquiry"),
  v.literal("support"),
  v.literal("fanvue_interest"),
  v.literal("safety_review"),
  v.literal("other"),
);
const referenceRightsStatus = v.union(v.literal("owned"), v.literal("consented"), v.literal("licensed"));
const referenceUseType = v.union(
  v.literal("creator_likeness"),
  v.literal("style"),
  v.literal("wardrobe"),
  v.literal("location"),
  v.literal("product"),
  v.literal("composition"),
);
const referenceSource = v.union(
  v.literal("operator_uploaded"),
  v.literal("client_provided"),
  v.literal("owned_library"),
  v.literal("licensed_library"),
);
const loraTrainingType = v.union(v.literal("content"), v.literal("style"), v.literal("balanced"));
const loraTrainingParams = v.object({
  triggerWord: v.string(),
  trainingType: loraTrainingType,
  steps: v.number(),
  learningRate: v.number(),
  defaultCaption: v.string(),
});
const loraDatasetCaption = v.object({
  referenceAssetId: v.id("creatorReferenceAssets"),
  caption: v.string(),
  sha256: v.optional(v.string()),
});
const loraOperatorAttestation = v.object({
  attestedBy: v.string(),
  statement: v.string(),
  confirmed: v.boolean(),
});
const personaIdentityPatch = v.object({
  bio: v.optional(v.string()),
  identitySummary: v.optional(v.string()),
  emotionalBackstory: v.optional(v.string()),
  voiceGuide: v.optional(v.string()),
  audience: v.optional(v.string()),
  disclosure: v.optional(v.string()),
  contentPillars: v.optional(v.array(v.string())),
  boundaries: v.optional(v.array(v.string())),
  contentBoundaries: v.optional(v.array(v.string())),
});
const personaVisualSystemPatch = v.object({
  promptLock: v.optional(v.string()),
  promptStyle: v.optional(v.string()),
  loraTrigger: v.optional(v.string()),
  referenceNotes: v.optional(v.string()),
});

const CREATOR_CONTENT_APPROVAL_RESOURCE = "creator_content_item";
const CREATOR_CONTENT_APPROVAL_ACTION = "creator_content_plan_approval";
const CREATOR_RENDER_ACTION = "creator_render_dispatch";
const CREATOR_LORA_TRAINING_APPROVAL_RESOURCE = "creator_lora_training_job";
const CREATOR_LORA_TRAINING_APPROVAL_ACTION = "creator_lora_training_review";
const CREATOR_LORA_TRAINING_DISPATCH_ACTION = "creator_lora_training_dispatch";
const CREATOR_FUNNEL_APPROVAL_RESOURCE = "creator_funnel_campaign";
const CREATOR_FUNNEL_APPROVAL_ACTION = "creator_funnel_activation_review";
// Publishing a selected render is a separate approval from the content/render
// decision. It is never inferred from a scheduled date and requires an
// explicit operator dispatch after that date.
const CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_RESOURCE = "creator_meta_instagram_publish";
const CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_ACTION = "creator_meta_instagram_publish_approval";
const CREATOR_META_INSTAGRAM_PUBLISH_DISPATCH_ACTION = "creator_meta_instagram_publish_dispatch";
// A reply is its own governed side effect. It is intentionally unrelated to
// content publication and can only target the newest signed customer message.
const CREATOR_META_INSTAGRAM_REPLY_APPROVAL_RESOURCE = "creator_meta_instagram_reply";
const CREATOR_META_INSTAGRAM_REPLY_APPROVAL_ACTION = "creator_meta_instagram_reply_approval";
const CREATOR_META_INSTAGRAM_REPLY_DISPATCH_ACTION = "creator_meta_instagram_reply_dispatch";
const META_INSTAGRAM_REPLY_REQUIRED_CAPABILITY = "reply_to_inbound_message";
const META_INSTAGRAM_REPLY_REQUIRED_SCOPE = "instagram_business_manage_messages";
// Postiz is a downstream multi-network scheduler. It receives a future
// schedule only after an individual approval and explicit worker queue; its
// acknowledgement is never evidence that a social network has published.
const CREATOR_POSTIZ_SCHEDULE_APPROVAL_RESOURCE = "creator_postiz_schedule";
const CREATOR_POSTIZ_SCHEDULE_APPROVAL_ACTION = "creator_postiz_schedule_approval";
const CREATOR_POSTIZ_SCHEDULE_DISPATCH_ACTION = "creator_postiz_schedule_dispatch";
const POSTIZ_SCHEDULE_REQUIRED_CAPABILITY = "schedule_content";
const FAL_Z_IMAGE_TRAINING_ENDPOINT = "fal-ai/z-image-trainer";
const FAL_Z_IMAGE_LORA_INFERENCE_ENDPOINT = "fal-ai/z-image/turbo/lora";
const Z_IMAGE_TURBO_BASE_MODEL = "z-image-turbo";
const MAX_REFERENCE_ASSETS_PER_CONTENT_PLAN = 12;
const MAX_CREATOR_RENDER_ATTEMPTS = 3;
const MAX_CREATOR_RENDER_CANDIDATES = 12;
const MAX_LORA_DATASET_ASSETS = 64;
const MAX_PERSONA_REVISIONS_PER_CREATOR = 500;
const MAX_FUNNEL_STAGES = 5;
// A signed customer message has a non-extendable normal response window. The
// reply lifecycle rechecks it at request, approval, queue, claim, and just
// before the provider call; an expired window is handed to a human instead.
const META_INSTAGRAM_INBOUND_REPLY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const CREATOR_INBOUND_BODY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * Capability metadata mirrors the provider-ready contract. Recording a grant
 * does not execute it: any post, paid chat reply, or tracking-link call still
 * needs its own approved action-ledger entry and trusted dispatcher.
 */
const FANVUE_READINESS_CAPABILITIES = new Set([
  "read_profile",
  "read_insights",
  "read_inbox",
  "schedule_content",
  "publish_subscription_post",
  "send_subscription_chat_reply",
  "manage_tracking_links",
]);

const META_INSTAGRAM_READINESS_CAPABILITIES = new Set([
  "read_profile",
  "read_insights",
  "read_inbox",
  "publish_feed",
  "publish_reel",
  "publish_story",
  "publish_carousel",
  "schedule_content",
  "reply_to_inbound_message",
]);

// Do not treat Postiz as an inbox or engagement automation provider. These
// metadata-only grants are deliberately narrow and are not credentials.
const POSTIZ_READINESS_CAPABILITIES = new Set([
  "read_profile",
  "read_insights",
  POSTIZ_SCHEDULE_REQUIRED_CAPABILITY,
]);

function normalizeText(value: string, label: string, maxLength = MAX_TEXT): string {
  const normalized = value.trim();
  assertNonBlank(normalized, label);
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function normalizeOptionalText(value: string | undefined, label: string, maxLength = MAX_TEXT): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

/**
 * The inbox-draft model sees an ephemeral, minimised view of stored text—not
 * customer identifiers, links, contact details, or raw provider payloads.
 * Keep this local to the private Convex boundary so browser projections can
 * never accidentally reuse it.
 */
function redactInboxDraftText(value: string | undefined, fallback: string, maxLength = MAX_INBOX_DRAFT_CONTEXT_CHARS): string {
  const redacted = (value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, "[link removed]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(/(?:\+?\d[\s().-]?){8,}\d/g, "[phone removed]")
    .replace(/\b@[A-Za-z0-9._-]{2,}\b/g, "[handle removed]")
    .replace(/\b(api[ _-]?key|access[ _-]?token|password|secret)\s*[:=]\s*\S+/gi, "$1: [secret removed]")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted) return fallback;
  return redacted.slice(0, maxLength);
}

function containsDirectContactOrLink(value: string): boolean {
  return /\b(?:https?:\/\/|www\.)|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:\+?\d[\s().-]?){8,}\d/i.test(value);
}

function normalizeHandle(value: string): string {
  const trimmed = normalizeText(value, "handle", 128).replace(/^@+/, "");
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error("handle may only include letters, numbers, periods, underscores, or hyphens");
  }
  return `@${trimmed.toLowerCase()}`;
}

function normalizeAccountHandle(value: string, platform: string): string {
  // Instagram-style accounts use a canonical handle. Channel labels and
  // imported manual accounts (for example a historical YouTube channel name)
  // may contain spaces, but never control characters.
  if (["instagram", "tiktok", "x", "fanvue", "fansly"].includes(platform)) return normalizeHandle(value);
  const normalized = normalizeText(value, "account handle", 128);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("account handle contains an invalid character");
  return normalized;
}

function normalizeReferenceStorageKey(value: string): string {
  const storageKey = normalizeText(value, "reference asset storage key", 1_024);
  if (!storageKey.startsWith("creator-references/")) {
    throw new Error("reference asset storage key must start with creator-references/");
  }
  const suffix = storageKey.slice("creator-references/".length);
  if (!suffix || suffix.includes("..") || suffix.includes("\\") || /[\u0000-\u001f\u007f]/.test(storageKey)) {
    throw new Error("reference asset storage key is invalid");
  }
  return storageKey;
}

function normalizeStringList(values: string[], label: string, maxItems = 20): string[] {
  if (values.length > maxItems) throw new Error(`${label} has too many entries`);
  const result = [...new Set(values.map((value) => normalizeText(value, label, MAX_SHORT_TEXT)))];
  return result;
}

function assertTimezone(timezone: string): string {
  const normalized = normalizeText(timezone, "timezone", 100);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format();
  } catch {
    throw new Error("timezone must be a valid IANA timezone");
  }
  return normalized;
}

function assertPositiveWhole(value: number, label: string, maximum: number): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum}`);
  }
}

function assertNonNegativeWhole(value: number, label: string, maximum: number): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be a whole number between 0 and ${maximum}`);
  }
}

function localDayKey(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function snapshotHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `stable-v1:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}:${serialized.length}`;
}

function contentApprovalSnapshot(content: Doc<"creatorContentItems">, reviewVersion = content.reviewVersion) {
  return {
    resourceType: CREATOR_CONTENT_APPROVAL_RESOURCE,
    resourceId: String(content._id),
    planVersion: reviewVersion,
    content: {
      creatorId: String(content.creatorId),
      accountId: content.accountId ? String(content.accountId) : undefined,
      destinationId: content.destinationId ? String(content.destinationId) : undefined,
      funnelId: content.funnelId ? String(content.funnelId) : undefined,
      funnelSnapshot: content.funnelSnapshot,
      format: content.format,
      funnelStage: content.funnelStage,
      title: content.title,
      hook: content.hook,
      caption: content.caption,
      cta: content.cta,
      whyNow: content.whyNow,
      promptSnapshot: content.promptSnapshot,
      referenceAssetKeys: content.referenceAssetKeys,
      scheduledAt: content.scheduledAt,
    },
  };
}

type CreatorRenderRequestDetails = {
  provider: "novita" | "ltx" | "fal_z_image_turbo_lora" | "unassigned";
  scheduledAt: number;
  referenceCount: number;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

/**
 * A render attempt owns a copy of the approved content snapshot. It is a
 * request envelope, not a provider payload, and retries retain it byte-for-
 * byte (as represented by stableSerialize) instead of reading mutable content.
 */
function creatorRenderRequestSnapshot(approval: Doc<"approvalRequests">) {
  return {
    approvalId: String(approval._id),
    resourceType: approval.resourceType,
    resourceId: approval.resourceId,
    planVersion: approval.planVersion,
    approvalSnapshotHash: approval.snapshotHash,
    approvalSnapshot: approval.snapshot,
  };
}

function creatorRenderRequestDetails(requestSnapshot: unknown): CreatorRenderRequestDetails {
  const request = asRecord(requestSnapshot, "creator render request snapshot");
  const approvalSnapshot = asRecord(request.approvalSnapshot, "creator render approval snapshot");
  const content = asRecord(approvalSnapshot.content, "creator render content snapshot");
  const promptSnapshot = asRecord(content.promptSnapshot, "creator render prompt snapshot");
  const provider = promptSnapshot.provider;
  if (provider !== "novita" && provider !== "ltx" && provider !== "fal_z_image_turbo_lora" && provider !== "unassigned") {
    throw new Error("creator render request has an unsupported provider");
  }
  const loraSnapshot = promptSnapshot.loraSnapshot;
  if (provider === "fal_z_image_turbo_lora") {
    const snapshot = asRecord(loraSnapshot, "creator LoRA render snapshot");
    if (
      snapshot.targetModel !== Z_IMAGE_TURBO_BASE_MODEL ||
      typeof snapshot.modelId !== "string" ||
      typeof snapshot.trainingJobId !== "string" ||
      typeof snapshot.triggerWord !== "string" ||
      typeof snapshot.modelArtifactKey !== "string" ||
      typeof snapshot.datasetManifestHash !== "string"
    ) {
      throw new Error("creator LoRA render snapshot is invalid");
    }
    assertControlledCreatorLoraArtifactKey(snapshot.modelArtifactKey, "creator LoRA render artifact");
    if (snapshot.modelArtifactUrl !== undefined) normalizePublicArtifactUrl(String(snapshot.modelArtifactUrl), "creator LoRA render artifact URL");
  } else if (loraSnapshot !== undefined) {
    throw new Error("a creator LoRA snapshot requires the Fal Z-Image Turbo LoRA provider");
  }
  const scheduledAt = content.scheduledAt;
  if (typeof scheduledAt !== "number" || !Number.isFinite(scheduledAt)) {
    throw new Error("creator render request has an invalid schedule");
  }
  const referenceAssetKeys = content.referenceAssetKeys;
  if (referenceAssetKeys !== undefined && (!Array.isArray(referenceAssetKeys) || referenceAssetKeys.some((key) => typeof key !== "string"))) {
    throw new Error("creator render request has invalid reference assets");
  }
  return {
    provider,
    scheduledAt,
    referenceCount: Array.isArray(referenceAssetKeys) ? referenceAssetKeys.length : 0,
  };
}

function creatorRenderAttemptKey(contentId: Id<"creatorContentItems">, reviewVersion: number, attemptNumber: number): string {
  return `creator-render:${contentId}:${reviewVersion}:attempt:${attemptNumber}`;
}

function legacyCreatorRenderActionKey(contentId: Id<"creatorContentItems">, reviewVersion: number): string {
  return `creator-render:${contentId}:${reviewVersion}`;
}

function creatorRenderActionPayload(args: {
  content: Doc<"creatorContentItems">;
  jobId: Id<"creatorRenderJobs">;
  attemptNumber: number;
  provider: CreatorRenderRequestDetails["provider"];
  requestHash: string;
  scheduledAt: number;
  referenceCount: number;
}) {
  return {
    resourceType: CREATOR_CONTENT_APPROVAL_RESOURCE,
    resourceId: String(args.content._id),
    planVersion: args.content.reviewVersion,
    creatorRenderJobId: String(args.jobId),
    attemptNumber: args.attemptNumber,
    provider: args.provider,
    requestHash: args.requestHash,
    scheduledAt: args.scheduledAt,
    referenceAssetCount: args.referenceCount,
  };
}

function creatorRenderStatusForProvider(provider: CreatorRenderRequestDetails["provider"]): "blocked" | "queued" {
  return provider === "unassigned" ? "blocked" : "queued";
}

function assertCreatorRenderRequestIntegrity(job: Doc<"creatorRenderJobs">): CreatorRenderRequestDetails {
  if (snapshotHash(job.requestSnapshot) !== job.requestHash) {
    throw new Error("creator render request snapshot integrity check failed");
  }
  const request = asRecord(job.requestSnapshot, "creator render request snapshot");
  if (request.approvalId !== String(job.approvalId) || request.planVersion !== job.reviewVersion) {
    throw new Error("creator render request is not bound to its approval version");
  }
  const details = creatorRenderRequestDetails(job.requestSnapshot);
  if (details.provider !== job.provider || details.scheduledAt !== job.scheduledAt || details.referenceCount !== job.referenceCount) {
    throw new Error("creator render request metadata does not match its immutable snapshot");
  }
  return details;
}

function assertControlledCreatorRenderAssetKey(value: string, label: string): void {
  const suffix = value.slice("creator-renders/".length);
  if (
    !value.startsWith("creator-renders/") ||
    !suffix ||
    value.length > 1_024 ||
    value.includes("..") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is not a controlled creator render asset key`);
  }
}

function normalizeCreatorRenderCandidateKey(value: string): string {
  const key = normalizeText(value, "creator render candidate key", 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
    throw new Error("creator render candidate key is invalid");
  }
  return key;
}

function normalizeTriggerRunId(value: string): string {
  const runId = normalizeText(value, "Trigger run identity", 256);
  if (/[\u0000-\u001f\u007f]/.test(runId)) throw new Error("Trigger run identity is invalid");
  return runId;
}

function normalizeOptionalRenderDimension(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 16_384) {
    throw new Error(`${label} must be a whole number between 1 and 16384`);
  }
  return value;
}

function normalizeOptionalRenderDuration(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0 || value > 7_200) {
    throw new Error("render duration must be greater than zero and no more than 7200 seconds");
  }
  return value;
}

async function assertCreatorRenderJobLinks(
  ctx: MutationCtx,
  job: Doc<"creatorRenderJobs">,
  content: Doc<"creatorContentItems">,
  approval: Doc<"approvalRequests">,
) {
  if (
    job.organizationId !== content.organizationId ||
    job.creatorId !== content.creatorId ||
    job.contentId !== content._id ||
    job.approvalId !== approval._id ||
    job.reviewVersion !== content.reviewVersion ||
    approval.organizationId !== content.organizationId ||
    approval.resourceType !== CREATOR_CONTENT_APPROVAL_RESOURCE ||
    approval.resourceId !== String(content._id) ||
    approval.planVersion !== content.reviewVersion ||
    approval.actionKind !== CREATOR_CONTENT_APPROVAL_ACTION ||
    approval.status !== "approved"
  ) {
    throw new Error("creator render job is no longer bound to an approved content version");
  }
  assertCreatorRenderRequestIntegrity(job);
  if (!job.actionId) throw new Error("creator render job has no action-ledger record");
  const action = await ctx.db.get(job.actionId);
  if (
    !action ||
    action.organizationId !== content.organizationId ||
    action.approvalId !== approval._id ||
    action.creatorRenderJobId !== job._id ||
    action.actionKind !== CREATOR_RENDER_ACTION ||
    action.idempotencyKey !== job.idempotencyKey
  ) {
    throw new Error("creator render job action-ledger linkage is invalid");
  }
  return action;
}

function assertCreatorRenderActionPayload(
  job: Doc<"creatorRenderJobs">,
  content: Doc<"creatorContentItems">,
  action: Doc<"actionLedger">,
): CreatorRenderRequestDetails {
  const details = assertCreatorRenderRequestIntegrity(job);
  const expected = creatorRenderActionPayload({
    content,
    jobId: job._id,
    attemptNumber: job.attemptNumber,
    provider: details.provider,
    requestHash: job.requestHash,
    scheduledAt: details.scheduledAt,
    referenceCount: details.referenceCount,
  });
  if (
    action.payloadHash !== snapshotHash(expected) ||
    stableSerialize(action.payloadSnapshot) !== stableSerialize(expected)
  ) {
    throw new Error("creator render action payload no longer matches its immutable request");
  }
  return details;
}

async function requireCreatorRenderCandidateContext(ctx: MutationCtx, candidateId: Id<"creatorRenderCandidates">) {
  const candidate = await ctx.db.get(candidateId);
  if (!candidate) throw new Error("creator render candidate not found");
  assertControlledCreatorRenderAssetKey(candidate.assetKey, "creator render asset");
  if (candidate.thumbnailKey) assertControlledCreatorRenderAssetKey(candidate.thumbnailKey, "creator render thumbnail");
  const [job, content] = await Promise.all([ctx.db.get(candidate.jobId), ctx.db.get(candidate.contentId)]);
  if (!job || !content) throw new Error("creator render candidate ownership records are missing");
  const approval = await ctx.db.get(job.approvalId);
  if (!approval) throw new Error("creator render candidate approval record is missing");
  const action = await assertCreatorRenderJobLinks(ctx, job, content, approval);
  if (
    candidate.organizationId !== job.organizationId ||
    candidate.creatorId !== job.creatorId ||
    candidate.contentId !== job.contentId ||
    candidate.attemptNumber !== job.attemptNumber ||
    candidate.provider !== job.provider
  ) {
    throw new Error("creator render candidate does not belong to its render attempt");
  }
  return { candidate, job, content, approval, action };
}

/**
 * Creates a job/action pair inside the current Convex mutation. The three
 * writes are transactionally atomic, so neither an unlinked job nor an
 * unowned paid-action row can survive a failed mutation.
 */
async function createCreatorRenderAttempt(
  ctx: MutationCtx,
  args: {
    content: Doc<"creatorContentItems">;
    approval: Doc<"approvalRequests">;
    requestSnapshot: unknown;
    requestHash: string;
    attemptNumber: number;
    requestedBy: string;
    retryOfJobId?: Id<"creatorRenderJobs">;
    idempotencyKey?: string;
    reusableActionId?: Id<"actionLedger">;
    now: number;
  },
) {
  const details = creatorRenderRequestDetails(args.requestSnapshot);
  if (snapshotHash(args.requestSnapshot) !== args.requestHash) {
    throw new Error("creator render request snapshot integrity check failed");
  }
  const idempotencyKey = args.idempotencyKey ?? creatorRenderAttemptKey(args.content._id, args.content.reviewVersion, args.attemptNumber);
  const existingJob = await ctx.db
    .query("creatorRenderJobs")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (existingJob) {
    if (
      existingJob.organizationId !== args.content.organizationId ||
      existingJob.creatorId !== args.content.creatorId ||
      existingJob.contentId !== args.content._id ||
      existingJob.approvalId !== args.approval._id ||
      existingJob.reviewVersion !== args.content.reviewVersion ||
      existingJob.attemptNumber !== args.attemptNumber ||
      existingJob.requestHash !== args.requestHash
    ) {
      throw new Error("creator render idempotency key is already bound to a different request");
    }
    return { jobId: existingJob._id, actionId: existingJob.actionId, reused: true };
  }

  const reusableAction = args.reusableActionId ? await ctx.db.get(args.reusableActionId) : null;
  if (args.reusableActionId && !reusableAction) throw new Error("creator render action-ledger record is missing");
  if (
    reusableAction &&
    (
      reusableAction.organizationId !== args.content.organizationId ||
      reusableAction.approvalId !== args.approval._id ||
      reusableAction.actionKind !== CREATOR_RENDER_ACTION ||
      reusableAction.idempotencyKey !== idempotencyKey ||
      (reusableAction.creatorRenderJobId !== undefined && reusableAction.creatorRenderJobId !== null)
    )
  ) {
    throw new Error("creator render action-ledger record cannot be reused");
  }

  const status = creatorRenderStatusForProvider(details.provider);
  const jobId = await ctx.db.insert("creatorRenderJobs", {
    organizationId: args.content.organizationId,
    creatorId: args.content.creatorId,
    contentId: args.content._id,
    approvalId: args.approval._id,
    actionId: reusableAction?._id,
    reviewVersion: args.content.reviewVersion,
    provider: details.provider,
    status: reusableAction?.status === "failed" ? "failed" : reusableAction?.status === "cancelled" ? "cancelled" : status,
    attemptNumber: args.attemptNumber,
    maxAttempts: MAX_CREATOR_RENDER_ATTEMPTS,
    idempotencyKey,
    requestHash: args.requestHash,
    requestSnapshot: args.requestSnapshot,
    scheduledAt: details.scheduledAt,
    referenceCount: details.referenceCount,
    retryOfJobId: args.retryOfJobId,
    requestedBy: args.requestedBy,
    createdAt: args.now,
    updatedAt: args.now,
  });

  if (reusableAction) {
    await ctx.db.patch(reusableAction._id, {
      creatorRenderJobId: jobId,
      updatedAt: args.now,
    });
    return { jobId, actionId: reusableAction._id, reused: true };
  }

  const actionPayload = creatorRenderActionPayload({
    content: args.content,
    jobId,
    attemptNumber: args.attemptNumber,
    provider: details.provider,
    requestHash: args.requestHash,
    scheduledAt: details.scheduledAt,
    referenceCount: details.referenceCount,
  });
  const actionId = await ctx.db.insert("actionLedger", {
    organizationId: args.content.organizationId,
    approvalId: args.approval._id,
    creatorRenderJobId: jobId,
    actionKind: CREATOR_RENDER_ACTION,
    riskClass: "moderate",
    status,
    idempotencyKey,
    payloadHash: snapshotHash(actionPayload),
    payloadSnapshot: actionPayload,
    createdAt: args.now,
    updatedAt: args.now,
  });
  await ctx.db.patch(jobId, { actionId, updatedAt: args.now });
  return { jobId, actionId, reused: false };
}

async function requireCreator(ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">, creatorId: Id<"creatorProfiles">) {
  const creator = await ctx.db.get(creatorId);
  if (!creator) throw new Error("creator profile not found");
  return creator;
}

type PersonaRevisionSnapshot = {
  identity: {
    bio?: string;
    identitySummary?: string;
    emotionalBackstory?: string;
    voiceGuide?: string;
    audience?: string;
    disclosure?: string;
    contentPillars: string[];
    boundaries: string[];
    contentBoundaries?: string[];
  };
  visualSystem: {
    promptLock: string;
    promptStyle?: string;
    loraTrigger?: string;
    referenceNotes?: string;
    version: number;
  };
};

function personaRevisionSnapshotFromCreator(creator: Doc<"creatorProfiles">): PersonaRevisionSnapshot {
  return {
    identity: { ...creator.identity },
    visualSystem: { ...creator.visualSystem },
  };
}

function hasOwnField(value: object | undefined, field: string): boolean {
  // Convex may materialise optional object keys as `undefined`; treating that
  // as an edit would silently clear unrelated Persona Bible fields.
  return Boolean(value && (value as Record<string, unknown>)[field] !== undefined);
}

function mergePersonaRevisionSnapshot(
  creator: Doc<"creatorProfiles">,
  identityPatch: {
    bio?: string;
    identitySummary?: string;
    emotionalBackstory?: string;
    voiceGuide?: string;
    audience?: string;
    disclosure?: string;
    contentPillars?: string[];
    boundaries?: string[];
    contentBoundaries?: string[];
  } | undefined,
  visualPatch: {
    promptLock?: string;
    promptStyle?: string;
    loraTrigger?: string;
    referenceNotes?: string;
  } | undefined,
): PersonaRevisionSnapshot {
  const identity = {
    ...creator.identity,
    ...(hasOwnField(identityPatch, "bio") ? { bio: normalizeOptionalText(identityPatch?.bio, "bio", 500) } : {}),
    ...(hasOwnField(identityPatch, "identitySummary") ? { identitySummary: normalizeOptionalText(identityPatch?.identitySummary, "identity summary") } : {}),
    ...(hasOwnField(identityPatch, "emotionalBackstory") ? { emotionalBackstory: normalizeOptionalText(identityPatch?.emotionalBackstory, "emotional backstory") } : {}),
    ...(hasOwnField(identityPatch, "voiceGuide") ? { voiceGuide: normalizeOptionalText(identityPatch?.voiceGuide, "voice guide") } : {}),
    ...(hasOwnField(identityPatch, "audience") ? { audience: normalizeOptionalText(identityPatch?.audience, "audience", 1_000) } : {}),
    ...(hasOwnField(identityPatch, "disclosure") ? { disclosure: normalizeOptionalText(identityPatch?.disclosure, "disclosure", 2_000) } : {}),
    ...(hasOwnField(identityPatch, "contentPillars") ? { contentPillars: normalizeStringList(identityPatch?.contentPillars ?? [], "content pillars") } : {}),
    ...(hasOwnField(identityPatch, "boundaries") ? { boundaries: normalizeStringList(identityPatch?.boundaries ?? [], "boundaries") } : {}),
    ...(hasOwnField(identityPatch, "contentBoundaries") ? { contentBoundaries: normalizeStringList(identityPatch?.contentBoundaries ?? [], "content boundaries") } : {}),
  };
  const requestedVisual = {
    ...creator.visualSystem,
    ...(hasOwnField(visualPatch, "promptLock") ? { promptLock: normalizeText(visualPatch?.promptLock ?? "", "prompt lock") } : {}),
    ...(hasOwnField(visualPatch, "promptStyle") ? { promptStyle: normalizeOptionalText(visualPatch?.promptStyle, "prompt style") } : {}),
    ...(hasOwnField(visualPatch, "loraTrigger") ? { loraTrigger: normalizeOptionalText(visualPatch?.loraTrigger, "LoRA trigger", 200) } : {}),
    ...(hasOwnField(visualPatch, "referenceNotes") ? { referenceNotes: normalizeOptionalText(visualPatch?.referenceNotes, "reference notes") } : {}),
  };
  const visualChanged = requestedVisual.promptLock !== creator.visualSystem.promptLock
    || requestedVisual.promptStyle !== creator.visualSystem.promptStyle
    || requestedVisual.loraTrigger !== creator.visualSystem.loraTrigger
    || requestedVisual.referenceNotes !== creator.visualSystem.referenceNotes;
  return {
    identity,
    visualSystem: {
      ...requestedVisual,
      version: visualChanged ? creator.visualSystem.version + 1 : creator.visualSystem.version,
    },
  };
}

function assertPersonaRevisionIntegrity(revision: Doc<"creatorPersonaRevisions">): void {
  if (!Number.isInteger(revision.revisionNumber) || revision.revisionNumber < 1 || revision.revisionNumber > MAX_PERSONA_REVISIONS_PER_CREATOR) {
    throw new Error("creator persona revision number is invalid");
  }
  if (snapshotHash(revision.snapshot) !== revision.snapshotHash) {
    throw new Error("creator persona revision snapshot integrity check failed");
  }
  normalizeText(revision.snapshot.visualSystem.promptLock, "persona revision prompt lock");
  assertPositiveWhole(revision.snapshot.visualSystem.version, "persona revision visual version", 1_000_000);
}

async function insertPersonaRevision(
  ctx: MutationCtx,
  args: {
    creator: Doc<"creatorProfiles">;
    revisionNumber: number;
    status: "active" | "superseded";
    source: "baseline" | "operator_edit" | "legacy_sync";
    snapshot: PersonaRevisionSnapshot;
    changeNote?: string;
    createdBy: string;
    createdAt: number;
    activatedBy?: string;
    activatedAt?: number;
    supersededAt?: number;
    supersededBy?: string;
  },
) {
  if (args.revisionNumber > MAX_PERSONA_REVISIONS_PER_CREATOR) {
    throw new Error(`a creator may have at most ${MAX_PERSONA_REVISIONS_PER_CREATOR} persona revisions`);
  }
  return await ctx.db.insert("creatorPersonaRevisions", {
    organizationId: args.creator.organizationId,
    creatorId: args.creator._id,
    revisionNumber: args.revisionNumber,
    status: args.status,
    source: args.source,
    snapshot: args.snapshot,
    snapshotHash: snapshotHash(args.snapshot),
    changeNote: args.changeNote,
    createdBy: args.createdBy,
    createdAt: args.createdAt,
    activatedBy: args.activatedBy,
    activatedAt: args.activatedAt,
    supersededAt: args.supersededAt,
    supersededBy: args.supersededBy,
  });
}

/**
 * Profiles created before the revision system get one baseline lazily. If a
 * legacy direct profile mutation changed the active snapshot, preserve that
 * new state as a labelled sync revision instead of rewriting history.
 */
async function ensureActivePersonaRevision(ctx: MutationCtx, creator: Doc<"creatorProfiles">) {
  const currentSnapshot = personaRevisionSnapshotFromCreator(creator);
  const now = Date.now();
  if (creator.activePersonaRevisionId) {
    const active = await ctx.db.get(creator.activePersonaRevisionId);
    if (
      !active ||
      active.organizationId !== creator.organizationId ||
      active.creatorId !== creator._id ||
      active.status !== "active" ||
      creator.activePersonaRevisionNumber !== active.revisionNumber
    ) {
      throw new Error("creator active persona revision linkage is invalid");
    }
    assertPersonaRevisionIntegrity(active);
    if (active.snapshotHash === snapshotHash(currentSnapshot) && stableSerialize(active.snapshot) === stableSerialize(currentSnapshot)) {
      return active;
    }
    const revisionId = await insertPersonaRevision(ctx, {
      creator,
      revisionNumber: active.revisionNumber + 1,
      status: "active",
      source: "legacy_sync",
      snapshot: currentSnapshot,
      changeNote: "Profile state synchronised from a legacy direct update.",
      createdBy: "system:profile-sync",
      createdAt: now,
      activatedBy: "system:profile-sync",
      activatedAt: now,
    });
    await ctx.db.patch(active._id, { status: "superseded", supersededAt: now, supersededBy: "system:profile-sync" });
    await ctx.db.patch(creator._id, {
      activePersonaRevisionId: revisionId,
      activePersonaRevisionNumber: active.revisionNumber + 1,
      updatedAt: now,
    });
    const revision = await ctx.db.get(revisionId);
    if (!revision) throw new Error("failed to create creator persona sync revision");
    return revision;
  }
  const revisions = await ctx.db
    .query("creatorPersonaRevisions")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .collect();
  const revisionNumber = Math.max(0, ...revisions.map((revision) => revision.revisionNumber)) + 1;
  const revisionId = await insertPersonaRevision(ctx, {
    creator,
    revisionNumber,
    status: "active",
    source: "baseline",
    snapshot: currentSnapshot,
    changeNote: "Baseline captured from the existing creator profile.",
    createdBy: "system:profile-baseline",
    createdAt: now,
    activatedBy: "system:profile-baseline",
    activatedAt: now,
  });
  await ctx.db.patch(creator._id, { activePersonaRevisionId: revisionId, activePersonaRevisionNumber: revisionNumber, updatedAt: now });
  const revision = await ctx.db.get(revisionId);
  if (!revision) throw new Error("failed to create creator persona baseline revision");
  return revision;
}

async function requireAccountForCreator(ctx: MutationCtx, creator: Doc<"creatorProfiles">, accountId: Id<"creatorSocialAccounts">) {
  const account = await ctx.db.get(accountId);
  if (!account || account.creatorId !== creator._id || account.organizationId !== creator.organizationId) {
    throw new Error("creator account does not belong to this profile");
  }
  return account;
}

async function requireDestinationForCreator(ctx: MutationCtx, creator: Doc<"creatorProfiles">, destinationId: Id<"creatorDestinations">) {
  const destination = await ctx.db.get(destinationId);
  if (!destination || destination.creatorId !== creator._id || destination.organizationId !== creator.organizationId) {
    throw new Error("creator destination does not belong to this profile");
  }
  return destination;
}

async function requireContentForCreator(ctx: MutationCtx, creator: Doc<"creatorProfiles">, contentId: Id<"creatorContentItems">) {
  const content = await ctx.db.get(contentId);
  if (!content || content.creatorId !== creator._id || content.organizationId !== creator.organizationId) {
    throw new Error("creator content item does not belong to this profile");
  }
  return content;
}

type FunnelStagePlanInput = {
  stage: "awareness" | "trust" | "consideration" | "conversion" | "retention";
  label: string;
  purpose: string;
  ctaText: string;
};

type FunnelComplianceInput = {
  disclosureRequired: boolean;
  disclosureText?: string;
  ageGateRequired: boolean;
  ageGateEvidenceReference?: string;
  operatorAttestation: { attestedBy: string; statement: string; confirmed: boolean };
};

type FunnelLinkPolicyInput = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContentPrefix?: string;
};

function normalizeUtmToken(value: string, label: string, maxLength = 120): string {
  const normalized = normalizeText(value, label, maxLength).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._~-]*$/.test(normalized)) {
    throw new Error(`${label} must use lowercase letters, numbers, periods, underscores, tildes, or hyphens`);
  }
  return normalized;
}

function normalizeFunnelStages(stages: FunnelStagePlanInput[]) {
  if (!stages.length || stages.length > MAX_FUNNEL_STAGES) {
    throw new Error(`a funnel must include between 1 and ${MAX_FUNNEL_STAGES} stages`);
  }
  const seen = new Set<string>();
  return stages.map((stage) => {
    if (seen.has(stage.stage)) throw new Error("funnel stages must not repeat");
    seen.add(stage.stage);
    return {
      stage: stage.stage,
      label: normalizeText(stage.label, "funnel stage label", 120),
      purpose: normalizeText(stage.purpose, "funnel stage purpose", 1_000),
      ctaText: normalizeText(stage.ctaText, "funnel stage CTA", 500),
    };
  });
}

function funnelDestinationLinkMetadata(destination: Doc<"creatorDestinations">) {
  let parsed: URL;
  try {
    parsed = new URL(destination.url);
  } catch {
    throw new Error("funnel destination URL is invalid");
  }
  // UTM values are stored separately. Refusing an existing query/hash keeps
  // this record from becoming a container for expiring or secret link data.
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("funnel destinations must be HTTPS URLs without credentials, query parameters, or fragments");
  }
  const destinationHost = parsed.host.toLowerCase();
  if (!destinationHost) throw new Error("funnel destination host is invalid");
  const canonicalPath = parsed.pathname || "/";
  return {
    destinationHost,
    destinationUrlHash: snapshotHash({ protocol: parsed.protocol, host: destinationHost, path: canonicalPath }),
  };
}

function normalizeFunnelCompliance(
  input: FunnelComplianceInput,
  destination: Doc<"creatorDestinations">,
  now: number,
) {
  const restrictedDestination = destination.kind === "fanvue" || destination.kind === "fansly";
  const disclosureRequired = input.disclosureRequired || restrictedDestination;
  const ageGateRequired = input.ageGateRequired || destination.ageGateRequired || restrictedDestination;
  if (destination.ageGateRequired && !input.ageGateRequired) {
    throw new Error("this destination requires the funnel to retain its age-gate requirement");
  }
  if (restrictedDestination && (!destination.ageGateRequired || !destination.disclosureText)) {
    throw new Error("subscription destinations require an active destination disclosure and age-gate requirement");
  }
  const disclosureText = normalizeOptionalText(input.disclosureText, "funnel disclosure", 1_000);
  if (disclosureRequired && !disclosureText) throw new Error("this funnel requires disclosure text");
  if (!input.operatorAttestation.confirmed) throw new Error("funnel compliance must be explicitly attested by an operator");
  const ageGateEvidenceReference = normalizeOptionalText(input.ageGateEvidenceReference, "age-gate evidence reference", 1_000);
  if (ageGateRequired && !ageGateEvidenceReference) {
    throw new Error("an age-gated funnel requires an operator evidence reference");
  }
  return {
    disclosureRequired,
    disclosureText,
    ageGateRequired,
    ageGateEvidenceReference,
    operatorAttestation: {
      attestedBy: normalizeText(input.operatorAttestation.attestedBy, "funnel attested by", 200),
      statement: normalizeText(input.operatorAttestation.statement, "funnel compliance attestation", 2_000),
      confirmed: true as const,
      attestedAt: now,
    },
  };
}

function normalizeFunnelLinkPolicy(destination: Doc<"creatorDestinations">, input: FunnelLinkPolicyInput) {
  return {
    utmSource: normalizeUtmToken(input.utmSource, "UTM source"),
    utmMedium: normalizeUtmToken(input.utmMedium, "UTM medium"),
    utmCampaign: normalizeUtmToken(input.utmCampaign, "UTM campaign"),
    utmContentPrefix: input.utmContentPrefix === undefined
      ? undefined
      : normalizeUtmToken(input.utmContentPrefix, "UTM content prefix"),
    ...funnelDestinationLinkMetadata(destination),
  };
}

function creatorFunnelReviewSnapshot(funnel: Doc<"creatorFunnelCampaigns">) {
  return {
    resourceType: CREATOR_FUNNEL_APPROVAL_RESOURCE,
    resourceId: String(funnel._id),
    planVersion: funnel.version,
    funnel: {
      creatorId: String(funnel.creatorId),
      destinationId: String(funnel.destinationId),
      campaignLabel: funnel.campaignLabel,
      objective: funnel.objective,
      stages: funnel.stages,
      compliance: funnel.compliance,
      linkPolicy: funnel.linkPolicy,
    },
  };
}

function creatorFunnelContentSnapshot(
  funnel: Doc<"creatorFunnelCampaigns">,
  destination: Doc<"creatorDestinations">,
  stage: "awareness" | "trust" | "consideration" | "conversion" | "retention",
) {
  const stagePlan = funnel.stages.find((item) => item.stage === stage);
  if (!stagePlan) throw new Error("the selected content stage is not enabled by this funnel");
  const payload = {
    funnelId: funnel._id,
    version: funnel.version,
    campaignLabel: funnel.campaignLabel,
    objective: funnel.objective,
    destinationId: destination._id,
    destinationKind: destination.kind,
    stage,
    stageLabel: stagePlan.label,
    stagePurpose: stagePlan.purpose,
    ctaText: stagePlan.ctaText,
    linkPolicy: funnel.linkPolicy,
    compliance: funnel.compliance,
  };
  return { ...payload, snapshotHash: snapshotHash(payload) };
}

function assertContentFunnelSnapshotIntegrity(content: Doc<"creatorContentItems">) {
  if (!content.funnelId && !content.funnelSnapshot) return undefined;
  if (!content.funnelId || !content.funnelSnapshot || content.funnelSnapshot.funnelId !== content.funnelId) {
    throw new Error("content funnel linkage is invalid");
  }
  const snapshot = content.funnelSnapshot;
  const { snapshotHash: storedSnapshotHash, ...payload } = snapshot;
  if (snapshotHash(payload) !== storedSnapshotHash) throw new Error("content funnel snapshot integrity check failed");
  if (content.destinationId !== snapshot.destinationId || content.funnelStage !== snapshot.stage || content.cta !== snapshot.ctaText) {
    throw new Error("content does not match its frozen funnel rules");
  }
  return snapshot;
}

async function requireActiveFunnelForContent(ctx: MutationCtx, content: Doc<"creatorContentItems">) {
  const snapshot = assertContentFunnelSnapshotIntegrity(content);
  if (!snapshot) return undefined;
  const [funnel, destination] = await Promise.all([ctx.db.get(snapshot.funnelId), ctx.db.get(snapshot.destinationId)]);
  if (
    !funnel ||
    !destination ||
    funnel.organizationId !== content.organizationId ||
    funnel.creatorId !== content.creatorId ||
    funnel.destinationId !== destination._id ||
    destination.organizationId !== content.organizationId ||
    destination.creatorId !== content.creatorId ||
    funnel.status !== "active" ||
    destination.status !== "active" ||
    funnel.version !== snapshot.version
  ) {
    throw new Error("the content funnel is not active and cannot admit a new provider action");
  }
  const expected = creatorFunnelContentSnapshot(funnel, destination, content.funnelStage);
  if (stableSerialize(expected) !== stableSerialize(snapshot)) {
    throw new Error("content funnel rules changed; create and review a new content plan");
  }
  return { funnel, destination, snapshot };
}

type MetaInstagramPublishFormat = "feed" | "reel";

function metaInstagramPublishFormatForContent(
  content: Doc<"creatorContentItems">,
  candidate: Doc<"creatorRenderCandidates">,
): MetaInstagramPublishFormat {
  if (content.format === "image") {
    if (candidate.mediaType !== "image") throw new Error("an Instagram feed post requires an approved image render");
    return "feed";
  }
  if (content.format === "reel" || content.format === "short") {
    if (candidate.mediaType !== "video") throw new Error("an Instagram reel requires an approved video render");
    return "reel";
  }
  // One selected candidate cannot faithfully represent a carousel, and the
  // current generated story pipeline has no separately approved on-media text
  // representation. Refuse both rather than silently publishing a different
  // format or dropping the approved editorial copy.
  throw new Error("Meta Instagram dispatch currently supports approved image feed posts and video reels only; publish this format manually");
}

function requiredMetaInstagramCapability(format: MetaInstagramPublishFormat): "publish_feed" | "publish_reel" {
  return format === "feed" ? "publish_feed" : "publish_reel";
}

type MetaInstagramPublishContext = {
  creator: Doc<"creatorProfiles">;
  content: Doc<"creatorContentItems">;
  account: Doc<"creatorSocialAccounts">;
  connection: Doc<"integrationConnections">;
  candidate: Doc<"creatorRenderCandidates">;
  contentApproval: Doc<"approvalRequests">;
  format: MetaInstagramPublishFormat;
  requiredCapability: "publish_feed" | "publish_reel";
};

/**
 * Revalidates every currently mutable governance edge before the action is
 * admitted, queued, or claimed. This is intentionally stricter than the
 * earlier render approval because an external publish is a new side effect.
 */
async function requireMetaInstagramPublishContext(
  ctx: MutationCtx,
  content: Doc<"creatorContentItems">,
): Promise<MetaInstagramPublishContext> {
  if (!content.selectedRenderCandidateId) throw new Error("select an approved render candidate before requesting Meta Instagram publication");
  const candidateContext = await requireCreatorRenderCandidateContext(ctx, content.selectedRenderCandidateId);
  if (candidateContext.content._id !== content._id || candidateContext.candidate.status !== "selected") {
    throw new Error("selected render candidate state is invalid for Meta Instagram publication");
  }
  if (!content.approvalId || content.reviewStatus !== "approved" || candidateContext.approval._id !== content.approvalId) {
    throw new Error("Meta Instagram publication requires an approved immutable content version");
  }
  const expectedContentApproval = contentApprovalSnapshot(content);
  if (
    candidateContext.approval.status !== "approved" ||
    candidateContext.approval.snapshotHash !== snapshotHash(expectedContentApproval) ||
    stableSerialize(candidateContext.approval.snapshot) !== stableSerialize(expectedContentApproval)
  ) {
    throw new Error("approved content snapshot is invalid for Meta Instagram publication");
  }
  const creator = await requireCreator(ctx, content.creatorId);
  if (!content.accountId) throw new Error("assign a connected official Instagram account before requesting publication");
  const account = await requireAccountForCreator(ctx, creator, content.accountId);
  if (account.platform !== "instagram" || account.status !== "connected" || account.health !== "healthy") {
    throw new Error("Meta Instagram publication requires a healthy connected official Instagram account");
  }
  if (!account.integrationConnectionId || !account.externalAccountId) {
    throw new Error("Meta Instagram publication requires a bound official account connection and Instagram user id");
  }
  const connection = await ctx.db.get(account.integrationConnectionId);
  if (
    !connection ||
    connection.organizationId !== creator.organizationId ||
    connection.provider !== "meta_instagram" ||
    connection.status !== "connected" ||
    connection.health !== "healthy" ||
    !connection.externalAccountId ||
    connection.externalAccountId !== account.externalAccountId
  ) {
    throw new Error("Meta Instagram connection is not an active verified professional account connection");
  }
  const requiredCapability = requiredMetaInstagramCapability(metaInstagramPublishFormatForContent(content, candidateContext.candidate));
  if (!connection.capabilities.includes(requiredCapability) || !account.capabilities.includes(requiredCapability)) {
    throw new Error(`Meta Instagram account lacks the required ${requiredCapability} capability`);
  }
  const requiredScopes = ["instagram_business_basic", "instagram_business_content_publish"];
  if (requiredScopes.some((scope) => !connection.scopes.includes(scope))) {
    throw new Error("Meta Instagram connection lacks the required official content-publishing scopes");
  }
  assertControlledCreatorRenderAssetKey(candidateContext.candidate.assetKey, "selected Meta Instagram render asset");
  return {
    creator,
    content,
    account,
    connection,
    candidate: candidateContext.candidate,
    contentApproval: candidateContext.approval,
    format: metaInstagramPublishFormatForContent(content, candidateContext.candidate),
    requiredCapability,
  };
}

function metaInstagramPublishActionKey(context: MetaInstagramPublishContext): string {
  return `creator-meta-instagram-publish:${context.content._id}:${context.content.reviewVersion}:${context.candidate._id}`;
}

function metaInstagramPublishSnapshot(context: MetaInstagramPublishContext) {
  return {
    resourceType: CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_RESOURCE,
    resourceId: String(context.content._id),
    planVersion: context.content.reviewVersion,
    provider: "meta_instagram" as const,
    type: "instagram.publish" as const,
    content: {
      contentId: String(context.content._id),
      contentReviewVersion: context.content.reviewVersion,
      contentApprovalId: String(context.contentApproval._id),
      contentApprovalHash: context.contentApproval.snapshotHash,
      scheduledAt: context.content.scheduledAt,
      format: context.format,
      caption: context.content.caption,
    },
    account: {
      accountId: String(context.account._id),
      connectionId: String(context.connection._id),
      igUserId: context.account.externalAccountId,
      requiredCapability: context.requiredCapability,
    },
    media: {
      candidateId: String(context.candidate._id),
      assetKey: context.candidate.assetKey,
      mediaType: context.candidate.mediaType,
    },
  };
}

async function requireMetaInstagramPublishAction(
  ctx: MutationCtx,
  context: MetaInstagramPublishContext,
) {
  const idempotencyKey = metaInstagramPublishActionKey(context);
  const action = await ctx.db
    .query("actionLedger")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (!action || !action.approvalId) throw new Error("Meta Instagram publish action is missing");
  const snapshot = metaInstagramPublishSnapshot(context);
  if (
    action.organizationId !== context.content.organizationId ||
    action.connectionId !== context.connection._id ||
    action.actionKind !== CREATOR_META_INSTAGRAM_PUBLISH_DISPATCH_ACTION ||
    action.idempotencyKey !== idempotencyKey ||
    action.payloadHash !== snapshotHash(snapshot) ||
    stableSerialize(action.payloadSnapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("Meta Instagram publish action is not bound to the approved content and account snapshot");
  }
  const approval = await ctx.db.get(action.approvalId);
  if (
    !approval ||
    approval.organizationId !== context.content.organizationId ||
    approval.resourceType !== CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_RESOURCE ||
    approval.resourceId !== String(context.content._id) ||
    approval.planVersion !== context.content.reviewVersion ||
    approval.actionKind !== CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_ACTION ||
    approval.snapshotHash !== snapshotHash(snapshot) ||
    stableSerialize(approval.snapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("Meta Instagram publish approval is not bound to the immutable publish snapshot");
  }
  return { action, approval, snapshot };
}

function normalizeMetaInstagramProviderId(value: string, label: string): string {
  const normalized = normalizeText(value, label, 240);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function metaInstagramContainerFromReceipt(receipt: unknown): string | undefined {
  if (receipt === undefined) return undefined;
  const value = asRecord(receipt, "Meta Instagram provider receipt");
  if (value.provider !== "meta_instagram") throw new Error("Meta Instagram action has a different provider receipt");
  if (value.containerId === undefined) return undefined;
  if (typeof value.containerId !== "string") throw new Error("Meta Instagram provider receipt container id is invalid");
  return normalizeMetaInstagramProviderId(value.containerId, "Meta Instagram container id");
}

function metaInstagramMediaFromReceipt(receipt: unknown): string | undefined {
  if (receipt === undefined) return undefined;
  const value = asRecord(receipt, "Meta Instagram provider receipt");
  if (value.provider !== "meta_instagram") throw new Error("Meta Instagram action has a different provider receipt");
  if (value.mediaId === undefined) return undefined;
  if (typeof value.mediaId !== "string") throw new Error("Meta Instagram provider receipt media id is invalid");
  return normalizeMetaInstagramProviderId(value.mediaId, "Meta Instagram media id");
}

function safeMetaInstagramWorkspaceRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Safe metadata projection for the operator workspace. Full action snapshots
 * contain caption and controlled asset lineage for the worker, so they never
 * leave this internal query. The provider receipt is reduced to identifiers
 * that an operator may use to manually verify an outcome in Meta.
 */
function metaInstagramPublishWorkspaceAction(action: Doc<"actionLedger">) {
  const snapshot = safeMetaInstagramWorkspaceRecord(action.payloadSnapshot);
  const content = safeMetaInstagramWorkspaceRecord(snapshot?.content);
  const receipt = safeMetaInstagramWorkspaceRecord(action.providerReceipt);
  const contentId = typeof content?.contentId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(content.contentId)
    ? content.contentId
    : undefined;
  const containerId = typeof receipt?.containerId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(receipt.containerId)
    ? receipt.containerId
    : undefined;
  const mediaId = typeof receipt?.mediaId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(receipt.mediaId)
    ? receipt.mediaId
    : undefined;
  return {
    _id: action._id,
    contentId,
    status: action.status,
    approvalId: action.approvalId,
    error: action.error?.slice(0, 500),
    providerReceipt: receipt?.provider === "meta_instagram" && (containerId || mediaId)
      ? { provider: "meta_instagram" as const, containerId, mediaId }
      : undefined,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

const POSTIZ_SCHEDULABLE_PLATFORMS = new Set([
  "instagram",
  "tiktok",
  "youtube",
  "pinterest",
  "x",
  "facebook",
  "threads",
  "linkedin",
  "bluesky",
]);
const POSTIZ_MINIMUM_FUTURE_SCHEDULE_MS = 60_000;

type PostizContentFormat = "image" | "carousel" | "reel" | "story" | "short" | "text" | "subscription_post";
type PostizScheduleSettings =
  | { __type: "instagram" | "instagram-standalone" }
  | {
    __type: "x";
    replyAudience: "everyone" | "following" | "mentionedUsers" | "subscribers" | "verified";
    madeWithAi: boolean;
    paidPartnership: boolean;
  }
  | {
    __type: "tiktok";
    privacyLevel: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY";
    duet: boolean;
    stitch: boolean;
    comments: boolean;
    autoAddMusic: "yes" | "no";
    brandContent: boolean;
    brandOrganic: boolean;
    contentPostingMethod: "DIRECT_POST" | "UPLOAD";
    videoMadeWithAi: boolean;
  }
  | { __type: "youtube"; visibility: "public" | "unlisted" | "private"; madeForKids: "yes" | "no" }
  | { __type: "pinterest"; board: string }
  | { __type: "facebook" | "threads" | "linkedin" | "bluesky" };

type PostizScheduleContext = {
  creator: Doc<"creatorProfiles">;
  content: Doc<"creatorContentItems">;
  account: Doc<"creatorSocialAccounts">;
  connection: Doc<"integrationConnections">;
  candidate: Doc<"creatorRenderCandidates">;
  contentApproval: Doc<"approvalRequests">;
};

type PostizScheduleSnapshotDetails = {
  organizationId: string;
  creatorId: string;
  contentId: string;
  contentReviewVersion: number;
  contentReviewHash: string;
  title: string;
  format: PostizContentFormat;
  scheduledAt: number;
  accountId: string;
  connectionId: string;
  integrationId: string;
  platform: string;
  candidateId: string;
  assetKey: string;
  mediaType: "image" | "video";
  postizSettings: PostizScheduleSettings;
};

function normalizePostizProviderId(value: string, label: string): string {
  const normalized = normalizeText(value, label, 240);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function normalizePostizScheduledAt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requiredPostizPlatform(value: unknown): string {
  if (typeof value !== "string" || !POSTIZ_SCHEDULABLE_PLATFORMS.has(value)) {
    throw new Error("Postiz account platform is not supported by the governed scheduler");
  }
  return value;
}

function requiredPostizContentFormat(value: unknown): PostizContentFormat {
  if (
    value !== "image"
    && value !== "carousel"
    && value !== "reel"
    && value !== "story"
    && value !== "short"
    && value !== "text"
    && value !== "subscription_post"
  ) {
    throw new Error("Postiz schedule content format is invalid");
  }
  return value;
}

function requiredPostizBoolean(record: Record<string, unknown>, key: string): boolean {
  if (typeof record[key] !== "boolean") throw new Error(`Postiz ${key} setting is required`);
  return record[key];
}

function assertPostizScheduleIsSafelyFuture(scheduledAt: number, phase: string): void {
  if (scheduledAt <= Date.now() + POSTIZ_MINIMUM_FUTURE_SCHEDULE_MS) {
    throw new Error(`${phase} requires a schedule more than 60 seconds in the future; it will not be converted into immediate publishing`);
  }
}

/**
 * Converts a Convex-validated public settings union into a canonical frozen
 * policy, and rejects any account/platform/media combination that the worker
 * would otherwise have to guess about. There are no default disclosures,
 * visibility values, or provider-side schedule modes.
 */
function normalizePostizScheduleSettings(
  value: unknown,
  platformValue: unknown,
  format: PostizContentFormat,
  mediaType: "image" | "video",
  titleValue: string,
): PostizScheduleSettings {
  const platform = requiredPostizPlatform(platformValue);
  const settings = asRecord(value, "Postiz schedule settings");
  const type = settings.__type;
  if (typeof type !== "string") throw new Error("Postiz schedule settings type is required");

  if (type === "instagram" || type === "instagram-standalone") {
    if (platform !== "instagram") throw new Error("Instagram Postiz settings do not match the linked account platform");
    if (format === "carousel") {
      throw new Error("Instagram carousel scheduling is unsupported until a multi-asset Postiz schedule is approved");
    }
    if (format !== "image" && format !== "reel" && format !== "short" && format !== "story") {
      throw new Error("Instagram Postiz scheduling requires an image, reel, short, or story content format");
    }
    return { __type: type };
  }
  if (type === "x") {
    if (platform !== "x") throw new Error("X Postiz settings do not match the linked account platform");
    const replyAudience = settings.replyAudience;
    if (
      replyAudience !== "everyone"
      && replyAudience !== "following"
      && replyAudience !== "mentionedUsers"
      && replyAudience !== "subscribers"
      && replyAudience !== "verified"
    ) {
      throw new Error("X replyAudience setting is invalid");
    }
    return {
      __type: "x",
      replyAudience,
      madeWithAi: requiredPostizBoolean(settings, "madeWithAi"),
      paidPartnership: requiredPostizBoolean(settings, "paidPartnership"),
    };
  }
  if (type === "tiktok") {
    if (platform !== "tiktok") throw new Error("TikTok Postiz settings do not match the linked account platform");
    if (mediaType !== "video") throw new Error("TikTok Postiz scheduling requires an approved video render");
    const privacyLevel = settings.privacyLevel;
    if (
      privacyLevel !== "PUBLIC_TO_EVERYONE"
      && privacyLevel !== "MUTUAL_FOLLOW_FRIENDS"
      && privacyLevel !== "FOLLOWER_OF_CREATOR"
      && privacyLevel !== "SELF_ONLY"
    ) {
      throw new Error("TikTok privacyLevel setting is invalid");
    }
    if (settings.autoAddMusic !== "yes" && settings.autoAddMusic !== "no") {
      throw new Error("TikTok autoAddMusic setting is required");
    }
    if (settings.contentPostingMethod !== "DIRECT_POST" && settings.contentPostingMethod !== "UPLOAD") {
      throw new Error("TikTok contentPostingMethod setting is invalid");
    }
    if (settings.contentPostingMethod !== "DIRECT_POST") {
      throw new Error("TikTok UPLOAD mode cannot be used for a governed Postiz schedule; choose DIRECT_POST");
    }
    return {
      __type: "tiktok",
      privacyLevel,
      duet: requiredPostizBoolean(settings, "duet"),
      stitch: requiredPostizBoolean(settings, "stitch"),
      comments: requiredPostizBoolean(settings, "comments"),
      autoAddMusic: settings.autoAddMusic,
      brandContent: requiredPostizBoolean(settings, "brandContent"),
      brandOrganic: requiredPostizBoolean(settings, "brandOrganic"),
      contentPostingMethod: "DIRECT_POST",
      videoMadeWithAi: requiredPostizBoolean(settings, "videoMadeWithAi"),
    };
  }
  if (type === "youtube") {
    if (platform !== "youtube") throw new Error("YouTube Postiz settings do not match the linked account platform");
    if (mediaType !== "video") throw new Error("YouTube Postiz scheduling requires an approved video render");
    if (settings.visibility !== "public" && settings.visibility !== "unlisted" && settings.visibility !== "private") {
      throw new Error("YouTube visibility setting is invalid");
    }
    if (settings.madeForKids !== "yes" && settings.madeForKids !== "no") {
      throw new Error("YouTube madeForKids setting is required");
    }
    const title = normalizeText(titleValue, "YouTube schedule title", 100);
    if (title.length < 2) throw new Error("YouTube schedule title must contain at least 2 characters");
    return { __type: "youtube", visibility: settings.visibility, madeForKids: settings.madeForKids };
  }
  if (type === "pinterest") {
    if (platform !== "pinterest") throw new Error("Pinterest Postiz settings do not match the linked account platform");
    if (typeof settings.board !== "string") throw new Error("Pinterest board setting is required");
    return { __type: "pinterest", board: normalizePostizProviderId(settings.board, "Pinterest board id") };
  }
  if (type === "facebook" || type === "threads" || type === "linkedin" || type === "bluesky") {
    if (platform !== type) throw new Error("Postiz settings do not match the linked account platform");
    return { __type: type };
  }
  throw new Error("Postiz settings type is unsupported");
}

/**
 * The current account/render state is checked while an operator is creating,
 * approving, or explicitly queueing an action. The worker later receives an
 * immutable copy of these exact values instead of re-reading mutable copy,
 * account, or selected-render fields.
 */
async function requirePostizScheduleContext(
  ctx: MutationCtx,
  content: Doc<"creatorContentItems">,
): Promise<PostizScheduleContext> {
  if (!content.selectedRenderCandidateId) {
    throw new Error("select an approved render candidate before requesting Postiz scheduling");
  }
  const candidateContext = await requireCreatorRenderCandidateContext(ctx, content.selectedRenderCandidateId);
  if (
    candidateContext.content._id !== content._id
    || candidateContext.candidate.status !== "selected"
    || candidateContext.job.status !== "selected"
    || candidateContext.action.status !== "succeeded"
  ) {
    throw new Error("selected render candidate state is invalid for Postiz scheduling");
  }
  if (!content.approvalId || content.reviewStatus !== "approved" || candidateContext.approval._id !== content.approvalId) {
    throw new Error("Postiz scheduling requires an approved immutable content version");
  }
  const expectedContentApproval = contentApprovalSnapshot(content);
  if (
    candidateContext.approval.status !== "approved"
    || candidateContext.approval.snapshotHash !== snapshotHash(expectedContentApproval)
    || stableSerialize(candidateContext.approval.snapshot) !== stableSerialize(expectedContentApproval)
  ) {
    throw new Error("approved content snapshot is invalid for Postiz scheduling");
  }
  const creator = await requireCreator(ctx, content.creatorId);
  if (!content.accountId) throw new Error("assign a connected Postiz account before requesting scheduling");
  const account = await requireAccountForCreator(ctx, creator, content.accountId);
  if (
    !POSTIZ_SCHEDULABLE_PLATFORMS.has(account.platform)
    || account.publisher !== "postiz"
    || account.status !== "connected"
    || account.health === "unhealthy"
    || !account.integrationConnectionId
    || !account.externalAccountId
    || !account.capabilities.includes(POSTIZ_SCHEDULE_REQUIRED_CAPABILITY)
  ) {
    throw new Error("Postiz scheduling requires a connected account with schedule_content capability");
  }
  const connection = await ctx.db.get(account.integrationConnectionId);
  if (
    !connection
    || connection.organizationId !== creator.organizationId
    || connection.provider !== "postiz"
    || connection.status !== "connected"
    || connection.health === "unhealthy"
    || !connection.externalAccountId
    || connection.externalAccountId !== account.externalAccountId
    || !connection.capabilities.includes(POSTIZ_SCHEDULE_REQUIRED_CAPABILITY)
  ) {
    throw new Error("Postiz connection is not an active account-bound scheduler integration");
  }
  assertControlledCreatorRenderAssetKey(candidateContext.candidate.assetKey, "selected Postiz render asset");
  return {
    creator,
    content,
    account,
    connection,
    candidate: candidateContext.candidate,
    contentApproval: candidateContext.approval,
  };
}

function postizScheduleActionKey(context: PostizScheduleContext): string {
  return `creator-postiz-schedule:${context.content._id}:${context.content.reviewVersion}`;
}

/**
 * This is a scheduler envelope, not a social-network publish request. It is
 * copied byte-for-byte into both approval and action rows so the worker has no
 * reason to infer a channel, caption, selected asset, or delivery time.
 */
function postizScheduleSnapshot(context: PostizScheduleContext, settings: PostizScheduleSettings) {
  return {
    resourceType: CREATOR_POSTIZ_SCHEDULE_APPROVAL_RESOURCE,
    resourceId: String(context.content._id),
    planVersion: context.content.reviewVersion,
    provider: "postiz" as const,
    execution: "postiz_scheduled" as const,
    organizationId: String(context.content.organizationId),
    creatorId: String(context.creator._id),
    content: {
      contentId: String(context.content._id),
      contentReviewVersion: context.content.reviewVersion,
      contentReviewHash: context.contentApproval.snapshotHash,
      contentApprovalId: String(context.contentApproval._id),
      title: context.content.title,
      format: context.content.format,
      scheduledAt: context.content.scheduledAt,
      caption: context.content.caption,
      cta: context.content.cta,
    },
    account: {
      accountId: String(context.account._id),
      connectionId: String(context.connection._id),
      integrationId: context.connection.externalAccountId,
      platform: context.account.platform,
      requiredCapability: POSTIZ_SCHEDULE_REQUIRED_CAPABILITY,
    },
    media: {
      candidateId: String(context.candidate._id),
      assetKey: context.candidate.assetKey,
      mediaType: context.candidate.mediaType,
    },
    postizSettings: settings,
  };
}

function postizScheduleSnapshotDetails(snapshotValue: unknown): PostizScheduleSnapshotDetails {
  const snapshot = asRecord(snapshotValue, "Postiz schedule snapshot");
  if (
    snapshot.resourceType !== CREATOR_POSTIZ_SCHEDULE_APPROVAL_RESOURCE
    || snapshot.provider !== "postiz"
    || snapshot.execution !== "postiz_scheduled"
  ) {
    throw new Error("Postiz schedule snapshot has an invalid execution policy");
  }
  const content = asRecord(snapshot.content, "Postiz schedule content snapshot");
  const account = asRecord(snapshot.account, "Postiz schedule account snapshot");
  const media = asRecord(snapshot.media, "Postiz schedule media snapshot");
  if (typeof snapshot.organizationId !== "string" || typeof snapshot.creatorId !== "string") {
    throw new Error("Postiz schedule snapshot ownership is invalid");
  }
  if (
    typeof content.contentId !== "string"
    || typeof content.contentReviewVersion !== "number"
    || !Number.isInteger(content.contentReviewVersion)
    || content.contentReviewVersion < 1
    || typeof content.contentReviewHash !== "string"
    || typeof content.contentApprovalId !== "string"
    || typeof content.title !== "string"
    || typeof content.caption !== "string"
    || (content.cta !== undefined && typeof content.cta !== "string")
  ) {
    throw new Error("Postiz schedule content snapshot is invalid");
  }
  if (
    typeof account.accountId !== "string"
    || typeof account.connectionId !== "string"
    || typeof account.integrationId !== "string"
    || account.requiredCapability !== POSTIZ_SCHEDULE_REQUIRED_CAPABILITY
  ) {
    throw new Error("Postiz schedule account snapshot is invalid");
  }
  if (
    typeof media.candidateId !== "string"
    || typeof media.assetKey !== "string"
    || (media.mediaType !== "image" && media.mediaType !== "video")
  ) {
    throw new Error("Postiz schedule media snapshot is invalid");
  }
  assertControlledCreatorRenderAssetKey(media.assetKey, "Postiz schedule render asset");
  if (snapshot.resourceId !== content.contentId || snapshot.planVersion !== content.contentReviewVersion) {
    throw new Error("Postiz schedule snapshot resource identity is invalid");
  }
  const format = requiredPostizContentFormat(content.format);
  const title = normalizeText(content.title, "Postiz schedule title", 200);
  const platform = requiredPostizPlatform(account.platform);
  const mediaType = media.mediaType;
  return {
    organizationId: normalizePostizProviderId(snapshot.organizationId, "Postiz schedule organization id"),
    creatorId: normalizePostizProviderId(snapshot.creatorId, "Postiz schedule creator id"),
    contentId: normalizePostizProviderId(content.contentId, "Postiz schedule content id"),
    contentReviewVersion: content.contentReviewVersion,
    contentReviewHash: normalizeText(content.contentReviewHash, "Postiz schedule content review hash", 500),
    title,
    format,
    scheduledAt: normalizePostizScheduledAt(content.scheduledAt, "Postiz schedule time"),
    accountId: normalizePostizProviderId(account.accountId, "Postiz schedule account id"),
    connectionId: normalizePostizProviderId(account.connectionId, "Postiz schedule connection id"),
    integrationId: normalizePostizProviderId(account.integrationId, "Postiz integration id"),
    platform,
    candidateId: normalizePostizProviderId(media.candidateId, "Postiz schedule render candidate id"),
    assetKey: media.assetKey,
    mediaType,
    postizSettings: normalizePostizScheduleSettings(snapshot.postizSettings, platform, format, mediaType, title),
  };
}

async function requirePostizScheduleAction(
  ctx: MutationCtx,
  context: PostizScheduleContext,
  submittedSettings?: PostizScheduleSettings,
) {
  const idempotencyKey = postizScheduleActionKey(context);
  const action = await ctx.db
    .query("actionLedger")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (!action || !action.approvalId) throw new Error("Postiz schedule action is missing");
  const storedDetails = postizScheduleSnapshotDetails(action.payloadSnapshot);
  if (
    submittedSettings
    && stableSerialize(submittedSettings) !== stableSerialize(storedDetails.postizSettings)
  ) {
    throw new Error("Postiz schedule settings are already frozen; create a newly reviewed content revision to change them");
  }
  const snapshot = postizScheduleSnapshot(context, submittedSettings ?? storedDetails.postizSettings);
  if (
    action.organizationId !== context.content.organizationId
    || action.connectionId !== context.connection._id
    || action.actionKind !== CREATOR_POSTIZ_SCHEDULE_DISPATCH_ACTION
    || action.idempotencyKey !== idempotencyKey
    || action.payloadHash !== snapshotHash(snapshot)
    || stableSerialize(action.payloadSnapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("Postiz schedule action is not bound to the approved content and account snapshot");
  }
  const approval = await ctx.db.get(action.approvalId);
  if (
    !approval
    || approval.organizationId !== context.content.organizationId
    || approval.resourceType !== CREATOR_POSTIZ_SCHEDULE_APPROVAL_RESOURCE
    || approval.resourceId !== String(context.content._id)
    || approval.planVersion !== context.content.reviewVersion
    || approval.actionKind !== CREATOR_POSTIZ_SCHEDULE_APPROVAL_ACTION
    || approval.snapshotHash !== snapshotHash(snapshot)
    || stableSerialize(approval.snapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("Postiz schedule approval is not bound to the immutable scheduler snapshot");
  }
  return { action, approval, snapshot };
}

/**
 * Claim-time verification intentionally uses the frozen action/approval
 * envelope, not mutable account/copy/render state. The sole live business
 * guard is the existing funnel safety check at the caller.
 */
async function requirePostizScheduleActionForWorker(
  ctx: MutationCtx,
  content: Doc<"creatorContentItems">,
) {
  const idempotencyKey = `creator-postiz-schedule:${content._id}:${content.reviewVersion}`;
  const action = await ctx.db
    .query("actionLedger")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (!action || !action.approvalId || !action.connectionId) throw new Error("Postiz schedule action is missing");
  const details = postizScheduleSnapshotDetails(action.payloadSnapshot);
  if (
    action.organizationId !== content.organizationId
    || action.actionKind !== CREATOR_POSTIZ_SCHEDULE_DISPATCH_ACTION
    || action.idempotencyKey !== idempotencyKey
    || action.payloadHash !== snapshotHash(action.payloadSnapshot)
    || String(action.connectionId) !== details.connectionId
    || details.organizationId !== String(content.organizationId)
    || details.creatorId !== String(content.creatorId)
    || details.contentId !== String(content._id)
    || details.contentReviewVersion !== content.reviewVersion
    || details.accountId.length === 0
    || details.candidateId.length === 0
  ) {
    throw new Error("Postiz schedule worker action is not bound to its immutable content snapshot");
  }
  const approval = await ctx.db.get(action.approvalId);
  if (
    !approval
    || approval.organizationId !== content.organizationId
    || approval.resourceType !== CREATOR_POSTIZ_SCHEDULE_APPROVAL_RESOURCE
    || approval.resourceId !== String(content._id)
    || approval.planVersion !== content.reviewVersion
    || approval.actionKind !== CREATOR_POSTIZ_SCHEDULE_APPROVAL_ACTION
    || approval.snapshotHash !== action.payloadHash
    || stableSerialize(approval.snapshot) !== stableSerialize(action.payloadSnapshot)
  ) {
    throw new Error("Postiz schedule worker approval is not bound to its immutable scheduler snapshot");
  }
  return { action, approval, snapshot: action.payloadSnapshot, details };
}

function postizReceiptFromAction(receipt: unknown) {
  if (receipt === undefined) return undefined;
  const value = asRecord(receipt, "Postiz provider receipt");
  if (
    value.provider !== "postiz"
    || typeof value.postId !== "string"
    || typeof value.integrationId !== "string"
  ) {
    throw new Error("Postiz provider receipt is invalid");
  }
  return {
    provider: "postiz" as const,
    postId: normalizePostizProviderId(value.postId, "Postiz post id"),
    integrationId: normalizePostizProviderId(value.integrationId, "Postiz integration id"),
    scheduledAt: normalizePostizScheduledAt(value.scheduledAt, "Postiz receipt schedule time"),
  };
}

/** Safe Postiz status/receipt projection; never expose copy, asset keys, or tokens. */
function postizScheduleWorkspaceAction(action: Doc<"actionLedger">) {
  const snapshot = safeMetaInstagramWorkspaceRecord(action.payloadSnapshot);
  const content = safeMetaInstagramWorkspaceRecord(snapshot?.content);
  const account = safeMetaInstagramWorkspaceRecord(snapshot?.account);
  const contentId = typeof content?.contentId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(content.contentId)
    ? content.contentId
    : undefined;
  const accountId = typeof account?.accountId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(account.accountId)
    ? account.accountId
    : undefined;
  const connectionId = typeof account?.connectionId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(account.connectionId)
    ? account.connectionId
    : undefined;
  const receipt = (() => {
    try {
      return postizReceiptFromAction(action.providerReceipt);
    } catch {
      return undefined;
    }
  })();
  const postizSettings = (() => {
    try {
      return postizScheduleSnapshotDetails(action.payloadSnapshot).postizSettings;
    } catch {
      return undefined;
    }
  })();
  return {
    _id: action._id,
    contentId,
    accountId,
    connectionId,
    status: action.status,
    approvalId: action.approvalId,
    error: action.error?.slice(0, 500),
    postizSettings,
    providerReceipt: receipt,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

type MetaInstagramReplyContext = {
  thread: Doc<"creatorInboxThreads">;
  creator: Doc<"creatorProfiles">;
  account: Doc<"creatorSocialAccounts">;
  connection: Doc<"integrationConnections">;
  inbound: Doc<"creatorInboxMessages">;
  inboundReceipt: Doc<"eventReceipts">;
  approvedDraft: Doc<"creatorInboxMessages">;
};

function assertMetaInstagramReplyWindow(inbound: Doc<"creatorInboxMessages">): void {
  const occurredAt = inbound.occurredAt;
  const replyEligibilityEndsAt = inbound.replyEligibilityEndsAt;
  if (
    typeof occurredAt !== "number"
    || typeof replyEligibilityEndsAt !== "number"
    || !Number.isSafeInteger(occurredAt)
    || !Number.isSafeInteger(replyEligibilityEndsAt)
    || replyEligibilityEndsAt !== occurredAt + META_INSTAGRAM_INBOUND_REPLY_WINDOW_MS
  ) {
    throw new Error("verified Meta Instagram inbound reply window is invalid");
  }
  if (replyEligibilityEndsAt <= Date.now()) {
    throw new Error("the Meta Instagram customer response window has expired; use human handoff");
  }
}

/**
 * Reconstructs reply authority entirely from the signed private inbox record.
 * Browser callers provide only a thread id; they cannot select a customer,
 * official account, inbound message, response window, or reply text.
 */
async function requireMetaInstagramReplyContext(
  ctx: MutationCtx,
  thread: Doc<"creatorInboxThreads">,
): Promise<MetaInstagramReplyContext> {
  if (
    thread.platform !== "instagram"
    || !thread.accountId
    || thread.status === "human_handoff"
    || thread.status === "closed"
    || thread.intent === "safety_review"
    || thread.safetyFlags.length > 0
  ) {
    throw new Error("this inbox thread is not eligible for a governed Meta Instagram reply");
  }
  if (!thread.approvedDraftMessageId || thread.draftReviewStatus !== "approved") {
    throw new Error("a locally reviewed frozen reply draft is required before Meta Instagram reply approval");
  }
  const creator = await requireCreator(ctx, thread.creatorId);
  if (creator.organizationId !== thread.organizationId) throw new Error("inbox thread creator organization is invalid");
  const account = await requireAccountForCreator(ctx, creator, thread.accountId);
  if (
    account.platform !== "instagram"
    || account.status !== "connected"
    || account.health !== "healthy"
    || !account.externalAccountId
    || !account.integrationConnectionId
    || !account.capabilities.includes("read_inbox")
    || !account.capabilities.includes(META_INSTAGRAM_REPLY_REQUIRED_CAPABILITY)
  ) {
    throw new Error("a healthy official Instagram account with inbox-reply capability is required");
  }
  const connection = await ctx.db.get(account.integrationConnectionId);
  if (
    !connection
    || connection.organizationId !== thread.organizationId
    || connection.provider !== "meta_instagram"
    || connection.status !== "connected"
    || connection.health !== "healthy"
    || connection.externalAccountId !== account.externalAccountId
    || !connection.capabilities.includes("read_inbox")
    || !connection.capabilities.includes(META_INSTAGRAM_REPLY_REQUIRED_CAPABILITY)
    || !connection.scopes.includes("instagram_business_basic")
    || !connection.scopes.includes(META_INSTAGRAM_REPLY_REQUIRED_SCOPE)
  ) {
    throw new Error("the official Meta Instagram connection lacks required inbox-reply scope or capability");
  }

  const messages = await ctx.db
    .query("creatorInboxMessages")
    .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
    .order("desc")
    .take(MAX_ROWS);
  const inbound = messages.find((message) => message.direction === "inbound");
  if (
    !inbound
    || inbound.verifiedInbound !== true
    || inbound.provider !== "meta_instagram"
    || inbound.source !== "official_webhook"
    || !inbound.externalMessageId
    || !inbound.officialRecipientId
    || !inbound.customerSenderId
    || !inbound.eventReceiptId
    || inbound.officialRecipientId !== account.externalAccountId
    || inbound.expiresAt === undefined
    || inbound.expiresAt <= Date.now()
  ) {
    throw new Error("only the latest verified customer-initiated Meta Instagram text message may receive a reply");
  }
  assertMetaInstagramReplyWindow(inbound);
  if (
    thread.responseWindowEndsAt !== inbound.replyEligibilityEndsAt
    || thread.verifiedMetaInstagramInboundAt !== inbound.occurredAt
    || thread.verifiedMetaInstagramReplyEligibilityEndsAt !== inbound.replyEligibilityEndsAt
  ) {
    throw new Error("inbox thread response-window metadata does not match the signed Meta message");
  }
  const inboundReceipt = await ctx.db.get(inbound.eventReceiptId);
  if (
    !inboundReceipt
    || inboundReceipt.organizationId !== thread.organizationId
    || inboundReceipt.source !== "meta_instagram_inbound"
    || inboundReceipt.eventType !== "instagram.inbound_message"
    || inboundReceipt.eventId !== `meta-instagram:${inbound.officialRecipientId}:${inbound.externalMessageId}`
  ) {
    throw new Error("Meta Instagram inbound receipt integrity check failed");
  }
  assertDigest(inboundReceipt.payloadHash, "Meta Instagram inbound receipt hash");

  const approvedDraft = await ctx.db.get(thread.approvedDraftMessageId);
  if (
    !approvedDraft
    || approvedDraft.organizationId !== thread.organizationId
    || approvedDraft.threadId !== thread._id
    || approvedDraft.direction !== "outbound"
    || approvedDraft.source !== "operator"
    || approvedDraft.automated
    || (approvedDraft.status !== "approved" && approvedDraft.status !== "queued")
    || approvedDraft.body.length > 1_000
    || approvedDraft.expiresAt === undefined
    || approvedDraft.expiresAt <= Date.now()
    || (thread.requiresDisclosure && !/\b(ai|automated|assistant)\b/i.test(approvedDraft.body))
  ) {
    throw new Error("the locally reviewed reply draft is not an eligible frozen Meta Instagram reply");
  }
  return { thread, creator, account, connection, inbound, inboundReceipt, approvedDraft };
}

function metaInstagramReplyActionKey(context: MetaInstagramReplyContext): string {
  return `creator-meta-instagram-reply:${context.thread._id}:${context.inbound._id}:${context.approvedDraft._id}`;
}

function metaInstagramReplySnapshot(context: MetaInstagramReplyContext) {
  return {
    resourceType: CREATOR_META_INSTAGRAM_REPLY_APPROVAL_RESOURCE,
    resourceId: String(context.thread._id),
    provider: "meta_instagram" as const,
    type: "instagram.reply" as const,
    thread: {
      threadId: String(context.thread._id),
      inboundMessageId: String(context.inbound._id),
      inboundReceiptId: String(context.inboundReceipt._id),
      occurredAt: context.inbound.occurredAt,
      replyEligibilityEndsAt: context.inbound.replyEligibilityEndsAt,
    },
    account: {
      accountId: String(context.account._id),
      connectionId: String(context.connection._id),
      igUserId: context.account.externalAccountId,
      requiredCapability: META_INSTAGRAM_REPLY_REQUIRED_CAPABILITY,
      requiredScope: META_INSTAGRAM_REPLY_REQUIRED_SCOPE,
    },
    // This opaque provider-scoped recipient id is obtained only from Meta's
    // signed webhook. It never reaches the workspace or provider receipt.
    recipient: { instagramScopedId: context.inbound.customerSenderId },
    reply: {
      approvedDraftMessageId: String(context.approvedDraft._id),
      text: context.approvedDraft.body,
    },
  };
}

async function requireMetaInstagramReplyAction(ctx: MutationCtx, context: MetaInstagramReplyContext) {
  const idempotencyKey = metaInstagramReplyActionKey(context);
  const action = await ctx.db
    .query("actionLedger")
    .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
    .unique();
  if (!action || !action.approvalId) throw new Error("Meta Instagram reply action is missing");
  const snapshot = metaInstagramReplySnapshot(context);
  if (
    action.organizationId !== context.thread.organizationId
    || action.connectionId !== context.connection._id
    || action.actionKind !== CREATOR_META_INSTAGRAM_REPLY_DISPATCH_ACTION
    || action.idempotencyKey !== idempotencyKey
    || action.payloadHash !== snapshotHash(snapshot)
    || stableSerialize(action.payloadSnapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("Meta Instagram reply action is not bound to the signed inbound message and frozen draft");
  }
  const approval = await ctx.db.get(action.approvalId);
  if (
    !approval
    || approval.organizationId !== context.thread.organizationId
    || approval.resourceType !== CREATOR_META_INSTAGRAM_REPLY_APPROVAL_RESOURCE
    || approval.resourceId !== String(context.thread._id)
    || approval.planVersion !== undefined
    || approval.actionKind !== CREATOR_META_INSTAGRAM_REPLY_APPROVAL_ACTION
    || approval.snapshotHash !== snapshotHash(snapshot)
    || stableSerialize(approval.snapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("Meta Instagram reply approval is not bound to the immutable reply snapshot");
  }
  return { action, approval, snapshot };
}

/** Worker-only lookup that still works after a newer customer message arrives. */
async function requireMetaInstagramReplyWorkerAction(ctx: MutationCtx, thread: Doc<"creatorInboxThreads">) {
  if (!thread.metaInstagramReplyActionId) throw new Error("Meta Instagram reply action is missing from this inbox thread");
  const action = await ctx.db.get(thread.metaInstagramReplyActionId);
  if (
    !action
    || action.organizationId !== thread.organizationId
    || action.actionKind !== CREATOR_META_INSTAGRAM_REPLY_DISPATCH_ACTION
    || !action.approvalId
    || !action.payloadSnapshot
    || action.payloadHash !== snapshotHash(action.payloadSnapshot)
  ) {
    throw new Error("Meta Instagram reply worker action integrity check failed");
  }
  const snapshot = asRecord(action.payloadSnapshot, "Meta Instagram reply snapshot");
  const snapshotThread = asRecord(snapshot.thread, "Meta Instagram reply snapshot thread");
  if (snapshot.type !== "instagram.reply" || snapshotThread.threadId !== String(thread._id)) {
    throw new Error("Meta Instagram reply worker action targets a different inbox thread");
  }
  const approval = await ctx.db.get(action.approvalId);
  if (
    !approval
    || approval.organizationId !== thread.organizationId
    || approval.resourceType !== CREATOR_META_INSTAGRAM_REPLY_APPROVAL_RESOURCE
    || approval.resourceId !== String(thread._id)
    || approval.actionKind !== CREATOR_META_INSTAGRAM_REPLY_APPROVAL_ACTION
    || approval.snapshotHash !== action.payloadHash
    || stableSerialize(approval.snapshot) !== stableSerialize(action.payloadSnapshot)
  ) {
    throw new Error("Meta Instagram reply worker approval integrity check failed");
  }
  const outbound = await ctx.db
    .query("creatorInboxMessages")
    .withIndex("by_action", (q) => q.eq("actionId", action._id))
    .unique();
  if (
    !outbound
    || outbound.organizationId !== thread.organizationId
    || outbound.threadId !== thread._id
    || outbound.direction !== "outbound"
    || outbound.source !== "operator"
    || outbound.automated
  ) {
    throw new Error("Meta Instagram reply worker outbox linkage is invalid");
  }
  return { action, approval, snapshot, outbound };
}

function metaInstagramReplyMessageFromReceipt(receipt: unknown): string | undefined {
  if (receipt === undefined) return undefined;
  const value = asRecord(receipt, "Meta Instagram reply provider receipt");
  if (value.provider !== "meta_instagram") throw new Error("Meta Instagram reply action has a different provider receipt");
  if (value.messageId === undefined) return undefined;
  if (typeof value.messageId !== "string") throw new Error("Meta Instagram reply provider receipt message id is invalid");
  return normalizeMetaInstagramProviderId(value.messageId, "Meta Instagram reply message id");
}

/** Safe outbox projection: never expose customer ids, reply text, or raw payloads. */
function metaInstagramReplyWorkspaceAction(action: Doc<"actionLedger">) {
  const snapshot = safeMetaInstagramWorkspaceRecord(action.payloadSnapshot);
  const thread = safeMetaInstagramWorkspaceRecord(snapshot?.thread);
  const receipt = safeMetaInstagramWorkspaceRecord(action.providerReceipt);
  const threadId = typeof thread?.threadId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(thread.threadId)
    ? thread.threadId
    : undefined;
  const messageId = typeof receipt?.messageId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(receipt.messageId)
    ? receipt.messageId
    : undefined;
  return {
    _id: action._id,
    threadId,
    status: action.status,
    approvalId: action.approvalId,
    error: action.error?.slice(0, 500),
    providerReceipt: receipt?.provider === "meta_instagram" && messageId
      ? { provider: "meta_instagram" as const, messageId }
      : undefined,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
  };
}

async function requireFunnelReviewApproval(ctx: MutationCtx, funnel: Doc<"creatorFunnelCampaigns">) {
  if (!funnel.approvalId) throw new Error("funnel has no review approval record");
  const approval = await ctx.db.get(funnel.approvalId);
  const snapshot = creatorFunnelReviewSnapshot(funnel);
  if (
    !approval ||
    approval.organizationId !== funnel.organizationId ||
    approval.resourceType !== CREATOR_FUNNEL_APPROVAL_RESOURCE ||
    approval.resourceId !== String(funnel._id) ||
    approval.planVersion !== funnel.version ||
    approval.actionKind !== CREATOR_FUNNEL_APPROVAL_ACTION ||
    approval.snapshotHash !== snapshotHash(snapshot) ||
    stableSerialize(approval.snapshot) !== stableSerialize(snapshot)
  ) {
    throw new Error("funnel review approval linkage is invalid");
  }
  return approval;
}

function assertFunnelReadyForReview(
  funnel: Doc<"creatorFunnelCampaigns">,
  destination: Doc<"creatorDestinations">,
): void {
  if (destination.status !== "active") throw new Error("funnel destination must be active before review or activation");
  if (destination.creatorId !== funnel.creatorId || destination.organizationId !== funnel.organizationId || destination._id !== funnel.destinationId) {
    throw new Error("funnel destination ownership is invalid");
  }
  const currentDestinationMetadata = funnelDestinationLinkMetadata(destination);
  if (
    currentDestinationMetadata.destinationHost !== funnel.linkPolicy.destinationHost ||
    currentDestinationMetadata.destinationUrlHash !== funnel.linkPolicy.destinationUrlHash
  ) {
    throw new Error("funnel destination changed; update the funnel and request a new review");
  }
  const restrictedDestination = destination.kind === "fanvue" || destination.kind === "fansly";
  if (
    (destination.ageGateRequired || restrictedDestination) &&
    (!funnel.compliance.ageGateRequired || !funnel.compliance.ageGateEvidenceReference)
  ) {
    throw new Error("funnel age-gate requirements are incomplete for its destination");
  }
  if (
    (restrictedDestination || funnel.compliance.disclosureRequired) &&
    !funnel.compliance.disclosureText
  ) {
    throw new Error("funnel disclosure requirements are incomplete for its destination");
  }
}

function normalizeAttributionMetric(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new Error(`${label} must be a non-negative whole number`);
  }
  return value;
}

async function requireReferenceAssetsForCreator(
  ctx: MutationCtx,
  creator: Doc<"creatorProfiles">,
  referenceAssetIds: Id<"creatorReferenceAssets">[] | undefined,
): Promise<Doc<"creatorReferenceAssets">[]> {
  if (!referenceAssetIds?.length) return [];
  if (referenceAssetIds.length > MAX_REFERENCE_ASSETS_PER_CONTENT_PLAN) {
    throw new Error(`a content plan may use at most ${MAX_REFERENCE_ASSETS_PER_CONTENT_PLAN} reference assets`);
  }
  if (new Set(referenceAssetIds.map(String)).size !== referenceAssetIds.length) {
    throw new Error("reference assets must not contain duplicates");
  }

  const assets = await Promise.all(referenceAssetIds.map((referenceAssetId) => ctx.db.get(referenceAssetId)));
  if (assets.some((asset) => !asset)) throw new Error("reference asset not found");

  const resolved = assets as Doc<"creatorReferenceAssets">[];
  for (const asset of resolved) {
    if (asset.creatorId !== creator._id || asset.organizationId !== creator.organizationId) {
      throw new Error("reference asset does not belong to this creator profile");
    }
    // Keep this guard at the durable-content boundary, not only in the
    // selection UI. Historical/imported records may be visible to operators,
    // but nothing awaiting rights review may influence a creator render.
    if (asset.rightsStatus !== "owned" && asset.rightsStatus !== "consented" && asset.rightsStatus !== "licensed") {
      throw new Error("content planning may use only owned, consented, or licensed reference assets");
    }
    if (!asset.consentAttested) {
      throw new Error("content planning reference assets require an operator rights attestation");
    }
    // Creator likeness remains stricter than general visual direction: a
    // license alone never permits synthetic identity use.
    if (asset.useType === "creator_likeness" && asset.rightsStatus !== "consented" && asset.rightsStatus !== "owned") {
      throw new Error("creator likeness reference assets must be consented or owned");
    }
  }
  return resolved;
}

type NormalizedLoRATrainingParams = {
  trainingEndpoint: typeof FAL_Z_IMAGE_TRAINING_ENDPOINT;
  inferenceEndpoint: typeof FAL_Z_IMAGE_LORA_INFERENCE_ENDPOINT;
  baseModel: typeof Z_IMAGE_TURBO_BASE_MODEL;
  triggerWord: string;
  trainingType: "content" | "style" | "balanced";
  falTrainingType: "content" | "style" | "balanced";
  steps: number;
  learningRate: number;
  defaultCaption: string;
};

type NormalizedFalResultMetadata = {
  status?: string;
  modelUrl?: string;
  configUrl?: string;
  trainingSteps?: number;
  trainingImages?: number;
};

function normalizeLoRATriggerWord(value: string): string {
  const triggerWord = normalizeText(value, "LoRA trigger word", 64).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(triggerWord)) {
    throw new Error("LoRA trigger word must start with a letter and use only lowercase letters, numbers, underscores, or hyphens");
  }
  return triggerWord;
}

function captionIncludesTrigger(caption: string, triggerWord: string): boolean {
  return caption.toLocaleLowerCase().includes(triggerWord.toLocaleLowerCase());
}

function normalizeLoRATrainingParams(value: {
  triggerWord: string;
  trainingType: "content" | "style" | "balanced";
  steps: number;
  learningRate: number;
  defaultCaption: string;
}): NormalizedLoRATrainingParams {
  const triggerWord = normalizeLoRATriggerWord(value.triggerWord);
  if (!Number.isInteger(value.steps) || value.steps < 1 || value.steps > 100_000) {
    throw new Error("LoRA training steps must be a whole number between 1 and 100000");
  }
  if (!Number.isFinite(value.learningRate) || value.learningRate <= 0 || value.learningRate > 1) {
    throw new Error("LoRA learning rate must be greater than zero and no more than one");
  }
  const defaultCaption = normalizeText(value.defaultCaption, "LoRA default caption", 2_000);
  if (!captionIncludesTrigger(defaultCaption, triggerWord)) {
    throw new Error("LoRA default caption must include the frozen trigger word");
  }
  return {
    trainingEndpoint: FAL_Z_IMAGE_TRAINING_ENDPOINT,
    inferenceEndpoint: FAL_Z_IMAGE_LORA_INFERENCE_ENDPOINT,
    baseModel: Z_IMAGE_TURBO_BASE_MODEL,
    triggerWord,
    trainingType: value.trainingType,
    // The worker forwards this exact Fal enum; it must never infer a mode.
    falTrainingType: value.trainingType,
    steps: value.steps,
    learningRate: value.learningRate,
    defaultCaption,
  };
}

function normalizeLoraSha256(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const digest = normalizeText(value, "LoRA dataset SHA-256", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("LoRA dataset SHA-256 must be a 64-character hexadecimal digest");
  return digest;
}

function normalizeLoRACaption(value: string, trainingParams: NormalizedLoRATrainingParams): string {
  const caption = normalizeText(value, "LoRA dataset caption", 2_000);
  if (!captionIncludesTrigger(caption, trainingParams.triggerWord)) {
    throw new Error("every LoRA dataset caption must include the frozen trigger word");
  }
  return caption;
}

function assertControlledCreatorLoraArtifactKey(value: string, label: string): void {
  const suffix = value.slice("creator-loras/".length);
  if (
    !value.startsWith("creator-loras/") ||
    !suffix ||
    value.length > 1_024 ||
    value.includes("..") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is not a controlled creator LoRA artifact key`);
  }
}

function normalizePublicArtifactUrl(value: string, label: string): string {
  const candidate = normalizeText(value, label, 2_000);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must be a non-secret HTTPS URL without credentials, query parameters, or fragments`);
  }
  return parsed.toString();
}

function normalizeFalRequestId(value: string): string {
  const requestId = normalizeText(value, "Fal request id", 512);
  if (!/^[A-Za-z0-9._:-]+$/.test(requestId)) {
    throw new Error("Fal request id contains unsupported characters");
  }
  return requestId;
}

function normalizeFalResultMetadata(value: unknown): NormalizedFalResultMetadata | undefined {
  if (value === undefined) return undefined;
  const source = asRecord(value, "Fal result metadata");
  const allowed = new Set(["status", "modelUrl", "configUrl", "trainingSteps", "trainingImages"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) {
    throw new Error("Fal result metadata contains an unsupported field");
  }
  const result: NormalizedFalResultMetadata = {};
  if (source.status !== undefined) result.status = normalizeText(String(source.status), "Fal result status", 128);
  if (source.modelUrl !== undefined) result.modelUrl = normalizePublicArtifactUrl(String(source.modelUrl), "Fal model URL");
  if (source.configUrl !== undefined) result.configUrl = normalizePublicArtifactUrl(String(source.configUrl), "Fal config URL");
  if (source.trainingSteps !== undefined) {
    if (!Number.isInteger(source.trainingSteps) || (source.trainingSteps as number) < 1 || (source.trainingSteps as number) > 1_000_000) {
      throw new Error("Fal result training steps must be a positive whole number");
    }
    result.trainingSteps = source.trainingSteps as number;
  }
  if (source.trainingImages !== undefined) {
    if (!Number.isInteger(source.trainingImages) || (source.trainingImages as number) < 1 || (source.trainingImages as number) > MAX_LORA_DATASET_ASSETS) {
      throw new Error(`Fal result training images must be a whole number between 1 and ${MAX_LORA_DATASET_ASSETS}`);
    }
    result.trainingImages = source.trainingImages as number;
  }
  return result;
}

async function requireConsentedLoRAReferenceAssets(
  ctx: MutationCtx,
  creator: Doc<"creatorProfiles">,
  referenceAssetIds: Id<"creatorReferenceAssets">[],
): Promise<Doc<"creatorReferenceAssets">[]> {
  if (!referenceAssetIds.length || referenceAssetIds.length > MAX_LORA_DATASET_ASSETS) {
    throw new Error(`a LoRA dataset must include between 1 and ${MAX_LORA_DATASET_ASSETS} reference assets`);
  }
  if (new Set(referenceAssetIds.map(String)).size !== referenceAssetIds.length) {
    throw new Error("LoRA dataset reference assets must not contain duplicates");
  }
  const assets = await Promise.all(referenceAssetIds.map((referenceAssetId) => ctx.db.get(referenceAssetId)));
  if (assets.some((asset) => !asset)) throw new Error("LoRA dataset reference asset not found");
  const resolved = assets as Doc<"creatorReferenceAssets">[];
  for (const asset of resolved) {
    if (asset.organizationId !== creator.organizationId || asset.creatorId !== creator._id) {
      throw new Error("LoRA dataset reference asset does not belong to this creator");
    }
    if ((asset.rightsStatus !== "owned" && asset.rightsStatus !== "consented") || !asset.consentAttested) {
      throw new Error("LoRA training may use only operator-attested owned or consented creator reference assets");
    }
    normalizeReferenceStorageKey(asset.storageKey);
  }
  return resolved;
}

function createLoRADatasetManifest(
  assets: Doc<"creatorReferenceAssets">[],
  trainingParams: NormalizedLoRATrainingParams,
  captions: { referenceAssetId: Id<"creatorReferenceAssets">; caption: string; sha256?: string }[] | undefined,
) {
  const captionsByAsset = new Map<string, { caption: string; sha256?: string }>();
  for (const entry of captions ?? []) {
    const assetId = String(entry.referenceAssetId);
    if (captionsByAsset.has(assetId)) throw new Error("LoRA dataset captions must not contain duplicate reference assets");
    captionsByAsset.set(assetId, {
      caption: normalizeLoRACaption(entry.caption, trainingParams),
      sha256: normalizeLoraSha256(entry.sha256),
    });
  }
  const selectedIds = new Set(assets.map((asset) => String(asset._id)));
  if ([...captionsByAsset.keys()].some((assetId) => !selectedIds.has(assetId))) {
    throw new Error("LoRA dataset caption references an asset outside the selected dataset");
  }
  return assets.map((asset) => {
    const caption = captionsByAsset.get(String(asset._id));
    return {
      assetId: asset._id,
      storageKey: asset.storageKey,
      caption: caption?.caption ?? trainingParams.defaultCaption,
      sha256: caption?.sha256,
      rightsStatus: asset.rightsStatus as "owned" | "consented",
      consentAttestedBy: asset.consentAttestedBy,
      consentAttestedAt: asset.consentAttestedAt,
      consentRecordReference: asset.consentRecordReference,
    };
  });
}

function assertLoRATrainingJobIntegrity(job: Doc<"creatorLoRATrainingJobs">): void {
  const trainingParams = normalizeLoRATrainingParams(job.trainingParams);
  if (trainingParams.triggerWord !== job.triggerWord || stableSerialize(trainingParams) !== stableSerialize(job.trainingParams)) {
    throw new Error("LoRA training parameters are invalid or have changed");
  }
  if (job.datasetAssetCount !== job.datasetAssetIds.length || job.datasetManifest.length !== job.datasetAssetIds.length) {
    throw new Error("LoRA dataset count does not match its immutable manifest");
  }
  if (snapshotHash(job.datasetManifest) !== job.datasetManifestHash) {
    throw new Error("LoRA dataset manifest integrity check failed");
  }
  const seen = new Set<string>();
  job.datasetManifest.forEach((entry, index) => {
    if (entry.assetId !== job.datasetAssetIds[index] || seen.has(String(entry.assetId))) {
      throw new Error("LoRA dataset manifest does not match its selected assets");
    }
    seen.add(String(entry.assetId));
    assertNonBlank(entry.storageKey, "LoRA dataset storage key");
    normalizeReferenceStorageKey(entry.storageKey);
    normalizeLoRACaption(entry.caption, trainingParams);
    normalizeLoraSha256(entry.sha256);
    if (entry.rightsStatus !== "owned" && entry.rightsStatus !== "consented") {
      throw new Error("LoRA dataset manifest has unsupported rights state");
    }
    if (!entry.consentAttestedBy || !Number.isFinite(entry.consentAttestedAt) || entry.consentAttestedAt <= 0) {
      throw new Error("LoRA dataset manifest lacks a valid consent attestation");
    }
  });
  if (!job.operatorAttestation.confirmed) throw new Error("LoRA operator attestation is not confirmed");
  normalizeText(job.operatorAttestation.attestedBy, "LoRA attested by", 200);
  normalizeText(job.operatorAttestation.statement, "LoRA operator attestation", 2_000);
  if (!Number.isFinite(job.operatorAttestation.attestedAt) || job.operatorAttestation.attestedAt <= 0) {
    throw new Error("LoRA operator attestation timestamp is invalid");
  }
}

function loRATrainingReviewSnapshot(job: Doc<"creatorLoRATrainingJobs">) {
  return {
    resourceType: CREATOR_LORA_TRAINING_APPROVAL_RESOURCE,
    resourceId: String(job._id),
    targetModel: job.targetModel,
    triggerWord: job.triggerWord,
    trainingParams: job.trainingParams,
    datasetManifestHash: job.datasetManifestHash,
    datasetManifest: job.datasetManifest,
    operatorAttestation: job.operatorAttestation,
  };
}

function loRATrainingActionPayload(job: Doc<"creatorLoRATrainingJobs">) {
  return {
    resourceType: CREATOR_LORA_TRAINING_APPROVAL_RESOURCE,
    resourceId: String(job._id),
    targetModel: job.targetModel,
    creatorLoRATrainingJobId: String(job._id),
    trainingEndpoint: job.trainingParams.trainingEndpoint,
    baseModel: job.trainingParams.baseModel,
    trainingType: job.trainingParams.falTrainingType,
    datasetManifestHash: job.datasetManifestHash,
    datasetAssetCount: job.datasetAssetCount,
  };
}

async function requireLoRATrainingReviewApproval(ctx: MutationCtx, job: Doc<"creatorLoRATrainingJobs">) {
  if (!job.reviewApprovalId) throw new Error("LoRA training job has no review approval record");
  const approval = await ctx.db.get(job.reviewApprovalId);
  if (
    !approval ||
    approval.organizationId !== job.organizationId ||
    approval.resourceType !== CREATOR_LORA_TRAINING_APPROVAL_RESOURCE ||
    approval.resourceId !== String(job._id) ||
    approval.planVersion !== 1 ||
    approval.actionKind !== CREATOR_LORA_TRAINING_APPROVAL_ACTION
  ) {
    throw new Error("LoRA training review approval linkage is invalid");
  }
  const snapshot = loRATrainingReviewSnapshot(job);
  if (approval.snapshotHash !== snapshotHash(snapshot) || stableSerialize(approval.snapshot) !== stableSerialize(snapshot)) {
    throw new Error("LoRA training job changed since its review request");
  }
  return approval;
}

async function requireLoRATrainingAction(
  ctx: MutationCtx,
  job: Doc<"creatorLoRATrainingJobs">,
  approval: Doc<"approvalRequests">,
) {
  if (!job.actionId) throw new Error("LoRA training job has no action-ledger record");
  const action = await ctx.db.get(job.actionId);
  if (
    !action ||
    action.organizationId !== job.organizationId ||
    action.approvalId !== approval._id ||
    action.creatorLoRATrainingJobId !== job._id ||
    action.actionKind !== CREATOR_LORA_TRAINING_DISPATCH_ACTION ||
    action.idempotencyKey !== `creator-lora-training:${job._id}`
  ) {
    throw new Error("LoRA training action-ledger linkage is invalid");
  }
  const payload = loRATrainingActionPayload(job);
  if (action.payloadHash !== snapshotHash(payload) || stableSerialize(action.payloadSnapshot) !== stableSerialize(payload)) {
    throw new Error("LoRA training action payload does not match its immutable job");
  }
  return action;
}

async function requireActiveCreatorLoRAModel(
  ctx: MutationCtx,
  creator: Doc<"creatorProfiles">,
  modelId: Id<"creatorLoraModels">,
) {
  const model = await ctx.db.get(modelId);
  if (
    !model ||
    model.organizationId !== creator.organizationId ||
    model.creatorId !== creator._id ||
    model.status !== "active" ||
    creator.activeLoraModelId !== model._id
  ) {
    throw new Error("content may use only this creator's explicitly active LoRA model");
  }
  const job = await ctx.db.get(model.trainingJobId);
  if (!job || job.status !== "succeeded" || job.modelId !== model._id || job.creatorId !== creator._id) {
    throw new Error("active creator LoRA model is not bound to a successful training job");
  }
  assertLoRATrainingJobIntegrity(job);
  assertControlledCreatorLoraArtifactKey(model.modelArtifactKey, "active creator LoRA model artifact");
  if (model.modelArtifactUrl) normalizePublicArtifactUrl(model.modelArtifactUrl, "active creator LoRA model artifact URL");
  return { model, job };
}

async function ensureAccountDailyLimit(
  ctx: MutationCtx,
  account: Doc<"creatorSocialAccounts">,
  scheduledAt: number,
): Promise<void> {
  const day = localDayKey(scheduledAt, account.postingPolicy.timezone);
  const scheduled = await ctx.db
    .query("creatorContentItems")
    .withIndex("by_account_scheduled", (q) => q.eq("accountId", account._id))
    .collect();
  const sameDay = scheduled.filter(
    (item) =>
      item.status === "scheduled" &&
      item.scheduledAt !== undefined &&
      localDayKey(item.scheduledAt, account.postingPolicy.timezone) === day,
  );
  if (sameDay.length >= account.postingPolicy.dailyPostLimit) {
    throw new Error(`account daily plan limit (${account.postingPolicy.dailyPostLimit}) reached for ${day}`);
  }
}

function mappedLegacyAccountStatus(status: "unlinked" | "warming" | "active" | "banned") {
  if (status === "banned") return "paused" as const;
  // Historical "active" cannot prove that a supported official OAuth connection
  // is still valid, so every import must reconnect before it can be reviewed.
  return status === "unlinked" ? ("unlinked" as const) : ("pending" as const);
}

function mappedLegacyPlatform(platform: "instagram" | "tiktok" | "youtube" | "fanvue" | "pinterest" | "email") {
  if (platform === "pinterest" || platform === "email") return "other" as const;
  return platform;
}

function mappedLegacyStage(stage: "grow" | "brand_ready" | "monetized") {
  if (stage === "grow") return "growth" as const;
  return stage;
}

/**
 * Safe, compact operator read model. It deliberately omits any raw inbound
 * messages, OAuth data, provider receipts, tokens, and historical account meta.
 */
export const listWorkspace = internalQuery({
  args: {},
  handler: async (ctx) => {
    const organization = await findDefaultOrganization(ctx);
    if (!organization) {
      return {
        organization: null,
        creators: [],
        accounts: [],
        destinations: [],
        contentItems: [],
        inboxThreads: [],
        referenceAssets: [],
        renderActions: [],
        metaInstagramPublishActions: [],
        postizScheduleActions: [],
        metaInstagramReplyActions: [],
        renderJobs: [],
        renderCandidates: [],
        loraTrainingJobs: [],
        loraModels: [],
        personaRevisions: [],
        funnelCampaigns: [],
        funnelEvents: [],
        attributionSnapshots: [],
        connections: [],
      };
    }
    const [creators, accounts, destinations, contentItems, inboxThreads, connections, referenceAssets, attributionSnapshots, renderJobs, renderCandidates, loraTrainingJobs, loraModels, personaRevisions, funnelCampaigns, funnelEvents] = await Promise.all([
      ctx.db.query("creatorProfiles").withIndex("by_organization", (q) => q.eq("organizationId", organization._id)).collect(),
      ctx.db
        .query("creatorSocialAccounts")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorDestinations")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorContentItems")
        .withIndex("by_organization_scheduled", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorInboxThreads")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("integrationConnections")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorReferenceAssets")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorAttributionSnapshots")
        .withIndex("by_organization_captured", (q) => q.eq("organizationId", organization._id))
        .order("desc")
        .take(MAX_ROWS),
      ctx.db
        .query("creatorRenderJobs")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorRenderCandidates")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorLoRATrainingJobs")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorLoraModels")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorPersonaRevisions")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorFunnelCampaigns")
        .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
        .collect(),
      ctx.db
        .query("creatorFunnelEvents")
        .withIndex("by_organization_occurred", (q) => q.eq("organizationId", organization._id))
        .order("desc")
        .take(MAX_ROWS),
    ]);

    const organizationActions = await ctx.db
      .query("actionLedger")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", organization._id))
      .collect();
    const metaInstagramPublishActionRows = organizationActions
      .filter((action) => action.actionKind === CREATOR_META_INSTAGRAM_PUBLISH_DISPATCH_ACTION);
    const postizScheduleActionRows = organizationActions
      .filter((action) => action.actionKind === CREATOR_POSTIZ_SCHEDULE_DISPATCH_ACTION);
    const metaInstagramReplyActionRows = organizationActions
      .filter((action) => action.actionKind === CREATOR_META_INSTAGRAM_REPLY_DISPATCH_ACTION);
    const approvalIds = [...new Set([
      ...contentItems.flatMap((item) => (item.approvalId ? [item.approvalId] : [])),
      ...funnelCampaigns.flatMap((funnel) => (funnel.approvalId ? [funnel.approvalId] : [])),
      ...metaInstagramPublishActionRows.flatMap((action) => (action.approvalId ? [action.approvalId] : [])),
      ...postizScheduleActionRows.flatMap((action) => (action.approvalId ? [action.approvalId] : [])),
      ...metaInstagramReplyActionRows.flatMap((action) => (action.approvalId ? [action.approvalId] : [])),
    ])];
    const approvalRows = await Promise.all(approvalIds.map((approvalId) => ctx.db.get(approvalId)));
    const approvalsById = new Map(approvalRows.flatMap((approval) => approval ? [[approval._id, approval] as const] : []));
    const approvalStatus = new Map([...approvalsById].map(([approvalId, approval]) => [approvalId, approval.status]));
    const renderActions = (await Promise.all(
      approvalIds.map((approvalId) => ctx.db.query("actionLedger").withIndex("by_approval", (q) => q.eq("approvalId", approvalId)).collect()),
    ))
      .flat()
      .filter((action) => action.actionKind === CREATOR_RENDER_ACTION)
      .map((action) => ({
        _id: action._id,
        approvalId: action.approvalId,
        status: action.status,
        error: action.error,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt,
        payloadSnapshot: action.payloadSnapshot,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const metaInstagramPublishActions = metaInstagramPublishActionRows
      .map((action) => {
        const approval = action.approvalId ? approvalsById.get(action.approvalId) : undefined;
        return {
          ...metaInstagramPublishWorkspaceAction(action),
          approvalStatus: approval?.status ?? "missing",
          approvalDecidedAt: approval?.status === "approved" ? approval.decidedAt : undefined,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const postizScheduleActions = postizScheduleActionRows
      .map((action) => {
        const approval = action.approvalId ? approvalsById.get(action.approvalId) : undefined;
        return {
          ...postizScheduleWorkspaceAction(action),
          approvalStatus: approval?.status ?? "missing",
          approvalDecidedAt: approval?.status === "approved" ? approval.decidedAt : undefined,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const metaInstagramReplyActions = metaInstagramReplyActionRows
      .map((action) => {
        const approval = action.approvalId ? approvalsById.get(action.approvalId) : undefined;
        return {
          ...metaInstagramReplyWorkspaceAction(action),
          approvalStatus: approval?.status ?? "missing",
          approvalDecidedAt: approval?.status === "approved" ? approval.decidedAt : undefined,
        };
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);

    return {
      organization,
      creators: creators.sort((left, right) => left.name.localeCompare(right.name)),
      accounts: accounts.sort((left, right) => left.handle.localeCompare(right.handle)),
      destinations: destinations.sort((left, right) => left.label.localeCompare(right.label)),
      contentItems: contentItems
        .map((item) => ({
          ...item,
          approvalStatus: item.approvalId ? approvalStatus.get(item.approvalId) ?? "missing" : undefined,
        }))
        .sort((left, right) => left.scheduledAt - right.scheduledAt),
      inboxThreads: inboxThreads
        .map((thread) => ({
          ...thread,
          metaInstagramReplyProof: (() => {
            const inboundAt = thread.verifiedMetaInstagramInboundAt;
            const replyEligibilityEndsAt = thread.verifiedMetaInstagramReplyEligibilityEndsAt;
            const verifiedInbound = thread.platform === "instagram"
              && typeof inboundAt === "number"
              && Number.isSafeInteger(inboundAt)
              && typeof replyEligibilityEndsAt === "number"
              && Number.isSafeInteger(replyEligibilityEndsAt)
              && replyEligibilityEndsAt === inboundAt + META_INSTAGRAM_INBOUND_REPLY_WINDOW_MS;
            return {
              verifiedInbound,
              responseWindowOpen: verifiedInbound && replyEligibilityEndsAt > Date.now(),
              verifiedInboundAt: verifiedInbound ? inboundAt : undefined,
              replyEligibilityEndsAt: verifiedInbound ? replyEligibilityEndsAt : undefined,
            };
          })(),
          // The view may show the AI draft and rationale to the operator, but
          // this object intentionally never includes an original message body.
          messageBodyStored: false,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
      // This is a metadata-only outbox view. The approval record remains the
      // immutable source for the full prompt and reference snapshot; no key,
      // provider receipt, binary asset, or dispatch capability is returned.
      renderActions,
      // A separate, receipt-only projection for official Instagram publishing.
      // It deliberately excludes action payloads, captions, asset keys, and
      // access credentials while preserving the status and manual-check ids.
      metaInstagramPublishActions,
      // Scheduler acceptance is explicitly distinct from social publication.
      // This projection shows only lifecycle/receipt metadata and never the
      // approved caption, CTA, controlled asset key, or credential state.
      postizScheduleActions,
      // Inbound proof and frozen draft text remain private. This is only the
      // operator-safe status/receipt projection for a governed reply action.
      metaInstagramReplyActions,
      // The full request snapshot remains in Convex for the trusted worker;
      // this operator read model exposes only safe state and integrity metadata.
      renderJobs: renderJobs
        .map((job) => ({
          _id: job._id,
          organizationId: job.organizationId,
          creatorId: job.creatorId,
          contentId: job.contentId,
          approvalId: job.approvalId,
          actionId: job.actionId,
          reviewVersion: job.reviewVersion,
          provider: job.provider,
          status: job.status,
          attemptNumber: job.attemptNumber,
          maxAttempts: job.maxAttempts,
          idempotencyKey: job.idempotencyKey,
          requestHash: job.requestHash,
          scheduledAt: job.scheduledAt,
          referenceCount: job.referenceCount,
          retryOfJobId: job.retryOfJobId,
          failureReason: job.failureReason,
          selectedCandidateId: job.selectedCandidateId,
          selectedAt: job.selectedAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
      // Candidates contain only controlled-storage keys. A separate signed
      // server route may resolve them for an authorised operator later.
      renderCandidates: renderCandidates
        .map((candidate) => ({
          _id: candidate._id,
          organizationId: candidate.organizationId,
          creatorId: candidate.creatorId,
          contentId: candidate.contentId,
          jobId: candidate.jobId,
          attemptNumber: candidate.attemptNumber,
          provider: candidate.provider,
          mediaType: candidate.mediaType,
          status: candidate.status,
          assetKey: candidate.assetKey,
          thumbnailKey: candidate.thumbnailKey,
          width: candidate.width,
          height: candidate.height,
          durationSeconds: candidate.durationSeconds,
          rejectionReason: candidate.rejectionReason,
          selectedAt: candidate.selectedAt,
          selectedBy: candidate.selectedBy,
          rejectedAt: candidate.rejectedAt,
          rejectedBy: candidate.rejectedBy,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
      // Training state is operator-visible, but this read model intentionally
      // contains only frozen reference metadata—not binary sources, signed
      // URLs, credentials, or a raw Fal response.
      loraTrainingJobs: loraTrainingJobs
        .map((job) => ({
          _id: job._id,
          organizationId: job.organizationId,
          creatorId: job.creatorId,
          reviewApprovalId: job.reviewApprovalId,
          actionId: job.actionId,
          targetModel: job.targetModel,
          status: job.status,
          triggerWord: job.triggerWord,
          trainingLabel: job.trainingLabel,
          trainingParams: job.trainingParams,
          datasetAssetIds: job.datasetAssetIds,
          datasetAssetCount: job.datasetAssetCount,
          datasetManifestHash: job.datasetManifestHash,
          datasetManifest: job.datasetManifest,
          operatorAttestation: job.operatorAttestation,
          reviewRequestedAt: job.reviewRequestedAt,
          reviewRequestedBy: job.reviewRequestedBy,
          approvedAt: job.approvedAt,
          approvedBy: job.approvedBy,
          rejectedAt: job.rejectedAt,
          rejectedBy: job.rejectedBy,
          rejectionReason: job.rejectionReason,
          queuedAt: job.queuedAt,
          queuedBy: job.queuedBy,
          falRequestId: job.falRequestId,
          falResultMetadata: job.falResultMetadata,
          modelArtifactKey: job.modelArtifactKey,
          modelArtifactUrl: job.modelArtifactUrl,
          modelId: job.modelId,
          failureReason: job.failureReason,
          completedAt: job.completedAt,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
      loraModels: loraModels
        .map((model) => ({
          _id: model._id,
          organizationId: model.organizationId,
          creatorId: model.creatorId,
          trainingJobId: model.trainingJobId,
          targetModel: model.targetModel,
          triggerWord: model.triggerWord,
          trainingParams: model.trainingParams,
          status: model.status,
          modelArtifactKey: model.modelArtifactKey,
          modelArtifactUrl: model.modelArtifactUrl,
          falRequestId: model.falRequestId,
          falResultMetadata: model.falResultMetadata,
          datasetManifestHash: model.datasetManifestHash,
          activatedAt: model.activatedAt,
          activatedBy: model.activatedBy,
          createdAt: model.createdAt,
          updatedAt: model.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
      // Persona revisions are operator-visible creative state. They contain
      // no provider credentials and remain immutable once written.
      personaRevisions: personaRevisions
        .map((revision) => ({
          _id: revision._id,
          organizationId: revision.organizationId,
          creatorId: revision.creatorId,
          revisionNumber: revision.revisionNumber,
          status: revision.status,
          source: revision.source,
          snapshot: revision.snapshot,
          snapshotHash: revision.snapshotHash,
          changeNote: revision.changeNote,
          createdBy: revision.createdBy,
          createdAt: revision.createdAt,
          activatedBy: revision.activatedBy,
          activatedAt: revision.activatedAt,
          supersededAt: revision.supersededAt,
          supersededBy: revision.supersededBy,
        }))
        .sort((left, right) => right.revisionNumber - left.revisionNumber),
      // Funnel metadata has enough information for an operator to audit the
      // rules, but intentionally excludes the raw destination URL, event
      // notes, tracking identifiers, and any public-link automation state.
      funnelCampaigns: funnelCampaigns
        .map((funnel) => ({
          _id: funnel._id,
          organizationId: funnel.organizationId,
          creatorId: funnel.creatorId,
          destinationId: funnel.destinationId,
          approvalId: funnel.approvalId,
          approvalStatus: funnel.approvalId ? approvalStatus.get(funnel.approvalId) ?? "missing" : undefined,
          campaignLabel: funnel.campaignLabel,
          objective: funnel.objective,
          status: funnel.status,
          version: funnel.version,
          stages: funnel.stages,
          compliance: {
            disclosureRequired: funnel.compliance.disclosureRequired,
            disclosureText: funnel.compliance.disclosureText,
            ageGateRequired: funnel.compliance.ageGateRequired,
            ageGateEvidenceRecorded: Boolean(funnel.compliance.ageGateEvidenceReference),
            operatorAttestation: {
              attestedBy: funnel.compliance.operatorAttestation.attestedBy,
              confirmed: funnel.compliance.operatorAttestation.confirmed,
              attestedAt: funnel.compliance.operatorAttestation.attestedAt,
            },
          },
          linkPolicy: funnel.linkPolicy,
          reviewRequestedAt: funnel.reviewRequestedAt,
          reviewRequestedBy: funnel.reviewRequestedBy,
          approvedAt: funnel.approvedAt,
          approvedBy: funnel.approvedBy,
          activatedAt: funnel.activatedAt,
          activatedBy: funnel.activatedBy,
          pausedAt: funnel.pausedAt,
          pausedBy: funnel.pausedBy,
          pauseReason: funnel.pauseReason,
          createdAt: funnel.createdAt,
          updatedAt: funnel.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
      funnelEvents: funnelEvents.map((event) => ({
        _id: event._id,
        creatorId: event.creatorId,
        funnelId: event.funnelId,
        funnelVersion: event.funnelVersion,
        funnelSnapshotHash: event.funnelSnapshotHash,
        destinationId: event.destinationId,
        contentId: event.contentId,
        source: event.source,
        eventType: event.eventType,
        count: event.count,
        revenueMinor: event.revenueMinor,
        currency: event.currency,
        occurredAt: event.occurredAt,
        recordedBy: event.recordedBy,
        createdAt: event.createdAt,
      })),
      attributionSnapshots: attributionSnapshots.map((snapshot) => ({
        _id: snapshot._id,
        creatorId: snapshot.creatorId,
        accountId: snapshot.accountId,
        contentId: snapshot.contentId,
        destinationId: snapshot.destinationId,
        funnelId: snapshot.funnelId,
        funnelVersion: snapshot.funnelVersion,
        funnelSnapshotHash: snapshot.funnelSnapshotHash,
        source: snapshot.source,
        metrics: snapshot.metrics,
        capturedAt: snapshot.capturedAt,
        createdAt: snapshot.createdAt,
      })),
      // Metadata only: callers receive an object-store key they may later pass
      // to an approved server-side signer, never a live/signed asset URL.
      referenceAssets: referenceAssets
        .map((asset) => ({
          _id: asset._id,
          organizationId: asset.organizationId,
          creatorId: asset.creatorId,
          storageKey: asset.storageKey,
          displayName: asset.displayName,
          rightsStatus: asset.rightsStatus,
          useType: asset.useType,
          source: asset.source,
          consentAttested: asset.consentAttested,
          consentAttestedBy: asset.consentAttestedBy,
          consentAttestedAt: asset.consentAttestedAt,
          consentRecordReference: asset.consentRecordReference,
          licenseReference: asset.licenseReference,
          createdAt: asset.createdAt,
          updatedAt: asset.updatedAt,
        }))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      connections: connections.map((connection) => ({
        _id: connection._id,
        organizationId: connection.organizationId,
        provider: connection.provider,
        externalAccountId: connection.externalAccountId,
        displayName: connection.displayName,
        status: connection.status,
        health: connection.health,
        capabilities: connection.capabilities,
        scopes: connection.scopes,
        lastCheckedAt: connection.lastCheckedAt,
        lastSyncedAt: connection.lastSyncedAt,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
      })),
    };
  },
});

/**
 * Appends an immutable, active Persona Bible revision. Existing content and
 * approved render requests are intentionally never patched by this operation.
 */
export const createPersonaRevision = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    editedBy: v.string(),
    changeNote: v.optional(v.string()),
    identity: v.optional(personaIdentityPatch),
    visualSystem: v.optional(personaVisualSystemPatch),
  },
  handler: async (ctx, args) => {
    if (!args.identity && !args.visualSystem) throw new Error("a persona revision needs an identity or visual-system edit");
    const creator = await requireCreator(ctx, args.creatorId);
    const active = await ensureActivePersonaRevision(ctx, creator);
    const snapshot = mergePersonaRevisionSnapshot(creator, args.identity, args.visualSystem);
    if (stableSerialize(snapshot) === stableSerialize(active.snapshot)) {
      return { revisionId: active._id, revisionNumber: active.revisionNumber, reused: true };
    }
    const now = Date.now();
    const editedBy = normalizeText(args.editedBy, "edited by", 200);
    const changeNote = normalizeOptionalText(args.changeNote, "persona revision note", 2_000);
    const revisionNumber = active.revisionNumber + 1;
    const revisionId = await insertPersonaRevision(ctx, {
      creator,
      revisionNumber,
      status: "active",
      source: "operator_edit",
      snapshot,
      changeNote,
      createdBy: editedBy,
      createdAt: now,
      activatedBy: editedBy,
      activatedAt: now,
    });
    await ctx.db.patch(active._id, { status: "superseded", supersededAt: now, supersededBy: editedBy });
    await ctx.db.patch(creator._id, {
      identity: snapshot.identity,
      visualSystem: snapshot.visualSystem,
      activePersonaRevisionId: revisionId,
      activePersonaRevisionNumber: revisionNumber,
      updatedAt: now,
    });
    return { revisionId, revisionNumber, reused: false };
  },
});

/** Restores a prior immutable Persona Bible revision as the active future-plan state. */
export const activatePersonaRevision = internalMutation({
  args: { revisionId: v.id("creatorPersonaRevisions"), activatedBy: v.string() },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("creator persona revision not found");
    assertPersonaRevisionIntegrity(revision);
    const creator = await requireCreator(ctx, revision.creatorId);
    if (revision.organizationId !== creator.organizationId) throw new Error("creator persona revision ownership is invalid");
    const active = await ensureActivePersonaRevision(ctx, creator);
    if (active._id === revision._id) return { revisionId: revision._id, revisionNumber: revision.revisionNumber, reused: true };
    if (revision.status !== "superseded") throw new Error("creator persona revision is not eligible for activation");
    const now = Date.now();
    const activatedBy = normalizeText(args.activatedBy, "activated by", 200);
    await ctx.db.patch(active._id, { status: "superseded", supersededAt: now, supersededBy: activatedBy });
    await ctx.db.patch(revision._id, {
      status: "active",
      activatedAt: now,
      activatedBy,
      supersededAt: undefined,
      supersededBy: undefined,
    });
    await ctx.db.patch(creator._id, {
      identity: revision.snapshot.identity,
      visualSystem: revision.snapshot.visualSystem,
      activePersonaRevisionId: revision._id,
      activePersonaRevisionNumber: revision.revisionNumber,
      updatedAt: now,
    });
    return { revisionId: revision._id, revisionNumber: revision.revisionNumber, reused: false };
  },
});

/** Create a persona profile; it cannot create or sign into a social account. */
export const createProfile = internalMutation({
  args: {
    name: v.string(),
    handle: v.string(),
    archetype: creatorArchetype,
    stage: v.optional(creatorStage),
    timezone: v.string(),
    bio: v.optional(v.string()),
    identitySummary: v.optional(v.string()),
    emotionalBackstory: v.optional(v.string()),
    voiceGuide: v.optional(v.string()),
    audience: v.optional(v.string()),
    contentPillars: v.optional(v.array(v.string())),
    boundaries: v.optional(v.array(v.string())),
    promptLock: v.string(),
    promptStyle: v.optional(v.string()),
    loraTrigger: v.optional(v.string()),
    referenceNotes: v.optional(v.string()),
    primaryGoal: v.optional(creatorGoal),
    inboxPolicy: v.optional(inboxPolicy),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const organization = await ensureDefaultOrganization(ctx);
    if (!organization) throw new Error("failed to bootstrap Media Engine organization");
    const handle = normalizeHandle(args.handle);
    const existing = await ctx.db
      .query("creatorProfiles")
      .withIndex("by_organization_handle", (q) => q.eq("organizationId", organization._id).eq("handle", handle))
      .unique();
    if (existing) throw new Error("a creator profile with this handle already exists");

    return await ctx.db.insert("creatorProfiles", {
      organizationId: organization._id,
      name: normalizeText(args.name, "name", 200),
      handle,
      archetype: args.archetype,
      stage: args.stage ?? "setup",
      timezone: assertTimezone(args.timezone),
      identity: {
        bio: normalizeOptionalText(args.bio, "bio", 500),
        identitySummary: normalizeOptionalText(args.identitySummary, "identity summary"),
        emotionalBackstory: normalizeOptionalText(args.emotionalBackstory, "emotional backstory"),
        voiceGuide: normalizeOptionalText(args.voiceGuide, "voice guide"),
        audience: normalizeOptionalText(args.audience, "audience", 1_000),
        contentPillars: normalizeStringList(args.contentPillars ?? [], "content pillars"),
        boundaries: normalizeStringList(args.boundaries ?? [], "boundaries"),
      },
      visualSystem: {
        promptLock: normalizeText(args.promptLock, "prompt lock"),
        promptStyle: normalizeOptionalText(args.promptStyle, "prompt style"),
        loraTrigger: normalizeOptionalText(args.loraTrigger, "LoRA trigger", 200),
        referenceNotes: normalizeOptionalText(args.referenceNotes, "reference notes"),
        version: 1,
      },
      primaryGoal: args.primaryGoal ?? "audience_growth",
      inboxPolicy: args.inboxPolicy ?? "draft_only",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Revises the mutable persona bible without changing a previously approved
 * content snapshot. Visual-system changes advance its version so future plans
 * can record exactly which prompt lock they used.
 */
export const updateProfile = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    stage: creatorStage,
    timezone: v.string(),
    identitySummary: v.optional(v.string()),
    emotionalBackstory: v.optional(v.string()),
    voiceGuide: v.optional(v.string()),
    audience: v.optional(v.string()),
    contentPillars: v.array(v.string()),
    boundaries: v.array(v.string()),
    promptLock: v.string(),
    promptStyle: v.optional(v.string()),
    loraTrigger: v.optional(v.string()),
    referenceNotes: v.optional(v.string()),
    primaryGoal: creatorGoal,
    inboxPolicy: inboxPolicy,
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const visualSystem = {
      promptLock: normalizeText(args.promptLock, "prompt lock"),
      promptStyle: normalizeOptionalText(args.promptStyle, "prompt style"),
      loraTrigger: normalizeOptionalText(args.loraTrigger, "LoRA trigger", 200),
      referenceNotes: normalizeOptionalText(args.referenceNotes, "reference notes"),
      version: creator.visualSystem.version,
    };
    const visualChanged = visualSystem.promptLock !== creator.visualSystem.promptLock
      || visualSystem.promptStyle !== creator.visualSystem.promptStyle
      || visualSystem.loraTrigger !== creator.visualSystem.loraTrigger
      || visualSystem.referenceNotes !== creator.visualSystem.referenceNotes;
    if (visualChanged) visualSystem.version += 1;

    await ctx.db.patch(creator._id, {
      stage: args.stage,
      status: args.stage === "paused" ? "paused" : creator.status === "paused" ? "active" : creator.status,
      timezone: assertTimezone(args.timezone),
      identity: {
        ...creator.identity,
        identitySummary: normalizeOptionalText(args.identitySummary, "identity summary"),
        emotionalBackstory: normalizeOptionalText(args.emotionalBackstory, "emotional backstory"),
        voiceGuide: normalizeOptionalText(args.voiceGuide, "voice guide"),
        audience: normalizeOptionalText(args.audience, "audience", 1_000),
        contentPillars: normalizeStringList(args.contentPillars, "content pillars"),
        boundaries: normalizeStringList(args.boundaries, "boundaries"),
      },
      visualSystem,
      primaryGoal: args.primaryGoal,
      inboxPolicy: args.inboxPolicy,
      updatedAt: Date.now(),
    });
    return { visualVersion: visualSystem.version, visualChanged };
  },
});

/**
 * Create a registry row for an already-owned/authorised account. This is not
 * account creation, warm-up, login, token storage, or a provider connection.
 */
export const createSocialAccount = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    platform: socialPlatform,
    handle: v.string(),
    displayName: v.optional(v.string()),
    externalAccountId: v.optional(v.string()),
    integrationConnectionId: v.optional(v.id("integrationConnections")),
    ownershipStatus: v.union(v.literal("attested_owned"), v.literal("client_authorized")),
    dailyPostLimit: v.optional(v.number()),
    weeklyTarget: v.optional(v.number()),
    maxGapDays: v.optional(v.number()),
    formatTargets: v.optional(postingFormatTargets),
    capabilities: v.optional(v.array(v.string())),
    manualKycStatus: v.optional(manualKycStatus),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const handle = normalizeAccountHandle(args.handle, args.platform);
    const dailyPostLimit = args.dailyPostLimit ?? 1;
    assertPositiveWhole(dailyPostLimit, "daily post limit", MAX_DAILY_POSTS);
    if (args.weeklyTarget !== undefined) {
      assertPositiveWhole(args.weeklyTarget, "weekly post target", MAX_WEEKLY_POSTS);
    }
    if (args.maxGapDays !== undefined) {
      assertPositiveWhole(args.maxGapDays, "maximum cadence gap", MAX_CADENCE_GAP_DAYS);
    }
    const formatTargetValues = Object.values(args.formatTargets ?? {}).filter(
      (value): value is number => value !== undefined,
    );
    for (const target of formatTargetValues) {
      assertNonNegativeWhole(target, "format post target", MAX_WEEKLY_POSTS);
    }
    const totalFormatTarget = formatTargetValues.reduce((total, target) => total + target, 0);
    if (totalFormatTarget > MAX_WEEKLY_POSTS) {
      throw new Error(`format post targets may not exceed ${MAX_WEEKLY_POSTS} posts per week`);
    }
    if (args.weeklyTarget !== undefined && totalFormatTarget > args.weeklyTarget) {
      throw new Error("format post targets may not exceed the weekly post target");
    }
    const existing = await ctx.db
      .query("creatorSocialAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    if (existing.some((account) => account.platform === args.platform && account.handle === handle)) {
      throw new Error("this creator already has that platform account registered");
    }

    let connection: Doc<"integrationConnections"> | null = null;
    if (args.integrationConnectionId) {
      connection = await ctx.db.get(args.integrationConnectionId);
      if (!connection || connection.organizationId !== creator.organizationId) {
        throw new Error("integration connection does not belong to this creator organization");
      }
      if (args.platform === "fanvue" && connection.provider !== "fanvue") {
        throw new Error("Fanvue account records require a Fanvue provider connection");
      }
      if (args.platform === "instagram" && connection.provider !== "meta_instagram") {
        throw new Error("Instagram account records require an official Meta Instagram provider connection");
      }
    }
    const manualStatus = args.platform === "fanvue" ? (args.manualKycStatus ?? "pending") : "not_applicable";
    const now = Date.now();
    return await ctx.db.insert("creatorSocialAccounts", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      integrationConnectionId: args.integrationConnectionId,
      platform: args.platform,
      handle,
      displayName: normalizeOptionalText(args.displayName, "display name", 200),
      externalAccountId: normalizeOptionalText(args.externalAccountId, "external account id", 500),
      ownershipStatus: args.ownershipStatus,
      status: connection?.status === "connected" && manualStatus !== "rejected" ? "connected" : "pending",
      capabilities: normalizeStringList(args.capabilities ?? [], "account capabilities", 30),
      health: "unknown",
      postingPolicy: {
        mode: "approval_required",
        dailyPostLimit,
        timezone: creator.timezone,
        weeklyTarget: args.weeklyTarget,
        maxGapDays: args.maxGapDays,
        formatTargets: args.formatTargets,
      },
      manualKycStatus: manualStatus,
      lastCheckedAt: undefined,
      lastSyncedAt: undefined,
      notes: normalizeOptionalText(args.notes, "account notes"),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Records a Fanvue OAuth/KYC connection request without initiating OAuth,
 * persisting a credential, or executing any provider request. A trusted server
 * callback may later update the generic connection metadata after real consent.
 */
export const registerFanvueConnectionIntent = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    displayName: v.optional(v.string()),
    requestedCapabilities: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const requestedCapabilities = normalizeStringList(args.requestedCapabilities, "Fanvue requested capabilities", 12);
    if (!requestedCapabilities.length) throw new Error("select at least one Fanvue read capability");
    if (requestedCapabilities.some((capability) => !FANVUE_READINESS_CAPABILITIES.has(capability))) {
      throw new Error("Fanvue capability is not supported by the governed provider contract");
    }
    const displayName = normalizeOptionalText(args.displayName, "Fanvue connection name", 200);
    const existing = await ctx.db
      .query("integrationConnections")
      .withIndex("by_organization_provider", (q) => q.eq("organizationId", creator.organizationId).eq("provider", "fanvue"))
      .collect();
    const reusable = existing.find(
      (connection) => connection.status !== "revoked" && connection.displayName === displayName && connection.externalAccountId === undefined,
    );
    if (reusable) return { connectionId: reusable._id, reused: true };

    const now = Date.now();
    const connectionId = await ctx.db.insert("integrationConnections", {
      organizationId: creator.organizationId,
      provider: "fanvue",
      displayName,
      status: "pending",
      health: "unknown",
      capabilities: requestedCapabilities,
      scopes: [],
      createdAt: now,
      updatedAt: now,
    });
    return { connectionId, reused: false };
  },
});

/**
 * Records an official Meta Instagram OAuth intent only. It deliberately does
 * not open a browser, store an OAuth code/token, or create an Instagram
 * account. A separate trusted callback may complete this metadata record.
 */
export const registerMetaInstagramConnectionIntent = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    displayName: v.optional(v.string()),
    requestedCapabilities: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const requestedCapabilities = normalizeStringList(args.requestedCapabilities, "Meta Instagram requested capabilities", 12);
    if (!requestedCapabilities.length) throw new Error("select at least one Meta Instagram capability");
    if (requestedCapabilities.some((capability) => !META_INSTAGRAM_READINESS_CAPABILITIES.has(capability))) {
      throw new Error("Meta Instagram capability is not supported by the governed provider contract");
    }
    const displayName = normalizeOptionalText(args.displayName, "Meta Instagram connection name", 200);
    const existing = await ctx.db
      .query("integrationConnections")
      .withIndex("by_organization_provider", (q) => q.eq("organizationId", creator.organizationId).eq("provider", "meta_instagram"))
      .collect();
    const reusable = existing.find(
      (connection) => connection.status !== "revoked" && connection.displayName === displayName && connection.externalAccountId === undefined,
    );
    if (reusable) return { connectionId: reusable._id, reused: true };

    const now = Date.now();
    const connectionId = await ctx.db.insert("integrationConnections", {
      organizationId: creator.organizationId,
      provider: "meta_instagram",
      displayName,
      status: "pending",
      health: "unknown",
      capabilities: requestedCapabilities,
      scopes: [],
      createdAt: now,
      updatedAt: now,
    });
    return { connectionId, reused: false };
  },
});

/**
 * Links a manually known Postiz channel integration to one governed creator
 * account. This stores metadata only: no OAuth code, API key, refresh token,
 * or provider credential is ever accepted by Convex.
 */
export const linkPostizIntegration = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    platform: socialPlatform,
    integrationId: v.string(),
    handle: v.string(),
    displayName: v.optional(v.string()),
    requestedCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    if (!POSTIZ_SCHEDULABLE_PLATFORMS.has(args.platform)) {
      throw new Error("this platform is not supported by the governed Postiz scheduler");
    }
    const integrationId = normalizePostizProviderId(args.integrationId, "Postiz integration id");
    const handle = normalizeAccountHandle(args.handle, args.platform);
    const displayName = normalizeOptionalText(args.displayName, "Postiz account name", 200);
    const requested = normalizeStringList(args.requestedCapabilities ?? [], "Postiz requested capabilities", 12);
    if (requested.some((capability) => !POSTIZ_READINESS_CAPABILITIES.has(capability))) {
      throw new Error("Postiz capability is not supported by the governed scheduler contract");
    }
    const capabilities = [...new Set([...requested, POSTIZ_SCHEDULE_REQUIRED_CAPABILITY])].sort();

    const existingConnections = await ctx.db
      .query("integrationConnections")
      .withIndex("by_provider_external", (q) => q.eq("provider", "postiz").eq("externalAccountId", integrationId))
      .collect();
    if (existingConnections.length > 1) {
      throw new Error("Postiz integration id has conflicting connection records; reconcile manually");
    }
    let connection: Doc<"integrationConnections"> | null | undefined = existingConnections[0];
    if (connection) {
      const existingConnection = connection;
      if (existingConnection.organizationId !== creator.organizationId) {
        throw new Error("a Postiz integration may not be linked across organizations");
      }
      if (existingConnection.status === "revoked") {
        throw new Error("a revoked Postiz integration must be re-authorised before it can be linked");
      }
      const linkedAccounts = await ctx.db
        .query("creatorSocialAccounts")
        .withIndex("by_connection", (q) => q.eq("integrationConnectionId", existingConnection._id))
        .collect();
      if (linkedAccounts.some((account) => account.organizationId !== creator.organizationId || account.creatorId !== creator._id)) {
        throw new Error("a Postiz integration may not be linked to more than one creator");
      }
    }

    const accountsWithExternalId = await ctx.db
      .query("creatorSocialAccounts")
      .withIndex("by_platform_external_account", (q) => q.eq("platform", args.platform).eq("externalAccountId", integrationId))
      .collect();
    if (accountsWithExternalId.some((account) => account.organizationId !== creator.organizationId || account.creatorId !== creator._id)) {
      throw new Error("this Postiz integration is already linked to another creator account");
    }

    const creatorAccounts = await ctx.db
      .query("creatorSocialAccounts")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .collect();
    const accountWithHandle = creatorAccounts.find((account) => account.platform === args.platform && account.handle === handle);
    const accountWithIntegration = creatorAccounts.find(
      (account) => account.platform === args.platform && account.externalAccountId === integrationId,
    );
    if (accountWithHandle && accountWithIntegration && accountWithHandle._id !== accountWithIntegration._id) {
      throw new Error("the Postiz account handle and integration id are already bound to different account records");
    }
    const existingAccount = accountWithHandle ?? accountWithIntegration;
    if (
      existingAccount
      && (
        (existingAccount.externalAccountId !== undefined && existingAccount.externalAccountId !== integrationId)
        || (existingAccount.integrationConnectionId !== undefined && (!connection || existingAccount.integrationConnectionId !== connection._id))
        || (existingAccount.publisher !== undefined && existingAccount.publisher !== "postiz")
      )
    ) {
      throw new Error("the existing creator account is already bound to a different provider connection");
    }

    const now = Date.now();
    if (!connection) {
      const connectionId = await ctx.db.insert("integrationConnections", {
        organizationId: creator.organizationId,
        provider: "postiz",
        externalAccountId: integrationId,
        displayName,
        // "connected" means the operator bound this known Postiz integration;
        // health remains unknown until a separate credential-bound check runs.
        status: "connected",
        health: "unknown",
        capabilities,
        scopes: [],
        createdAt: now,
        updatedAt: now,
      });
      connection = await ctx.db.get(connectionId);
      if (!connection) throw new Error("Postiz integration connection could not be created");
    } else {
      const retainedSafeCapabilities = connection.capabilities.filter((capability) => POSTIZ_READINESS_CAPABILITIES.has(capability));
      await ctx.db.patch(connection._id, {
        displayName: displayName ?? connection.displayName,
        status: "connected",
        capabilities: [...new Set([...retainedSafeCapabilities, ...capabilities])].sort(),
        updatedAt: now,
      });
      connection = await ctx.db.get(connection._id);
      if (!connection) throw new Error("Postiz integration connection is missing after update");
    }

    if (!connection) throw new Error("Postiz integration connection is unavailable");
    const linkedConnection = connection;
    const accountCapabilities = [...new Set([
      ...(existingAccount?.capabilities.filter((capability) => POSTIZ_READINESS_CAPABILITIES.has(capability)) ?? []),
      ...capabilities,
    ])].sort();
    let accountId: Id<"creatorSocialAccounts">;
    let reused: boolean;
    if (existingAccount) {
      await ctx.db.patch(existingAccount._id, {
        integrationConnectionId: linkedConnection._id,
        displayName: displayName ?? existingAccount.displayName,
        externalAccountId: integrationId,
        status: "connected",
        onboarding: {
          mode: "manual",
          status: "ready",
          note: "Operator-linked Postiz integration; credentials remain outside Convex.",
        },
        publisher: "postiz",
        capabilities: accountCapabilities,
        scopes: [],
        connectionHealth: linkedConnection.health,
        updatedAt: now,
      });
      accountId = existingAccount._id;
      reused = true;
    } else {
      accountId = await ctx.db.insert("creatorSocialAccounts", {
        organizationId: creator.organizationId,
        creatorId: creator._id,
        integrationConnectionId: linkedConnection._id,
        platform: args.platform,
        handle,
        displayName,
        externalAccountId: integrationId,
        ownershipStatus: "client_authorized",
        status: "connected",
        onboarding: {
          mode: "manual",
          status: "ready",
          note: "Operator-linked Postiz integration; credentials remain outside Convex.",
        },
        publisher: "postiz",
        capabilities: accountCapabilities,
        scopes: [],
        health: "unknown",
        connectionHealth: linkedConnection.health,
        postingPolicy: {
          mode: "approval_required",
          dailyPostLimit: 1,
          timezone: creator.timezone,
        },
        manualKycStatus: "not_applicable",
        createdAt: now,
        updatedAt: now,
      });
      reused = false;
    }
    return { connectionId: linkedConnection._id, accountId, reused };
  },
});

/** Destination metadata only. Fanvue remains inactive until manual KYC and official OAuth are both evidenced. */
export const createDestination = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    kind: destinationKind,
    label: v.string(),
    url: v.string(),
    integrationConnectionId: v.optional(v.id("integrationConnections")),
    externalDestinationId: v.optional(v.string()),
    disclosureText: v.optional(v.string()),
    ageGateRequired: v.optional(v.boolean()),
    capabilities: v.optional(v.array(v.string())),
    manualKycStatus: v.optional(manualKycStatus),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const url = normalizeText(args.url, "destination URL", 2_000);
    if (!/^https:\/\//i.test(url)) throw new Error("destination URL must use HTTPS");
    let connection: Doc<"integrationConnections"> | null = null;
    if (args.integrationConnectionId) {
      connection = await ctx.db.get(args.integrationConnectionId);
      if (!connection || connection.organizationId !== creator.organizationId) {
        throw new Error("integration connection does not belong to this creator organization");
      }
    }
    const isFanvue = args.kind === "fanvue";
    if (isFanvue && connection && connection.provider !== "fanvue") {
      throw new Error("a Fanvue destination may only reference a Fanvue provider connection");
    }
    const manualStatus = isFanvue ? (args.manualKycStatus ?? "pending") : "not_applicable";
    const fanvueReady = Boolean(connection?.status === "connected" && manualStatus === "verified");
    const now = Date.now();
    return await ctx.db.insert("creatorDestinations", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      kind: args.kind,
      integrationConnectionId: args.integrationConnectionId,
      externalDestinationId: normalizeOptionalText(args.externalDestinationId, "external destination id", 500),
      label: normalizeText(args.label, "destination label", 200),
      url,
      disclosureText: normalizeOptionalText(args.disclosureText, "destination disclosure", 1_000),
      ageGateRequired: args.ageGateRequired ?? isFanvue,
      capabilities: normalizeStringList(args.capabilities ?? [], "destination capabilities", 30),
      manualKycStatus: manualStatus,
      approvalRequired: true,
      status: fanvueReady ? "active" : isFanvue ? "pending_connection" : "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Creates a draft creator funnel/campaign. This is metadata only: it neither
 * publishes a page nor creates a public tracking link or provider campaign.
 */
export const createFunnelCampaign = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    destinationId: v.id("creatorDestinations"),
    campaignLabel: v.string(),
    objective: funnelCampaignObjective,
    stages: v.array(funnelStagePlan),
    compliance: funnelComplianceInput,
    linkPolicy: funnelLinkPolicyInput,
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const destination = await requireDestinationForCreator(ctx, creator, args.destinationId);
    const now = Date.now();
    return await ctx.db.insert("creatorFunnelCampaigns", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      destinationId: destination._id,
      campaignLabel: normalizeText(args.campaignLabel, "funnel campaign label", 200),
      objective: args.objective,
      status: "draft",
      version: 1,
      stages: normalizeFunnelStages(args.stages),
      compliance: normalizeFunnelCompliance(args.compliance, destination, now),
      linkPolicy: normalizeFunnelLinkPolicy(destination, args.linkPolicy),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Revises only a non-live funnel. A live campaign must first be paused so an
 * operator cannot replace link/compliance rules under active content.
 */
export const updateFunnelCampaign = internalMutation({
  args: {
    funnelId: v.id("creatorFunnelCampaigns"),
    campaignLabel: v.string(),
    objective: funnelCampaignObjective,
    stages: v.array(funnelStagePlan),
    compliance: funnelComplianceInput,
    linkPolicy: funnelLinkPolicyInput,
  },
  handler: async (ctx, args) => {
    const funnel = await ctx.db.get(args.funnelId);
    if (!funnel) throw new Error("creator funnel campaign not found");
    if (funnel.status === "active") throw new Error("pause an active funnel before revising it");
    if (funnel.status === "review_required") throw new Error("a funnel under review is immutable; wait for a decision or create a new draft");
    if (funnel.status === "archived") throw new Error("an archived funnel cannot be revised");
    const creator = await requireCreator(ctx, funnel.creatorId);
    const destination = await requireDestinationForCreator(ctx, creator, funnel.destinationId);
    const now = Date.now();
    await ctx.db.patch(funnel._id, {
      campaignLabel: normalizeText(args.campaignLabel, "funnel campaign label", 200),
      objective: args.objective,
      status: "draft",
      version: funnel.version + 1,
      stages: normalizeFunnelStages(args.stages),
      compliance: normalizeFunnelCompliance(args.compliance, destination, now),
      linkPolicy: normalizeFunnelLinkPolicy(destination, args.linkPolicy),
      approvalId: undefined,
      reviewRequestedAt: undefined,
      reviewRequestedBy: undefined,
      approvedAt: undefined,
      approvedBy: undefined,
      activatedAt: undefined,
      activatedBy: undefined,
      pausedAt: undefined,
      pausedBy: undefined,
      pauseReason: undefined,
      updatedAt: now,
    });
    return { funnelId: funnel._id, version: funnel.version + 1 };
  },
});

/** Freeze a funnel version for human review. No destination or provider is contacted. */
export const submitFunnelForReview = internalMutation({
  args: { funnelId: v.id("creatorFunnelCampaigns"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const funnel = await ctx.db.get(args.funnelId);
    if (!funnel) throw new Error("creator funnel campaign not found");
    if (funnel.status !== "draft") throw new Error("only a draft funnel can be submitted for review");
    const creator = await requireCreator(ctx, funnel.creatorId);
    const destination = await requireDestinationForCreator(ctx, creator, funnel.destinationId);
    assertFunnelReadyForReview(funnel, destination);
    const now = Date.now();
    const requestedBy = normalizeText(args.requestedBy, "requested by", 200);
    const snapshot = creatorFunnelReviewSnapshot(funnel);
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: funnel.organizationId,
      resourceType: CREATOR_FUNNEL_APPROVAL_RESOURCE,
      resourceId: String(funnel._id),
      planVersion: funnel.version,
      actionKind: CREATOR_FUNNEL_APPROVAL_ACTION,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      riskClass: "moderate",
      status: "pending",
      requestedAt: now,
      requestedBy,
    });
    await ctx.db.patch(funnel._id, {
      approvalId,
      status: "review_required",
      reviewRequestedAt: now,
      reviewRequestedBy: requestedBy,
      updatedAt: now,
    });
    return { funnelId: funnel._id, approvalId, version: funnel.version };
  },
});

/** Approval records a human decision; activation remains a separate action. */
export const approveFunnelCampaign = internalMutation({
  args: { funnelId: v.id("creatorFunnelCampaigns"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const funnel = await ctx.db.get(args.funnelId);
    if (!funnel) throw new Error("creator funnel campaign not found");
    if (funnel.status !== "review_required" && funnel.status !== "approved") {
      throw new Error("funnel has no approvable review request");
    }
    const approval = await requireFunnelReviewApproval(ctx, funnel);
    if (approval.status !== "pending" && approval.status !== "approved") {
      throw new Error("funnel review has already been decided");
    }
    if (approval.status === "approved") {
      if (funnel.status !== "approved") throw new Error("funnel and approval decision state are inconsistent");
      return { funnelId: funnel._id, approvalId: approval._id, reused: true };
    }
    const now = Date.now();
    const decidedBy = normalizeText(args.decidedBy, "decided by", 200);
    await ctx.db.patch(approval._id, { status: "approved", decidedAt: now, decidedBy });
    await ctx.db.patch(funnel._id, { status: "approved", approvedAt: now, approvedBy: decidedBy, updatedAt: now });
    return { funnelId: funnel._id, approvalId: approval._id, reused: false };
  },
});

/**
 * Makes an already approved funnel eligible for new content snapshots. This
 * changes no provider state, so no action-ledger row is created or implied.
 */
export const activateFunnelCampaign = internalMutation({
  args: { funnelId: v.id("creatorFunnelCampaigns"), activatedBy: v.string() },
  handler: async (ctx, args) => {
    const funnel = await ctx.db.get(args.funnelId);
    if (!funnel) throw new Error("creator funnel campaign not found");
    if (funnel.status === "active") return { funnelId: funnel._id, reused: true };
    if (funnel.status !== "approved") throw new Error("only an approved funnel may be activated");
    const approval = await requireFunnelReviewApproval(ctx, funnel);
    if (approval.status !== "approved") throw new Error("funnel activation requires a human-approved review");
    const creator = await requireCreator(ctx, funnel.creatorId);
    const destination = await requireDestinationForCreator(ctx, creator, funnel.destinationId);
    assertFunnelReadyForReview(funnel, destination);
    const now = Date.now();
    const activatedBy = normalizeText(args.activatedBy, "activated by", 200);
    await ctx.db.patch(funnel._id, { status: "active", activatedAt: now, activatedBy, pausedAt: undefined, pausedBy: undefined, pauseReason: undefined, updatedAt: now });
    return { funnelId: funnel._id, reused: false };
  },
});

/** Pause a live funnel. Existing historical snapshots are retained, but new review/dispatch is blocked. */
export const pauseFunnelCampaign = internalMutation({
  args: { funnelId: v.id("creatorFunnelCampaigns"), pausedBy: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const funnel = await ctx.db.get(args.funnelId);
    if (!funnel) throw new Error("creator funnel campaign not found");
    if (funnel.status === "paused") return { funnelId: funnel._id, reused: true };
    if (funnel.status !== "active" && funnel.status !== "approved") {
      throw new Error("only an active or approved funnel may be paused");
    }
    const now = Date.now();
    const pausedBy = normalizeText(args.pausedBy, "paused by", 200);
    const pauseReason = normalizeText(args.reason, "funnel pause reason", 2_000);
    await ctx.db.patch(funnel._id, { status: "paused", pausedAt: now, pausedBy, pauseReason, updatedAt: now });
    return { funnelId: funnel._id, reused: false };
  },
});

/**
 * Records a reference image that has already been uploaded through an approved
 * operator-owned storage flow. It does not upload, download, scrape, sign, or
 * otherwise access image bytes.
 */
export const createReferenceAsset = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    storageKey: v.string(),
    displayName: v.string(),
    rightsStatus: referenceRightsStatus,
    useType: referenceUseType,
    source: referenceSource,
    consentAttested: v.boolean(),
    consentAttestedBy: v.string(),
    consentAttestedAt: v.number(),
    consentRecordReference: v.optional(v.string()),
    licenseReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const storageKey = normalizeReferenceStorageKey(args.storageKey);
    if (!args.consentAttested) throw new Error("reference asset rights must be attested by an operator");
    if (!Number.isFinite(args.consentAttestedAt) || args.consentAttestedAt <= 0 || args.consentAttestedAt > Date.now() + 60_000) {
      throw new Error("reference asset consent attestation timestamp is invalid");
    }
    if (args.useType === "creator_likeness" && args.rightsStatus !== "consented" && args.rightsStatus !== "owned") {
      throw new Error("creator likeness reference assets must be consented or owned");
    }
    const licenseReference = normalizeOptionalText(args.licenseReference, "license reference", 1_000);
    if (args.rightsStatus === "licensed" && !licenseReference) {
      throw new Error("licensed reference assets require a license reference");
    }
    const existing = await ctx.db
      .query("creatorReferenceAssets")
      .withIndex("by_organization_storage_key", (q) => q.eq("organizationId", creator.organizationId).eq("storageKey", storageKey))
      .unique();
    if (existing) throw new Error("a reference asset with this storage key is already registered");

    const now = Date.now();
    return await ctx.db.insert("creatorReferenceAssets", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      storageKey,
      displayName: normalizeText(args.displayName, "reference asset display name", 300),
      rightsStatus: args.rightsStatus,
      useType: args.useType,
      source: args.source,
      consentAttested: true,
      consentAttestedBy: normalizeText(args.consentAttestedBy, "consent attested by", 200),
      consentAttestedAt: args.consentAttestedAt,
      consentRecordReference: normalizeOptionalText(args.consentRecordReference, "consent record reference", 1_000),
      licenseReference,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Adds a scheduled calendar item and prompt brief. It is intentionally not a
 * render or publishing operation and can never contact a social platform.
 */
export const createContentPlan = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    accountId: v.optional(v.id("creatorSocialAccounts")),
    destinationId: v.optional(v.id("creatorDestinations")),
    funnelId: v.optional(v.id("creatorFunnelCampaigns")),
    format: contentFormat,
    funnelStage,
    title: v.string(),
    hook: v.string(),
    caption: v.string(),
    cta: v.string(),
    whyNow: v.string(),
    prompt: v.string(),
    promptStyle: v.optional(v.string()),
    referenceNotes: v.optional(v.string()),
    referenceAssetIds: v.optional(v.array(v.id("creatorReferenceAssets"))),
    renderProvider: v.optional(renderProvider),
    loraModelId: v.optional(v.id("creatorLoraModels")),
    scheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    if (!Number.isFinite(args.scheduledAt) || args.scheduledAt <= Date.now()) {
      throw new Error("content must be scheduled in the future");
    }
    let account: Doc<"creatorSocialAccounts"> | null = null;
    if (args.accountId) {
      account = await requireAccountForCreator(ctx, creator, args.accountId);
      await ensureAccountDailyLimit(ctx, account, args.scheduledAt);
    }
    let destination: Doc<"creatorDestinations"> | null = null;
    if (args.destinationId) destination = await requireDestinationForCreator(ctx, creator, args.destinationId);
    let funnel: Doc<"creatorFunnelCampaigns"> | null = null;
    let funnelSnapshot: ReturnType<typeof creatorFunnelContentSnapshot> | undefined;
    if (args.funnelId) {
      funnel = await ctx.db.get(args.funnelId);
      if (
        !funnel ||
        funnel.organizationId !== creator.organizationId ||
        funnel.creatorId !== creator._id ||
        funnel.status !== "active"
      ) {
        throw new Error("content may use only this creator's explicitly active funnel");
      }
      const funnelDestination = await requireDestinationForCreator(ctx, creator, funnel.destinationId);
      if (funnelDestination.status !== "active") throw new Error("an active funnel requires an active destination");
      if (destination && destination._id !== funnelDestination._id) {
        throw new Error("content destination must match the active funnel destination");
      }
      destination = funnelDestination;
      funnelSnapshot = creatorFunnelContentSnapshot(funnel, funnelDestination, args.funnelStage);
      if (normalizeText(args.cta, "content CTA", 1_000) !== funnelSnapshot.ctaText) {
        throw new Error("content CTA must match the selected funnel stage CTA");
      }
    }
    const referenceAssets = await requireReferenceAssetsForCreator(ctx, creator, args.referenceAssetIds);
    const personaRevision = await ensureActivePersonaRevision(ctx, creator);
    const provider = args.renderProvider ?? "unassigned";
    const activeLora = args.loraModelId ? await requireActiveCreatorLoRAModel(ctx, creator, args.loraModelId) : undefined;
    if (provider === "fal_z_image_turbo_lora" && !activeLora) {
      throw new Error("the Fal Z-Image Turbo LoRA provider requires an explicitly active creator LoRA model");
    }
    if (provider !== "fal_z_image_turbo_lora" && activeLora) {
      throw new Error("an active creator LoRA model may only be snapshotted with the Fal Z-Image Turbo LoRA provider");
    }
    // The first native Fal endpoint is text-to-image only. Rejecting an
    // attached reference set here prevents a future dispatcher from silently
    // ignoring a governed likeness/style reference.
    if (provider === "fal_z_image_turbo_lora" && referenceAssets.length) {
      throw new Error("the Fal Z-Image Turbo LoRA provider does not support per-post reference assets yet");
    }
    const now = Date.now();
    return await ctx.db.insert("creatorContentItems", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      accountId: args.accountId,
      destinationId: destination?._id,
      funnelId: funnel?._id,
      funnelSnapshot,
      format: args.format,
      funnelStage: args.funnelStage,
      status: "scheduled",
      reviewStatus: "not_requested",
      approvalId: undefined,
      reviewVersion: 1,
      title: normalizeText(args.title, "content title", 300),
      hook: normalizeText(args.hook, "content hook", 1_000),
      caption: normalizeText(args.caption, "content caption", 4_000),
      cta: normalizeText(args.cta, "content CTA", 1_000),
      whyNow: normalizeText(args.whyNow, "content rationale", 2_000),
      promptSnapshot: {
        promptLock: personaRevision.snapshot.visualSystem.promptLock,
        prompt: normalizeText(args.prompt, "image prompt"),
        promptStyle: normalizeOptionalText(args.promptStyle ?? personaRevision.snapshot.visualSystem.promptStyle, "prompt style"),
        referenceNotes: normalizeOptionalText(args.referenceNotes ?? personaRevision.snapshot.visualSystem.referenceNotes, "reference notes"),
        provider,
        version: personaRevision.snapshot.visualSystem.version,
        loraSnapshot: activeLora
          ? {
              modelId: activeLora.model._id,
              trainingJobId: activeLora.job._id,
              targetModel: activeLora.model.targetModel,
              triggerWord: activeLora.model.triggerWord,
              modelArtifactKey: activeLora.model.modelArtifactKey,
              modelArtifactUrl: activeLora.model.modelArtifactUrl,
              datasetManifestHash: activeLora.model.datasetManifestHash,
          }
          : undefined,
        personaSnapshot: {
          revisionId: personaRevision._id,
          revisionNumber: personaRevision.revisionNumber,
          snapshotHash: personaRevision.snapshotHash,
          identity: personaRevision.snapshot.identity,
          visualSystem: personaRevision.snapshot.visualSystem,
        },
      },
      referenceAssetKeys: referenceAssets.length ? referenceAssets.map((asset) => asset.storageKey) : undefined,
      renderState: "brief_ready",
      previewUrl: undefined,
      scheduledAt: args.scheduledAt,
      publishedAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Move an unreviewed calendar item; approval snapshots are never silently mutated. */
export const rescheduleContent = internalMutation({
  args: { contentId: v.id("creatorContentItems"), scheduledAt: v.number() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    if (!Number.isFinite(args.scheduledAt) || args.scheduledAt <= Date.now()) {
      throw new Error("content must be scheduled in the future");
    }
    if (content.reviewStatus === "pending" || content.reviewStatus === "approved") {
      throw new Error("pending or approved content is immutable; create a revision rather than changing its schedule");
    }
    if (content.status !== "scheduled" && content.status !== "draft") {
      throw new Error("only active planned content can be rescheduled");
    }
    if (content.accountId) {
      const account = await ctx.db.get(content.accountId);
      if (!account || account.organizationId !== content.organizationId) throw new Error("content account is invalid");
      // The current content item counts in the old day, but not in the new day;
      // temporarily exclude it when evaluating the new limit.
      const day = localDayKey(args.scheduledAt, account.postingPolicy.timezone);
      const planned = await ctx.db
        .query("creatorContentItems")
        .withIndex("by_account_scheduled", (q) => q.eq("accountId", account._id))
        .collect();
      const sameDay = planned.filter(
        (item) =>
          item._id !== content._id &&
          item.status === "scheduled" &&
          localDayKey(item.scheduledAt, account.postingPolicy.timezone) === day,
      );
      if (sameDay.length >= account.postingPolicy.dailyPostLimit) {
        throw new Error(`account daily plan limit (${account.postingPolicy.dailyPostLimit}) reached for ${day}`);
      }
    }
    await ctx.db.patch(content._id, {
      scheduledAt: args.scheduledAt,
      // A rejected schedule change is a new internal revision. The rejected
      // approval remains immutable in its own audit row; the next review gets
      // a new version/snapshot instead of silently reusing that decision.
      reviewStatus: content.reviewStatus === "rejected" ? "not_requested" : content.reviewStatus,
      approvalId: content.reviewStatus === "rejected" ? undefined : content.approvalId,
      reviewVersion: content.reviewStatus === "rejected" ? content.reviewVersion + 1 : content.reviewVersion,
      renderState: content.reviewStatus === "rejected" ? "brief_ready" : content.renderState,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Freeze a calendar item's current version into an approval record. Approval
 * applies to future rendering/publishing only; this function itself performs
 * no external action.
 */
export const submitContentForReview = internalMutation({
  args: { contentId: v.id("creatorContentItems"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    if (content.reviewStatus === "pending" || content.reviewStatus === "approved") {
      throw new Error("the current content version already has a review decision");
    }
    if (content.status !== "scheduled" && content.status !== "draft") {
      throw new Error("only planned content can be sent for review");
    }
    await requireActiveFunnelForContent(ctx, content);
    if (!content.accountId) throw new Error("assign an owned social account before requesting approval");
    const [creator, account, destination] = await Promise.all([
      requireCreator(ctx, content.creatorId),
      ctx.db.get(content.accountId),
      content.destinationId ? ctx.db.get(content.destinationId) : null,
    ]);
    if (!account || account.creatorId !== creator._id || account.organizationId !== creator.organizationId) {
      throw new Error("content account is invalid");
    }
    if (account.status !== "connected") {
      throw new Error("the official provider connection must be healthy before a content plan can be approved");
    }
    if (destination) {
      if (destination.creatorId !== creator._id || destination.organizationId !== creator.organizationId) {
        throw new Error("content destination is invalid");
      }
      if (destination.status !== "active") throw new Error("destination must be active before plan approval");
      if (destination.kind === "fanvue") {
        if (!destination.ageGateRequired || !destination.disclosureText || destination.manualKycStatus !== "verified") {
          throw new Error("Fanvue destinations require a disclosure, age gate, and verified manual KYC before approval");
        }
        const connection = destination.integrationConnectionId ? await ctx.db.get(destination.integrationConnectionId) : null;
        if (!connection || connection.provider !== "fanvue" || connection.status !== "connected") {
          throw new Error("Fanvue destinations require an official connected Fanvue OAuth record before approval");
        }
      }
    }
    const requestedBy = normalizeText(args.requestedBy, "requested by", 200);
    const now = Date.now();
    const reviewVersion = content.reviewStatus === "rejected" ? content.reviewVersion + 1 : content.reviewVersion;
    const snapshot = contentApprovalSnapshot(content, reviewVersion);
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: content.organizationId,
      resourceType: CREATOR_CONTENT_APPROVAL_RESOURCE,
      resourceId: String(content._id),
      planVersion: reviewVersion,
      actionKind: CREATOR_CONTENT_APPROVAL_ACTION,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      riskClass: "moderate",
      status: "pending",
      requestedAt: now,
      requestedBy,
    });
    await ctx.db.patch(content._id, {
      reviewStatus: "pending",
      approvalId,
      reviewVersion,
      updatedAt: now,
    });
    return approvalId;
  },
});

/**
 * Human approval admits one creator-specific render attempt and its action
 * ledger row in the same transaction. This mutation never contacts a renderer.
 */
export const approveContentPlan = internalMutation({
  args: { contentId: v.id("creatorContentItems"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content || !content.approvalId || (content.reviewStatus !== "pending" && content.reviewStatus !== "approved")) {
      throw new Error("content has no approvable approval request");
    }
    const approval = await ctx.db.get(content.approvalId);
    if (
      !approval ||
      approval.organizationId !== content.organizationId ||
      approval.resourceType !== CREATOR_CONTENT_APPROVAL_RESOURCE ||
      approval.resourceId !== String(content._id) ||
      approval.planVersion !== content.reviewVersion ||
      approval.actionKind !== CREATOR_CONTENT_APPROVAL_ACTION ||
      (approval.status !== "pending" && approval.status !== "approved")
    ) {
      throw new Error("content approval record is invalid or no longer approvable");
    }
    const snapshot = contentApprovalSnapshot(content);
    if (approval.snapshotHash !== snapshotHash(snapshot) || stableSerialize(approval.snapshot) !== stableSerialize(snapshot)) {
      throw new Error("content changed since its approval request; create a new review version");
    }
    await requireActiveFunnelForContent(ctx, content);
    const now = Date.now();
    const decidedBy = normalizeText(args.decidedBy, "decided by", 200);
    if (approval.status === "pending") {
      if (content.reviewStatus !== "pending") throw new Error("content and approval decision state are inconsistent");
      await ctx.db.patch(approval._id, {
        status: "approved",
        decidedAt: now,
        decidedBy,
      });
    } else if (content.reviewStatus !== "approved") {
      throw new Error("content and approval decision state are inconsistent");
    }

    const jobsForApproval = await ctx.db
      .query("creatorRenderJobs")
      .withIndex("by_approval", (q) => q.eq("approvalId", approval._id))
      .collect();
    const firstAttempt = jobsForApproval.find(
      (job) =>
        job.contentId === content._id &&
        job.creatorId === content.creatorId &&
        job.reviewVersion === content.reviewVersion &&
        job.attemptNumber === 1,
    );
    if (firstAttempt) {
      await assertCreatorRenderJobLinks(ctx, firstAttempt, content, approval);
      await ctx.db.patch(content._id, {
        reviewStatus: "approved",
        renderState: firstAttempt.status === "selected" ? "rendered" : "approved_for_render",
        updatedAt: now,
      });
      return { jobId: firstAttempt._id, actionId: firstAttempt.actionId, reused: true };
    }

    const initialAttemptKey = creatorRenderAttemptKey(content._id, content.reviewVersion, 1);
    const legacyAttemptKey = legacyCreatorRenderActionKey(content._id, content.reviewVersion);
    const [actionAtInitialKey, legacyAction] = await Promise.all([
      ctx.db.query("actionLedger").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", initialAttemptKey)).unique(),
      ctx.db.query("actionLedger").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", legacyAttemptKey)).unique(),
    ]);
    if (actionAtInitialKey && legacyAction && actionAtInitialKey._id !== legacyAction._id) {
      throw new Error("multiple creator render action-ledger records exist for the initial approval attempt");
    }
    const reusableAction = actionAtInitialKey ?? legacyAction;
    if (
      reusableAction &&
      (
        reusableAction.organizationId !== content.organizationId ||
        reusableAction.approvalId !== approval._id ||
        reusableAction.actionKind !== CREATOR_RENDER_ACTION ||
        reusableAction.renderJobId !== undefined ||
        reusableAction.creatorRenderJobId !== undefined
      )
    ) {
      throw new Error("existing creator render action-ledger record is not reusable");
    }
    const requestSnapshot = creatorRenderRequestSnapshot(approval);
    const result = await createCreatorRenderAttempt(ctx, {
      content,
      approval,
      requestSnapshot,
      requestHash: snapshotHash(requestSnapshot),
      attemptNumber: 1,
      requestedBy: decidedBy,
      idempotencyKey: reusableAction?.idempotencyKey ?? initialAttemptKey,
      reusableActionId: reusableAction?._id,
      now,
    });
    await ctx.db.patch(content._id, {
      reviewStatus: "approved",
      renderState: "approved_for_render",
      updatedAt: now,
    });
    return result;
  },
});

/** Records a human rejection without touching a renderer, publisher, or inbox provider. */
export const rejectContentPlan = internalMutation({
  args: { contentId: v.id("creatorContentItems"), decidedBy: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content || !content.approvalId || content.reviewStatus !== "pending") {
      throw new Error("content has no pending approval request");
    }
    const approval = await ctx.db.get(content.approvalId);
    if (
      !approval ||
      approval.organizationId !== content.organizationId ||
      approval.resourceType !== CREATOR_CONTENT_APPROVAL_RESOURCE ||
      approval.resourceId !== String(content._id) ||
      approval.planVersion !== content.reviewVersion ||
      approval.actionKind !== CREATOR_CONTENT_APPROVAL_ACTION ||
      approval.status !== "pending"
    ) {
      throw new Error("content approval record is invalid or no longer pending");
    }
    const snapshot = contentApprovalSnapshot(content);
    if (approval.snapshotHash !== snapshotHash(snapshot) || stableSerialize(approval.snapshot) !== stableSerialize(snapshot)) {
      throw new Error("content changed since its approval request; create a new review version");
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "rejected",
      decidedAt: now,
      decidedBy: normalizeText(args.decidedBy, "decided by", 200),
      denialReason: normalizeText(args.reason, "rejection reason", 2_000),
    });
    await ctx.db.patch(content._id, {
      reviewStatus: "rejected",
      renderState: "rejected",
      updatedAt: now,
    });
  },
});

/**
 * Select one reviewed, controlled-storage candidate for a content item. This
 * records a human choice only; it neither publishes media nor invokes a
 * renderer. A candidate cannot be selected until the linked renderer action
 * has been explicitly recorded as succeeded by a trusted future worker.
 */
export const selectRenderCandidate = internalMutation({
  args: { candidateId: v.id("creatorRenderCandidates"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const { candidate, job, content, action } = await requireCreatorRenderCandidateContext(ctx, args.candidateId);
    const decidedBy = normalizeText(args.decidedBy, "decided by", 200);
    if (candidate.status === "rejected") throw new Error("a rejected render candidate cannot be selected");
    if (candidate.status === "selected") {
      if (content.selectedRenderCandidateId !== candidate._id || job.selectedCandidateId !== candidate._id) {
        throw new Error("selected creator render candidate state is inconsistent");
      }
      return { candidateId: candidate._id, alreadySelected: true };
    }
    if (job.status !== "candidates_ready") {
      throw new Error("creator render candidates are not ready for selection");
    }
    if (action.status !== "succeeded") {
      throw new Error("the renderer action has not recorded a verified successful outcome");
    }
    if (content.selectedRenderCandidateId && content.selectedRenderCandidateId !== candidate._id) {
      throw new Error("reject the currently selected render candidate before choosing another one");
    }
    const [contentCandidates, contentJobs] = await Promise.all([
      ctx.db.query("creatorRenderCandidates").withIndex("by_content", (q) => q.eq("contentId", content._id)).collect(),
      ctx.db.query("creatorRenderJobs").withIndex("by_content", (q) => q.eq("contentId", content._id)).collect(),
    ]);
    const anotherSelectedCandidate = contentCandidates.find(
      (item) => item._id !== candidate._id && item.status === "selected",
    );
    if (anotherSelectedCandidate) throw new Error("another render candidate is already selected for this content item");
    const activeOtherAttempt = contentJobs.find(
      (item) =>
        item._id !== job._id &&
        item.approvalId === job.approvalId &&
        item.reviewVersion === job.reviewVersion &&
        (item.status === "queued" || item.status === "running"),
    );
    if (activeOtherAttempt) {
      throw new Error("another creator render attempt is still active; wait for it or cancel it before selecting an older candidate");
    }
    const now = Date.now();
    await ctx.db.patch(candidate._id, {
      status: "selected",
      selectedAt: now,
      selectedBy: decidedBy,
      rejectedAt: undefined,
      rejectedBy: undefined,
      rejectionReason: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      status: "selected",
      selectedCandidateId: candidate._id,
      selectedAt: now,
      failureReason: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, {
      selectedRenderCandidateId: candidate._id,
      selectedRenderAt: now,
      renderState: "rendered",
      status: "rendered",
      updatedAt: now,
    });
    return { candidateId: candidate._id, alreadySelected: false };
  },
});

/**
 * Creates a separately reviewable official Meta Instagram publish action for
 * one selected render. This never calls Meta or Trigger and is deliberately
 * distinct from approving the editorial content/render plan.
 */
export const requestMetaInstagramPublish = internalMutation({
  args: { contentId: v.id("creatorContentItems"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const idempotencyKey = metaInstagramPublishActionKey(context);
    const existing = await ctx.db
      .query("actionLedger")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      const linked = await requireMetaInstagramPublishAction(ctx, context);
      if (linked.action.status === "failed" || linked.action.status === "cancelled" || linked.action.status === "blocked") {
        throw new Error("the previous Meta Instagram publish action did not complete; manually verify Meta before creating a newly approved content revision");
      }
      return { actionId: linked.action._id, approvalId: linked.approval._id, reused: true, status: linked.action.status };
    }
    if (content.status !== "rendered") {
      throw new Error("only a selected rendered content item may request Meta Instagram publication");
    }
    const now = Date.now();
    const snapshot = metaInstagramPublishSnapshot(context);
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: content.organizationId,
      resourceType: CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_RESOURCE,
      resourceId: String(content._id),
      planVersion: content.reviewVersion,
      actionKind: CREATOR_META_INSTAGRAM_PUBLISH_APPROVAL_ACTION,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      riskClass: "moderate",
      status: "pending",
      requestedAt: now,
      requestedBy: normalizeText(args.requestedBy, "requested by", 200),
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: content.organizationId,
      connectionId: context.connection._id,
      approvalId,
      actionKind: CREATOR_META_INSTAGRAM_PUBLISH_DISPATCH_ACTION,
      riskClass: "moderate",
      status: "admitted",
      idempotencyKey,
      payloadHash: snapshotHash(snapshot),
      payloadSnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, { status: "awaiting_publish_approval", updatedAt: now });
    return { actionId, approvalId, reused: false, status: "admitted" as const };
  },
});

/** Human approval of one frozen publish request; it cannot invoke Meta or Trigger. */
export const approveMetaInstagramPublish = internalMutation({
  args: { contentId: v.id("creatorContentItems"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const { action, approval } = await requireMetaInstagramPublishAction(ctx, context);
    if (approval.status === "approved") {
      if (action.status !== "admitted" && action.status !== "queued" && action.status !== "running" && action.status !== "succeeded") {
        throw new Error("approved Meta Instagram publish action is in an invalid state");
      }
      return { actionId: action._id, approvalId: approval._id, reused: true, status: action.status };
    }
    if (content.status !== "awaiting_publish_approval" || approval.status !== "pending" || action.status !== "admitted") {
      throw new Error("Meta Instagram publish request is not pending approval");
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "approved",
      decidedAt: now,
      decidedBy: normalizeText(args.decidedBy, "decided by", 200),
    });
    return { actionId: action._id, approvalId: approval._id, reused: false, status: "admitted" as const };
  },
});

/**
 * Explicit operator queue only. A future calendar time is not a publishing
 * trigger: the operator must return after it is due and invoke this action.
 */
export const queueMetaInstagramPublish = internalMutation({
  args: { contentId: v.id("creatorContentItems"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const { action, approval } = await requireMetaInstagramPublishAction(ctx, context);
    if (action.status === "queued" || action.status === "running" || action.status === "succeeded") {
      return { actionId: action._id, reused: true, status: action.status };
    }
    if (content.status !== "awaiting_publish_approval" || approval.status !== "approved" || action.status !== "admitted") {
      throw new Error("Meta Instagram publish action must be individually approved before queueing");
    }
    if (content.scheduledAt > Date.now()) {
      throw new Error("the calendar time has not arrived; Meta Instagram publication is never scheduled automatically");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "queued",
      error: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, {
      status: "dispatch_queued",
      updatedAt: now,
    });
    // Preserve the operator identity in the immutable audit already attached
    // to the individual approval; do not turn this queue into an automatic run.
    normalizeText(args.requestedBy, "requested by", 200);
    return { actionId: action._id, reused: false, status: "queued" as const };
  },
});

/** Trusted worker claim; no browser route can transition an action to running. */
export const claimMetaInstagramPublish = internalMutation({
  args: { contentId: v.id("creatorContentItems"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const { action, approval, snapshot } = await requireMetaInstagramPublishAction(ctx, context);
    if (approval.status !== "approved") throw new Error("Meta Instagram publish request is not individually approved");
    if (content.scheduledAt > Date.now()) throw new Error("Meta Instagram publish time has not arrived");
    if (action.status === "running") {
      if (action.triggerRunId !== triggerRunId || content.status !== "dispatch_queued") {
        throw new Error("Meta Instagram publish action is already claimed by another Trigger run");
      }
      return { action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash }, snapshot, providerReceipt: action.providerReceipt, reused: true };
    }
    if (action.status !== "queued" || content.status !== "dispatch_queued") {
      throw new Error("Meta Instagram publish action is not eligible for worker claim");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, { status: "running", triggerRunId, error: undefined, updatedAt: now });
    return { action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash }, snapshot, providerReceipt: action.providerReceipt, reused: false };
  },
});

/** Persist a sanitized official container id before the worker asks Meta to publish it. */
export const recordMetaInstagramPublishContainer = internalMutation({
  args: { contentId: v.id("creatorContentItems"), triggerRunId: v.string(), containerId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const containerId = normalizeMetaInstagramProviderId(args.containerId, "Meta Instagram container id");
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const { action } = await requireMetaInstagramPublishAction(ctx, context);
    if (action.status !== "running" || action.triggerRunId !== triggerRunId || content.status !== "dispatch_queued") {
      throw new Error("only the Trigger run that claimed this Meta Instagram action may record its container");
    }
    const existingContainerId = metaInstagramContainerFromReceipt(action.providerReceipt);
    if (existingContainerId) {
      if (existingContainerId !== containerId) throw new Error("Meta Instagram action already has a different container id");
      return { containerId, reused: true };
    }
    await ctx.db.patch(action._id, {
      providerReceipt: { provider: "meta_instagram", containerId },
      updatedAt: Date.now(),
    });
    return { containerId, reused: false };
  },
});

/** Completes only the worker-owned immutable action after Meta returns a media id. */
export const completeMetaInstagramPublish = internalMutation({
  args: { contentId: v.id("creatorContentItems"), triggerRunId: v.string(), containerId: v.string(), mediaId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const containerId = normalizeMetaInstagramProviderId(args.containerId, "Meta Instagram container id");
    const mediaId = normalizeMetaInstagramProviderId(args.mediaId, "Meta Instagram media id");
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const { action } = await requireMetaInstagramPublishAction(ctx, context);
    if (action.status === "succeeded") {
      if (
        action.triggerRunId !== triggerRunId ||
        content.status !== "published" ||
        metaInstagramContainerFromReceipt(action.providerReceipt) !== containerId ||
        metaInstagramMediaFromReceipt(action.providerReceipt) !== mediaId
      ) {
        throw new Error("Meta Instagram completion belongs to a different worker state");
      }
      return { mediaId, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId || content.status !== "dispatch_queued") {
      throw new Error("only the Trigger run that claimed this Meta Instagram action may complete it");
    }
    const recordedContainerId = metaInstagramContainerFromReceipt(action.providerReceipt);
    if (recordedContainerId !== containerId) throw new Error("Meta Instagram completion must use the persisted container id");
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "succeeded",
      triggerRunId,
      error: undefined,
      providerReceipt: { provider: "meta_instagram", containerId, mediaId },
      updatedAt: now,
    });
    await ctx.db.patch(content._id, { status: "published", publishedAt: now, updatedAt: now });
    return { mediaId, reused: false };
  },
});

/**
 * Records a terminal, operator-visible failure. It never retries, requeues, or
 * creates a second Meta container; an uncertain external outcome must be
 * manually checked in Meta before a newly reviewed content revision is made.
 */
export const failMetaInstagramPublish = internalMutation({
  args: { contentId: v.id("creatorContentItems"), triggerRunId: v.string(), error: v.string(), containerId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const failureReason = normalizeText(args.error, "Meta Instagram publish failure", 2_000);
    const suppliedContainerId = args.containerId === undefined
      ? undefined
      : normalizeMetaInstagramProviderId(args.containerId, "Meta Instagram container id");
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    const context = await requireMetaInstagramPublishContext(ctx, content);
    const { action } = await requireMetaInstagramPublishAction(ctx, context);
    const recordedContainerId = metaInstagramContainerFromReceipt(action.providerReceipt);
    if (recordedContainerId && suppliedContainerId && recordedContainerId !== suppliedContainerId) {
      throw new Error("Meta Instagram failure container id does not match the persisted container");
    }
    const containerId = recordedContainerId ?? suppliedContainerId;
    if (action.status === "failed") {
      if (action.triggerRunId !== triggerRunId || content.status !== "failed") {
        throw new Error("Meta Instagram publish failure belongs to a different worker state");
      }
      return { recorded: true, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId || content.status !== "dispatch_queued") {
      throw new Error("only the Trigger run that claimed this Meta Instagram action may record its failure");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "failed",
      triggerRunId,
      error: failureReason,
      providerReceipt: containerId ? { provider: "meta_instagram", containerId } : undefined,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, { status: "failed", updatedAt: now });
    return { recorded: true, reused: false };
  },
});

/**
 * Creates one individually reviewable Postiz schedule request. This persists
 * the future delivery envelope only; it does not call Postiz or any social
 * network, and it does not permit a calendar tick to dispatch it.
 */
export const requestPostizSchedule = internalMutation({
  args: {
    contentId: v.id("creatorContentItems"),
    requestedBy: v.string(),
    postizSettings: v.optional(postizSettings),
  },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requirePostizScheduleContext(ctx, content);
    if (args.postizSettings === undefined) {
      throw new Error("Postiz schedule settings are required before requesting individual approval");
    }
    const settings = normalizePostizScheduleSettings(
      args.postizSettings,
      context.account.platform,
      requiredPostizContentFormat(context.content.format),
      context.candidate.mediaType,
      context.content.title,
    );
    assertPostizScheduleIsSafelyFuture(context.content.scheduledAt, "Postiz schedule request");
    const idempotencyKey = postizScheduleActionKey(context);
    const existing = await ctx.db
      .query("actionLedger")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      const linked = await requirePostizScheduleAction(ctx, context, settings);
      if (linked.action.status === "failed" || linked.action.status === "cancelled" || linked.action.status === "blocked") {
        throw new Error("the previous Postiz schedule action did not complete; reconcile with Postiz before creating a newly reviewed content revision");
      }
      return { actionId: linked.action._id, approvalId: linked.approval._id, reused: true, status: linked.action.status };
    }
    if (content.status !== "rendered") {
      throw new Error("only a selected rendered content item may request Postiz scheduling");
    }
    const now = Date.now();
    const snapshot = postizScheduleSnapshot(context, settings);
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: content.organizationId,
      resourceType: CREATOR_POSTIZ_SCHEDULE_APPROVAL_RESOURCE,
      resourceId: String(content._id),
      planVersion: content.reviewVersion,
      actionKind: CREATOR_POSTIZ_SCHEDULE_APPROVAL_ACTION,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      riskClass: "moderate",
      status: "pending",
      requestedAt: now,
      requestedBy: normalizeText(args.requestedBy, "requested by", 200),
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: content.organizationId,
      connectionId: context.connection._id,
      approvalId,
      actionKind: CREATOR_POSTIZ_SCHEDULE_DISPATCH_ACTION,
      riskClass: "moderate",
      status: "admitted",
      idempotencyKey,
      payloadHash: snapshotHash(snapshot),
      payloadSnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, { status: "awaiting_publish_approval", updatedAt: now });
    return { actionId, approvalId, reused: false, status: "admitted" as const };
  },
});

/** Individual human approval only; it cannot contact or queue Postiz. */
export const approvePostizSchedule = internalMutation({
  args: { contentId: v.id("creatorContentItems"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requirePostizScheduleContext(ctx, content);
    const { action, approval } = await requirePostizScheduleAction(ctx, context);
    if (approval.status === "approved") {
      if (action.status !== "admitted" && action.status !== "queued" && action.status !== "running" && action.status !== "succeeded") {
        throw new Error("approved Postiz schedule action is in an invalid state");
      }
      return { actionId: action._id, approvalId: approval._id, reused: true, status: action.status };
    }
    if (content.status !== "awaiting_publish_approval" || approval.status !== "pending" || action.status !== "admitted") {
      throw new Error("Postiz schedule request is not pending approval");
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "approved",
      decidedAt: now,
      decidedBy: normalizeText(args.decidedBy, "decided by", 200),
    });
    return { actionId: action._id, approvalId: approval._id, reused: false, status: "admitted" as const };
  },
});

/**
 * Explicitly queues one already-approved future schedule for the trusted
 * worker. It deliberately does not wait for or publish at the local calendar
 * time: Postiz receives the future timestamp in the frozen envelope.
 */
export const queuePostizSchedule = internalMutation({
  args: { contentId: v.id("creatorContentItems"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const context = await requirePostizScheduleContext(ctx, content);
    const { action, approval, snapshot } = await requirePostizScheduleAction(ctx, context);
    const details = postizScheduleSnapshotDetails(snapshot);
    if (action.status === "queued" || action.status === "running" || action.status === "succeeded") {
      return { actionId: action._id, reused: true, status: action.status };
    }
    if (content.status !== "awaiting_publish_approval" || approval.status !== "approved" || action.status !== "admitted") {
      throw new Error("Postiz schedule action must be individually approved before queueing");
    }
    assertPostizScheduleIsSafelyFuture(details.scheduledAt, "Postiz schedule queue");
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "queued",
      error: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, {
      status: "dispatch_queued",
      updatedAt: now,
    });
    normalizeText(args.requestedBy, "requested by", 200);
    return { actionId: action._id, reused: false, status: "queued" as const };
  },
});

/**
 * Trusted worker claim. It rechecks the immutable approval snapshot and its
 * future date, while avoiding a second dependency on mutable copy/account
 * state. A current active funnel remains the one live safety requirement.
 */
export const claimPostizSchedule = internalMutation({
  args: { contentId: v.id("creatorContentItems"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    await requireActiveFunnelForContent(ctx, content);
    const { action, approval, snapshot, details } = await requirePostizScheduleActionForWorker(ctx, content);
    if (approval.status !== "approved") throw new Error("Postiz schedule request is not individually approved");
    assertPostizScheduleIsSafelyFuture(details.scheduledAt, "Postiz schedule claim");
    if (action.status === "running") {
      if (action.triggerRunId !== triggerRunId) {
        throw new Error("Postiz schedule action is already claimed by another Trigger run");
      }
      return {
        action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash },
        snapshot,
        providerReceipt: action.providerReceipt,
        reused: true,
      };
    }
    if (action.status === "succeeded") {
      return {
        action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash },
        snapshot,
        providerReceipt: action.providerReceipt,
        reused: true,
      };
    }
    if (action.status !== "queued") {
      throw new Error("Postiz schedule action is not eligible for worker claim");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, { status: "running", triggerRunId, error: undefined, updatedAt: now });
    return {
      action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash },
      snapshot,
      providerReceipt: action.providerReceipt,
      reused: false,
    };
  },
});

/**
 * Records scheduler acceptance only. It deliberately returns content to the
 * local scheduled state and never asserts that the downstream social network
 * published it; social delivery remains awaiting provider-side execution.
 */
export const completePostizSchedule = internalMutation({
  args: {
    contentId: v.id("creatorContentItems"),
    triggerRunId: v.string(),
    postId: v.string(),
    integrationId: v.string(),
    scheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const postId = normalizePostizProviderId(args.postId, "Postiz post id");
    const integrationId = normalizePostizProviderId(args.integrationId, "Postiz integration id");
    const scheduledAt = normalizePostizScheduledAt(args.scheduledAt, "Postiz receipt schedule time");
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    const { action, details } = await requirePostizScheduleActionForWorker(ctx, content);
    if (details.integrationId !== integrationId || details.scheduledAt !== scheduledAt) {
      throw new Error("Postiz completion does not match the frozen integration or schedule");
    }
    if (action.status === "succeeded") {
      const receipt = postizReceiptFromAction(action.providerReceipt);
      if (
        action.triggerRunId !== triggerRunId
        || !receipt
        || receipt.postId !== postId
        || receipt.integrationId !== integrationId
        || receipt.scheduledAt !== scheduledAt
      ) {
        throw new Error("Postiz completion belongs to a different worker state");
      }
      return { postId, reused: true, scheduledWithPostiz: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this Postiz schedule action may complete it");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "succeeded",
      triggerRunId,
      error: undefined,
      providerReceipt: { provider: "postiz", postId, integrationId, scheduledAt },
      updatedAt: now,
    });
    await ctx.db.patch(content._id, {
      status: "scheduled",
      updatedAt: now,
    });
    return { postId, reused: false, scheduledWithPostiz: true };
  },
});

/**
 * Terminal worker failure. No retry or requeue is created because an
 * interrupted request may have been accepted by Postiz and needs manual
 * reconciliation before a newly reviewed content version can be scheduled.
 */
export const failPostizSchedule = internalMutation({
  args: { contentId: v.id("creatorContentItems"), triggerRunId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const failureReason = normalizeText(args.error, "Postiz schedule failure", 2_000);
    const content = await ctx.db.get(args.contentId);
    if (!content) throw new Error("content item not found");
    const { action } = await requirePostizScheduleActionForWorker(ctx, content);
    if (action.status === "failed") {
      if (action.triggerRunId !== triggerRunId) {
        throw new Error("Postiz schedule failure belongs to a different worker state");
      }
      return { recorded: true, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this Postiz schedule action may record its failure");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "failed",
      triggerRunId,
      error: failureReason,
      updatedAt: now,
    });
    await ctx.db.patch(content._id, { status: "failed", updatedAt: now });
    return { recorded: true, reused: false };
  },
});

/**
 * Admits one frozen, locally approved reply to the approval ledger. This is
 * not a send: only a private signed inbound proof can supply the recipient.
 */
export const requestMetaInstagramReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    const context = await requireMetaInstagramReplyContext(ctx, thread);
    const idempotencyKey = metaInstagramReplyActionKey(context);
    if (thread.metaInstagramReplyActionId) {
      const existingByPointer = await ctx.db.get(thread.metaInstagramReplyActionId);
      if (!existingByPointer || existingByPointer.idempotencyKey !== idempotencyKey) {
        throw new Error("this inbox thread already has a governed Meta Instagram reply action; use human reconciliation");
      }
      const linked = await requireMetaInstagramReplyAction(ctx, context);
      return { actionId: linked.action._id, approvalId: linked.approval._id, reused: true, status: linked.action.status };
    }
    if (context.approvedDraft.actionId || context.approvedDraft.status !== "approved") {
      throw new Error("the selected local reply draft is already governed or is no longer approval-ready");
    }
    const existing = await ctx.db
      .query("actionLedger")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      throw new Error("a previous governed Meta Instagram reply exists for this signed inbound message; use human reconciliation");
    }
    const now = Date.now();
    const snapshot = metaInstagramReplySnapshot(context);
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: thread.organizationId,
      resourceType: CREATOR_META_INSTAGRAM_REPLY_APPROVAL_RESOURCE,
      resourceId: String(thread._id),
      planVersion: undefined,
      actionKind: CREATOR_META_INSTAGRAM_REPLY_APPROVAL_ACTION,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      riskClass: "moderate",
      status: "pending",
      requestedAt: now,
      requestedBy: normalizeText(args.requestedBy, "requested by", 200),
      expiresAt: context.inbound.replyEligibilityEndsAt,
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: thread.organizationId,
      connectionId: context.connection._id,
      approvalId,
      actionKind: CREATOR_META_INSTAGRAM_REPLY_DISPATCH_ACTION,
      riskClass: "moderate",
      status: "admitted",
      idempotencyKey,
      payloadHash: snapshotHash(snapshot),
      payloadSnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(context.approvedDraft._id, { actionId, updatedAt: now });
    await ctx.db.patch(thread._id, { metaInstagramReplyActionId: actionId, updatedAt: now });
    return { actionId, approvalId, reused: false, status: "admitted" as const };
  },
});

/** Human approval for one signed-inbound/frozen-draft reply; it cannot send or queue a worker. */
export const approveMetaInstagramReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    const context = await requireMetaInstagramReplyContext(ctx, thread);
    const { action, approval } = await requireMetaInstagramReplyAction(ctx, context);
    if (thread.metaInstagramReplyActionId !== action._id) throw new Error("Meta Instagram reply action linkage is invalid");
    if (approval.status === "approved") {
      if (action.status !== "admitted" && action.status !== "queued" && action.status !== "running" && action.status !== "succeeded") {
        throw new Error("approved Meta Instagram reply action is in an invalid state");
      }
      return { actionId: action._id, approvalId: approval._id, reused: true, status: action.status };
    }
    if (approval.status !== "pending" || action.status !== "admitted") {
      throw new Error("Meta Instagram reply request is not pending individual approval");
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "approved",
      decidedAt: now,
      decidedBy: normalizeText(args.decidedBy, "decided by", 200),
    });
    return { actionId: action._id, approvalId: approval._id, reused: false, status: "admitted" as const };
  },
});

/** Explicit operator queue only. There is no schedule or autonomous reply dispatcher. */
export const queueMetaInstagramReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    const context = await requireMetaInstagramReplyContext(ctx, thread);
    const { action, approval } = await requireMetaInstagramReplyAction(ctx, context);
    if (thread.metaInstagramReplyActionId !== action._id) throw new Error("Meta Instagram reply action linkage is invalid");
    if (action.status === "queued" || action.status === "running" || action.status === "succeeded") {
      return { actionId: action._id, reused: true, status: action.status };
    }
    if (approval.status !== "approved" || action.status !== "admitted") {
      throw new Error("Meta Instagram reply action must be individually approved before queueing");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, { status: "queued", error: undefined, updatedAt: now });
    await ctx.db.patch(context.approvedDraft._id, { status: "queued", updatedAt: now });
    // This has no scheduling semantics; retaining the actor only validates the
    // explicit operator intent that reaches this boundary.
    normalizeText(args.requestedBy, "requested by", 200);
    return { actionId: action._id, reused: false, status: "queued" as const };
  },
});

/** Trusted Trigger claim only. It rechecks the current signed response window before any provider call. */
export const claimMetaInstagramReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    const context = await requireMetaInstagramReplyContext(ctx, thread);
    const { action, approval, snapshot } = await requireMetaInstagramReplyAction(ctx, context);
    if (thread.metaInstagramReplyActionId !== action._id) throw new Error("Meta Instagram reply action linkage is invalid");
    if (approval.status !== "approved") throw new Error("Meta Instagram reply request is not individually approved");
    if (action.status === "running") {
      if (action.triggerRunId !== triggerRunId) throw new Error("Meta Instagram reply action is already claimed by another Trigger run");
      return { action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash }, snapshot, reused: true };
    }
    if (action.status !== "queued") throw new Error("Meta Instagram reply action is not eligible for worker claim");
    await ctx.db.patch(action._id, { status: "running", triggerRunId, error: undefined, updatedAt: Date.now() });
    return { action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash }, snapshot, reused: false };
  },
});

/**
 * Last durable proof check immediately before the worker reaches Meta. This
 * catches a newer signed inbound message or handoff that arrived after claim;
 * no browser payload can bypass it.
 */
export const confirmMetaInstagramReplySend = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    const context = await requireMetaInstagramReplyContext(ctx, thread);
    const { action, approval } = await requireMetaInstagramReplyAction(ctx, context);
    if (
      thread.metaInstagramReplyActionId !== action._id
      || approval.status !== "approved"
      || action.status !== "running"
      || action.triggerRunId !== triggerRunId
    ) {
      throw new Error("Meta Instagram reply action is no longer eligible for provider send");
    }
    return { confirmed: true };
  },
});

/** Completes the worker-owned action after Graph returns an official message receipt. */
export const completeMetaInstagramReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), triggerRunId: v.string(), messageId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const messageId = normalizeMetaInstagramProviderId(args.messageId, "Meta Instagram reply message id");
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    if (thread.status === "human_handoff") {
      throw new Error("Meta Instagram reply reached a human-handoff thread; reconcile the provider outcome manually");
    }
    const { action, outbound } = await requireMetaInstagramReplyWorkerAction(ctx, thread);
    const recordedMessageId = metaInstagramReplyMessageFromReceipt(action.providerReceipt);
    if (action.status === "succeeded") {
      if (action.triggerRunId !== triggerRunId || recordedMessageId !== messageId || outbound.status !== "sent") {
        throw new Error("Meta Instagram reply completion belongs to a different worker state");
      }
      return { messageId, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId || outbound.status !== "queued") {
      throw new Error("only the Trigger run that claimed this Meta Instagram reply may complete it");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, {
      status: "succeeded",
      triggerRunId,
      error: undefined,
      providerReceipt: { provider: "meta_instagram", messageId },
      updatedAt: now,
    });
    await ctx.db.patch(outbound._id, { status: "sent", updatedAt: now });
    await ctx.db.patch(thread._id, { status: "closed", updatedAt: now });
    return { messageId, reused: false };
  },
});

/**
 * Every worker error is terminal and becomes a human handoff. This deliberately
 * treats a timeout or malformed receipt as externally uncertain: no retry,
 * requeue, or second message may be created from this control plane.
 */
export const failMetaInstagramReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), triggerRunId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const failureReason = normalizeText(args.error, "Meta Instagram reply failure", 2_000);
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    const { action, outbound } = await requireMetaInstagramReplyWorkerAction(ctx, thread);
    if (action.status === "failed") {
      if (action.triggerRunId !== triggerRunId || outbound.status !== "failed" || thread.status !== "human_handoff") {
        throw new Error("Meta Instagram reply failure belongs to a different worker state");
      }
      return { recorded: true, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId || outbound.status !== "queued") {
      throw new Error("only the Trigger run that claimed this Meta Instagram reply may record its failure");
    }
    const now = Date.now();
    await ctx.db.patch(action._id, { status: "failed", triggerRunId, error: failureReason, updatedAt: now });
    await ctx.db.patch(outbound._id, { status: "failed", updatedAt: now });
    await ctx.db.patch(thread._id, {
      status: "human_handoff",
      handoffReason: "Meta Instagram reply outcome needs manual reconciliation; do not retry automatically.",
      updatedAt: now,
    });
    return { recorded: true, reused: false };
  },
});

/**
 * Reject a reviewed candidate without changing its immutable render request.
 * Rejecting every candidate makes that attempt retry-eligible; it never
 * silently starts another paid/provider action.
 */
export const rejectRenderCandidate = internalMutation({
  args: { candidateId: v.id("creatorRenderCandidates"), decidedBy: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { candidate, job, content } = await requireCreatorRenderCandidateContext(ctx, args.candidateId);
    if (content.status === "awaiting_publish_approval" || content.status === "dispatch_queued" || content.status === "published" || content.status === "failed") {
      throw new Error("a candidate bound to a Meta Instagram publish action may not be changed; create a newly reviewed content revision instead");
    }
    const decidedBy = normalizeText(args.decidedBy, "decided by", 200);
    const reason = normalizeText(args.reason, "candidate rejection reason", 2_000);
    if (candidate.status === "rejected") return { candidateId: candidate._id, alreadyRejected: true };
    if (candidate.status === "selected" && content.selectedRenderCandidateId !== candidate._id) {
      throw new Error("selected creator render candidate state is inconsistent");
    }
    const jobCandidates = await ctx.db
      .query("creatorRenderCandidates")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .collect();
    const remainingPending = jobCandidates.some((item) => item._id !== candidate._id && item.status === "pending");
    const anotherSelectedCandidate = jobCandidates.some((item) => item._id !== candidate._id && item.status === "selected");
    const now = Date.now();
    await ctx.db.patch(candidate._id, {
      status: "rejected",
      rejectionReason: reason,
      rejectedAt: now,
      rejectedBy: decidedBy,
      selectedAt: undefined,
      selectedBy: undefined,
      updatedAt: now,
    });
    const nextJobStatus = anotherSelectedCandidate ? "selected" : remainingPending ? "candidates_ready" : "failed" as const;
    await ctx.db.patch(job._id, {
      status: nextJobStatus,
      selectedCandidateId: candidate.status === "selected" ? undefined : job.selectedCandidateId,
      selectedAt: candidate.status === "selected" ? undefined : job.selectedAt,
      failureReason: nextJobStatus === "failed" ? "All render candidates were rejected by an operator." : undefined,
      updatedAt: now,
    });
    if (content.selectedRenderCandidateId === candidate._id) {
      await ctx.db.patch(content._id, {
        selectedRenderCandidateId: undefined,
        selectedRenderAt: undefined,
        renderState: remainingPending ? "rendered" : "approved_for_render",
        status: "scheduled",
        updatedAt: now,
      });
    }
    return { candidateId: candidate._id, alreadyRejected: false };
  },
});

/**
 * Explicit human retry creates a new immutable attempt and a new action-ledger
 * key. It reuses the original job's frozen request snapshot rather than the
 * current content draft, and it never contacts a provider itself.
 */
export const retryCreatorRenderJob = internalMutation({
  args: { jobId: v.id("creatorRenderJobs"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("creator render job not found");
    const [content, approval] = await Promise.all([ctx.db.get(job.contentId), ctx.db.get(job.approvalId)]);
    if (!content || !approval) throw new Error("creator render job ownership records are missing");
    await assertCreatorRenderJobLinks(ctx, job, content, approval);
    if (content.selectedRenderCandidateId) {
      throw new Error("a selected render candidate already exists; reject it before requesting another render attempt");
    }
    await requireActiveFunnelForContent(ctx, content);
    const requestedBy = normalizeText(args.requestedBy, "requested by", 200);
    const relatedJobs = (await ctx.db
      .query("creatorRenderJobs")
      .withIndex("by_content", (q) => q.eq("contentId", content._id))
      .collect())
      .filter((item) => item.approvalId === job.approvalId && item.reviewVersion === job.reviewVersion);
    const activeAttempt = relatedJobs.find((item) => item.status === "queued" || item.status === "running");
    if (activeAttempt) return { jobId: activeAttempt._id, actionId: activeAttempt.actionId, reused: true };
    const latestAttempt = relatedJobs.reduce((latest, item) => item.attemptNumber > latest.attemptNumber ? item : latest, job);
    if (latestAttempt._id !== job._id) {
      throw new Error("only the newest creator render attempt can be retried");
    }
    if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1 || job.attemptNumber >= job.maxAttempts) {
      throw new Error(`creator render retry limit (${job.maxAttempts}) reached for this approved content version`);
    }
    if (job.status === "selected") throw new Error("a selected creator render job cannot be retried");
    if (job.status === "candidates_ready") {
      const pendingCandidate = await ctx.db
        .query("creatorRenderCandidates")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .filter((q) => q.eq(q.field("status"), "pending"))
        .first();
      if (pendingCandidate) throw new Error("review or reject all pending render candidates before retrying");
    } else if (job.status !== "blocked" && job.status !== "failed" && job.status !== "cancelled") {
      throw new Error("creator render job is not retry-eligible");
    }
    const details = assertCreatorRenderRequestIntegrity(job);
    if (details.provider === "unassigned") {
      throw new Error("assign a renderer through a new content revision before retrying this blocked request");
    }
    const now = Date.now();
    const result = await createCreatorRenderAttempt(ctx, {
      content,
      approval,
      requestSnapshot: job.requestSnapshot,
      requestHash: job.requestHash,
      attemptNumber: job.attemptNumber + 1,
      requestedBy,
      retryOfJobId: job._id,
      now,
    });
    await ctx.db.patch(content._id, {
      renderState: "approved_for_render",
      updatedAt: now,
    });
    return result;
  },
});

/**
 * Internal worker-only claim. It atomically binds one Trigger run to the
 * immutable request and action-ledger row before that worker may touch a
 * renderer. A blocked/unassigned request is deliberately never claimable.
 */
export const claimCreatorRenderJob = internalMutation({
  args: { jobId: v.id("creatorRenderJobs"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("creator render job not found");
    const [content, approval] = await Promise.all([ctx.db.get(job.contentId), ctx.db.get(job.approvalId)]);
    if (!content || !approval) throw new Error("creator render job ownership records are missing");
    const action = await assertCreatorRenderJobLinks(ctx, job, content, approval);
    const details = assertCreatorRenderActionPayload(job, content, action);
    if (details.provider === "unassigned" || job.status === "blocked" || action.status === "blocked") {
      throw new Error("blocked creator render jobs cannot be claimed; create a newly approved assigned-provider revision instead");
    }
    // A campaign pause is a governance stop, not a rewrite of the immutable
    // approval snapshot. It must nevertheless stop a queued worker before it
    // starts an external render. A running worker may finish/recover normally.
    if (job.status !== "running") {
      try {
        await requireActiveFunnelForContent(ctx, content);
      } catch (error) {
        if (job.status === "queued" && action.status === "queued") {
          const now = Date.now();
          const reason = error instanceof Error ? error.message : "creator funnel is not active";
          await ctx.db.patch(job._id, { status: "blocked", failureReason: reason, updatedAt: now });
          await ctx.db.patch(action._id, { status: "blocked", error: reason, updatedAt: now });
        }
        throw error;
      }
    }
    if (job.status === "running") {
      if (action.status !== "running" || action.triggerRunId !== triggerRunId) {
        throw new Error("creator render job is already claimed by another Trigger run");
      }
      return {
        job: {
          id: job._id,
          provider: job.provider,
          attemptNumber: job.attemptNumber,
          requestHash: job.requestHash,
          scheduledAt: job.scheduledAt,
          referenceCount: job.referenceCount,
        },
        requestSnapshot: job.requestSnapshot,
        reused: true,
      };
    }
    if (job.status !== "queued" || action.status !== "queued") {
      throw new Error("creator render job is not eligible for worker claim");
    }
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "running", failureReason: undefined, updatedAt: now });
    await ctx.db.patch(action._id, { status: "running", triggerRunId, error: undefined, updatedAt: now });
    return {
      job: {
        id: job._id,
        provider: job.provider,
        attemptNumber: job.attemptNumber,
        requestHash: job.requestHash,
        scheduledAt: job.scheduledAt,
        referenceCount: job.referenceCount,
      },
      requestSnapshot: job.requestSnapshot,
      reused: false,
    };
  },
});

/**
 * Internal worker-only completion metadata. The worker must have claimed this
 * job and copied output into controlled storage first; no provider URL or raw
 * receipt is persisted here. Repeating the same candidate key is idempotent.
 */
export const recordCreatorRenderCandidate = internalMutation({
  args: {
    jobId: v.id("creatorRenderJobs"),
    triggerRunId: v.string(),
    candidateKey: v.string(),
    assetKey: v.string(),
    thumbnailKey: v.optional(v.string()),
    mediaType: v.union(v.literal("image"), v.literal("video")),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const candidateKey = normalizeCreatorRenderCandidateKey(args.candidateKey);
    assertControlledCreatorRenderAssetKey(args.assetKey, "creator render asset");
    if (args.thumbnailKey) assertControlledCreatorRenderAssetKey(args.thumbnailKey, "creator render thumbnail");
    const width = normalizeOptionalRenderDimension(args.width, "render width");
    const height = normalizeOptionalRenderDimension(args.height, "render height");
    const durationSeconds = normalizeOptionalRenderDuration(args.durationSeconds);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("creator render job not found");
    const [content, approval] = await Promise.all([ctx.db.get(job.contentId), ctx.db.get(job.approvalId)]);
    if (!content || !approval) throw new Error("creator render job ownership records are missing");
    const action = await assertCreatorRenderJobLinks(ctx, job, content, approval);
    const details = assertCreatorRenderActionPayload(job, content, action);
    if (details.provider === "unassigned" || job.provider === "unassigned") {
      throw new Error("an unassigned provider cannot record a render candidate");
    }
    if (
      (job.status !== "running" && job.status !== "candidates_ready") ||
      (action.status !== "running" && action.status !== "succeeded") ||
      action.triggerRunId !== triggerRunId
    ) {
      throw new Error("only the Trigger run that claimed this creator render job may record candidates");
    }
    const idempotencyKey = `creator-render-candidate:${job._id}:${candidateKey}`;
    const existing = await ctx.db
      .query("creatorRenderCandidates")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      if (
        existing.organizationId !== job.organizationId ||
        existing.creatorId !== job.creatorId ||
        existing.contentId !== content._id ||
        existing.jobId !== job._id ||
        existing.attemptNumber !== job.attemptNumber ||
        existing.provider !== job.provider ||
        existing.mediaType !== args.mediaType ||
        existing.assetKey !== args.assetKey ||
        existing.thumbnailKey !== args.thumbnailKey ||
        existing.width !== width ||
        existing.height !== height ||
        existing.durationSeconds !== durationSeconds
      ) {
        throw new Error("creator render candidate idempotency key is already bound to different output metadata");
      }
      return { candidateId: existing._id, reused: true };
    }
    const existingCandidates = await ctx.db
      .query("creatorRenderCandidates")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .collect();
    if (existingCandidates.length >= MAX_CREATOR_RENDER_CANDIDATES) {
      throw new Error(`creator render attempt may record at most ${MAX_CREATOR_RENDER_CANDIDATES} candidates`);
    }
    const now = Date.now();
    const candidateId = await ctx.db.insert("creatorRenderCandidates", {
      organizationId: job.organizationId,
      creatorId: job.creatorId,
      contentId: content._id,
      jobId: job._id,
      attemptNumber: job.attemptNumber,
      provider: job.provider,
      mediaType: args.mediaType,
      status: "pending",
      idempotencyKey,
      assetKey: args.assetKey,
      thumbnailKey: args.thumbnailKey,
      width,
      height,
      durationSeconds,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, { status: "candidates_ready", failureReason: undefined, updatedAt: now });
    await ctx.db.patch(action._id, {
      status: "succeeded",
      triggerRunId,
      error: undefined,
      // Sanitized state only: the raw provider receipt stays outside Convex.
      providerReceipt: {
        provider: job.provider,
        creatorRenderJobId: String(job._id),
        controlledStorage: true,
        candidateCount: existingCandidates.length + 1,
      },
      updatedAt: now,
    });
    return { candidateId, reused: false };
  },
});

/**
 * Internal worker-only failure recorder. It cannot cancel a completed review,
 * create a retry, or change the immutable request; the operator must request
 * any later retry through the governed gateway action.
 */
export const failCreatorRenderJob = internalMutation({
  args: { jobId: v.id("creatorRenderJobs"), triggerRunId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const failureReason = normalizeText(args.error, "creator render failure", 2_000);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("creator render job not found");
    const [content, approval] = await Promise.all([ctx.db.get(job.contentId), ctx.db.get(job.approvalId)]);
    if (!content || !approval) throw new Error("creator render job ownership records are missing");
    const action = await assertCreatorRenderJobLinks(ctx, job, content, approval);
    assertCreatorRenderActionPayload(job, content, action);
    if (job.status === "failed") {
      if (action.status !== "failed" || action.triggerRunId !== triggerRunId) {
        throw new Error("creator render job failure belongs to a different worker state");
      }
      return { recorded: true, reused: true };
    }
    if (job.status !== "running" || action.status !== "running" || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this creator render job may record its failure");
    }
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "failed", failureReason, updatedAt: now });
    await ctx.db.patch(action._id, { status: "failed", triggerRunId, error: failureReason, updatedAt: now });
    await ctx.db.patch(content._id, { renderState: "approved_for_render", updatedAt: now });
    return { recorded: true, reused: false };
  },
});

/**
 * Creates a consent-gated Z-Image Turbo LoRA training draft. This freezes the
 * selected reference asset keys, captions, hashes (when supplied), training
 * parameters, and explicit operator attestation. It does not call Fal.
 */
export const createLoRATrainingDraft = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    trainingLabel: v.optional(v.string()),
    referenceAssetIds: v.array(v.id("creatorReferenceAssets")),
    datasetCaptions: v.optional(v.array(loraDatasetCaption)),
    trainingParams: loraTrainingParams,
    operatorAttestation: loraOperatorAttestation,
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const trainingParams = normalizeLoRATrainingParams(args.trainingParams);
    if (!args.operatorAttestation.confirmed) {
      throw new Error("an explicit operator attestation is required before a LoRA training draft can be created");
    }
    const assets = await requireConsentedLoRAReferenceAssets(ctx, creator, args.referenceAssetIds);
    const datasetManifest = createLoRADatasetManifest(assets, trainingParams, args.datasetCaptions);
    const now = Date.now();
    const jobId = await ctx.db.insert("creatorLoRATrainingJobs", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      targetModel: Z_IMAGE_TURBO_BASE_MODEL,
      status: "draft",
      triggerWord: trainingParams.triggerWord,
      trainingLabel: normalizeOptionalText(args.trainingLabel, "LoRA training label", 300),
      trainingParams,
      datasetAssetIds: assets.map((asset) => asset._id),
      datasetAssetCount: assets.length,
      datasetManifest,
      datasetManifestHash: snapshotHash(datasetManifest),
      operatorAttestation: {
        attestedBy: normalizeText(args.operatorAttestation.attestedBy, "LoRA attested by", 200),
        statement: normalizeText(args.operatorAttestation.statement, "LoRA operator attestation", 2_000),
        confirmed: true,
        attestedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, status: "draft" as const, datasetManifestHash: snapshotHash(datasetManifest) };
  },
});

/** Requests explicit human review of a frozen LoRA training dataset. */
export const submitLoRATrainingForReview = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const creator = await requireCreator(ctx, job.creatorId);
    await requireConsentedLoRAReferenceAssets(ctx, creator, job.datasetAssetIds);
    if (job.status === "review_required") {
      const approval = await requireLoRATrainingReviewApproval(ctx, job);
      if (approval.status !== "pending") throw new Error("LoRA training review state is inconsistent");
      return { approvalId: approval._id, reused: true };
    }
    if (job.status !== "draft") throw new Error("only a LoRA training draft may be submitted for review");
    const now = Date.now();
    const requestedBy = normalizeText(args.requestedBy, "requested by", 200);
    const snapshot = loRATrainingReviewSnapshot(job);
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: job.organizationId,
      resourceType: CREATOR_LORA_TRAINING_APPROVAL_RESOURCE,
      resourceId: String(job._id),
      planVersion: 1,
      actionKind: CREATOR_LORA_TRAINING_APPROVAL_ACTION,
      snapshotHash: snapshotHash(snapshot),
      snapshot,
      riskClass: "financial",
      status: "pending",
      requestedAt: now,
      requestedBy,
    });
    await ctx.db.patch(job._id, {
      reviewApprovalId: approvalId,
      status: "review_required",
      reviewRequestedAt: now,
      reviewRequestedBy: requestedBy,
      updatedAt: now,
    });
    return { approvalId, reused: false };
  },
});

/** Human approval only. It admits no provider call until a separate queue step. */
export const approveLoRATraining = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    const creator = await requireCreator(ctx, job.creatorId);
    await requireConsentedLoRAReferenceAssets(ctx, creator, job.datasetAssetIds);
    if (job.status === "approved_for_training" && approval.status === "approved") {
      return { approvalId: approval._id, reused: true };
    }
    if (job.status !== "review_required" || approval.status !== "pending") {
      throw new Error("LoRA training job has no pending review approval");
    }
    const now = Date.now();
    const decidedBy = normalizeText(args.decidedBy, "decided by", 200);
    await ctx.db.patch(approval._id, { status: "approved", decidedAt: now, decidedBy });
    await ctx.db.patch(job._id, { status: "approved_for_training", approvedAt: now, approvedBy: decidedBy, updatedAt: now });
    return { approvalId: approval._id, reused: false };
  },
});

/** A rejected review stays terminal; create a fresh, newly attested draft to revise it. */
export const rejectLoRATraining = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), decidedBy: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    if (job.status === "rejected" && approval.status === "rejected") return { approvalId: approval._id, reused: true };
    if (job.status !== "review_required" || approval.status !== "pending") {
      throw new Error("LoRA training job has no pending review approval");
    }
    const now = Date.now();
    const decidedBy = normalizeText(args.decidedBy, "decided by", 200);
    const reason = normalizeText(args.reason, "LoRA rejection reason", 2_000);
    await ctx.db.patch(approval._id, { status: "rejected", decidedAt: now, decidedBy, denialReason: reason });
    await ctx.db.patch(job._id, {
      status: "rejected",
      rejectedAt: now,
      rejectedBy: decidedBy,
      rejectionReason: reason,
      updatedAt: now,
    });
    return { approvalId: approval._id, reused: false };
  },
});

/**
 * Explicitly queues a reviewed training job and creates its durable paid-action
 * ledger record. Queueing itself never calls Fal.
 */
export const queueLoRATraining = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    if (approval.status !== "approved") throw new Error("LoRA training requires an approved review before queueing");
    const creator = await requireCreator(ctx, job.creatorId);
    await requireConsentedLoRAReferenceAssets(ctx, creator, job.datasetAssetIds);
    if (job.status === "queued" || job.status === "running" || job.status === "succeeded") {
      const action = await requireLoRATrainingAction(ctx, job, approval);
      return { actionId: action._id, reused: true, status: job.status };
    }
    if (job.status !== "approved_for_training") throw new Error("LoRA training job is not approved for queueing");
    const idempotencyKey = `creator-lora-training:${job._id}`;
    const existingAction = await ctx.db.query("actionLedger").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).unique();
    if (existingAction) throw new Error("LoRA training action idempotency key is already bound to another record");
    const now = Date.now();
    const actionPayload = loRATrainingActionPayload(job);
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: job.organizationId,
      approvalId: approval._id,
      creatorLoRATrainingJobId: job._id,
      actionKind: CREATOR_LORA_TRAINING_DISPATCH_ACTION,
      riskClass: "financial",
      status: "queued",
      idempotencyKey,
      payloadHash: snapshotHash(actionPayload),
      payloadSnapshot: actionPayload,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      actionId,
      status: "queued",
      queuedAt: now,
      queuedBy: normalizeText(args.requestedBy, "requested by", 200),
      updatedAt: now,
    });
    return { actionId, reused: false, status: "queued" as const };
  },
});

/** Worker-only claim. It returns the frozen dataset and training params. */
export const claimLoRATrainingJob = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    if (approval.status !== "approved") throw new Error("LoRA training review is not approved");
    const action = await requireLoRATrainingAction(ctx, job, approval);
    const creator = await requireCreator(ctx, job.creatorId);
    await requireConsentedLoRAReferenceAssets(ctx, creator, job.datasetAssetIds);
    if (job.status === "running") {
      if (action.status !== "running" || job.triggerRunId !== triggerRunId || action.triggerRunId !== triggerRunId) {
        throw new Error("LoRA training job is already claimed by another Trigger run");
      }
      return {
        job: {
          id: job._id,
          creatorId: job.creatorId,
          targetModel: job.targetModel,
          triggerWord: job.triggerWord,
          trainingParams: job.trainingParams,
          datasetManifestHash: job.datasetManifestHash,
          datasetAssetCount: job.datasetAssetCount,
          falRequestId: job.falRequestId,
        },
        datasetManifest: job.datasetManifest,
        reused: true,
      };
    }
    if (job.status !== "queued" || action.status !== "queued") throw new Error("LoRA training job is not eligible for worker claim");
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "running", triggerRunId, failureReason: undefined, updatedAt: now });
    await ctx.db.patch(action._id, { status: "running", triggerRunId, error: undefined, updatedAt: now });
    return {
      job: {
        id: job._id,
        creatorId: job.creatorId,
        targetModel: job.targetModel,
        triggerWord: job.triggerWord,
        trainingParams: job.trainingParams,
        datasetManifestHash: job.datasetManifestHash,
        datasetAssetCount: job.datasetAssetCount,
        falRequestId: job.falRequestId,
      },
      datasetManifest: job.datasetManifest,
      reused: false,
    };
  },
});

/** Records the Fal request id before polling, preventing duplicate paid work on retry. */
export const recordLoRATrainingProviderSubmission = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), triggerRunId: v.string(), falRequestId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const falRequestId = normalizeFalRequestId(args.falRequestId);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    const action = await requireLoRATrainingAction(ctx, job, approval);
    if (job.status !== "running" || action.status !== "running" || job.triggerRunId !== triggerRunId || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this LoRA training job may record its Fal request id");
    }
    if (job.falRequestId) {
      if (job.falRequestId !== falRequestId) throw new Error("LoRA training job already has a different Fal request id");
      return { falRequestId, reused: true };
    }
    const now = Date.now();
    await ctx.db.patch(job._id, { falRequestId, updatedAt: now });
    await ctx.db.patch(action._id, {
      triggerRunId,
      providerReceipt: { provider: "fal", requestId: falRequestId, targetModel: job.targetModel },
      updatedAt: now,
    });
    return { falRequestId, reused: false };
  },
});

/**
 * Worker-only completion. It creates a validating model registry row but does
 * not make that model active or modify a creator's prompt defaults.
 */
export const completeLoRATrainingJob = internalMutation({
  args: {
    jobId: v.id("creatorLoRATrainingJobs"),
    triggerRunId: v.string(),
    modelArtifactKey: v.string(),
    modelArtifactUrl: v.optional(v.string()),
    falRequestId: v.optional(v.string()),
    falResultMetadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    assertControlledCreatorLoraArtifactKey(args.modelArtifactKey, "LoRA model artifact");
    const modelArtifactUrl = args.modelArtifactUrl === undefined ? undefined : normalizePublicArtifactUrl(args.modelArtifactUrl, "LoRA model artifact URL");
    const falResultMetadata = normalizeFalResultMetadata(args.falResultMetadata);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    const action = await requireLoRATrainingAction(ctx, job, approval);
    const submittedFalRequestId = args.falRequestId === undefined ? job.falRequestId : normalizeFalRequestId(args.falRequestId);
    if (!submittedFalRequestId) throw new Error("LoRA training completion requires a persisted Fal request id");
    if (job.falRequestId && job.falRequestId !== submittedFalRequestId) throw new Error("LoRA training completion Fal request id does not match the claimed job");
    if (job.status === "succeeded") {
      if (action.status !== "succeeded" || job.triggerRunId !== triggerRunId || action.triggerRunId !== triggerRunId || !job.modelId) {
        throw new Error("LoRA training completion belongs to a different worker state");
      }
      const existingModel = await ctx.db.get(job.modelId);
      if (!existingModel || existingModel.modelArtifactKey !== args.modelArtifactKey || existingModel.modelArtifactUrl !== modelArtifactUrl) {
        throw new Error("LoRA training completion is bound to different model metadata");
      }
      return { modelId: existingModel._id, reused: true };
    }
    if (job.status !== "running" || action.status !== "running" || job.triggerRunId !== triggerRunId || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this LoRA training job may complete it");
    }
    const creator = await requireCreator(ctx, job.creatorId);
    await requireConsentedLoRAReferenceAssets(ctx, creator, job.datasetAssetIds);
    const existingModel = await ctx.db
      .query("creatorLoraModels")
      .withIndex("by_training_job", (q) => q.eq("trainingJobId", job._id))
      .unique();
    if (existingModel) throw new Error("LoRA training job already has a model registry record");
    const now = Date.now();
    const modelId = await ctx.db.insert("creatorLoraModels", {
      organizationId: job.organizationId,
      creatorId: job.creatorId,
      trainingJobId: job._id,
      targetModel: job.targetModel,
      triggerWord: job.triggerWord,
      trainingParams: job.trainingParams,
      status: "validating",
      modelArtifactKey: args.modelArtifactKey,
      modelArtifactUrl,
      falRequestId: submittedFalRequestId,
      falResultMetadata,
      datasetManifestHash: job.datasetManifestHash,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(job._id, {
      status: "succeeded",
      falRequestId: submittedFalRequestId,
      falResultMetadata,
      modelArtifactKey: args.modelArtifactKey,
      modelArtifactUrl,
      modelId,
      completedAt: now,
      failureReason: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(action._id, {
      status: "succeeded",
      triggerRunId,
      error: undefined,
      providerReceipt: {
        provider: "fal",
        requestId: submittedFalRequestId,
        targetModel: job.targetModel,
        controlledModelArtifact: true,
        creatorLoraModelId: String(modelId),
      },
      updatedAt: now,
    });
    return { modelId, reused: false };
  },
});

/** Records worker failure without starting a retry or changing the frozen dataset. */
export const failLoRATrainingJob = internalMutation({
  args: { jobId: v.id("creatorLoRATrainingJobs"), triggerRunId: v.string(), error: v.string(), falRequestId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeTriggerRunId(args.triggerRunId);
    const failureReason = normalizeText(args.error, "LoRA training failure", 2_000);
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("LoRA training job not found");
    assertLoRATrainingJobIntegrity(job);
    const approval = await requireLoRATrainingReviewApproval(ctx, job);
    const action = await requireLoRATrainingAction(ctx, job, approval);
    const falRequestId = args.falRequestId === undefined ? job.falRequestId : normalizeFalRequestId(args.falRequestId);
    if (job.falRequestId && falRequestId && job.falRequestId !== falRequestId) {
      throw new Error("LoRA training failure Fal request id does not match the claimed job");
    }
    if (job.status === "failed") {
      if (action.status !== "failed" || job.triggerRunId !== triggerRunId || action.triggerRunId !== triggerRunId) {
        throw new Error("LoRA training failure belongs to a different worker state");
      }
      return { recorded: true, reused: true };
    }
    if (job.status !== "running" || action.status !== "running" || job.triggerRunId !== triggerRunId || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this LoRA training job may record its failure");
    }
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "failed", falRequestId, failureReason, completedAt: now, updatedAt: now });
    await ctx.db.patch(action._id, {
      status: "failed",
      triggerRunId,
      error: failureReason,
      providerReceipt: falRequestId ? { provider: "fal", requestId: falRequestId, targetModel: job.targetModel } : undefined,
      updatedAt: now,
    });
    return { recorded: true, reused: false };
  },
});

/**
 * Activation is a separate operator decision. It validates the successful
 * training artifact and provenance, then atomically replaces this creator's
 * active LoRA pointer. It never touches a legacy persona/model table.
 */
export const activateLoRAModel = internalMutation({
  args: { modelId: v.id("creatorLoraModels"), activatedBy: v.string() },
  handler: async (ctx, args) => {
    const model = await ctx.db.get(args.modelId);
    if (!model) throw new Error("creator LoRA model not found");
    const creator = await requireCreator(ctx, model.creatorId);
    if (model.organizationId !== creator.organizationId) throw new Error("creator LoRA model ownership is invalid");
    const job = await ctx.db.get(model.trainingJobId);
    if (!job || job.organizationId !== creator.organizationId || job.creatorId !== creator._id || job.status !== "succeeded" || job.modelId !== model._id) {
      throw new Error("creator LoRA model is not bound to a successful training job");
    }
    assertLoRATrainingJobIntegrity(job);
    await requireConsentedLoRAReferenceAssets(ctx, creator, job.datasetAssetIds);
    assertControlledCreatorLoraArtifactKey(model.modelArtifactKey, "creator LoRA model artifact");
    if (model.modelArtifactUrl) normalizePublicArtifactUrl(model.modelArtifactUrl, "creator LoRA model artifact URL");
    if (model.falRequestId !== job.falRequestId || model.datasetManifestHash !== job.datasetManifestHash || model.triggerWord !== job.triggerWord) {
      throw new Error("creator LoRA model provenance does not match its training job");
    }
    if (creator.activeLoraModelId === model._id && model.status === "active") return { modelId: model._id, reused: true };
    if (model.status !== "validating") throw new Error("only a validating creator LoRA model may be activated");
    const now = Date.now();
    const activatedBy = normalizeText(args.activatedBy, "activated by", 200);
    if (creator.activeLoraModelId) {
      const existingActive = await ctx.db.get(creator.activeLoraModelId);
      if (existingActive && existingActive.creatorId === creator._id && existingActive.status === "active") {
        await ctx.db.patch(existingActive._id, { status: "archived", updatedAt: now });
      }
    }
    await ctx.db.patch(model._id, { status: "active", activatedAt: now, activatedBy, updatedAt: now });
    await ctx.db.patch(creator._id, { activeLoraModelId: model._id, updatedAt: now });
    return { modelId: model._id, reused: false };
  },
});

/**
 * Records an operator-entered observation taken from an authorised provider
 * surface. This accepts no estimates or invented results: it is a manual
 * transcription of actual analytics until an official provider sync exists.
 */
export const createManualAttributionSnapshot = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    accountId: v.optional(v.id("creatorSocialAccounts")),
    contentId: v.optional(v.id("creatorContentItems")),
    destinationId: v.optional(v.id("creatorDestinations")),
    funnelId: v.optional(v.id("creatorFunnelCampaigns")),
    metrics: v.object({
      impressions: v.optional(v.number()),
      reach: v.optional(v.number()),
      linkClicks: v.optional(v.number()),
      followers: v.optional(v.number()),
      subscribers: v.optional(v.number()),
      grossRevenueMinor: v.optional(v.number()),
      currency: v.optional(v.string()),
    }),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    if (args.accountId) await requireAccountForCreator(ctx, creator, args.accountId);
    const content = args.contentId ? await requireContentForCreator(ctx, creator, args.contentId) : undefined;
    let destination = args.destinationId ? await requireDestinationForCreator(ctx, creator, args.destinationId) : undefined;
    let funnel = args.funnelId ? await ctx.db.get(args.funnelId) : undefined;
    if (funnel && (funnel.creatorId !== creator._id || funnel.organizationId !== creator.organizationId)) {
      throw new Error("creator funnel campaign does not belong to this profile");
    }
    let funnelVersion: number | undefined;
    let funnelSnapshotHash: string | undefined;
    if (content?.funnelSnapshot) {
      const snapshot = assertContentFunnelSnapshotIntegrity(content);
      if (!snapshot) throw new Error("content funnel snapshot is invalid");
      if (funnel && funnel._id !== snapshot.funnelId) throw new Error("content and requested funnel do not match");
      funnel = await ctx.db.get(snapshot.funnelId);
      if (!funnel || funnel.creatorId !== creator._id || funnel.organizationId !== creator.organizationId) {
        throw new Error("content funnel ownership is invalid");
      }
      funnelVersion = snapshot.version;
      funnelSnapshotHash = snapshot.snapshotHash;
      if (!destination) destination = await requireDestinationForCreator(ctx, creator, snapshot.destinationId);
      if (destination._id !== snapshot.destinationId) throw new Error("content and attribution destination do not match");
    } else if (funnel) {
      if (!destination) destination = await requireDestinationForCreator(ctx, creator, funnel.destinationId);
      if (destination._id !== funnel.destinationId) throw new Error("funnel and attribution destination do not match");
      funnelVersion = funnel.version;
      funnelSnapshotHash = snapshotHash(creatorFunnelReviewSnapshot(funnel));
    }
    if (!Number.isFinite(args.capturedAt) || args.capturedAt <= 0 || args.capturedAt > Date.now() + 60_000) {
      throw new Error("analytics capture time is invalid");
    }
    const metrics = {
      impressions: normalizeAttributionMetric(args.metrics.impressions, "impressions"),
      reach: normalizeAttributionMetric(args.metrics.reach, "reach"),
      linkClicks: normalizeAttributionMetric(args.metrics.linkClicks, "link clicks"),
      followers: normalizeAttributionMetric(args.metrics.followers, "followers"),
      subscribers: normalizeAttributionMetric(args.metrics.subscribers, "subscribers"),
      grossRevenueMinor: normalizeAttributionMetric(args.metrics.grossRevenueMinor, "gross revenue"),
      currency: normalizeOptionalText(args.metrics.currency, "currency", 12)?.toUpperCase(),
    };
    if ([
      metrics.impressions,
      metrics.reach,
      metrics.linkClicks,
      metrics.followers,
      metrics.subscribers,
      metrics.grossRevenueMinor,
    ].every((value) => value === undefined)) {
      throw new Error("record at least one verified analytics metric");
    }
    if (metrics.currency && !/^[A-Z]{3}$/.test(metrics.currency)) {
      throw new Error("currency must use a three-letter ISO code");
    }
    if (metrics.grossRevenueMinor !== undefined && !metrics.currency) {
      throw new Error("gross revenue requires a three-letter currency code");
    }
    const now = Date.now();
    return await ctx.db.insert("creatorAttributionSnapshots", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      accountId: args.accountId,
      contentId: args.contentId,
      destinationId: destination?._id,
      funnelId: funnel?._id,
      funnelVersion,
      funnelSnapshotHash,
      source: "manual",
      metrics,
      capturedAt: args.capturedAt,
      createdAt: now,
    });
  },
});

/**
 * Records an aggregate operator observation for a funnel. It cannot receive
 * a click ID, visitor identity, raw link, webhook receipt, or provider token.
 * Paused/archived funnels remain recordable so historical attribution is not
 * silently lost when a campaign is stopped.
 */
export const recordManualFunnelEvent = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    funnelId: v.id("creatorFunnelCampaigns"),
    contentId: v.optional(v.id("creatorContentItems")),
    eventType: funnelEventType,
    count: v.number(),
    revenueMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    note: v.optional(v.string()),
    occurredAt: v.number(),
    recordedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    const funnel = await ctx.db.get(args.funnelId);
    if (!funnel || funnel.creatorId !== creator._id || funnel.organizationId !== creator.organizationId) {
      throw new Error("creator funnel campaign does not belong to this profile");
    }
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 10_000_000) {
      throw new Error("manual funnel event count must be a whole number between 1 and 10000000");
    }
    if (!Number.isFinite(args.occurredAt) || args.occurredAt <= 0 || args.occurredAt > Date.now() + 60_000) {
      throw new Error("manual funnel event time is invalid");
    }
    const revenueMinor = normalizeAttributionMetric(args.revenueMinor, "funnel event revenue");
    const currency = normalizeOptionalText(args.currency, "funnel event currency", 12)?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error("funnel event currency must use a three-letter ISO code");
    if (revenueMinor !== undefined && !currency) throw new Error("funnel event revenue requires a three-letter currency code");
    if (args.eventType === "revenue_observed" && revenueMinor === undefined) {
      throw new Error("a revenue observation requires a revenue amount");
    }

    let content: Doc<"creatorContentItems"> | undefined;
    let funnelVersion = funnel.version;
    let funnelSnapshotHash = snapshotHash(creatorFunnelReviewSnapshot(funnel));
    if (args.contentId) {
      content = await requireContentForCreator(ctx, creator, args.contentId);
      const snapshot = assertContentFunnelSnapshotIntegrity(content);
      if (!snapshot || snapshot.funnelId !== funnel._id) {
        throw new Error("manual funnel events linked to content require that content's matching funnel snapshot");
      }
      funnelVersion = snapshot.version;
      funnelSnapshotHash = snapshot.snapshotHash;
      if (content.destinationId !== funnel.destinationId) throw new Error("content destination does not match the funnel destination");
    }

    const now = Date.now();
    return await ctx.db.insert("creatorFunnelEvents", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      funnelId: funnel._id,
      funnelVersion,
      funnelSnapshotHash,
      destinationId: funnel.destinationId,
      contentId: content?._id,
      source: "manual",
      eventType: args.eventType,
      count: args.count,
      revenueMinor,
      currency,
      note: normalizeOptionalText(args.note, "manual funnel event note", 1_000),
      occurredAt: args.occurredAt,
      recordedBy: normalizeText(args.recordedBy, "recorded by", 200),
      createdAt: now,
    });
  },
});

/**
 * Accepts one message only after the public webhook route has verified Meta's
 * raw-body HMAC. This is intentionally a receipt + inbox-record boundary:
 * it does not draft, queue, authorize, or send a reply.
 *
 * Idempotency is atomic with the inbox write. The receipt id derives from the
 * official recipient and Meta message id, so retries cannot create a second
 * customer message even if Meta changes the surrounding delivery envelope.
 */
export const ingestVerifiedMetaInstagramInbound = internalMutation({
  args: {
    officialRecipientId: v.string(),
    customerSenderId: v.string(),
    externalMessageId: v.string(),
    externalThreadId: v.string(),
    payloadHash: v.string(),
    occurredAt: v.number(),
    replyEligibilityEndsAt: v.number(),
    summary: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const officialRecipientId = normalizeMetaInstagramProviderId(args.officialRecipientId, "official Instagram recipient id");
    const customerSenderId = normalizeMetaInstagramProviderId(args.customerSenderId, "Instagram customer sender id");
    const externalMessageId = normalizeMetaInstagramProviderId(args.externalMessageId, "official Instagram message id");
    const externalThreadId = normalizeText(args.externalThreadId, "Instagram customer thread key", 160);
    if (!/^meta-instagram:[a-f0-9]{64}$/.test(externalThreadId)) {
      throw new Error("Instagram customer thread key is invalid");
    }
    assertDigest(args.payloadHash, "Instagram inbound payload hash");
    if (!Number.isSafeInteger(args.occurredAt) || args.occurredAt <= 0 || args.occurredAt > Date.now() + 5 * 60 * 1_000) {
      throw new Error("Instagram inbound message timestamp is invalid");
    }
    if (
      !Number.isSafeInteger(args.replyEligibilityEndsAt)
      || args.replyEligibilityEndsAt !== args.occurredAt + META_INSTAGRAM_INBOUND_REPLY_WINDOW_MS
    ) {
      throw new Error("Instagram inbound reply window is invalid");
    }

    // A signed request is still rejected unless its recipient is an already
    // connected, healthy official Meta Instagram account with inbox access.
    // This prevents a valid delivery for an unrelated account from entering
    // the Creator Promotion workspace.
    const account = await ctx.db
      .query("creatorSocialAccounts")
      .withIndex("by_platform_external_account", (q) => q.eq("platform", "instagram").eq("externalAccountId", officialRecipientId))
      .unique();
    if (
      !account
      || account.status !== "connected"
      || account.health !== "healthy"
      || !account.integrationConnectionId
      || !account.capabilities.includes("read_inbox")
    ) {
      return { accepted: false, reason: "unmapped_or_unhealthy_recipient" as const };
    }
    const connection = await ctx.db.get(account.integrationConnectionId);
    if (
      !connection
      || connection.organizationId !== account.organizationId
      || connection.provider !== "meta_instagram"
      || connection.externalAccountId !== officialRecipientId
      || connection.status !== "connected"
      || connection.health !== "healthy"
      || !connection.capabilities.includes("read_inbox")
    ) {
      return { accepted: false, reason: "unmapped_or_unhealthy_recipient" as const };
    }
    const creator = await requireCreator(ctx, account.creatorId);
    if (creator.organizationId !== account.organizationId) {
      throw new Error("Instagram account has an invalid creator organization binding");
    }

    const eventId = `meta-instagram:${officialRecipientId}:${externalMessageId}`;
    const priorReceipt = await ctx.db
      .query("eventReceipts")
      .withIndex("by_source_event", (q) => q.eq("source", "meta_instagram_inbound").eq("eventId", eventId))
      .unique();
    if (priorReceipt) {
      if (
        priorReceipt.organizationId !== account.organizationId
        || priorReceipt.eventType !== "instagram.inbound_message"
        || priorReceipt.payloadHash !== args.payloadHash
      ) {
        throw new Error("Instagram inbound replay conflicts with the original verified message");
      }
      const priorMessage = await ctx.db
        .query("creatorInboxMessages")
        .withIndex("by_event_receipt", (q) => q.eq("eventReceiptId", priorReceipt._id))
        .unique();
      if (!priorMessage) throw new Error("Instagram inbound receipt is missing its inbox message");
      return {
        accepted: true,
        created: false,
        receiptId: priorReceipt._id,
        threadId: priorMessage.threadId,
        messageId: priorMessage._id,
      };
    }

    const now = Date.now();
    let thread = await ctx.db
      .query("creatorInboxThreads")
      .withIndex("by_account_external_thread", (q) => q.eq("accountId", account._id).eq("externalThreadId", externalThreadId))
      .unique();
    if (!thread) {
      const threadId = await ctx.db.insert("creatorInboxThreads", {
        organizationId: account.organizationId,
        creatorId: creator._id,
        accountId: account._id,
        destinationId: undefined,
        platform: "instagram",
        // The public workspace sees only this hashed thread key. The opaque
        // sender id is retained on the private signed-message record only.
        externalThreadId,
        participantLabel: "Instagram contact",
        summary: normalizeText(args.summary, "Instagram inbound summary", 600),
        intent: "general",
        status: "received",
        responseWindowEndsAt: args.replyEligibilityEndsAt,
        verifiedMetaInstagramInboundAt: args.occurredAt,
        verifiedMetaInstagramReplyEligibilityEndsAt: args.replyEligibilityEndsAt,
        requiresDisclosure: true,
        safetyFlags: [],
        draftReply: undefined,
        draftRationale: undefined,
        draftReviewStatus: undefined,
        draftReviewedAt: undefined,
        draftReviewedBy: undefined,
        approvedDraftMessageId: undefined,
        metaInstagramReplyActionId: undefined,
        handoffReason: undefined,
        handoffAssignee: undefined,
        createdAt: now,
        updatedAt: now,
      });
      thread = await ctx.db.get(threadId);
      if (!thread) throw new Error("failed to create Instagram inbox thread");
    } else {
      const existingReplyAction = thread.metaInstagramReplyActionId
        ? await ctx.db.get(thread.metaInstagramReplyActionId)
        : null;
      const preservesGovernedReply = Boolean(
        existingReplyAction
        && existingReplyAction.actionKind === CREATOR_META_INSTAGRAM_REPLY_DISPATCH_ACTION
        && (existingReplyAction.status === "admitted" || existingReplyAction.status === "queued" || existingReplyAction.status === "running"),
      );
      const remainsHandedOff = thread.status === "human_handoff" || thread.safetyFlags.length > 0 || preservesGovernedReply;
      if (preservesGovernedReply) {
        // Do not erase the worker-owned linkage while a claim may be in flight.
        // A confirmation immediately before send will now fail on handoff, and
        // the worker records one terminal manual-reconciliation outcome.
        await ctx.db.patch(thread._id, {
          summary: normalizeText(args.summary, "Instagram inbound summary", 600),
          responseWindowEndsAt: args.replyEligibilityEndsAt,
          verifiedMetaInstagramInboundAt: args.occurredAt,
          verifiedMetaInstagramReplyEligibilityEndsAt: args.replyEligibilityEndsAt,
          status: "human_handoff",
          handoffReason: "A newer Instagram customer message arrived while a governed reply was pending; reconcile manually.",
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(thread._id, {
          summary: normalizeText(args.summary, "Instagram inbound summary", 600),
          responseWindowEndsAt: args.replyEligibilityEndsAt,
          verifiedMetaInstagramInboundAt: args.occurredAt,
          verifiedMetaInstagramReplyEligibilityEndsAt: args.replyEligibilityEndsAt,
          // A new customer message invalidates any old draft. It must be
          // regenerated and reviewed against the latest inbound context.
          draftReply: undefined,
          draftRationale: undefined,
          draftReviewStatus: undefined,
          draftReviewedAt: undefined,
          draftReviewedBy: undefined,
          approvedDraftMessageId: undefined,
          metaInstagramReplyActionId: undefined,
          status: remainsHandedOff ? "human_handoff" : "received",
          updatedAt: now,
        });
      }
    }

    const receiptId = await ctx.db.insert("eventReceipts", {
      organizationId: account.organizationId,
      source: "meta_instagram_inbound",
      eventId,
      eventType: "instagram.inbound_message",
      payloadHash: args.payloadHash,
      status: "processed",
      occurredAt: args.occurredAt,
      receivedAt: now,
      processedAt: now,
    });
    const messageId = await ctx.db.insert("creatorInboxMessages", {
      organizationId: account.organizationId,
      threadId: thread._id,
      externalMessageId,
      verifiedInbound: true,
      provider: "meta_instagram",
      officialRecipientId,
      customerSenderId,
      occurredAt: args.occurredAt,
      replyEligibilityEndsAt: args.replyEligibilityEndsAt,
      eventReceiptId: receiptId,
      direction: "inbound",
      source: "official_webhook",
      status: "received",
      // The signed route supplies a bounded, URL-redacted text body. This is
      // retained privately for a later operator-reviewed draft only and is
      // never returned by listWorkspace.
      body: normalizeText(args.body, "Instagram inbound body", 2_000),
      automated: false,
      expiresAt: now + CREATOR_INBOUND_BODY_RETENTION_MS,
      createdAt: now,
      updatedAt: now,
    });
    return { accepted: true, created: true, receiptId, threadId: thread._id, messageId };
  },
});

/**
 * Store only metadata and an AI-safe summary of an inbox conversation. The
 * source message body stays with the official provider; no reply can be sent
 * from this module.
 */
export const createInboxThread = internalMutation({
  args: {
    creatorId: v.id("creatorProfiles"),
    accountId: v.optional(v.id("creatorSocialAccounts")),
    destinationId: v.optional(v.id("creatorDestinations")),
    platform: socialPlatform,
    externalThreadId: v.optional(v.string()),
    participantLabel: v.optional(v.string()),
    summary: v.string(),
    intent: inboxIntent,
    responseWindowEndsAt: v.optional(v.number()),
    requiresDisclosure: v.optional(v.boolean()),
    safetyFlags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const creator = await requireCreator(ctx, args.creatorId);
    if (args.accountId) await requireAccountForCreator(ctx, creator, args.accountId);
    if (args.destinationId) await requireDestinationForCreator(ctx, creator, args.destinationId);
    const externalThreadId = normalizeOptionalText(args.externalThreadId, "external thread id", 500);
    if (externalThreadId) {
      const existing = await ctx.db
        .query("creatorInboxThreads")
        .withIndex("by_account_external_thread", (q) => q.eq("accountId", args.accountId).eq("externalThreadId", externalThreadId))
        .unique();
      if (existing) return existing._id;
    }
    const now = Date.now();
    return await ctx.db.insert("creatorInboxThreads", {
      organizationId: creator.organizationId,
      creatorId: creator._id,
      accountId: args.accountId,
      destinationId: args.destinationId,
      platform: args.platform,
      externalThreadId,
      participantLabel: normalizeOptionalText(args.participantLabel, "participant label", 200),
      summary: normalizeText(args.summary, "inbox summary", 4_000),
      intent: args.intent,
      status: "received",
      responseWindowEndsAt: args.responseWindowEndsAt,
      verifiedMetaInstagramInboundAt: undefined,
      verifiedMetaInstagramReplyEligibilityEndsAt: undefined,
      requiresDisclosure: args.requiresDisclosure ?? true,
      safetyFlags: normalizeStringList(args.safetyFlags ?? [], "safety flags", 20),
      draftReply: undefined,
      draftRationale: undefined,
      draftReviewStatus: undefined,
      draftReviewedAt: undefined,
      draftReviewedBy: undefined,
      approvedDraftMessageId: undefined,
      metaInstagramReplyActionId: undefined,
      handoffReason: undefined,
      handoffAssignee: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Persists a reply draft for an operator to review; it cannot transmit it. */
/**
 * Builds the only model-readable inbox context. It is intentionally an
 * internal query behind the service-token gateway: the browser supplies only
 * a thread id and never receives stored message text, destination URLs,
 * contact identifiers, tracking data, or provider receipts.
 */
export const getInboxDraftContext = internalQuery({
  args: { threadId: v.id("creatorInboxThreads") },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return { eligible: false as const, reason: "The inbox thread no longer exists." };
    if (thread.status === "human_handoff" || thread.status === "closed") {
      return { eligible: false as const, reason: "This conversation is already assigned to human review." };
    }
    if (thread.intent === "safety_review" || thread.intent === "fanvue_interest" || thread.safetyFlags.length > 0) {
      return { eligible: false as const, reason: "This conversation requires a human handoff under the inbox safety policy." };
    }
    if (thread.metaInstagramReplyActionId || thread.approvedDraftMessageId || thread.draftReviewStatus === "approved") {
      return { eligible: false as const, reason: "A reviewed or governed reply already exists and must be reconciled manually." };
    }

    const creator = await ctx.db.get(thread.creatorId);
    if (!creator || creator.organizationId !== thread.organizationId || creator.status !== "active") {
      return { eligible: false as const, reason: "The creator profile is not active for inbox drafting." };
    }
    if (creator.inboxPolicy !== "draft_only") {
      return { eligible: false as const, reason: "This creator is configured for human inbox handoff only." };
    }

    const now = Date.now();
    const messages = await ctx.db
      .query("creatorInboxMessages")
      .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
      .order("desc")
      .take(MAX_ROWS);
    const latestInbound = messages.find((message) => message.direction === "inbound");
    let verifiedInboundText: string | undefined;
    if (
      latestInbound
      && latestInbound.verifiedInbound === true
      && latestInbound.provider === "meta_instagram"
      && latestInbound.source === "official_webhook"
      && latestInbound.status === "received"
      && latestInbound.eventReceiptId
      && latestInbound.expiresAt !== undefined
      && latestInbound.expiresAt > now
      && latestInbound.externalMessageId
      && latestInbound.officialRecipientId
      && latestInbound.customerSenderId
      && thread.accountId
    ) {
      const [account, receipt] = await Promise.all([
        ctx.db.get(thread.accountId),
        ctx.db.get(latestInbound.eventReceiptId),
      ]);
      if (
        account
        && account.creatorId === creator._id
        && account.organizationId === thread.organizationId
        && account.platform === "instagram"
        && account.externalAccountId === latestInbound.officialRecipientId
        && receipt
        && receipt.organizationId === thread.organizationId
        && receipt.source === "meta_instagram_inbound"
        && receipt.eventType === "instagram.inbound_message"
        && receipt.eventId === `meta-instagram:${latestInbound.officialRecipientId}:${latestInbound.externalMessageId}`
      ) {
        verifiedInboundText = redactInboxDraftText(latestInbound.body, "No usable inbound message text is available.");
      }
    }

    const disclosures = thread.requiresDisclosure ? [DEFAULT_AI_ASSISTANCE_DISCLOSURE] : [];
    let funnel: {
      objective: "brand_partnerships" | "subscription_conversion" | "website_conversion" | "lead_capture" | "other";
      destinationKind: "brand_inquiry" | "link_in_bio" | "website" | "fanvue" | "fansly" | "other";
      destinationLabel: string;
      disclosureRequired: boolean;
      disclosureText?: string;
      linkMayBeMentioned: false;
    } | undefined;

    if (thread.destinationId) {
      const destination = await ctx.db.get(thread.destinationId);
      if (!destination || destination.creatorId !== creator._id || destination.organizationId !== thread.organizationId) {
        return { eligible: false as const, reason: "The conversation destination is no longer valid for this creator." };
      }
      const activeFunnels = (await ctx.db
        .query("creatorFunnelCampaigns")
        .withIndex("by_creator_status", (q) => q.eq("creatorId", creator._id).eq("status", "active"))
        .take(MAX_ROWS))
        .filter((candidate) => candidate.destinationId === destination._id);
      if (activeFunnels.length !== 1) {
        return { eligible: false as const, reason: "The conversation destination needs exactly one active reviewed funnel before a draft can be generated." };
      }
      const activeFunnel = activeFunnels[0];
      try {
        assertFunnelReadyForReview(activeFunnel, destination);
      } catch {
        return { eligible: false as const, reason: "The active funnel or destination compliance record needs human review." };
      }
      if (
        destination.kind === "fanvue"
        || destination.kind === "fansly"
        || destination.ageGateRequired
        || activeFunnel.compliance.ageGateRequired
      ) {
        return { eligible: false as const, reason: "Age-gated or subscription-destination conversations require a human handoff." };
      }
      const funnelDisclosure = activeFunnel.compliance.disclosureRequired
        ? activeFunnel.compliance.disclosureText
        : undefined;
      if (activeFunnel.compliance.disclosureRequired && (!funnelDisclosure || containsDirectContactOrLink(funnelDisclosure))) {
        return { eligible: false as const, reason: "The active funnel disclosure is not safe to place in an AI draft and needs human review." };
      }
      if (funnelDisclosure && !disclosures.includes(funnelDisclosure)) disclosures.push(funnelDisclosure);
      funnel = {
        objective: activeFunnel.objective,
        destinationKind: destination.kind,
        destinationLabel: redactInboxDraftText(destination.label, "Approved destination", 200),
        disclosureRequired: activeFunnel.compliance.disclosureRequired,
        disclosureText: funnelDisclosure,
        // The data model has no deterministic inbox-stage or direct-link
        // authorization. A model must never select a CTA or emit a URL.
        linkMayBeMentioned: false,
      };
    }

    return {
      eligible: true as const,
      context: {
        creator: {
          voiceGuide: redactInboxDraftText(creator.identity.voiceGuide, "Warm, factual, concise.", 1_000),
          identitySummary: redactInboxDraftText(creator.identity.identitySummary, "No additional identity summary is recorded.", 1_000),
          emotionalBackstory: redactInboxDraftText(creator.identity.emotionalBackstory, "No emotional backstory is required for this reply.", 1_000),
          boundaries: creator.identity.boundaries
            .slice(0, MAX_INBOX_DRAFT_BOUNDARIES)
            .map((boundary) => redactInboxDraftText(boundary, "", 400))
            .filter(Boolean),
        },
        thread: {
          intent: thread.intent,
          summary: redactInboxDraftText(thread.summary, "No thread summary is available."),
          inboundText: verifiedInboundText,
          inboundTextVerified: Boolean(verifiedInboundText),
        },
        disclosures,
        funnel,
      },
    };
  },
});

export const draftInboxReply = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), draftReply: v.string(), rationale: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    if (thread.status === "human_handoff" || thread.status === "closed") {
      throw new Error("a handed-off or closed thread cannot receive an AI draft");
    }
    const creator = await requireCreator(ctx, thread.creatorId);
    if (creator.organizationId !== thread.organizationId || creator.status !== "active" || creator.inboxPolicy !== "draft_only") {
      throw new Error("this creator is not eligible for AI inbox drafting");
    }
    if (thread.intent === "safety_review" || thread.intent === "fanvue_interest" || thread.safetyFlags.length > 0) {
      throw new Error("this inbox thread requires human handoff instead of an AI draft");
    }
    if (thread.metaInstagramReplyActionId) {
      throw new Error("a governed Meta Instagram reply action already exists; reconcile it manually before changing this draft");
    }
    if (thread.approvedDraftMessageId || thread.draftReviewStatus === "approved") {
      throw new Error("a reviewed inbox draft already exists; reconcile it manually before generating another AI draft");
    }
    await ctx.db.patch(thread._id, {
      draftReply: normalizeText(args.draftReply, "reply draft", 4_000),
      draftRationale: normalizeOptionalText(args.rationale, "reply rationale", 2_000),
      draftReviewStatus: "draft",
      draftReviewedAt: undefined,
      draftReviewedBy: undefined,
      approvedDraftMessageId: undefined,
      status: "draft_ready",
      updatedAt: Date.now(),
    });
  },
});

/** Saves an operator revision of a draft; it never sends or queues a provider message. */
export const reviseInboxDraft = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), draftReply: v.string(), rationale: v.optional(v.string()), revisedBy: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    if (thread.status === "human_handoff" || thread.status === "closed") {
      throw new Error("a handed-off or closed thread cannot receive a revised draft");
    }
    if (thread.metaInstagramReplyActionId) {
      throw new Error("a governed Meta Instagram reply action already exists; reconcile it manually before changing this draft");
    }
    await ctx.db.patch(thread._id, {
      draftReply: normalizeText(args.draftReply, "reply draft", 4_000),
      draftRationale: normalizeOptionalText(args.rationale, "reply rationale", 2_000),
      draftReviewStatus: "draft",
      draftReviewedAt: undefined,
      draftReviewedBy: normalizeText(args.revisedBy, "draft revised by", 200),
      approvedDraftMessageId: undefined,
      status: "draft_ready",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Records a human approval of a reply draft. Approval is a local audit state
 * only: it does not call, queue, or authorize an external provider send.
 */
export const approveInboxDraft = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), approvedBy: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.status !== "draft_ready" || !thread.draftReply) {
      throw new Error("thread has no reviewable reply draft");
    }
    if (thread.metaInstagramReplyActionId) {
      throw new Error("a governed Meta Instagram reply action already exists; reconcile it manually before approving another draft");
    }
    if (thread.intent === "safety_review" || thread.safetyFlags.length > 0) {
      throw new Error("safety-flagged conversations require human handoff instead of draft approval");
    }
    if (thread.requiresDisclosure && !/\b(ai|automated|assistant)\b/i.test(thread.draftReply)) {
      throw new Error("the reply draft must include a plain AI-assistance disclosure before approval");
    }
    const now = Date.now();
    const approvedDraftMessageId = await ctx.db.insert("creatorInboxMessages", {
      organizationId: thread.organizationId,
      threadId: thread._id,
      direction: "outbound",
      source: "operator",
      status: "approved",
      body: thread.draftReply,
      automated: false,
      expiresAt: now + 30 * 24 * 60 * 60 * 1_000,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(thread._id, {
      draftReviewStatus: "approved",
      draftReviewedAt: now,
      draftReviewedBy: normalizeText(args.approvedBy, "draft approved by", 200),
      approvedDraftMessageId,
      updatedAt: now,
    });
  },
});

/** Records an operator handoff. The assignee must send any reply in the provider UI after normal review. */
export const handoffInboxThread = internalMutation({
  args: { threadId: v.id("creatorInboxThreads"), reason: v.string(), assignee: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("inbox thread not found");
    if (thread.status === "closed") throw new Error("a closed thread cannot be handed off");
    await ctx.db.patch(thread._id, {
      status: "human_handoff",
      handoffReason: normalizeText(args.reason, "handoff reason", 2_000),
      handoffAssignee: normalizeOptionalText(args.assignee, "handoff assignee", 200),
      updatedAt: Date.now(),
    });
  },
});

/**
 * One-way metadata import from the retired persona seed. It never reads or
 * copies tokenKey, tokenService, meta, legacy messages, engagement, posts, or
 * any dispatcher state. Imported accounts are explicitly unverified until a
 * new official provider connection is completed.
 */
export const importLegacyPersonas = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organization = await ensureDefaultOrganization(ctx);
    if (!organization) throw new Error("failed to bootstrap Media Engine organization");
    const legacyPersonas = await ctx.db.query("personas").take(MAX_ROWS);
    let importedProfiles = 0;
    let importedAccounts = 0;

    for (const legacyPersona of legacyPersonas) {
      const existing = await ctx.db
        .query("creatorProfiles")
        .withIndex("by_legacy_persona", (q) => q.eq("legacyPersonaId", legacyPersona._id))
        .unique();
      if (existing) continue;
      const historicalHandle = normalizeHandle(legacyPersona.handle);
      // Never create a second profile over a manually reconstructed creator.
      // The operator can explicitly link that profile to the historical record
      // later, after checking that the identity is the same.
      const sameHandle = await ctx.db
        .query("creatorProfiles")
        .withIndex("by_organization_handle", (q) => q.eq("organizationId", organization._id).eq("handle", historicalHandle))
        .unique();
      if (sameHandle) continue;

      const now = Date.now();
      const profileId = await ctx.db.insert("creatorProfiles", {
        organizationId: organization._id,
        legacyPersonaId: legacyPersona._id,
        name: normalizeText(legacyPersona.name, "legacy persona name", 200),
        handle: historicalHandle,
        archetype: legacyPersona.archetype,
        stage: mappedLegacyStage(legacyPersona.stage),
        timezone: "UTC",
        identity: {
          bio: normalizeOptionalText(legacyPersona.bio, "legacy bio", 500),
          identitySummary: normalizeOptionalText(legacyPersona.identitySummary, "legacy identity summary"),
          emotionalBackstory: undefined,
          voiceGuide: undefined,
          audience: normalizeOptionalText(legacyPersona.niche, "legacy niche", 1_000),
          contentPillars: legacyPersona.niche ? [legacyPersona.niche] : [],
          boundaries: ["Historical import only. Reconfirm identity, consent, disclosure, and public-content boundaries before activation."],
        },
        visualSystem: {
          promptLock: normalizeText(legacyPersona.globalLock, "legacy prompt lock"),
          loraTrigger: normalizeOptionalText(legacyPersona.loraTrigger, "legacy LoRA trigger", 200),
          promptStyle: undefined,
          referenceNotes: "Imported historical metadata only; no reference image, provider URL, or credential was copied.",
          version: 1,
        },
        primaryGoal: "audience_growth",
        inboxPolicy: "draft_only",
        status: "paused",
        createdAt: now,
        updatedAt: now,
      });
      importedProfiles += 1;

      const legacyAccounts = await ctx.db
        .query("accounts")
        .withIndex("by_persona", (q) => q.eq("personaId", legacyPersona._id))
        .take(MAX_ROWS);
      for (const legacyAccount of legacyAccounts) {
        // Select only safe, non-secret metadata. Do not copy tokenService,
        // tokenKey, meta, or the old account's capability claims.
        const platform = mappedLegacyPlatform(legacyAccount.platform);
        await ctx.db.insert("creatorSocialAccounts", {
          organizationId: organization._id,
          creatorId: profileId,
          integrationConnectionId: undefined,
          platform,
          handle: normalizeAccountHandle(legacyAccount.handle, platform),
          displayName: undefined,
          externalAccountId: undefined,
          ownershipStatus: "legacy_unverified",
          status: mappedLegacyAccountStatus(legacyAccount.status),
          capabilities: [],
          health: "unknown",
          postingPolicy: { mode: "approval_required", dailyPostLimit: 1, timezone: "UTC" },
          manualKycStatus: platform === "fanvue" ? "pending" : "not_applicable",
          lastCheckedAt: undefined,
          lastSyncedAt: undefined,
          notes: "Historical metadata import only. Re-attest ownership and reconnect using official OAuth before any review.",
          createdAt: now,
          updatedAt: now,
        });
        importedAccounts += 1;
      }
    }
    return { importedProfiles, importedAccounts };
  },
});
