import { z } from "zod";

/**
 * Provider-agnostic contracts for the creator-promotion control plane.
 *
 * These schemas intentionally describe only accounts that a creator or agency
 * is authorized to operate. They do not model account sign-up, password
 * handling, browser automation, proxying, or engagement manipulation.
 * Every externally-visible action is individually approved and is later
 * dispatched by a server-only worker.
 */

export const CREATOR_PROMOTION_PROVIDERS = [
  "meta_instagram",
  "fanvue",
  "postiz",
] as const;

export const CreatorPromotionProviderSchema = z.enum(CREATOR_PROMOTION_PROVIDERS);
export type CreatorPromotionProvider = z.infer<typeof CreatorPromotionProviderSchema>;

const IdentifierSchema = z.string().trim().min(1).max(160);
const ActorIdentifierSchema = z.string().trim().min(1).max(160);
const IsoDateTimeSchema = z.string().datetime({ offset: true });
const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hex digest");
const UuidSchema = z.string().uuid();

export const AccountCapabilitySchema = z.enum([
  "read_profile",
  "read_insights",
  "read_inbox",
  "publish_feed",
  "publish_reel",
  "publish_story",
  "publish_carousel",
  "schedule_content",
  "reply_to_inbound_message",
  "publish_subscription_post",
  "send_subscription_chat_reply",
  "manage_tracking_links",
]);
export type AccountCapability = z.infer<typeof AccountCapabilitySchema>;

export const AccountConnectionStatusSchema = z.enum([
  "pending_oauth",
  "connected",
  "degraded",
  "paused",
  "revoked",
]);
export type AccountConnectionStatus = z.infer<typeof AccountConnectionStatusSchema>;

export const CredentialHealthSchema = z.enum([
  "not_available",
  "valid",
  "expiring_soon",
  "expired",
  "revoked",
]);

/**
 * Metadata-only record for an account connected through an official OAuth or
 * managed-connection flow. Credentials never belong in this object.
 */
export const ProviderAccountCapabilityGrantSchema = z
  .object({
    accountId: IdentifierSchema,
    organizationId: IdentifierSchema,
    creatorProfileId: IdentifierSchema,
    provider: CreatorPromotionProviderSchema,
    externalAccountId: IdentifierSchema,
    handle: z.string().trim().min(1).max(128).optional(),
    connectionStatus: AccountConnectionStatusSchema,
    credentialHealth: CredentialHealthSchema,
    credentialStore: z.literal("server_vault"),
    grantedCapabilities: z.array(AccountCapabilitySchema).min(1).max(16),
    /** Individual approval is intentionally the only execution mode. */
    approvalMode: z.literal("individual_action"),
    scopes: z.array(z.string().trim().min(1).max(128)).max(32),
    linkedAt: IsoDateTimeSchema,
    lastVerifiedAt: IsoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.grantedCapabilities).size !== value.grantedCapabilities.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["grantedCapabilities"],
        message: "Capabilities must not be duplicated",
      });
    }
  });
export type ProviderAccountCapabilityGrant = z.infer<typeof ProviderAccountCapabilityGrantSchema>;

export const ApprovalEvidenceSchema = z
  .object({
    approvalId: IdentifierSchema,
    status: z.literal("approved"),
    approvedBy: ActorIdentifierSchema,
    approvedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    /** Digest of the immutable action payload displayed to the approver. */
    contentDigest: Sha256DigestSchema,
    policyVersion: z.string().trim().min(1).max(80),
  })
  .strict();
export type ApprovalEvidence = z.infer<typeof ApprovalEvidenceSchema>;

const ActionEnvelopeSchema = z
  .object({
    actionId: IdentifierSchema,
    idempotencyKey: z.string().trim().min(16).max(200),
    organizationId: IdentifierSchema,
    creatorProfileId: IdentifierSchema,
    accountId: IdentifierSchema,
    requestedBy: ActorIdentifierSchema,
    requestedAt: IsoDateTimeSchema,
    /** Scheduler-created actions still require an individual human approval. */
    requestedFrom: z.enum(["operator", "scheduler"]),
    executionMode: z.literal("approval_required"),
    requiresIndividualApproval: z.literal(true),
    correlationId: IdentifierSchema,
    contentDigest: Sha256DigestSchema,
    approval: ApprovalEvidenceSchema,
  })
  .strict();

const InstagramFormatSchema = z.enum(["feed", "reel", "story", "carousel"]);

const InstagramPublishPayloadSchema = z
  .object({
    format: InstagramFormatSchema,
    caption: z.string().max(2_200).optional(),
    mediaUrls: z.array(z.string().url()).min(1).max(10),
    /** Meta requires publishing media to be reachable by its servers. */
    mediaIsPubliclyReachable: z.literal(true),
    isAiGenerated: z.boolean(),
    scheduledAt: IsoDateTimeSchema.optional(),
  })
  .strict();

