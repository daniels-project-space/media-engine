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
    archetype: v.union(v.literal("flagship"), v.literal("faceless")),
    globalLock: v.string(),
    bio: v.optional(v.string()),
    identitySummary: v.optional(v.string()),
    loraUrl: v.optional(v.string()),
    loraTrigger: v.optional(v.string()),
    stage: v.union(v.literal("grow"), v.literal("brand_ready"), v.literal("monetized")),
    niche: v.optional(v.string()),
    streamSlug: v.optional(v.string()),
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
    tokenService: v.optional(v.string()),
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
    tier: v.union(v.literal("basic"), v.literal("standard"), v.literal("premium")),
    brief: v.string(),
    productImageKey: v.optional(v.string()), // R2 key of the client's product image
    status: v.union(
      v.literal("new"),
      v.literal("in_progress"),
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
    orderId: v.optional(v.id("clientOrders")),
    stage: v.union(
      v.literal("scripting"),
      v.literal("script_ready"),
      v.literal("drafting"),
      v.literal("draft_ready"),
      v.literal("rendering"),
      v.literal("final_ready"),
      v.literal("failed"),
    ),
    shots: v.optional(
      v.array(
        v.object({
          kind: v.optional(v.string()), // "card" for the brand end-card
          imagePrompt: v.optional(v.string()),
          imageUrl: v.optional(v.string()), // real product / reference image
          imageKey: v.optional(v.string()), // R2 key of the approved draft image (reused in 4K)
          motion: v.string(),
          seconds: v.number(),
          onText: v.optional(v.string()),
          cardTitle: v.optional(v.string()),
          cardSub: v.optional(v.string()),
        }),
      ),
    ),
    hook: v.optional(v.string()),
    caption: v.optional(v.string()),
    musicPrompt: v.optional(v.string()),
    draftPostId: v.optional(v.id("posts")),
    finalPostId: v.optional(v.id("posts")),
    error: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_stage", ["stage"]),

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
});
