/**
 * Presentation contracts for the Creator Promotion workspace.
 *
 * These types deliberately contain no credentials, access tokens, raw inbox
 * messages, raw provider receipts, or assertions that an external action occurred.
 * The route / gateway that supplies the data owns those concerns.
 */

export type CreatorTimestamp = number | string;

export type CreatorPlatform =
  | "instagram"
  | "tiktok"
  | "x"
  | "facebook"
  | "threads"
  | "pinterest"
  | "youtube"
  | "linkedin"
  | "bluesky"
  | "fanvue"
  | "fansly"
  | "email"
  | "other";

export type CreatorProfileStage = "draft" | "active" | "paused" | "archived";

export type CreatorAccountStatus = "unlinked" | "pending" | "connected" | "degraded" | "paused";

/** Operator-recorded ownership state; it is not a live provider assertion. */
export type CreatorAccountOwnershipStatus = "attested_owned" | "client_authorized" | "legacy_unverified";

/** Manual KYC state as recorded by an operator or trusted onboarding flow. */
export type CreatorManualKycStatus = "not_applicable" | "pending" | "verified" | "rejected";

/** Safe onboarding stage only. Free-form notes and OAuth material stay private. */
export type CreatorAccountOnboarding = {
  mode: "manual" | "fanvue_partner" | "oauth_connect";
  status: "not_started" | "partner_approval_required" | "kyc_required" | "oauth_required" | "ready" | "blocked";
};

/** Last recorded health metadata, not a new live network or provider probe. */
export type CreatorAccountHealth = "unknown" | "healthy" | "degraded" | "unhealthy";

export type CreatorContentFormat = "feed" | "reel" | "story" | "carousel";

export type CreatorContentStatus = "idea" | "planned" | "ready_for_review" | "approved" | "scheduled" | "published" | "blocked";

export type CreatorApprovalStatus = "not_requested" | "pending" | "approved" | "rejected" | "not_required";

/**
 * The safe, operator-visible lifecycle for one individually approved official
 * Meta Instagram publication. It is deliberately separate from the editorial
 * content approval and from the calendar timestamp.
 */
export type CreatorMetaInstagramPublishStatus =
  | "not_requested"
  | "pending_approval"
  | "approved"
  | "queued"
  | "running"
  | "published"
  | "failed"
  | "blocked";

/** A bounded provider receipt; it contains no URL, token, request body, or raw provider response. */
export type CreatorMetaInstagramPublishReceipt = {
  provider: "meta_instagram";
  containerId?: string;
  mediaId?: string;
};

/**
 * Safe projection of the durable Meta action and its individual approval. A
 * calendar item never becomes publishable merely by receiving a timestamp.
 */
export type CreatorMetaInstagramPublish = {
  status: CreatorMetaInstagramPublishStatus;
  approvalStatus?: Exclude<CreatorApprovalStatus, "not_required"> | "missing";
  requestedAt?: CreatorTimestamp;
  approvedAt?: CreatorTimestamp;
  queuedAt?: CreatorTimestamp;
  startedAt?: CreatorTimestamp;
  completedAt?: CreatorTimestamp;
  updatedAt?: CreatorTimestamp;
  receipt?: CreatorMetaInstagramPublishReceipt;
  /** Sanitized, URL-free failure text from the trusted worker. */
  failureReason?: string;
};

/**
 * A separately approved request for Postiz to create a future schedule. A
 * successful request is deliberately not called a social-network publication:
 * the downstream network can still reject or delay delivery.
 */
export type CreatorPostizScheduleStatus =
  | "not_requested"
  | "pending_approval"
  | "approved"
  | "queued"
  | "running"
  | "scheduled"
  | "failed"
  | "blocked";

/** Safe, URL-free acknowledgement of the Postiz schedule record. */
export type CreatorPostizScheduleReceipt = {
  provider: "postiz";
  scheduleId?: string;
};

/**
 * Explicit, per-schedule delivery policy sent through the governed Postiz
 * handoff. This is safe operator metadata only: no credential, content copy,
 * provider request body, or media location is exposed here.
 */
export type CreatorPostizSettings =
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
    contentPostingMethod: "DIRECT_POST";
    videoMadeWithAi: boolean;
  }
  | { __type: "youtube"; visibility: "public" | "unlisted" | "private"; madeForKids: "yes" | "no" }
  | { __type: "pinterest"; board: string }
  | { __type: "facebook" | "threads" | "linkedin" | "bluesky" };

