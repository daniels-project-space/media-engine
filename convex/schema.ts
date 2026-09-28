import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const streamKind = v.union(
  v.literal("persona_growth"),
  v.literal("product_ads"),
  v.literal("shorts"),
  v.literal("email"),
);

export const postStatus = v.union(
  v.literal("planned"),
  v.literal("generating"),
  v.literal("ready"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("published"),
  v.literal("failed"),
);

const projectShot = v.object({
  id: v.optional(v.string()),
  kind: v.optional(v.string()), // "card" for a deterministic end-card
  beat: v.optional(v.string()),
  imagePrompt: v.optional(v.string()),
  imageUrl: v.optional(v.string()), // client-provided or approved reference image
  imageKey: v.optional(v.string()), // R2 key of an approved reference frame
  motion: v.string(),
  audioCue: v.optional(v.string()),
  seconds: v.number(),
  onText: v.optional(v.string()),
  cardTitle: v.optional(v.string()),
  cardSub: v.optional(v.string()),
});

const projectNarrative = v.object({
  audience: v.string(),
  objective: v.string(),
  corePromise: v.string(),
  insight: v.string(),
  arc: v.array(v.object({ beat: v.string(), purpose: v.string() })),
  voiceover: v.optional(v.string()),
  cta: v.string(),
});

const projectRenderPlan = v.object({
  provider: v.literal("higgsfield"),
  model: v.literal("seedance_2_0"),
  creditSource: v.literal("higgsfield_subscription"),
  aspectRatio: v.union(v.literal("9:16"), v.literal("16:9"), v.literal("1:1")),
  durationSeconds: v.number(),
  audioStrategy: v.string(),
  referencePolicy: v.string(),
  fallbackPolicy: v.literal("fail_closed"),
  providerInstructions: v.array(v.string()),
});

// Creator Promotion funnels are governed campaign metadata, not public
// landing pages or redirectors. They deliberately retain only destination
// identity and a stable URL fingerprint: raw URLs, signed links, click IDs,
// tracking tokens, and provider credentials never belong in this surface.
const creatorFunnelStage = v.union(
  v.literal("awareness"),
  v.literal("trust"),
  v.literal("consideration"),
  v.literal("conversion"),
  v.literal("retention"),
);

const creatorFunnelStagePlan = v.object({
  stage: creatorFunnelStage,
  label: v.string(),
  purpose: v.string(),
  ctaText: v.string(),
});

const creatorFunnelCompliance = v.object({
  disclosureRequired: v.boolean(),
  disclosureText: v.optional(v.string()),
  ageGateRequired: v.boolean(),
  ageGateEvidenceReference: v.optional(v.string()),
  operatorAttestation: v.object({
    attestedBy: v.string(),
    statement: v.string(),
    confirmed: v.literal(true),
    attestedAt: v.number(),
  }),
});

const creatorFunnelLinkPolicy = v.object({
  // The CTA is explicit and frozen by stage; no runtime text-to-link
  // generation is allowed by this planning model.
  utmSource: v.string(),
  utmMedium: v.string(),
  utmCampaign: v.string(),
  utmContentPrefix: v.optional(v.string()),
  destinationHost: v.string(),
  destinationUrlHash: v.string(),
});

const creatorFunnelContentSnapshot = v.object({
  funnelId: v.id("creatorFunnelCampaigns"),
  version: v.number(),
  campaignLabel: v.string(),
  objective: v.union(
    v.literal("brand_partnerships"),
    v.literal("subscription_conversion"),
    v.literal("website_conversion"),
    v.literal("lead_capture"),
    v.literal("other"),
  ),
  destinationId: v.id("creatorDestinations"),
  destinationKind: v.union(
    v.literal("brand_inquiry"),
    v.literal("link_in_bio"),
    v.literal("website"),
    v.literal("fanvue"),
    v.literal("fansly"),
    v.literal("other"),
  ),
  stage: creatorFunnelStage,
  stageLabel: v.string(),
  stagePurpose: v.string(),
  ctaText: v.string(),
  linkPolicy: creatorFunnelLinkPolicy,
  compliance: creatorFunnelCompliance,
  snapshotHash: v.string(),
});

export default defineSchema({
  streams: defineTable({
    slug: v.string(),
    name: v.string(),
    kind: streamKind,
    goal: v.string(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("draft")),
    autonomy: v.union(v.literal("auto"), v.literal("approve")),
    config: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  personas: defineTable({
    name: v.string(),
    handle: v.string(),
    archetype: v.union(v.literal("flagship"), v.literal("lifestyle"), v.literal("creator"), v.literal("faceless")),
    globalLock: v.string(),
    bio: v.optional(v.string()),
    identitySummary: v.optional(v.string()),
    loraUrl: v.optional(v.string()),
    loraTrigger: v.optional(v.string()),
    stage: v.union(v.literal("grow"), v.literal("brand_ready"), v.literal("monetized")),
    niche: v.optional(v.string()),
    streamSlug: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    createdAt: v.number(),
  }).index("by_handle", ["handle"]),

  accounts: defineTable({
    platform: v.union(
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube"),
      v.literal("fanvue"),
      v.literal("pinterest"),
      v.literal("email"),
    ),
    handle: v.string(),
    personaId: v.optional(v.id("personas")),
    status: v.union(
      v.literal("unlinked"),
      v.literal("warming"),
      v.literal("active"),
      v.literal("banned"),
    ),
    // Only the dedicated Media Engine account-token bucket is valid. This
    // field is later used by a Trigger vault lookup.
    tokenService: v.optional(v.literal("media-engine-accounts")),
    tokenKey: v.optional(v.string()),
    meta: v.optional(v.any()),
    notes: v.optional(v.string()),
  }).index("by_persona", ["personaId"]),

  emailContacts: defineTable({
    email: v.string(),
    source: v.string(),
    personaHandle: v.optional(v.string()),
    tags: v.array(v.string()),
    status: v.union(v.literal("subscribed"), v.literal("unsubscribed")),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  posts: defineTable({
    streamSlug: v.string(),
    personaId: v.optional(v.id("personas")),
    platform: v.string(),
    kind: v.union(
      v.literal("carousel"),
      v.literal("reel"),
      v.literal("short"),
      v.literal("image"),
      v.literal("story"),
      v.literal("email"),
    ),
    status: postStatus,
    title: v.optional(v.string()),
    hook: v.optional(v.string()),
    caption: v.optional(v.string()),
    // Present only for private client-render outputs. The completion mutation
    // verifies this binding before a paid render can advance a project.
    renderJobId: v.optional(v.id("renderJobs")),
    slides: v.optional(
      v.array(
        v.object({
          r2Key: v.optional(v.string()),
          url: v.optional(v.string()),
          prompt: v.string(),
          role: v.optional(v.string()),
        }),
      ),
    ),
    scheduledAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    externalId: v.optional(v.string()),
    error: v.optional(v.string()),
    // Variant tagging — the data spine for the performance feedback loop.
    // variantTag is machine-sortable: concept__hookId__variantId__v{n}
    variantTag: v.optional(v.string()),
    concept: v.optional(v.string()),
    hookId: v.optional(v.string()),
    variantId: v.optional(v.string()),
    // Best-of-N quality: the winning candidate's vision-QC score (0-100).
    qcScore: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_stream", ["streamSlug"])
    .index("by_concept", ["concept"]),

  promptTemplates: defineTable({
    name: v.string(),
    category: v.union(
      v.literal("global_lock"),
      v.literal("base_model"),
      v.literal("environment"),
      v.literal("niche_slide"),
      v.literal("cta_slide"),
      v.literal("motion"),
      v.literal("storyboard"),
      v.literal("realism_suffix"),
      v.literal("caption"),
    ),
    body: v.string(),
    niche: v.optional(v.string()),
    source: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_category", ["category"]),

  // Fiverr / direct AI-ad client orders — the fulfilment control room. Fiverr has
  // no seller API, so orders are logged here (manually or via forwarded email) and
  // fulfilled with the ad pipeline; replies are AI-drafted for the seller to send.
  clientOrders: defineTable({
    buyer: v.string(),
    source: v.string(), // "fiverr" | "direct" | ...
    // New control-plane ownership. Existing orders intentionally remain valid
    // without it; new governed work is attached to an organization.
    organizationId: v.optional(v.id("organizations")),
    tier: v.union(v.literal("basic"), v.literal("standard"), v.literal("premium")),
    brief: v.string(),
    productImageKey: v.optional(v.string()), // R2 key of the client's product image
    status: v.union(
      v.literal("new"),
      v.literal("in_progress"),
      v.literal("ready_for_delivery"),
      v.literal("delivered"),
      v.literal("revision"),
      v.literal("complete"),
      v.literal("cancelled"),
    ),
    pricePence: v.optional(v.number()), // what the buyer paid
    costPence: v.optional(v.number()), // our model spend so far
    deliveryPostId: v.optional(v.id("posts")), // the generated ad
    dueAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  // Ad Studio projects — the staged pipeline: script → cheap 480p draft → approval →
  // 4K final. Shots are approved once and reused across draft and final so the 4K cut
  // is faithful to what was signed off cheaply.
  adProjects: defineTable({
    buyer: v.string(),
    title: v.string(),
    brief: v.string(),
    // Additive ownership link for the governed control plane. This is optional
    // so historical projects require no migration or destructive rewrite.
    organizationId: v.optional(v.id("organizations")),
    orderId: v.optional(v.id("clientOrders")),
    source: v.optional(v.union(v.literal("fiverr"), v.literal("direct"))),
    stage: v.union(
      v.literal("scripting"),
      v.literal("script_ready"),
      v.literal("drafting"),
      v.literal("draft_ready"),
      v.literal("rendering"),
      v.literal("final_ready"),
      v.literal("failed"),
    ),
    // The canonical, reviewable creative plan. Every final render uses the
    // version that was approved before dispatch; it never regenerates a vague
    // brief directly into a paid job.
    intakeStatus: v.optional(
      v.union(v.literal("collecting"), v.literal("needs_reply"), v.literal("ready_to_plan"), v.literal("complete")),
    ),
    intakeSummary: v.optional(v.string()),
    missingFields: v.optional(v.array(v.string())),
    narrative: v.optional(projectNarrative),
    shots: v.optional(v.array(projectShot)),
    // A snapshot is taken only at explicit approval. Legacy Studio mutations
    // may still edit `shots` while being retired, but can never alter a queued
    // or running paid render.
    approvedShots: v.optional(v.array(projectShot)),
    storyboardVersion: v.optional(v.number()),
    renderPlan: v.optional(projectRenderPlan),
    approvedPlanVersion: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    hook: v.optional(v.string()),
    caption: v.optional(v.string()),
    musicPrompt: v.optional(v.string()),
    draftPostId: v.optional(v.id("posts")),
    finalPostId: v.optional(v.id("posts")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_stage", ["stage"]).index("by_order", ["orderId"]),

  // Persisted marketplace/direct-client dialogue. On Fiverr these are drafts
  // for a human to send manually; the application never auto-messages buyers.
  projectMessages: defineTable({
    projectId: v.id("adProjects"),
    role: v.union(v.literal("buyer"), v.literal("operator"), v.literal("assistant"), v.literal("system")),
    body: v.string(),
    status: v.union(v.literal("received"), v.literal("draft"), v.literal("approved"), v.literal("sent")),
    createdAt: v.number(),
  })
    .index("by_project_created", ["projectId", "createdAt"])
    .index("by_project_status", ["projectId", "status"]),

  // A durable render ledger makes paid work idempotent and joins a Trigger run
  // to its approved plan, output post and client delivery status.
  renderJobs: defineTable({
    projectId: v.id("adProjects"),
    // A governed render is linked to both its immutable approval snapshot and
    // the durable action ledger row that admits its paid side effect.
    approvalId: v.optional(v.id("approvalRequests")),
    actionId: v.optional(v.id("actionLedger")),
    planVersion: v.number(),
    kind: v.union(v.literal("draft"), v.literal("final")),
    idempotencyKey: v.string(),
    provider: v.literal("higgsfield"),
    model: v.literal("seedance_2_0"),
    creditSource: v.literal("higgsfield_subscription"),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("cancelled")),
    // One 32-byte server-generated dispatch capability is consumed by the
    // Trigger worker before it may read the approved plan or create media.
    dispatchToken: v.optional(v.string()),
    triggerRunId: v.optional(v.string()),
    workerRunId: v.optional(v.string()),
    postId: v.optional(v.id("posts")),
    creditsUsed: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_status", ["status"]),

  // Productized services — one record per service, drives its public landing page.
  services: defineTable({
    slug: v.string(),
    active: v.boolean(),
    order: v.number(),
    name: v.string(),
    tagline: v.string(),
    seoTitle: v.string(),
    seoDescription: v.string(),
    heroHeadline: v.string(),
    heroSubhead: v.string(),
    heroClipKey: v.optional(v.string()), // R2 key of the autoplay hero clip
    proofPoints: v.array(v.string()), // "500+ clips", "4K", "48h turnaround"
    howItWorks: v.array(v.object({ title: v.string(), body: v.string() })),
    gallery: v.array(
      v.object({
        clipKey: v.optional(v.string()),
        imageKey: v.optional(v.string()),
        label: v.string(),
        beforeKey: v.optional(v.string()), // before/after pair = strongest format
      }),
    ),
    valueProps: v.array(v.object({ header: v.string(), body: v.string() })),
    pricingTiers: v.array(
      v.object({
        name: v.string(),
        price: v.string(),
        unit: v.optional(v.string()),
        popular: v.optional(v.boolean()),
        features: v.array(v.string()),
      }),
    ),
    faq: v.array(v.object({ q: v.string(), a: v.string() })),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  // Inbound leads — the sales funnel. Full-auto on our surfaces; on marketplaces the
  // draftReply is surfaced for a human send-click (auto-messaging buyers = ban).
  leads: defineTable({
    service: v.optional(v.string()), // service slug
    name: v.string(),
    email: v.string(),
    brandLink: v.optional(v.string()),
    budget: v.optional(v.string()),
    timeline: v.optional(v.string()),
    message: v.optional(v.string()),
    source: v.string(), // "landing" | "fiverr" | "upwork" | "cold" | ...
    stage: v.union(
      v.literal("new"),
      v.literal("qualifying"),
      v.literal("sample"),
      v.literal("quoted"),
      v.literal("won"),
      v.literal("lost"),
    ),
    draftReply: v.optional(v.string()),
    sampleKey: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_stage", ["stage"]),

  settings: defineTable({
    key: v.string(),
    value: v.any(),
  }).index("by_key", ["key"]),

  spend: defineTable({
    day: v.string(),
    service: v.string(),
    model: v.optional(v.string()),
    costPence: v.number(),
    ref: v.optional(v.string()),
    ts: v.number(),
  }).index("by_day", ["day"]),

  // ─────────────────────────────────────────────────────────────────────────
  // AD-AGENCY SPINE (added 2026-07-11) — orchestration, funnels, intel, registry.
  // Everything below is reasoning/infra: no asset is rendered by these tables.
  // ─────────────────────────────────────────────────────────────────────────

  // A campaign = one product/app being marketed. The core object Jarvis creates
  // from a natural-language brief. `plan` holds the generated strategy JSON.
  campaigns: defineTable({
    name: v.string(),
    brief: v.string(), // the raw natural-language ask
    productUrl: v.optional(v.string()),
    productName: v.optional(v.string()),
    category: v.union(
      v.literal("app_launch"),
      v.literal("ecommerce"),
      v.literal("fiverr_service"),
      v.literal("personal_brand"),
      v.literal("saas"),
      v.literal("content"),
      v.literal("other"),
    ),
    mode: v.union(v.literal("free"), v.literal("paid")),
    budgetPence: v.number(), // hard cap for paid channels; 0 in free mode
    spentPence: v.number(),
    autonomy: v.union(v.literal("manual"), v.literal("assist"), v.literal("auto")),
    status: v.union(
      v.literal("draft"),
      v.literal("researching"),
      v.literal("planned"),
      v.literal("awaiting_approval"),
      v.literal("live"),
      v.literal("paused"),
      v.literal("done"),
      v.literal("failed"),
    ),
    objective: v.optional(v.string()), // installs | signups | sales | awareness
    plan: v.optional(v.any()), // CampaignPlan JSON from the strategist
    profile: v.optional(v.any()), // ProductProfile JSON from understand()
    personaId: v.optional(v.id("personas")),
    storeId: v.optional(v.id("stores")), // targeted commerce store (product-aware)
    clientId: v.optional(v.id("clients")), // the account this campaign is for
    streamSlug: v.optional(v.string()),
    funnelSlug: v.optional(v.string()),
    discountCode: v.optional(v.string()),
    referenceImageKeys: v.optional(v.array(v.string())), // R2 keys pulled from the product URL
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status"]),

  // The action DAG for a campaign — one row per concrete step the engine will run.
  campaignSteps: defineTable({
    campaignId: v.id("campaigns"),
    order: v.number(),
    kind: v.union(
      v.literal("research"),
      v.literal("understand"),
      v.literal("strategy"),
      v.literal("build_funnel"),
      v.literal("create_discount"),
      v.literal("schedule_posts"),
      v.literal("cold_email"),
      v.literal("influencer_brief"),
      v.literal("community_post"),
      v.literal("analytics_check"),
      v.literal("adjust"),
    ),
    channel: v.optional(v.string()), // instagram | x | facebook | reddit | email | ...
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("blocked"), // needs a missing key or human approval
    ),
    paid: v.boolean(), // true = counts against paid budget
    estCostPence: v.optional(v.number()),
    costPence: v.optional(v.number()),
    scheduledAt: v.optional(v.number()),
    payload: v.optional(v.any()),
    result: v.optional(v.any()),
    dryRun: v.optional(v.boolean()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_status", ["status"]),

  // DB-driven landing pages / funnels. `/f/[slug]` renders straight from a row —
  // no page is generated as an asset; the agent writes structured copy + refs.
  funnels: defineTable({
    slug: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    productName: v.string(),
    headline: v.string(),
    subhead: v.optional(v.string()),
    valueProps: v.array(v.object({ header: v.string(), body: v.string() })),
    ctaText: v.string(),
    ctaUrl: v.string(),
    discountCode: v.optional(v.string()),
    discountBlurb: v.optional(v.string()),
    heroImageKey: v.optional(v.string()), // R2 key (pulled reference still, not rendered)
    referenceImageKeys: v.optional(v.array(v.string())),
    sections: v.optional(v.any()), // extra structured blocks (faq, proof, etc.)
    theme: v.optional(v.string()),
    captureEmail: v.optional(v.boolean()),
    published: v.boolean(),
    views: v.number(),
    conversions: v.number(),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_campaign", ["campaignId"]),

  // Discount / coupon codes — provider-backed (Stripe promotion_codes) or manual.
  discountCodes: defineTable({
    code: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    provider: v.union(v.literal("stripe"), v.literal("shopify"), v.literal("manual")),
    kind: v.union(v.literal("percent"), v.literal("amount")),
    percentOff: v.optional(v.number()),
    amountOffPence: v.optional(v.number()),
    currency: v.optional(v.string()),
    externalId: v.optional(v.string()), // provider id
    maxRedemptions: v.optional(v.number()),
    redemptions: v.number(),
    expiresAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("expired"), v.literal("disabled")),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_campaign", ["campaignId"]),

  // Influencer CRM — sourced targets and outreach state per campaign.
  influencers: defineTable({
    handle: v.string(),
    platform: v.string(),
    niche: v.optional(v.string()),
    followers: v.optional(v.number()),
    engagementRate: v.optional(v.number()),
    email: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    contactStatus: v.union(
      v.literal("sourced"),
      v.literal("contacted"),
      v.literal("negotiating"),
      v.literal("agreed"),
      v.literal("delivered"),
      v.literal("declined"),
    ),
    briefKey: v.optional(v.string()), // R2 key of the brief/asset pack handed over
    rateNote: v.optional(v.string()),
    source: v.optional(v.string()),
    meta: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_niche", ["niche"])
    .index("by_campaign", ["campaignId"])
    .index("by_status", ["contactStatus"]),

  // Model / LoRA registry — view + add trained looks; personas reference these.
  models: defineTable({
    name: v.string(),
    kind: v.union(v.literal("lora"), v.literal("checkpoint"), v.literal("base")),
    provider: v.union(
      v.literal("fal"),
      v.literal("higgsfield"),
      v.literal("replicate"),
      v.literal("local"),
      v.literal("other"),
    ),
    url: v.optional(v.string()),
    trigger: v.optional(v.string()), // trigger word
    baseModel: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    previewKeys: v.optional(v.array(v.string())), // R2 keys of existing sample stills
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived"), v.literal("training")),
    createdAt: v.number(),
  })
    .index("by_kind", ["kind"])
    .index("by_persona", ["personaId"]),

  // Marketing playbooks — the reusable "how to market X, what to say, what works".
  playbooks: defineTable({
    slug: v.string(),
    category: v.union(
      v.literal("cold_email"),
      v.literal("fiverr_niche"),
      v.literal("branding"),
      v.literal("ig_influencer_funnel"),
      v.literal("app_launch"),
      v.literal("community"),
      v.literal("seo"),
    ),
    title: v.string(),
    channel: v.optional(v.string()),
    description: v.string(),
    structure: v.any(), // funnel stages / cadence / sequence
    templates: v.array(v.object({ label: v.string(), body: v.string() })),
    bestPractices: v.array(v.string()),
    kpis: v.array(v.string()),
    defaultBudgetSplit: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_category", ["category"]),

  // Market/SEO intel gathered per campaign.
  intelReports: defineTable({
    campaignId: v.optional(v.id("campaigns")),
    kind: v.union(
      v.literal("seo"),
      v.literal("competitor"),
      v.literal("positioning"),
      v.literal("trend"),
      v.literal("audience"),
    ),
    query: v.optional(v.string()),
    data: v.any(),
    source: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_campaign", ["campaignId"]),

  // Real engagement snapshots — replaces the deterministic fake like counts.
  engagement: defineTable({
    postId: v.optional(v.id("posts")),
    campaignId: v.optional(v.id("campaigns")),
    platform: v.string(),
    externalId: v.optional(v.string()),
    impressions: v.optional(v.number()),
    reach: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    saves: v.optional(v.number()),
    clicks: v.optional(v.number()),
    followersDelta: v.optional(v.number()),
    raw: v.optional(v.any()),
    ts: v.number(),
  })
    .index("by_post", ["postId"])
    .index("by_campaign", ["campaignId"])
    .index("by_platform", ["platform"]),

  // ─────────────────────────────────────────────────────────────────────────
  // COMMERCE + ASSET-REUSE GRAPH (added 2026-07-11) — product-aware planning,
  // asset lineage, cross-marketing. Infra/reasoning only, no rendering.
  // ─────────────────────────────────────────────────────────────────────────

  // A connected commerce store (Shopify). Products sync into `products`.
  stores: defineTable({
    platform: v.union(v.literal("shopify"), v.literal("woocommerce"), v.literal("manual")),
    domain: v.string(), // e.g. snuffloe.myshopify.com
    name: v.optional(v.string()),
    clientId: v.optional(v.id("clients")),
    tokenService: v.optional(v.string()), // vault service holding the admin token
    tokenKey: v.optional(v.string()),
    currency: v.optional(v.string()),
    meta: v.optional(v.any()),
    lastSyncedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_domain", ["domain"]),

  // A product pulled from a store. `channelPlan` is the product-aware suggestion
  // (which channels/formats fit this product) computed at sync time.
  products: defineTable({
    storeId: v.id("stores"),
    externalId: v.string(),
    title: v.string(),
    handle: v.optional(v.string()),
    productType: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    pricePence: v.optional(v.number()),
    currency: v.optional(v.string()),
    imageUrls: v.optional(v.array(v.string())),
    imageKeys: v.optional(v.array(v.string())), // mirrored to R2
    collections: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    channelPlan: v.optional(v.any()), // { channels:[], formats:[], angle, aovBand }
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_store", ["storeId"])
    .index("by_handle", ["handle"]),

  // Canonical asset registry — every marketing image/video the engine knows
  // about, so it can be reused, handed to influencers, or repurposed. The node
  // in the reuse graph; edges live in `assetDerivations`, placements in `placements`.
  assets: defineTable({
    r2Key: v.optional(v.string()),
    url: v.optional(v.string()),
    kind: v.union(v.literal("image"), v.literal("video"), v.literal("clip"), v.literal("logo"), v.literal("screenshot")),
    source: v.union(v.literal("generated"), v.literal("pulled"), v.literal("uploaded"), v.literal("derived")),
    sourcePostId: v.optional(v.id("posts")),
    campaignId: v.optional(v.id("campaigns")),
    personaId: v.optional(v.id("personas")),
    productId: v.optional(v.id("products")),
    modelId: v.optional(v.id("models")),
    tags: v.optional(v.array(v.string())),
    // Rights so we know what we may reuse where.
    rights: v.optional(v.union(v.literal("owned"), v.literal("licensed"), v.literal("creator"), v.literal("stock"))),
    license: v.optional(v.any()), // { scope, platforms:[], expiresAt }
    aspect: v.optional(v.string()), // "1:1" | "9:16" | "16:9" | ...
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_persona", ["personaId"])
    .index("by_kind", ["kind"]),

  // DERIVED_FROM edges — one asset repurposed into another (reframe, recaption,
  // cameo insert, remix). Supports the "reuse a marketing image with a cameo and
  // upload to TikTok" flow: original → derived variant → placement.
  assetDerivations: defineTable({
    parentAssetId: v.id("assets"),
    childAssetId: v.id("assets"),
    op: v.union(
      v.literal("reframe"),
      v.literal("recaption"),
      v.literal("cameo_insert"),
      v.literal("repurpose"),
      v.literal("remix"),
      v.literal("crop"),
    ),
    params: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_parent", ["parentAssetId"])
    .index("by_child", ["childAssetId"]),

  // Where an asset was (or will be) posted — 1 asset → many placements across
  // platforms/brands, each with its own tracking + discount code.
  placements: defineTable({
    assetId: v.id("assets"),
    campaignId: v.optional(v.id("campaigns")),
    platform: v.string(), // tiktok | instagram | youtube | x | ...
    channel: v.optional(v.string()),
    persona: v.optional(v.string()),
    influencerId: v.optional(v.id("influencers")),
    trackingCode: v.optional(v.string()),
    discountCode: v.optional(v.string()),
    status: v.union(
      v.literal("planned"),
      v.literal("handed_off"),
      v.literal("scheduled"),
      v.literal("posted"),
      v.literal("failed"),
    ),
    externalId: v.optional(v.string()),
    postId: v.optional(v.id("posts")),
    scheduledAt: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    result: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_asset", ["assetId"])
    .index("by_campaign", ["campaignId"])
    .index("by_status", ["status"]),

  // Cross-marketing agreements across the portfolio (bundles, shoutout swaps,
  // referrals, shared retargeting, UGC syndication).
  crossPromotions: defineTable({
    kind: v.union(
      v.literal("bundle"),
      v.literal("shoutout_swap"),
      v.literal("referral"),
      v.literal("retarget"),
      v.literal("syndication"),
    ),
    campaignIds: v.optional(v.array(v.id("campaigns"))),
    productIds: v.optional(v.array(v.id("products"))),
    personaIds: v.optional(v.array(v.id("personas"))),
    terms: v.optional(v.any()),
    sharedAudienceKey: v.optional(v.string()),
    referralCode: v.optional(v.string()),
    rationale: v.optional(v.string()),
    status: v.union(v.literal("proposed"), v.literal("active"), v.literal("done"), v.literal("declined")),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  // ─────────────────────────────────────────────────────────────────────────
  // AGENCY SPINE (added 2026-07-11) — clients/accounts. An account = a brand the
  // agency runs; every campaign/store/persona hangs off it, and its brandKit is
  // the ground truth all content is planned against. (Distinct from clientOrders,
  // which is Fiverr order fulfilment.)
  // ─────────────────────────────────────────────────────────────────────────
  clients: defineTable({
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal("prospect"), v.literal("active"), v.literal("paused"), v.literal("churned")),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    goals: v.optional(v.string()),
    // brandKit = { oneLiner, voice, tone, audience, valueProps[], differentiators[],
    //   competitors[], keywords[], colors[], dos[], donts[] } — from onboarding.
    brandKit: v.optional(v.any()),
    referenceImageKeys: v.optional(v.array(v.string())),
    retainerPence: v.optional(v.number()), // monthly retainer, if any
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),

  // ─────────────────────────────────────────────────────────────────────────
  // GOVERNED CONTROL PLANE — the private coordination substrate for the
  // portfolio. These records are additive: they do not revive the retired
  // campaign plane and never store provider credentials or OAuth material.
  // ─────────────────────────────────────────────────────────────────────────

  organizations: defineTable({
    slug: v.string(),
    name: v.string(),
    kind: v.union(
      v.literal("agency"),
      v.literal("portfolio"),
      v.literal("client"),
      v.literal("partner"),
    ),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  // Connection metadata only. Tokens, refresh credentials, webhooks secrets,
  // and provider API keys live in the server vault boundary, never in Convex.
  integrationConnections: defineTable({
    organizationId: v.id("organizations"),
    provider: v.string(),
    externalAccountId: v.optional(v.string()),
    displayName: v.optional(v.string()),
    status: v.union(
      v.literal("disconnected"),
      v.literal("pending"),
      v.literal("connected"),
      v.literal("degraded"),
      v.literal("revoked"),
    ),
    health: v.union(v.literal("unknown"), v.literal("healthy"), v.literal("degraded"), v.literal("unhealthy")),
    capabilities: v.array(v.string()),
    scopes: v.array(v.string()),
    lastCheckedAt: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    failureMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_provider", ["organizationId", "provider"])
    .index("by_provider_external", ["provider", "externalAccountId"])
    .index("by_status", ["status"]),

  // Idempotent receipt ledger for signed server-to-server integrations. It
  // stores delivery metadata and a body digest, not raw secrets or files.
  eventReceipts: defineTable({
    organizationId: v.id("organizations"),
    source: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payloadHash: v.string(),
    status: v.union(
      v.literal("received"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("processed"),
    ),
    occurredAt: v.optional(v.number()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
  })
    .index("by_source_event", ["source", "eventId"])
    .index("by_organization_received", ["organizationId", "receivedAt"])
    .index("by_received", ["receivedAt"])
    .index("by_status_received", ["status", "receivedAt"]),

  // FORM / SEVEN's signed outbox records a safe brief here after signature and
  // replay checks. The source app keeps raw uploads; this record contains only
  // the information needed for operator qualification and downstream work.
  formSevenIntakes: defineTable({
    organizationId: v.id("organizations"),
    eventReceiptId: v.id("eventReceipts"),
    externalIntakeId: v.string(),
    eventType: v.union(
      v.literal("form_seven.free_video_brief.created"),
      v.literal("form_seven.service_inquiry.created"),
    ),
    status: v.union(
      v.literal("received"),
      v.literal("qualifying"),
      v.literal("qualified"),
      v.literal("rejected"),
      v.literal("converted"),
      v.literal("archived"),
    ),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    businessName: v.optional(v.string()),
    businessType: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    selectedService: v.optional(v.string()),
    briefDescription: v.optional(v.string()),
    referenceCount: v.number(),
    marketingOptIn: v.boolean(),
    receivedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event_receipt", ["eventReceiptId"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_received", ["organizationId", "receivedAt"])
    .index("by_received", ["receivedAt"])
    .index("by_external_intake", ["organizationId", "externalIntakeId"]),

  // Artifact declarations arrive without a storage key. Only a reviewed,
  // server-side copy may receive an approved private `products/client/` key.
  intakeArtifacts: defineTable({
    intakeId: v.id("formSevenIntakes"),
    kind: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("document"),
      v.literal("pdf"),
      v.literal("website"),
      v.literal("other"),
    ),
    status: v.union(
      v.literal("declared"),
      v.literal("pending_review"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("revoked"),
    ),
    sourceLabel: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    sourceDigest: v.optional(v.string()),
    contentType: v.optional(v.string()),
    byteSize: v.optional(v.number()),
    approvedObjectKey: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_intake", ["intakeId"])
    .index("by_intake_status", ["intakeId", "status"]),

  // Immutable approval snapshots make consequential work explainable and
  // revocable. The caller must create a new record for a new plan version.
  approvalRequests: defineTable({
    organizationId: v.id("organizations"),
    resourceType: v.string(),
    resourceId: v.string(),
    planVersion: v.optional(v.number()),
    actionKind: v.string(),
    snapshotHash: v.string(),
    snapshot: v.any(),
    riskClass: v.union(v.literal("low"), v.literal("moderate"), v.literal("high"), v.literal("financial")),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("expired"),
      v.literal("cancelled"),
    ),
    requestedAt: v.number(),
    requestedBy: v.string(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.string()),
    denialReason: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_resource", ["resourceType", "resourceId", "planVersion"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_status", ["status"]),

  // Every external side effect gets a durable, idempotent action row before it
  // is dispatched. Provider receipts are sanitized metadata, never credentials.
  actionLedger: defineTable({
    organizationId: v.id("organizations"),
    connectionId: v.optional(v.id("integrationConnections")),
    approvalId: v.optional(v.id("approvalRequests")),
    renderJobId: v.optional(v.id("renderJobs")),
    // Creator Promotion uses its own render lifecycle. Do not overload the
    // studio/client `renderJobs` relationship above: the two pipelines have
    // distinct approval, retention, and provider contracts.
    creatorRenderJobId: v.optional(v.id("creatorRenderJobs")),
    // LoRA training is a distinct, consent-gated paid workflow. It must not
    // share a render action row because its dataset and provider receipt have
    // their own retention and recovery contract.
    creatorLoRATrainingJobId: v.optional(v.id("creatorLoRATrainingJobs")),
    actionKind: v.string(),
    riskClass: v.union(v.literal("low"), v.literal("moderate"), v.literal("high"), v.literal("financial")),
    status: v.union(
      v.literal("admitted"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("blocked"),
    ),
    idempotencyKey: v.string(),
    payloadHash: v.string(),
    payloadSnapshot: v.optional(v.any()),
    estimatedCostMinor: v.optional(v.number()),
    reservedCostMinor: v.optional(v.number()),
    actualCostMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    providerReceipt: v.optional(v.any()),
    triggerRunId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_render_job", ["renderJobId"])
    .index("by_creator_render_job", ["creatorRenderJobId"])
    .index("by_creator_lora_training_job", ["creatorLoRATrainingJobId"])
    .index("by_approval", ["approvalId"])
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_status", ["status"]),

  // Spend is reserved before a financial side effect and reconciled from the
  // action ledger afterwards. Amounts are integer minor currency units.
  budgetEnvelopes: defineTable({
    organizationId: v.id("organizations"),
    connectionId: v.optional(v.id("integrationConnections")),
    name: v.string(),
    scopeType: v.string(),
    scopeId: v.optional(v.string()),
    currency: v.string(),
    hardLimitMinor: v.number(),
    reservedMinor: v.number(),
    spentMinor: v.number(),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("closed")),
    periodStartAt: v.number(),
    periodEndAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_status", ["status"])
    .index("by_scope", ["organizationId", "scopeType", "scopeId"]),

  // ─────────────────────────────────────────────────────────────────────────
  // CREATOR PROMOTION WORKSPACE
  //
  // This is a new governed surface; it deliberately does not revive the
  // retired persona/distribution modules above. OAuth material and passwords
  // never enter Convex. Provider actions are represented by approvalRequests
  // and actionLedger rows before a trusted dispatcher performs a side effect.
  // ─────────────────────────────────────────────────────────────────────────

  creatorProfiles: defineTable({
    organizationId: v.id("organizations"),
    // Historical persona data can be imported once by an operator without
    // exposing the retired table directly to the browser.
    legacyPersonaId: v.optional(v.id("personas")),
    name: v.string(),
    handle: v.string(),
    archetype: v.union(
      v.literal("flagship"),
      v.literal("lifestyle"),
      v.literal("creator"),
      v.literal("faceless"),
    ),
    stage: v.union(
      v.literal("setup"),
      v.literal("growth"),
      v.literal("brand_ready"),
      v.literal("monetized"),
      v.literal("paused"),
    ),
    timezone: v.string(),
    identity: v.object({
      bio: v.optional(v.string()),
      identitySummary: v.optional(v.string()),
      emotionalBackstory: v.optional(v.string()),
      voiceGuide: v.optional(v.string()),
      audience: v.optional(v.string()),
      disclosure: v.optional(v.string()),
      contentPillars: v.array(v.string()),
      boundaries: v.array(v.string()),
      contentBoundaries: v.optional(v.array(v.string())),
    }),
    visualSystem: v.object({
      promptLock: v.string(),
      promptStyle: v.optional(v.string()),
      loraTrigger: v.optional(v.string()),
      referenceNotes: v.optional(v.string()),
      version: v.number(),
    }),
    // A ready model is never made active by training completion. This pointer
    // exists only for a future explicit, auditable operator activation.
    activeLoraModelId: v.optional(v.id("creatorLoraModels")),
    // Persona edits are append-only revisions. This pointer is the single
    // current source for future plans; approved content keeps its own frozen
    // snapshot and is never rewritten when the active persona changes.
    activePersonaRevisionId: v.optional(v.id("creatorPersonaRevisions")),
    activePersonaRevisionNumber: v.optional(v.number()),
    primaryGoal: v.union(v.literal("audience_growth"), v.literal("brand_partnerships"), v.literal("fanvue_conversion")),
    // Defaults are intentionally conservative. A future operator policy may
    // enable an official provider dispatcher per creator/account.
    inboxPolicy: v.union(v.literal("draft_only"), v.literal("human_handoff")),
    automationPolicy: v.optional(v.object({
      postMode: v.union(v.literal("manual"), v.literal("approval_required"), v.literal("automatic")),
      inboxMode: v.union(v.literal("draft_only"), v.literal("approval_required"), v.literal("automatic_safe")),
      dailyPostCap: v.number(),
      dailyReplyCap: v.number(),
      quietHours: v.optional(v.object({ start: v.string(), end: v.string() })),
      requireAgeGate: v.boolean(),
      escalationRules: v.array(v.string()),
    })),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_handle", ["organizationId", "handle"])
    .index("by_legacy_persona", ["legacyPersonaId"]),

  // Immutable persona-bible revisions for the Creator Promotion workspace.
  // The full identity and visual system are captured together so image prompts
  // can always be traced back to one stable creative/character definition.
  creatorPersonaRevisions: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    revisionNumber: v.number(),
    status: v.union(v.literal("active"), v.literal("superseded")),
    source: v.union(v.literal("baseline"), v.literal("operator_edit"), v.literal("legacy_sync")),
    snapshot: v.object({
      identity: v.object({
        bio: v.optional(v.string()),
        identitySummary: v.optional(v.string()),
        emotionalBackstory: v.optional(v.string()),
        voiceGuide: v.optional(v.string()),
        audience: v.optional(v.string()),
        disclosure: v.optional(v.string()),
        contentPillars: v.array(v.string()),
        boundaries: v.array(v.string()),
        contentBoundaries: v.optional(v.array(v.string())),
      }),
      visualSystem: v.object({
        promptLock: v.string(),
        promptStyle: v.optional(v.string()),
        loraTrigger: v.optional(v.string()),
        referenceNotes: v.optional(v.string()),
        version: v.number(),
      }),
    }),
    snapshotHash: v.string(),
    changeNote: v.optional(v.string()),
    createdBy: v.string(),
    createdAt: v.number(),
    activatedBy: v.optional(v.string()),
    activatedAt: v.optional(v.number()),
    supersededAt: v.optional(v.number()),
    supersededBy: v.optional(v.string()),
  })
    .index("by_organization", ["organizationId"])
    .index("by_creator", ["creatorId"])
    .index("by_creator_revision", ["creatorId", "revisionNumber"])
    .index("by_creator_status", ["creatorId", "status"]),

  // Reference-image records are provenance metadata only. The asset bytes live
  // in the approved object store; this table never contains a signed URL,
  // remote image URL, scraped source, or provider credential.
  creatorReferenceAssets: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    storageKey: v.string(),
    displayName: v.string(),
    rightsStatus: v.union(v.literal("owned"), v.literal("consented"), v.literal("licensed")),
    useType: v.union(
      v.literal("creator_likeness"),
      v.literal("style"),
      v.literal("wardrobe"),
      v.literal("location"),
      v.literal("product"),
      v.literal("composition"),
    ),
    source: v.union(
      v.literal("operator_uploaded"),
      v.literal("client_provided"),
      v.literal("owned_library"),
      v.literal("licensed_library"),
    ),
    // Every entry has an accountable operator attestation. Likeness reference
    // assets additionally require consented or owned rights in the mutation.
    consentAttested: v.boolean(),
    consentAttestedBy: v.string(),
    consentAttestedAt: v.number(),
    consentRecordReference: v.optional(v.string()),
    licenseReference: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_organization", ["organizationId"])
    .index("by_organization_storage_key", ["organizationId", "storageKey"]),

  // Account records hold only provider/account metadata. Creation is a
  // legitimate onboarding/KYC workflow, never a browser or verification bot.
  creatorSocialAccounts: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    integrationConnectionId: v.optional(v.id("integrationConnections")),
    platform: v.union(
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube"),
      v.literal("fanvue"),
      v.literal("fansly"),
      v.literal("pinterest"),
      v.literal("x"),
      v.literal("facebook"),
      v.literal("threads"),
      v.literal("linkedin"),
      v.literal("bluesky"),
      v.literal("email"),
      v.literal("other"),
    ),
    handle: v.string(),
    displayName: v.optional(v.string()),
    externalAccountId: v.optional(v.string()),
    ownershipStatus: v.union(v.literal("attested_owned"), v.literal("client_authorized"), v.literal("legacy_unverified")),
    status: v.union(
      v.literal("unlinked"),
      v.literal("pending"),
      v.literal("not_started"),
      v.literal("kyc_pending"),
      v.literal("oauth_pending"),
      v.literal("connected"),
      v.literal("degraded"),
      v.literal("paused"),
      v.literal("revoked"),
    ),
    onboarding: v.optional(v.object({
      mode: v.union(v.literal("manual"), v.literal("fanvue_partner"), v.literal("oauth_connect")),
      status: v.union(
        v.literal("not_started"),
        v.literal("partner_approval_required"),
        v.literal("kyc_required"),
        v.literal("oauth_required"),
        v.literal("ready"),
        v.literal("blocked"),
      ),
      note: v.optional(v.string()),
    })),
    publisher: v.optional(v.union(v.literal("meta"), v.literal("fanvue"), v.literal("postiz"), v.literal("manual"))),
    capabilities: v.array(v.string()),
    scopes: v.optional(v.array(v.string())),
    health: v.union(v.literal("unknown"), v.literal("healthy"), v.literal("degraded"), v.literal("unhealthy")),
    connectionHealth: v.optional(v.union(v.literal("unknown"), v.literal("healthy"), v.literal("degraded"), v.literal("unhealthy"))),
    postingPolicy: v.object({
      mode: v.union(v.literal("manual"), v.literal("approval_required"), v.literal("automatic")),
      dailyPostLimit: v.number(),
      timezone: v.string(),
      dailyCap: v.optional(v.number()),
      quietHours: v.optional(v.object({ start: v.string(), end: v.string() })),
      // Editorial cadence and mix targets are planning controls only. They
      // never authorize provider publishing or dispatch.
      weeklyTarget: v.optional(v.number()),
      maxGapDays: v.optional(v.number()),
      formatTargets: v.optional(v.object({
        image: v.optional(v.number()),
        carousel: v.optional(v.number()),
        reel: v.optional(v.number()),
        story: v.optional(v.number()),
        short: v.optional(v.number()),
        text: v.optional(v.number()),
      })),
    }),
    manualKycStatus: v.union(v.literal("not_applicable"), v.literal("pending"), v.literal("verified"), v.literal("rejected")),
    lastCheckedAt: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_organization", ["organizationId"])
    .index("by_connection", ["integrationConnectionId"])
    .index("by_platform_status", ["platform", "status"])
    // Official webhook lookup only. This is not an account-creation or
    // browser-automation capability; it binds a verified recipient id to an
    // already governed connected account.
    .index("by_platform_external_account", ["platform", "externalAccountId"]),

  creatorDestinations: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    kind: v.union(v.literal("brand_inquiry"), v.literal("link_in_bio"), v.literal("website"), v.literal("fanvue"), v.literal("fansly"), v.literal("other")),
    integrationConnectionId: v.optional(v.id("integrationConnections")),
    label: v.string(),
    url: v.string(),
    externalDestinationId: v.optional(v.string()),
    disclosureText: v.optional(v.string()),
    disclosure: v.optional(v.string()),
    ageGateRequired: v.boolean(),
    capabilities: v.array(v.string()),
    manualKycStatus: v.union(v.literal("not_applicable"), v.literal("pending"), v.literal("verified"), v.literal("rejected")),
    approvalRequired: v.boolean(),
    status: v.union(v.literal("draft"), v.literal("pending_connection"), v.literal("active"), v.literal("paused"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_organization", ["organizationId"]),

  // A governed creator funnel/campaign ties one creator to one existing
  // destination. It stores explicit stage CTAs and UTM naming rules, but
  // never manufactures a public link, redirect, short URL, tracking token, or
  // provider-side campaign. Activation requires a separately immutable
  // approval request; pausing prevents new content approval/dispatch.
  creatorFunnelCampaigns: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    destinationId: v.id("creatorDestinations"),
    approvalId: v.optional(v.id("approvalRequests")),
    campaignLabel: v.string(),
    objective: v.union(
      v.literal("brand_partnerships"),
      v.literal("subscription_conversion"),
      v.literal("website_conversion"),
      v.literal("lead_capture"),
      v.literal("other"),
    ),
    status: v.union(
      v.literal("draft"),
      v.literal("review_required"),
      v.literal("approved"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("archived"),
    ),
    // An update creates a new version before it can be reviewed/activated;
    // approved content keeps its own immutable funnel snapshot instead.
    version: v.number(),
    stages: v.array(creatorFunnelStagePlan),
    compliance: creatorFunnelCompliance,
    linkPolicy: creatorFunnelLinkPolicy,
    reviewRequestedAt: v.optional(v.number()),
    reviewRequestedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    activatedAt: v.optional(v.number()),
    activatedBy: v.optional(v.string()),
    pausedAt: v.optional(v.number()),
    pausedBy: v.optional(v.string()),
    pauseReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_creator", ["creatorId"])
    .index("by_creator_status", ["creatorId", "status"])
    .index("by_destination", ["destinationId"])
    .index("by_approval", ["approvalId"]),

  // A content item is the operator-visible schedule/outbox entry. It records
  // the prompt lineage and intended provider, but provider receipts live only
  // in actionLedger after an authorized dispatch.
  creatorContentItems: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    accountId: v.optional(v.id("creatorSocialAccounts")),
    destinationId: v.optional(v.id("creatorDestinations")),
    // When present, both fields are a frozen, URL-free record of an active
    // campaign. Content never follows mutable campaign/link state at runtime.
    funnelId: v.optional(v.id("creatorFunnelCampaigns")),
    funnelSnapshot: v.optional(creatorFunnelContentSnapshot),
    approvalId: v.optional(v.id("approvalRequests")),
    // A selected candidate is a reviewed, controlled-storage asset. It is
    // deliberately distinct from publication and does not imply that any
    // social provider accepted or posted it.
    selectedRenderCandidateId: v.optional(v.id("creatorRenderCandidates")),
    selectedRenderAt: v.optional(v.number()),
    format: v.union(v.literal("image"), v.literal("carousel"), v.literal("reel"), v.literal("story"), v.literal("short"), v.literal("text"), v.literal("subscription_post")),
    funnelStage: v.union(v.literal("awareness"), v.literal("trust"), v.literal("consideration"), v.literal("conversion"), v.literal("retention")),
    status: v.union(
      v.literal("idea"),
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("cancelled"),
      v.literal("archived"),
      v.literal("awaiting_render_approval"),
      v.literal("render_queued"),
      v.literal("rendered"),
      v.literal("awaiting_publish_approval"),
      v.literal("dispatch_queued"),
      v.literal("published"),
      v.literal("failed"),
      v.literal("paused"),
    ),
    reviewStatus: v.union(v.literal("not_requested"), v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    reviewVersion: v.number(),
    title: v.string(),
    hook: v.string(),
    caption: v.string(),
    cta: v.optional(v.string()),
    whyNow: v.string(),
    promptSnapshot: v.object({
      promptLock: v.string(),
      prompt: v.string(),
      promptStyle: v.optional(v.string()),
      referenceNotes: v.optional(v.string()),
      provider: v.union(
        v.literal("render_engine"),
        v.literal("novita"),
        v.literal("ltx"),
        // Explicitly selected only after a ready creator LoRA is snapshotted
        // into this content version; never the default renderer.
        v.literal("fal_z_image_turbo_lora"),
        v.literal("unassigned"),
      ),
      version: v.number(),
      // A content version that uses a creator LoRA freezes exactly which
      // reviewed model it references. It never follows a mutable profile
      // pointer at render time.
      loraSnapshot: v.optional(v.object({
        modelId: v.id("creatorLoraModels"),
        trainingJobId: v.id("creatorLoRATrainingJobs"),
        targetModel: v.literal("z-image-turbo"),
        triggerWord: v.string(),
        modelArtifactKey: v.string(),
        modelArtifactUrl: v.optional(v.string()),
        datasetManifestHash: v.string(),
      })),
      // A new plan freezes the active persona revision together with its
      // prompt system. Later persona edits cannot alter this content version
      // or any approval/render request derived from it.
      personaSnapshot: v.optional(v.object({
        revisionId: v.id("creatorPersonaRevisions"),
        revisionNumber: v.number(),
        snapshotHash: v.string(),
        identity: v.object({
          bio: v.optional(v.string()),
          identitySummary: v.optional(v.string()),
          emotionalBackstory: v.optional(v.string()),
          voiceGuide: v.optional(v.string()),
          audience: v.optional(v.string()),
          disclosure: v.optional(v.string()),
          contentPillars: v.array(v.string()),
          boundaries: v.array(v.string()),
          contentBoundaries: v.optional(v.array(v.string())),
        }),
        visualSystem: v.object({
          promptLock: v.string(),
          promptStyle: v.optional(v.string()),
          loraTrigger: v.optional(v.string()),
          referenceNotes: v.optional(v.string()),
          version: v.number(),
        }),
      })),
    }),
    referenceAssetKeys: v.optional(v.array(v.string())),
    renderProvider: v.optional(
      v.union(
        v.literal("render_engine"),
        v.literal("novita"),
        v.literal("ltx"),
        v.literal("fal_z_image_turbo_lora"),
        v.literal("manual"),
        v.literal("unassigned"),
      ),
    ),
    renderState: v.union(v.literal("not_requested"), v.literal("brief_ready"), v.literal("approved_for_render"), v.literal("rendered"), v.literal("rejected")),
    previewUrl: v.optional(v.string()),
    scheduledAt: v.number(),
    publishedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator_scheduled", ["creatorId", "scheduledAt"])
    .index("by_account_scheduled", ["accountId", "scheduledAt"])
    .index("by_organization_scheduled", ["organizationId", "scheduledAt"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_approval", ["approvalId"]),

  // Creator-specific render attempts. Every row is one immutable attempt of
  // one approved content version; a retry creates a new row rather than
  // mutating the original request or reusing a paid-action idempotency key.
  creatorRenderJobs: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    contentId: v.id("creatorContentItems"),
    approvalId: v.id("approvalRequests"),
    actionId: v.optional(v.id("actionLedger")),
    reviewVersion: v.number(),
    provider: v.union(
      v.literal("render_engine"),
      v.literal("novita"),
      v.literal("ltx"),
      v.literal("fal_z_image_turbo_lora"),
      v.literal("unassigned"),
    ),
    status: v.union(
      v.literal("blocked"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("candidates_ready"),
      v.literal("selected"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    attemptNumber: v.number(),
    maxAttempts: v.number(),
    idempotencyKey: v.string(),
    // The original approval snapshot is copied into this request envelope and
    // never replaced on retry. Workers must use it instead of mutable content.
    requestHash: v.string(),
    requestSnapshot: v.any(),
    scheduledAt: v.optional(v.number()),
    referenceCount: v.number(),
    retryOfJobId: v.optional(v.id("creatorRenderJobs")),
    requestedBy: v.string(),
    failureReason: v.optional(v.string()),
    selectedCandidateId: v.optional(v.id("creatorRenderCandidates")),
    selectedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_creator", ["creatorId"])
    .index("by_content", ["contentId"])
    .index("by_approval", ["approvalId"])
    .index("by_idempotency", ["idempotencyKey"])
    .index("by_status", ["status"]),

  // A candidate may be recorded only after a trusted renderer has copied its
  // output into controlled storage. This surface never stores a provider URL,
  // credential, or raw provider receipt.
  creatorRenderCandidates: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    contentId: v.id("creatorContentItems"),
    jobId: v.id("creatorRenderJobs"),
    attemptNumber: v.number(),
    provider: v.union(v.literal("render_engine"), v.literal("novita"), v.literal("ltx"), v.literal("fal_z_image_turbo_lora")),
    mediaType: v.union(v.literal("image"), v.literal("video")),
    status: v.union(v.literal("pending"), v.literal("selected"), v.literal("rejected")),
    idempotencyKey: v.string(),
    assetKey: v.string(),
    thumbnailKey: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    rejectionReason: v.optional(v.string()),
    selectedAt: v.optional(v.number()),
    selectedBy: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_creator", ["creatorId"])
    .index("by_content", ["contentId"])
    .index("by_job", ["jobId"])
    .index("by_content_status", ["contentId", "status"])
    .index("by_idempotency", ["idempotencyKey"]),

  // Creator-specific Z-Image Turbo LoRA training. Every job freezes an
  // operator-attested dataset manifest at draft creation and is separately
  // reviewed before a trusted worker may submit it to Fal. No source bytes,
  // provider credential, signed URL, or raw provider response enters Convex.
  creatorLoRATrainingJobs: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    reviewApprovalId: v.optional(v.id("approvalRequests")),
    actionId: v.optional(v.id("actionLedger")),
    targetModel: v.literal("z-image-turbo"),
    status: v.union(
      v.literal("draft"),
      v.literal("review_required"),
      v.literal("approved_for_training"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("rejected"),
    ),
    triggerWord: v.string(),
    trainingLabel: v.optional(v.string()),
    // The endpoint distinction is intentional: the training endpoint creates
    // weights, while the inference endpoint consumes an approved model later.
    // Both are frozen at draft creation so workers never invent defaults.
    trainingParams: v.object({
      trainingEndpoint: v.literal("fal-ai/z-image-trainer"),
      inferenceEndpoint: v.literal("fal-ai/z-image/turbo/lora"),
      baseModel: v.literal("z-image-turbo"),
      triggerWord: v.string(),
      trainingType: v.union(v.literal("content"), v.literal("style"), v.literal("balanced")),
      // Kept separately so the worker can forward the Fal enum without
      // inferring or remapping a user-facing training mode.
      falTrainingType: v.union(v.literal("content"), v.literal("style"), v.literal("balanced")),
      steps: v.number(),
      learningRate: v.number(),
      defaultCaption: v.string(),
    }),
    datasetAssetIds: v.array(v.id("creatorReferenceAssets")),
    datasetAssetCount: v.number(),
    // Immutable after draft creation. The stable hash is rechecked before
    // review, queueing, worker claim, and completion.
    datasetManifest: v.array(v.object({
      assetId: v.id("creatorReferenceAssets"),
      storageKey: v.string(),
      caption: v.string(),
      // Optional because the current reference library does not yet retain a
      // cryptographic digest. A worker may compute and verify it before upload.
      sha256: v.optional(v.string()),
      rightsStatus: v.union(v.literal("owned"), v.literal("consented")),
      consentAttestedBy: v.string(),
      consentAttestedAt: v.number(),
      consentRecordReference: v.optional(v.string()),
    })),
    datasetManifestHash: v.string(),
    operatorAttestation: v.object({
      attestedBy: v.string(),
      statement: v.string(),
      confirmed: v.literal(true),
      attestedAt: v.number(),
    }),
    reviewRequestedAt: v.optional(v.number()),
    reviewRequestedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    queuedAt: v.optional(v.number()),
    queuedBy: v.optional(v.string()),
    // Non-secret provider state only. The worker records the request id
    // atomically before polling so a retry cannot duplicate paid training.
    falRequestId: v.optional(v.string()),
    falResultMetadata: v.optional(v.object({
      status: v.optional(v.string()),
      modelUrl: v.optional(v.string()),
      configUrl: v.optional(v.string()),
      trainingSteps: v.optional(v.number()),
      trainingImages: v.optional(v.number()),
    })),
    // The worker must re-home an output artifact before it can complete a
    // job. The optional URL is sanitized metadata, never a signed URL.
    modelArtifactKey: v.optional(v.string()),
    modelArtifactUrl: v.optional(v.string()),
    modelId: v.optional(v.id("creatorLoraModels")),
    triggerRunId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_creator", ["creatorId"])
    .index("by_status", ["status"])
    .index("by_review_approval", ["reviewApprovalId"])
    .index("by_action", ["actionId"])
    .index("by_fal_request", ["falRequestId"]),

  // A successful job produces a model registry record. It is deliberately
  // not auto-attached to a creator prompt system; activation remains a future
  // explicit operator action.
  creatorLoraModels: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    trainingJobId: v.id("creatorLoRATrainingJobs"),
    targetModel: v.literal("z-image-turbo"),
    triggerWord: v.string(),
    trainingParams: v.object({
      trainingEndpoint: v.literal("fal-ai/z-image-trainer"),
      inferenceEndpoint: v.literal("fal-ai/z-image/turbo/lora"),
      baseModel: v.literal("z-image-turbo"),
      triggerWord: v.string(),
      trainingType: v.union(v.literal("content"), v.literal("style"), v.literal("balanced")),
      falTrainingType: v.union(v.literal("content"), v.literal("style"), v.literal("balanced")),
      steps: v.number(),
      learningRate: v.number(),
      defaultCaption: v.string(),
    }),
    // Completion only registers a model for validation. A separate operator
    // action may explicitly activate one model for a creator.
    status: v.union(v.literal("validating"), v.literal("active"), v.literal("failed"), v.literal("archived")),
    modelArtifactKey: v.string(),
    modelArtifactUrl: v.optional(v.string()),
    falRequestId: v.string(),
    falResultMetadata: v.optional(v.object({
      status: v.optional(v.string()),
      modelUrl: v.optional(v.string()),
      configUrl: v.optional(v.string()),
      trainingSteps: v.optional(v.number()),
      trainingImages: v.optional(v.number()),
    })),
    datasetManifestHash: v.string(),
    activatedAt: v.optional(v.number()),
    activatedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_creator", ["creatorId"])
    .index("by_training_job", ["trainingJobId"])
    .index("by_creator_status", ["creatorId", "status"]),

  // Minimal inbox state lets the operator see and govern each conversation.
  // Message bodies are retention-bounded and may only be sourced from an
  // official channel webhook or an operator input.
  creatorInboxThreads: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    accountId: v.optional(v.id("creatorSocialAccounts")),
    destinationId: v.optional(v.id("creatorDestinations")),
    platform: v.union(
      v.literal("instagram"),
      v.literal("tiktok"),
      v.literal("youtube"),
      v.literal("fanvue"),
      v.literal("fansly"),
      v.literal("pinterest"),
      v.literal("x"),
      v.literal("facebook"),
      v.literal("threads"),
      v.literal("linkedin"),
      v.literal("bluesky"),
      v.literal("email"),
      v.literal("other"),
    ),
    externalThreadId: v.optional(v.string()),
    participantLabel: v.optional(v.string()),
    summary: v.string(),
    intent: v.union(v.literal("general"), v.literal("brand_inquiry"), v.literal("support"), v.literal("fanvue_interest"), v.literal("safety_review"), v.literal("other")),
    status: v.union(v.literal("received"), v.literal("draft_ready"), v.literal("human_handoff"), v.literal("closed")),
    responseWindowEndsAt: v.optional(v.number()),
    // Set exclusively by signed official Meta webhook ingestion. Manual and
    // unverified inbox threads leave these absent and are permanently
    // non-sendable through the governed Meta reply lifecycle.
    verifiedMetaInstagramInboundAt: v.optional(v.number()),
    verifiedMetaInstagramReplyEligibilityEndsAt: v.optional(v.number()),
    requiresDisclosure: v.boolean(),
    safetyFlags: v.array(v.string()),
    draftReply: v.optional(v.string()),
    draftRationale: v.optional(v.string()),
    draftReviewStatus: v.optional(v.union(v.literal("draft"), v.literal("approved"), v.literal("rejected"))),
    draftReviewedAt: v.optional(v.number()),
    draftReviewedBy: v.optional(v.string()),
    // A local approval freezes one immutable outbound message. It is never a
    // provider permission by itself; the Meta reply lifecycle below requires a
    // separate action/approval/explicit queue against this exact message.
    approvedDraftMessageId: v.optional(v.id("creatorInboxMessages")),
    // At most one governed Meta reply action may exist for the latest verified
    // inbound message. A new signed customer message clears this pointer;
    // failures hand the thread off instead of allowing a duplicate retry.
    metaInstagramReplyActionId: v.optional(v.id("actionLedger")),
    handoffReason: v.optional(v.string()),
    handoffAssignee: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId"])
    .index("by_account_external_thread", ["accountId", "externalThreadId"])
    .index("by_organization", ["organizationId"]),

  creatorInboxMessages: defineTable({
    organizationId: v.id("organizations"),
    threadId: v.id("creatorInboxThreads"),
    externalMessageId: v.optional(v.string()),
    // Present only on a signed, customer-initiated official webhook ingress.
    // They are deliberately metadata-only and never authorize a reply.
    verifiedInbound: v.optional(v.boolean()),
    provider: v.optional(v.literal("meta_instagram")),
    officialRecipientId: v.optional(v.string()),
    // The signed webhook's opaque customer Instagram-scoped id. It stays in
    // the private message record only long enough to address one approved
    // response-window reply; it is never part of the workspace projection.
    customerSenderId: v.optional(v.string()),
    occurredAt: v.optional(v.number()),
    replyEligibilityEndsAt: v.optional(v.number()),
    eventReceiptId: v.optional(v.id("eventReceipts")),
    direction: v.union(v.literal("inbound"), v.literal("outbound"), v.literal("system")),
    source: v.union(v.literal("operator"), v.literal("official_webhook"), v.literal("ai_draft"), v.literal("provider")),
    status: v.union(v.literal("received"), v.literal("draft"), v.literal("approved"), v.literal("queued"), v.literal("sent"), v.literal("failed")),
    body: v.string(),
    automated: v.boolean(),
    actionId: v.optional(v.id("actionLedger")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_created", ["threadId", "createdAt"])
    .index("by_action", ["actionId"])
    .index("by_expiry", ["expiresAt"])
    .index("by_provider_external_message", ["provider", "externalMessageId"])
    .index("by_event_receipt", ["eventReceiptId"]),

  // Actual provider-derived performance only. The UI must never fabricate
  // reach, clicks, subscriptions, or revenue when a connection is absent.
  creatorAttributionSnapshots: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    accountId: v.optional(v.id("creatorSocialAccounts")),
    contentId: v.optional(v.id("creatorContentItems")),
    destinationId: v.optional(v.id("creatorDestinations")),
    funnelId: v.optional(v.id("creatorFunnelCampaigns")),
    funnelVersion: v.optional(v.number()),
    funnelSnapshotHash: v.optional(v.string()),
    source: v.union(v.literal("instagram"), v.literal("fanvue"), v.literal("postiz"), v.literal("manual")),
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
    createdAt: v.number(),
  })
    .index("by_creator_captured", ["creatorId", "capturedAt"])
    .index("by_content_captured", ["contentId", "capturedAt"])
    .index("by_funnel_captured", ["funnelId", "capturedAt"])
    .index("by_organization_captured", ["organizationId", "capturedAt"]),

  // Manual, aggregate-only funnel observations. This is an audit trail for
  // operator-transcribed analytics, not a pixel, webhook, redirect, payment,
  // or subscriber-data integration. It intentionally stores no visitor ID,
  // message body, email, public URL, or provider token.
  creatorFunnelEvents: defineTable({
    organizationId: v.id("organizations"),
    creatorId: v.id("creatorProfiles"),
    funnelId: v.id("creatorFunnelCampaigns"),
    funnelVersion: v.number(),
    funnelSnapshotHash: v.string(),
    destinationId: v.id("creatorDestinations"),
    contentId: v.optional(v.id("creatorContentItems")),
    source: v.literal("manual"),
    eventType: v.union(
      v.literal("link_click"),
      v.literal("lead"),
      v.literal("brand_inquiry"),
      v.literal("signup"),
      v.literal("subscription"),
      v.literal("revenue_observed"),
      v.literal("other"),
    ),
    count: v.number(),
    revenueMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    note: v.optional(v.string()),
    occurredAt: v.number(),
    recordedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_funnel_occurred", ["funnelId", "occurredAt"])
    .index("by_content_occurred", ["contentId", "occurredAt"])
    .index("by_organization_occurred", ["organizationId", "occurredAt"]),
});