const InstagramReplyPayloadSchema = z
  .object({
    /** Prevents outbound cold-message automation. */
    respondsToInboundMessage: z.literal(true),
    inboundMessageId: IdentifierSchema,
    inboundReceivedAt: IsoDateTimeSchema,
    responseWindowEndsAt: IsoDateTimeSchema,
    text: z.string().trim().min(1).max(1_000),
    automationDisclosureIncluded: z.literal(true),
    humanHandoffAvailable: z.literal(true),
  })
  .strict();

const FanvuePostPayloadSchema = z
  .object({
    creatorUserUuid: UuidSchema,
    text: z.string().trim().min(1).max(5_000).optional(),
    mediaUuids: z.array(UuidSchema).max(50).default([]),
    mediaPreviewUuid: UuidSchema.optional(),
    /** Fanvue documents a minimum paid-post price of 300 cents. */
    priceCents: z.number().int().min(300).optional(),
    audience: z.enum(["subscribers", "followers-and-subscribers"]),
    publishAt: IsoDateTimeSchema.optional(),
    expiresAt: IsoDateTimeSchema.optional(),
    collectionUuids: z.array(UuidSchema).max(20).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.text && value.mediaUuids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mediaUuids"],
        message: "A Fanvue post needs text or at least one media item",
      });
    }
    if (value.priceCents && value.mediaUuids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priceCents"],
        message: "A paid Fanvue post must include media",
      });
    }
  });

const FanvueChatReplyPayloadSchema = z
  .object({
    creatorUserUuid: UuidSchema,
    recipientUserUuid: UuidSchema,
    /** Prevents a chat action from being used for a cold or mass DM. */
    respondsToInboundConversation: z.literal(true),
    inboundMessageUuid: UuidSchema,
    inboundReceivedAt: IsoDateTimeSchema,
    text: z.string().trim().min(1).max(5_000).optional(),
    mediaUuids: z.array(UuidSchema).max(10).default([]),
    mediaPreviewUuid: UuidSchema.optional(),
    priceCents: z.number().int().min(300).optional(),
    templateUuid: UuidSchema.optional(),
    automationDisclosureIncluded: z.literal(true),
    humanHandoffAvailable: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.text && value.mediaUuids.length === 0 && !value.templateUuid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A Fanvue chat reply needs text, media, or a template",
      });
    }
    if (value.priceCents && value.mediaUuids.length === 0 && !value.templateUuid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["priceCents"],
        message: "A priced chat reply must include media or a template",
      });
    }
  });

const FanvueTrackingLinkPayloadSchema = z
  .object({
    creatorUserUuid: UuidSchema,
    name: z.string().trim().min(1).max(120),
    externalSocialPlatform: z.enum([
      "facebook",
      "instagram",
      "other",
      "reddit",
      "snapchat",
      "tiktok",
      "twitter",
      "youtube",
    ]),
  })
  .strict();

const PostizSchedulePayloadSchema = z
  .object({
    integrationId: IdentifierSchema,
    platform: z.enum([
      "instagram",
      "facebook",
      "tiktok",
      "x",
      "linkedin",
      "youtube",
      "threads",
      "pinterest",
      "reddit",
      "bluesky",
      "mastodon",
    ]),
    caption: z.string().trim().min(1).max(5_000),
    mediaUrls: z.array(z.string().url()).max(10).default([]),
    /** Postiz is deliberately limited to future scheduling, never "post now". */
    scheduledAt: IsoDateTimeSchema,
  })
  .strict();

export const InstagramPublishActionSchema = ActionEnvelopeSchema.extend({
  provider: z.literal("meta_instagram"),
  type: z.literal("instagram.publish"),
  payload: InstagramPublishPayloadSchema,
}).strict();

export const InstagramReplyActionSchema = ActionEnvelopeSchema.extend({
  provider: z.literal("meta_instagram"),
  type: z.literal("instagram.reply_to_inbound"),
  payload: InstagramReplyPayloadSchema,
}).strict();

export const FanvuePostActionSchema = ActionEnvelopeSchema.extend({
  provider: z.literal("fanvue"),
  type: z.literal("fanvue.create_post"),
  payload: FanvuePostPayloadSchema,
}).strict();

export const FanvueChatReplyActionSchema = ActionEnvelopeSchema.extend({
  provider: z.literal("fanvue"),
  type: z.literal("fanvue.reply_to_inbound"),
  payload: FanvueChatReplyPayloadSchema,
}).strict();

export const FanvueTrackingLinkActionSchema = ActionEnvelopeSchema.extend({
  provider: z.literal("fanvue"),
  type: z.literal("fanvue.create_tracking_link"),
  payload: FanvueTrackingLinkPayloadSchema,
}).strict();

