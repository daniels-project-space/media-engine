import { defineTable } from "convex/server";
import { v } from "convex/values";

export const platform = v.union(
  v.literal("instagram"),
  v.literal("x"),
  v.literal("reddit"),
  v.literal("googleads"),
  v.literal("metaads"),
);
export const mode = v.union(
  v.literal("off"),
  v.literal("draft"),
  v.literal("automatic"),
);
export const goal = v.union(
  v.literal("signup"),
  v.literal("lead"),
  v.literal("purchase"),
);
export const metrics = v.object({
  impressions: v.number(),
  clicks: v.number(),
  spendMinor: v.number(),
  currency: v.string(),
  capturedAt: v.number(),
});

export const marketingTables = {
  marketingProjects: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    website: v.string(),
    offer: v.string(),
    audience: v.string(),
    facts: v.array(v.string()),
    goal,
    tone: v.string(),
    timezone: v.string(),
    cadence: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("paused"),
    ),
    version: v.number(),
    factsConfirmedAt: v.optional(v.number()),
    generationLimitMinor: v.number(),
    advertisingLimitMinor: v.number(),
    currency: v.string(),
    conversionTokenHash: v.string(),
    openItemCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    nextPlanAt: v.number(),
    planningError: v.optional(v.string()),
    defaultAssetId: v.optional(v.id("marketingAssets")),
  })
    .index("by_organization", ["organizationId"])
    .index("by_status_next_plan", ["status", "nextPlanAt"]),

  marketingProviderAccounts: defineTable({
    providerAccountId: v.string(),
    profileId: v.string(),
    platform,
    label: v.string(),
    connected: v.boolean(),
    syncedAt: v.number(),
  })
    .index("by_provider_id", ["providerAccountId"])
    .index("by_profile", ["profileId"])
    .index("by_synced", ["syncedAt"]),

  marketingChannels: defineTable({
    projectId: v.id("marketingProjects"),
    accountId: v.id("marketingProviderAccounts"),
    mode,
    subreddit: v.optional(v.string()),
    communityApproved: v.boolean(),
    adAccountId: v.optional(v.string()),
    pageId: v.optional(v.string()),
    authorisedUntil: v.optional(v.number()),
    policyVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_account", ["accountId"]),

  marketingAssets: defineTable({
    projectId: v.id("marketingProjects"),
    key: v.string(),
    sha256: v.string(),
    bytes: v.number(),
    contentType: v.string(),
    source: v.union(v.literal("upload"), v.literal("approved_render")),
    rightsConfirmed: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_key", ["key"]),

  marketingRenderImports: defineTable({
    projectId: v.id("marketingProjects"),
    renderJobId: v.id("renderJobs"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("verified"),
      v.literal("failed"),
    ),
    sourceKey: v.string(),
    sha256: v.string(),
    bytes: v.number(),
    destinationKey: v.string(),
    attempt: v.number(),
    workerRunId: v.optional(v.string()),
    assetId: v.optional(v.id("marketingAssets")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_created", ["projectId", "createdAt"])
    .index("by_project_job", ["projectId", "renderJobId"]),

  marketingItems: defineTable({
    projectId: v.id("marketingProjects"),
    channelId: v.id("marketingChannels"),
    kind: v.union(v.literal("post"), v.literal("ad")),
    title: v.string(),
    content: v.string(),
    assetId: v.optional(v.id("marketingAssets")),
    scheduledAt: v.number(),
    version: v.number(),
    // Frozen, server-validated ad template; never arbitrary provider calls.
    ad: v.optional(
      v.object({
        headline: v.string(),
        description: v.string(),
        keywords: v.array(v.string()),
        countries: v.array(v.string()),
        dailyBudgetMinor: v.number(),
        durationDays: v.number(),
        maxSpendMinor: v.number(),
      }),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("approved"),
      v.literal("dispatching"),
      v.literal("uncertain"),
      v.literal("scheduled"),
      v.literal("published"),
      v.literal("active"),
      v.literal("cancel_pending"),
      v.literal("cancelled"),
      v.literal("paused"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    approvalId: v.optional(v.id("approvalRequests")),
    actionId: v.optional(v.id("actionLedger")),
    approvedHash: v.optional(v.string()),
    idempotencyKey: v.string(),
    providerId: v.optional(v.string()),
    providerCampaignId: v.optional(v.string()),
    providerNativeAdId: v.optional(v.string()),
    providerCampaignKey: v.optional(v.string()),
    providerNativeAdKey: v.optional(v.string()),
    providerStatusReadAt: v.optional(v.number()),
    billingSettlement: v.optional(
      v.object({
        reference: v.string(),
        finalSpendMinor: v.number(),
        currency: v.string(),
        confirmedAt: v.number(),
      }),
    ),
    publicationUrl: v.optional(v.string()),
    heldIntegrationMinor: v.number(),
    heldAdvertisingMinor: v.number(),
    reservationMonth: v.optional(v.string()),
    workerRunId: v.optional(v.string()),
    dispatchedAt: v.optional(v.number()),
    terminalAt: v.optional(v.number()),
    nextCheckAt: v.number(),
    error: v.optional(v.string()),
    metrics: v.optional(metrics),
    reconciliationFailures: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project_created", ["projectId", "createdAt"])
    .index("by_project_status", ["projectId", "status"])
    .index("by_project_ad_held", ["projectId", "kind", "heldAdvertisingMinor"])
    .index("by_channel_scheduled", ["channelId", "scheduledAt"])
    .index("by_channel_status", ["channelId", "status"])
    .index("by_status_next_check", ["status", "nextCheckAt"])
    .index("by_provider_id", ["providerId"])
    .index("by_provider_campaign_key", ["providerCampaignKey"])
    .index("by_provider_native_ad_key", ["providerNativeAdKey"])
    .index("by_idempotency", ["idempotencyKey"]),

  marketingAllowances: defineTable({
    scope: v.string(),
    month: v.string(),
    currency: v.string(),
    limitMinor: v.number(),
    spentMinor: v.number(),
    heldMinor: v.number(),
    updatedAt: v.number(),
  }).index("by_scope_month", ["scope", "month"]),

  marketingConversions: defineTable({
    projectId: v.id("marketingProjects"),
    eventId: v.string(),
    event: goal,
    itemId: v.optional(v.id("marketingItems")),
    valueMinor: v.number(),
    currency: v.string(),
    occurredAt: v.number(),
    receivedAt: v.number(),
  })
    .index("by_project_event", ["projectId", "eventId"])
    .index("by_project_received", ["projectId", "receivedAt"]),

  marketingResults: defineTable({
    projectId: v.id("marketingProjects"),
    month: v.string(),
    conversions: v.number(),
    valueMinor: v.number(),
    currency: v.string(),
    updatedAt: v.number(),
  }).index("by_project_month", ["projectId", "month"]),

  marketingWebhookReceipts: defineTable({
    eventId: v.string(),
    bodyHash: v.string(),
    receivedAt: v.number(),
    itemId: v.optional(v.id("marketingItems")),
  }).index("by_event", ["eventId"]),

  marketingProviderInventory: defineTable({
    provider: v.literal("zernio"),
    accountCount: v.number(),
    baseMinor: v.number(),
    checkedAt: v.number(),
    pricingVerifiedAt: v.number(),
    periodSpendMinor: v.optional(v.number()),
    xSpendMinor: v.optional(v.number()),
    xSpendLimitMinor: v.optional(v.union(v.number(), v.null())),
    nextRefreshAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_provider", ["provider"]),
};