/**
 * Public projection of the governed Postiz scheduling lifecycle. It contains
 * no Postiz credentials, content payload, caption, media URL, or raw provider
 * response.
 */
export type CreatorPostizSchedule = {
  status: CreatorPostizScheduleStatus;
  approvalStatus?: Exclude<CreatorApprovalStatus, "not_required"> | "missing";
  requestedAt?: CreatorTimestamp;
  approvedAt?: CreatorTimestamp;
  queuedAt?: CreatorTimestamp;
  startedAt?: CreatorTimestamp;
  completedAt?: CreatorTimestamp;
  updatedAt?: CreatorTimestamp;
  receipt?: CreatorPostizScheduleReceipt;
  /** Frozen explicit policy selections for this individual schedule request. */
  postizSettings?: CreatorPostizSettings;
  failureReason?: string;
};

/** A separately approved official reply; local draft approval alone is never a send authority. */
export type CreatorMetaInstagramReplyStatus =
  | "not_requested"
  | "pending_approval"
  | "approved"
  | "queued"
  | "running"
  | "sent"
  | "failed"
  | "blocked";

export type CreatorMetaInstagramReply = {
  status: CreatorMetaInstagramReplyStatus;
  approvalStatus?: Exclude<CreatorApprovalStatus, "not_required"> | "missing";
  requestedAt?: CreatorTimestamp;
  approvedAt?: CreatorTimestamp;
  queuedAt?: CreatorTimestamp;
  startedAt?: CreatorTimestamp;
  completedAt?: CreatorTimestamp;
  updatedAt?: CreatorTimestamp;
  /** Bounded receipt only—never a recipient ID, message text, token, or raw provider payload. */
  receipt?: { provider: "meta_instagram"; messageId?: string };
  failureReason?: string;
};

/** Safe proof projection; raw inbound identity and message body remain server-side. */
export type CreatorMetaInstagramReplyProof = {
  verifiedInbound: boolean;
  responseWindowOpen: boolean;
  verifiedInboundAt?: CreatorTimestamp;
  replyEligibilityEndsAt?: CreatorTimestamp;
};

export type CreatorDestinationStatus = "not_connected" | "connection_review" | "connected" | "unavailable";

export type CreatorAgeGateStatus = "not_configured" | "pending" | "confirmed" | "blocked";

export type CreatorComplianceStatus = "not_reviewed" | "review_required" | "approved" | "blocked";

export type CreatorInboxStatus = "new" | "draft_ready" | "handoff_required" | "closed";

export type CreatorIntent =
  | "brand_enquiry"
  | "collaboration"
  | "fanvue_interest"
  | "general_question"
  | "support"
  | "sensitive"
  | "unknown";

/** The business outcome an operator is qualifying; it is never a send instruction. */
export type CreatorInboxFunnelIntent =
  | "brand_partnership"
  | "subscription_interest"
  | "relationship_nurture"
  | "support_resolution"
  | "not_applicable"
  | "unknown";

/** Operator-visible qualification state for a permitted inbound conversation. */
export type CreatorInboxQualificationState =
  | "unqualified"
  | "needs_review"
  | "qualified"
  | "not_applicable"
  | "blocked";

/** Whether a required plain-language AI disclosure is present in the current local draft. */
export type CreatorInboxDisclosureState = "not_required" | "required_missing" | "draft_includes_disclosure" | "confirmed";

/** Safety state guides the operator to review or handoff; it never triggers an external action. */
export type CreatorInboxSafetyState = "clear" | "review_required" | "handoff_required";

/**
 * Secret-safe server projection for the draft-only inbox model. It contains
 * neither provider credentials nor raw model/CLI diagnostics.
 */
export type CreatorInboxDraftModelHealth = {
  status: "ready" | "paused" | "unavailable";
  canGenerate: boolean;
  model: string;
  authentication: "openai_api";
  missing: string[];
  notes: string[];
};

export type CreatorMedia = {
  url: string;
  alt?: string;
  kind?: "image" | "video";
};