export const PostizScheduleActionSchema = ActionEnvelopeSchema.extend({
  provider: z.literal("postiz"),
  type: z.literal("postiz.schedule_post"),
  payload: PostizSchedulePayloadSchema,
}).strict();

/**
 * The only side-effecting action shapes a future dispatcher may accept.
 * Account creation, bulk engagement, cold DMs, and any unapproved operations
 * are intentionally not represented here.
 */
export const CreatorPromotionActionSchema = z.discriminatedUnion("type", [
  InstagramPublishActionSchema,
  InstagramReplyActionSchema,
  FanvuePostActionSchema,
  FanvueChatReplyActionSchema,
  FanvueTrackingLinkActionSchema,
  PostizScheduleActionSchema,
]);
export type CreatorPromotionAction = z.infer<typeof CreatorPromotionActionSchema>;

declare const verifiedApprovedAction: unique symbol;
export type VerifiedApprovedCreatorPromotionAction = CreatorPromotionAction & {
  readonly [verifiedApprovedAction]: true;
};

export type ApprovalVerificationResult =
  | { ok: true; action: VerifiedApprovedCreatorPromotionAction }
  | { ok: false; errors: string[] };

/**
 * Verifies that a parsed action has a non-expired individual approval matching
 * the exact payload hash. A successful result is branded so dispatch adapters
 * can refuse arbitrary action objects at compile time.
 */
export function verifyApprovedCreatorPromotionAction(
  input: unknown,
  now = new Date(),
): ApprovalVerificationResult {
  const parsed = CreatorPromotionActionSchema.safeParse(input);
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
    if (expiresAt <= now) errors.push("Approval has expired");
  }
  if (action.approval.contentDigest !== action.contentDigest) {
    errors.push("Approved content digest does not match the action payload");
  }

  const scheduledAt = scheduledAtForAction(action);
  if (scheduledAt && scheduledAt <= now) {
    errors.push("Scheduled actions must be scheduled in the future");
  }
  if (scheduledAt && expiresAt.getTime() > 0 && scheduledAt > expiresAt) {
    errors.push("Approval expires before the scheduled action can run");
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    action: Object.freeze({ ...action }) as VerifiedApprovedCreatorPromotionAction,
  };
}

export function requiredCapabilitiesForAction(
  action: CreatorPromotionAction,
): readonly AccountCapability[] {
  switch (action.type) {
    case "instagram.publish":
      return [
        action.payload.format === "feed"
          ? "publish_feed"
          : action.payload.format === "reel"
            ? "publish_reel"
            : action.payload.format === "story"
              ? "publish_story"
              : "publish_carousel",
        ...(action.payload.scheduledAt ? (["schedule_content"] as const) : []),
      ];
    case "instagram.reply_to_inbound":
      return ["read_inbox", "reply_to_inbound_message"];
    case "fanvue.create_post":
      return [
        "publish_subscription_post",
        ...(action.payload.publishAt ? (["schedule_content"] as const) : []),
      ];
    case "fanvue.reply_to_inbound":
      return ["read_inbox", "send_subscription_chat_reply"];
    case "fanvue.create_tracking_link":
      return ["manage_tracking_links"];
    case "postiz.schedule_post":
      return ["schedule_content"];
  }
}

export type AccountActionAuthorizationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Checks the connection record before the dispatcher sees a provider action.
 * It does not inspect, fetch, or expose credentials.
 */
export function authorizeActionForAccount(
  action: CreatorPromotionAction,
  account: ProviderAccountCapabilityGrant,
): AccountActionAuthorizationResult {
  const errors: string[] = [];
  if (action.accountId !== account.accountId) errors.push("Action account does not match grant");
  if (action.provider !== account.provider) errors.push("Action provider does not match grant");
  if (account.connectionStatus !== "connected") errors.push("Account is not connected");
  if (account.credentialHealth !== "valid") errors.push("Account credential is not healthy");
  if (account.approvalMode !== "individual_action") errors.push("Account does not require individual approval");

  for (const capability of requiredCapabilitiesForAction(action)) {
    if (!account.grantedCapabilities.includes(capability)) {
      errors.push(`Account lacks required capability: ${capability}`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function scheduledAtForAction(action: CreatorPromotionAction): Date | null {
  switch (action.type) {
    case "instagram.publish":
      return action.payload.scheduledAt ? new Date(action.payload.scheduledAt) : null;
    case "fanvue.create_post":
      return action.payload.publishAt ? new Date(action.payload.publishAt) : null;
    case "postiz.schedule_post":
      return new Date(action.payload.scheduledAt);
    default:
      return null;
  }
}
