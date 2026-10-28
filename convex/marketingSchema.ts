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
    researchVersion: v.optional(v.number()),
    factsConfirmedAt: v.optional(v.number()),
    generationLimitMinor: v.number(),
    advertisingLimitMinor: v.number(),
    currency: v.string(),
    conversionTokenHash: v.string(),
    onboardingKey: v.optional(v.string()),
    onboardingHash: v.optional(v.string()),
    openItemCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    nextPlanAt: v.number(),
    planningError: v.optional(v.string()),
    defaultAssetId: v.optional(v.id("marketingAssets")),
    zernioProfileId: v.optional(v.string()),
    stats: v.optional(
      v.object({
        published: v.number(),
        impressions: v.number(),
        clicks: v.number(),
        advertisingMinor: v.number(),
        conversions: v.number(),
        valueMinor: v.number(),
        metricsAt: v.optional(v.number()),
        since: v.number(),
      }),
    ),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_onboarding", ["organizationId", "onboardingKey"])
    .index("by_status_next_plan", ["status", "nextPlanAt"]),

  // Immutable revisions keep a project brief change from silently rewriting
  // an owner's planning work. These are planning documents, not publish jobs.
  marketingPlans: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("marketingProjects"),
    projectVersion: v.number(),
    researchVersion: v.optional(v.number()),
    revision: v.number(),
    strategy: v.string(),
    calendar: v.string(),
    sources: v.string(),
    origin: v.union(v.literal("owner"), v.literal("ai")),
    createdAt: v.number(),
  }).index("by_project_revision", ["projectId", "revision"]),

  // A brief is a reviewed planning artifact, not a GPU job or authorization.
  marketingRenderBriefs: defineTable({
    organizationId: v.id("organizations"), projectId: v.id("marketingProjects"),
    planId: v.id("marketingPlans"), entryIndex: v.number(), projectVersion: v.number(),
    researchVersion: v.number(), modelId: v.union(v.literal("minimax-h3"), v.literal("qwen-image-2-1")),
    prompt: v.string(), script: v.optional(v.string()), channel: v.string(), format: v.string(), createdAt: v.number(),
    renderJobId: v.optional(v.string()),
    renderState: v.optional(v.union(v.literal("tracked"), v.literal("importing"), v.literal("ready"), v.literal("failed"))),
    renderProviderState: v.optional(v.string()),
    renderError: v.optional(v.string()),
    renderAssetId: v.optional(v.id("marketingAssets")),
    renderRequest: v.optional(v.object({
      state: v.literal("staged"),
      requestHash: v.string(),
      requestKey: v.string(),
      requestGuideHash: v.string(),
      modelId: v.union(v.literal("minimax-h3"), v.literal("qwen-image-2-1")),
      outputContentType: v.union(v.literal("video/mp4"), v.literal("image/png")),
      environmentId: v.optional(v.string()),
      quality: v.union(
        v.object({
          kind: v.literal("video"), steps: v.number(), width: v.number(), height: v.number(), frames: v.number(), fps: v.number(),
          durationSeconds: v.number(), precision: v.string(), approximateCache: v.boolean(),
          postprocess: v.object({ latentScale: v.number(), videoRestoration: v.string(), finalWidth: v.number(), finalHeight: v.number(), required: v.boolean() }),
        }),
        v.object({
          kind: v.literal("image"), precision: v.string(), steps: v.number(), cfg: v.number(), outputResolution: v.number(),
          useKvCache: v.boolean(), cpuOffload: v.boolean(), defaultSeed: v.number(),
        }),
      ),
      settings: v.union(v.object({}), v.object({ width: v.number(), height: v.number() })),
      blockers: v.array(v.union(
        v.literal("native-model-unqualified"),
        v.literal("project-connection-missing"),
        v.literal("project-connection-unavailable"),
        v.literal("environment-required"),
        v.literal("environment-model-mismatch"),
        v.literal("environment-not-prepared"),
        v.literal("requested-format-not-supported"),
        v.literal("capacity-unverified"),
        v.literal("spend-control-unverified"),
        v.literal("output-delivery-unverified"),
        v.literal("dispatch-disabled"),
      )),
      checkedAt: v.number(),
      authorization: v.optional(v.object({
        requestHash: v.string(), authorizedAt: v.number(), generationLimitMinor: v.number(), currency: v.string(),
        source: v.literal("owner-action"),
      })),
    })),
  }).index("by_project_created", ["projectId", "createdAt"])
    .index("by_plan_entry_model", ["planId", "entryIndex", "modelId"]),

  marketingPlanRuns: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.id("marketingProjects"),
    requestKey: v.string(),
    projectVersion: v.number(),
    researchVersion: v.optional(v.number()),
    baseRevision: v.number(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_project_request", ["projectId", "requestKey"])
    .index("by_project_created", ["projectId", "createdAt"]),

  // One bounded diagnostic record per project; old workers are fenced by key.
  marketingAiChecks: defineTable({
    projectId: v.id("marketingProjects"), requestKey: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed")),
    outcome: v.optional(v.union(v.literal("subscription-login"), v.literal("unavailable"))),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  marketingHyperImports: defineTable({
    projectId: v.id("marketingProjects"), jobId: v.string(),
    briefId: v.optional(v.id("marketingRenderBriefs")), modelId: v.optional(v.string()), providerState: v.optional(v.string()),
    status: v.union(v.literal("tracked"), v.literal("queued"), v.literal("running"), v.literal("verified"), v.literal("failed")),
    attempt: v.number(), workerRunId: v.optional(v.string()),
    assetId: v.optional(v.id("marketingAssets")), error: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_project_job", ["projectId", "jobId"]).index("by_project_created", ["projectId", "createdAt"]),

  marketingResearch: defineTable({
    projectId: v.id("marketingProjects"), url: v.string(), title: v.string(),
    description: v.string(), excerpt: v.string(), kind: v.union(v.literal("project"), v.literal("reference")),
    origin: v.optional(v.union(v.literal("project"), v.literal("manual"), v.literal("discovered"))),
    contentHash: v.string(), capturedAt: v.number(),
  }).index("by_project_url", ["projectId", "url"]).index("by_project", ["projectId"]),

  marketingResearchDiscoveries: defineTable({
    projectId: v.id("marketingProjects"), requestKey: v.string(), projectVersion: v.number(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    captured: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_project_request", ["projectId", "requestKey"]).index("by_project_created", ["projectId", "createdAt"]),

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
    organizationId: v.optional(v.id("organizations")),
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
    .index("by_key", ["key"])
    .index("by_organization_created", ["organizationId", "createdAt"]),

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
    organizationId: v.optional(v.id("organizations")),
    projectId: v.id("marketingProjects"),
    planId: v.optional(v.id("marketingPlans")),
    planEntryIndex: v.optional(v.number()),
    channelId: v.optional(v.id("marketingChannels")),
    intendedPlatform: v.optional(v.union(v.literal("instagram"), v.literal("x"), v.literal("reddit"))),
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
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_organization_created", ["organizationId", "createdAt"]),

  marketingCosts: defineTable({
    organizationId: v.id("organizations"),
    projectId: v.optional(v.id("marketingProjects")),
    label: v.string(),
    category: v.union(
      v.literal("subscription"),
      v.literal("generation"),
      v.literal("hosting"),
    ),
    amountMinor: v.number(),
    currency: v.string(),
    occurredAt: v.number(),
    reference: v.string(),
    createdAt: v.number(),
    voidedAt: v.optional(v.number()),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_project", ["projectId"])
    .index("by_organization_reference", ["organizationId", "reference"]),
  marketingCostTotals: defineTable({
    organizationId: v.id("organizations"),
    currency: v.string(),
    subscription: v.number(),
    generation: v.number(),
    hosting: v.number(),
    updatedAt: v.number(),
  }).index("by_organization_currency", ["organizationId", "currency"]),

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