/**
 * A real, operator-supplied visual reference. `imageUrl`, when present, is
 * expected to be a short-lived signed URL from the media service rather than a
 * public asset URL. This presentation contract intentionally does not expose
 * storage keys or any biometric/identity data.
 */
export type CreatorReferenceAsset = {
  id: string;
  creatorId: string;
  label: string;
  useType: CreatorReferenceUseType;
  rightsStatus: CreatorReferenceRightsStatus;
  sourceDescription: string;
  imageUrl?: string;
  createdAt: CreatorTimestamp;
};

export type CreatorReferenceUseType =
  | "identity_reference"
  | "style_direction"
  | "wardrobe"
  | "location"
  | "pose_composition"
  | "texture_palette"
  | "other";

export type CreatorReferenceRightsStatus =
  | "creator_owned"
  | "consent_verified"
  | "license_verified"
  | "review_required"
  | "rejected";

export type CreatorVisualSystem = {
  promptLock?: string;
  promptStyle?: string;
  loraTrigger?: string;
  referenceNotes?: string;
  version?: string;
};

/**
 * Presentation-only LoRA training state. These records deliberately describe
 * the host's persisted job state; pressing a UI control is never evidence that
 * a training provider accepted or began a run.
 */
/** The only native training target supported by this Creator Promotion surface. */
export type CreatorLoraTrainingTarget = "z-image-turbo";

/**
 * The only payload a presentation surface may request. The server remains
 * responsible for validating authorization, selected references, and provider
 * configuration before it creates a durable job.
 */
export type CreatorLoraTrainingRequest = {
  creatorId: string;
  target: CreatorLoraTrainingTarget;
  referenceAssetIds: string[];
  trainingParams: {
    triggerWord: string;
    trainingType: "content";
    steps: 1000;
    learningRate: 0.0001;
    defaultCaption: string;
  };
  operatorAttestation: {
    confirmed: true;
    statement: string;
  };
};

export type CreatorLoraTrainingStatus =
  | "draft"
  | "review_required"
  | "approved_for_training"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CreatorLoraConsentStatus = "not_confirmed" | "review_required" | "confirmed" | "blocked";

export type CreatorLoraDataReadiness = "not_ready" | "review_required" | "ready" | "blocked";

/**
 * Legacy LoRAs are never presumed usable by Z-Image Turbo. The upstream model
 * registry must explicitly mark an existing model native after verification.
 */
export type CreatorLoraCompatibility = "native" | "unverified_legacy" | "incompatible_legacy";

/** Metadata for an operator-visible evaluation preview. It does not expose raw training data. */
export type CreatorLoraPreviewMetadata = {
  label: string;
  imageUrl?: string;
  promptSummary?: string;
  width?: number;
  height?: number;
  createdAt?: CreatorTimestamp;
  reviewStatus?: "pending" | "approved" | "rejected";
};

/** A registered creator model, not an assertion that it is loaded by a renderer. */
export type CreatorLoraModel = {
  id: string;
  creatorId: string;
  label: string;
  target: CreatorLoraTrainingTarget;
  compatibility: CreatorLoraCompatibility;
  status: "training" | "validating" | "active" | "failed" | "archived";
  triggerToken?: string;
  baseModelLabel?: string;
  version?: string;
  trainingJobId?: string;
  preview?: CreatorLoraPreviewMetadata;
  createdAt?: CreatorTimestamp;
  reviewedAt?: CreatorTimestamp;
  notes?: string;
};

/** A durable record supplied by the authenticated training workflow. */
export type CreatorLoraTrainingJob = {
  id: string;
  creatorId: string;
  target: CreatorLoraTrainingTarget;
  status: CreatorLoraTrainingStatus;
  consentStatus: CreatorLoraConsentStatus;
  dataReadiness: CreatorLoraDataReadiness;
  modelId?: string;
  modelLabel?: string;
  providerLabel?: string;
  selectedReferenceAssetIds?: string[];
  referenceAssetCount?: number;
  eligibleReferenceAssetCount?: number;
  progressPercent?: number;
  completedSteps?: number;
  totalSteps?: number;
  requestedAt?: CreatorTimestamp;
  startedAt?: CreatorTimestamp;
  completedAt?: CreatorTimestamp;
  updatedAt: CreatorTimestamp;
  preview?: CreatorLoraPreviewMetadata;
  reviewNote?: string;
  failureReason?: string;
};

