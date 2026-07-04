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
});