export type CreatorIdentity = {
  bio?: string;
  identitySummary?: string;
  emotionalBackstory?: string;
  voiceGuide?: string;
  audience?: string;
  contentPillars?: string[];
  boundaries?: string[];
};

/** Immutable, operator-visible Persona Bible state used only by future plans. */
export type CreatorPersonaRevision = {
  id: string;
  creatorId: string;
  revisionNumber: number;
  status: "active" | "superseded";
  source: "baseline" | "operator_edit" | "legacy_sync";
  identity: CreatorIdentity;
  visualSystem: CreatorVisualSystem;
  snapshotHash?: string;
  changeNote?: string;
  createdBy?: string;
  createdAt: CreatorTimestamp;
  activatedBy?: string;
  activatedAt?: CreatorTimestamp;
  supersededAt?: CreatorTimestamp;
};

/** Browser-safe request shape; the gateway owns immutable snapshot validation. */
export type CreatorPersonaRevisionRequest = {
  creatorId: string;
  changeNote?: string;
  identity: CreatorIdentity;
  visualSystem: CreatorVisualSystem;
};

export type CreatorPromotionPersona = {
  id: string;
  name: string;
  handle: string;
  archetype?: string;
  stage: CreatorProfileStage;
  lifecycleStage?: "setup" | "growth" | "brand_ready" | "monetized" | "paused";
  timezone?: string;
  avatarUrl?: string;
  identity?: CreatorIdentity;
  visualSystem?: CreatorVisualSystem;
  activePersonaRevisionId?: string;
  activePersonaRevisionNumber?: number;
  primaryGoal?: string;
  inboxPolicy?: "draft_only" | "human_handoff";
};

export type CreatorPublishingPolicy = {
  dailyCap?: number;
  approvalRequired?: boolean;
  quietHours?: string;
  /** Optional weekly editorial target used by the calendar's cadence checks. */
  weeklyTarget?: number;
  /** Maximum number of consecutive calendar days without a scheduled post. */
  maxGapDays?: number;
  /** Optional per-format weekly targets used by the calendar's mix checks. */
  formatTargets?: Partial<Record<CreatorContentFormat, number>>;
};

/**
 * Controlled calendar state emitted by the operating schedule. Dates are
 * calendar dates in `timezone`, not a provider-publishing assertion.
 */
export type CreatorCalendarState = {
  weekStartsOn: Date;
  timezone: string;
  selectedDay?: Date;
  selectedContentId?: string;
};

export type CreatorSocialAccount = {
  id: string;
  creatorId: string;
  platform: CreatorPlatform;
  handle: string;
  label?: string;
  status: CreatorAccountStatus;
  /** Safe linkage metadata only; OAuth material remains server-side. */
  integrationConnectionId?: string;
  ownershipStatus?: CreatorAccountOwnershipStatus;
  onboarding?: CreatorAccountOnboarding;
  manualKycStatus?: CreatorManualKycStatus;
  health?: CreatorAccountHealth;
  connectionHealth?: CreatorAccountHealth;
  lastCheckedAt?: CreatorTimestamp;
  /** The executor bound to this account, not a claim that it is already live. */
  publisher?: "meta" | "fanvue" | "postiz" | "manual";
  capabilities?: string[];
  policy?: CreatorPublishingPolicy;
  lastSyncedAt?: CreatorTimestamp;
  nextScheduledAt?: CreatorTimestamp;
  notes?: string;
};

export type CreatorContentItem = {
  id: string;
  creatorId: string;
  accountId?: string;
  /** A frozen governed route, when this plan is funnel-bound. */
  funnelId?: string;
  title: string;
  format: CreatorContentFormat;
  status: CreatorContentStatus;
  approvalStatus?: CreatorApprovalStatus;
  funnelStage?: string;
  scheduledAt?: CreatorTimestamp;
  publishedAt?: CreatorTimestamp;
  hook?: string;
  caption?: string;
  cta?: string;
  whyNow?: string;
  promptSnapshot?: string;
  renderProvider?: "novita" | "ltx" | "fal_z_image_turbo_lora" | "unassigned";
  renderState?: "unrequested" | "planned" | "queued" | "blocked" | "rendering" | "review" | "ready" | "failed";
  /** The reviewed candidate selected for this post; selection is never publication. */
  selectedRenderCandidateId?: string;
  selectedRenderAt?: CreatorTimestamp;
  previewMedia?: CreatorMedia[];
  /** Optional because legacy and unrequested content has no Meta action yet. */
  metaInstagramPublish?: CreatorMetaInstagramPublish;
  /** Optional because content is not scheduled through Postiz by default. */
  postizSchedule?: CreatorPostizSchedule;
};

/**
 * A durable, approved creator render job. A queued item is not evidence that
 * Novita or LTX accepted, rendered, or billed a job.
 */
export type CreatorRenderJobStatus = "queued" | "blocked" | "running" | "candidates_ready" | "selected" | "failed" | "cancelled";

export type CreatorRenderJob = {
  id: string;
  creatorId: string;
  contentId: string;
  provider: "novita" | "ltx" | "fal_z_image_turbo_lora" | "unassigned";
  status: CreatorRenderJobStatus;
  attemptNumber: number;
  maxAttempts: number;
  scheduledAt?: CreatorTimestamp;
  createdAt: CreatorTimestamp;
  updatedAt: CreatorTimestamp;
  failureReason?: string;
  referenceCount?: number;
  selectedCandidateId?: string;
  requestHash?: string;
};

/** A provider result copied into controlled storage and awaiting operator review. */
export type CreatorRenderCandidate = {
  id: string;
  jobId: string;
  creatorId: string;
  contentId: string;
  attemptNumber: number;
  provider: "novita" | "ltx" | "fal_z_image_turbo_lora";
  mediaType: "image" | "video";
  status: "pending" | "selected" | "rejected";
  previewUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  rejectionReason?: string;
  createdAt: CreatorTimestamp;
  updatedAt: CreatorTimestamp;
};

/** A verified observation copied from an authorised provider analytics surface. */
export type CreatorAttributionSnapshot = {
  id: string;
  creatorId: string;
  accountId?: string;
  contentId?: string;
  destinationId?: string;
  source: "instagram" | "fanvue" | "postiz" | "manual";
  metrics: {
    impressions?: number;
    reach?: number;
    linkClicks?: number;
    followers?: number;
    subscribers?: number;
    grossRevenueMinor?: number;
    currency?: string;
  };
  capturedAt: CreatorTimestamp;
};

/**
 * Fanvue is the only subscription destination represented by this surface.
 * It is provider-ready metadata, never an assertion that Fanvue is connected.
 */
export type FanvueDestination = {
  id: string;
  creatorId: string;
  provider: "fanvue";
  label: string;
  url?: string;
  connectionStatus: CreatorDestinationStatus;
  ageGateStatus: CreatorAgeGateStatus;
  complianceStatus: CreatorComplianceStatus;
  approvalStatus: CreatorApprovalStatus;
  disclosure?: string;
  lastReviewedAt?: CreatorTimestamp;
  notes?: string;
};

/** A public-safe destination for a brand inquiry, portfolio, link hub, or website. */
export type CreatorPartnerDestination = {
  id: string;
  creatorId: string;
  kind: "brand_inquiry" | "link_in_bio" | "website" | "other";
  label: string;
  url?: string;
  connectionStatus: CreatorDestinationStatus;
  complianceStatus: CreatorComplianceStatus;
  approvalStatus: CreatorApprovalStatus;
  disclosure?: string;
  lastReviewedAt?: CreatorTimestamp;
  notes?: string;
};

/**
 * A safe, URL-free projection of a destination that can be used by the
 * governed funnel surface. It deliberately carries no provider credentials,
 * tracking link, or customer data.
 */
export type CreatorFunnelDestination = {
  id: string;
  creatorId: string;
  label: string;
  kind?: "brand_inquiry" | "link_in_bio" | "website" | "fanvue" | "fansly" | "other";
  provider?: "fanvue";
  connectionStatus: CreatorDestinationStatus;
  complianceStatus: CreatorComplianceStatus;
  approvalStatus: CreatorApprovalStatus;
  ageGateStatus?: CreatorAgeGateStatus;
  disclosure?: string;
};

export type CreatorFunnelStage = "awareness" | "trust" | "consideration" | "conversion" | "retention";

export type CreatorFunnelObjective =
  | "brand_partnerships"
  | "subscription_conversion"
  | "website_conversion"
  | "lead_capture"
  | "other";

export type CreatorFunnelStatus = "draft" | "review_required" | "approved" | "active" | "paused" | "archived";

export type CreatorFunnelApprovalStatus = "pending" | "approved" | "rejected" | "missing";

export type CreatorFunnelStagePlan = {
  stage: CreatorFunnelStage;
  label: string;
  purpose: string;
  ctaText: string;
};

/** Safe compliance projection; raw evidence and attestation copy never reach this UI contract. */
export type CreatorFunnelCompliance = {
  disclosureRequired: boolean;
  disclosureText?: string;
  ageGateRequired: boolean;
  ageGateEvidenceRecorded: boolean;
  operatorAttestation: {
    attestedBy: string;
    confirmed: true;
    attestedAt: CreatorTimestamp;
  };
};

/** URL-free link naming policy. The public destination itself is never created or dispatched here. */
export type CreatorFunnelLinkPolicy = {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContentPrefix?: string;
  destinationHost: string;
  destinationUrlHash: string;
};

/**
 * A governed creator funnel campaign. Lifecycle changes are requested through
 * parent callbacks; this presentation contract cannot dispatch any provider
 * action, create a redirect, publish, message, or process a payment.
 */
export type CreatorFunnelCampaign = {
  id: string;
  creatorId: string;
  destinationId: string;
  approvalId?: string;
  approvalStatus?: CreatorFunnelApprovalStatus;
  campaignLabel: string;
  objective: CreatorFunnelObjective;
  status: CreatorFunnelStatus;
  version: number;
  stages: CreatorFunnelStagePlan[];
  compliance: CreatorFunnelCompliance;
  linkPolicy: CreatorFunnelLinkPolicy;
  reviewRequestedAt?: CreatorTimestamp;
  approvedAt?: CreatorTimestamp;
  activatedAt?: CreatorTimestamp;
  pausedAt?: CreatorTimestamp;
  pauseReason?: string;
  createdAt: CreatorTimestamp;
  updatedAt: CreatorTimestamp;
};

export type CreatorFunnelEventType =
  | "link_click"
  | "lead"
  | "brand_inquiry"
  | "signup"
  | "subscription"
  | "revenue_observed"
  | "other";

/**
 * A manual, aggregate-only observation. There is no visitor, message, link,
 * provider token, or payment record in this model.
 */
export type CreatorFunnelEvent = {
  id: string;
  creatorId: string;
  funnelId: string;
  funnelVersion: number;
  funnelSnapshotHash: string;
  destinationId: string;
  contentId?: string;
  source: "manual";
  eventType: CreatorFunnelEventType;
  count: number;
  revenueMinor?: number;
  currency?: string;
  occurredAt: CreatorTimestamp;
  recordedBy: string;
  createdAt: CreatorTimestamp;
};

export type CreatorInboxThread = {
  id: string;
  creatorId: string;
  accountId?: string;
  destinationId?: string;
  platform?: CreatorPlatform;
  participantLabel?: string;
  intent: CreatorIntent;
  funnelIntent?: CreatorInboxFunnelIntent;
  qualificationState?: CreatorInboxQualificationState;
  status: CreatorInboxStatus;
  receivedAt?: CreatorTimestamp;
  responseDueAt?: CreatorTimestamp;
  summary?: string;
  assistantDraft?: string;
  draftRationale?: string;
  draftReviewStatus?: "draft" | "approved" | "rejected";
  draftReviewedAt?: CreatorTimestamp;
  draftReviewedBy?: string;
  /** True only when the intake requires a disclosure in a proposed reply. */
  requiresDisclosure?: boolean;
  disclosureState?: CreatorInboxDisclosureState;
  /** Historical display field kept for older workspace payloads. */
  disclosureShown?: boolean;
  safetyState?: CreatorInboxSafetyState;
  safetyFlags?: string[];
  handoffReason?: string;
  handoffAssignee?: string;
  /** Present only as a safe status projection of signed Meta inbound evidence. */
  metaInstagramReplyProof?: CreatorMetaInstagramReplyProof;
  /** Separate from local draft review and populated only from the audited action ledger. */
  metaInstagramReply?: CreatorMetaInstagramReply;
};
