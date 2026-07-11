import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Asset-reuse graph. `assets` = nodes (every marketing image/video the engine
// knows), `assetDerivations` = DERIVED_FROM edges (reframe/cameo/repurpose),
// `placements` = where each asset went (1 asset → many channels/brands). This is
// what lets a marketing image be reused by an influencer or repurposed to TikTok.

const kindV = v.union(v.literal("image"), v.literal("video"), v.literal("clip"), v.literal("logo"), v.literal("screenshot"));
const sourceV = v.union(v.literal("generated"), v.literal("pulled"), v.literal("uploaded"), v.literal("derived"));
const rightsV = v.union(v.literal("owned"), v.literal("licensed"), v.literal("creator"), v.literal("stock"));

export const register = mutation({
  args: {
    r2Key: v.optional(v.string()),
    url: v.optional(v.string()),
    kind: kindV,
    source: sourceV,
    sourcePostId: v.optional(v.id("posts")),
    campaignId: v.optional(v.id("campaigns")),
    personaId: v.optional(v.id("personas")),
    productId: v.optional(v.id("products")),
    modelId: v.optional(v.id("models")),
    tags: v.optional(v.array(v.string())),
    rights: v.optional(rightsV),
    license: v.optional(v.any()),
    aspect: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    // Dedupe by r2Key if given.
    if (a.r2Key) {
      const dup = (await ctx.db.query("assets").withIndex("by_campaign", (q) => q.eq("campaignId", a.campaignId)).collect()).find(
        (x) => x.r2Key === a.r2Key,
      );
      if (dup) return dup._id;
    }
    return await ctx.db.insert("assets", { ...a, rights: a.rights ?? "owned", createdAt: Date.now() });
  },
});

export const get = query({
  args: { id: v.id("assets") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const forCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => await ctx.db.query("assets").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect(),
});

export const forPersona = query({
  args: { personaId: v.id("personas") },
  handler: async (ctx, { personaId }) => await ctx.db.query("assets").withIndex("by_persona", (q) => q.eq("personaId", personaId)).collect(),
});

export const list = query({
  args: { kind: v.optional(kindV), limit: v.optional(v.number()) },
  handler: async (ctx, { kind, limit }) => {
    const rows = kind
      ? await ctx.db.query("assets").withIndex("by_kind", (q) => q.eq("kind", kind)).collect()
      : await ctx.db.query("assets").collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit ?? 100);
  },
});

// ── Derivations (edges) ────────────────────────────────────────────────────

export const addDerivation = mutation({
  args: {
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
  },
  handler: async (ctx, a) => await ctx.db.insert("assetDerivations", { ...a, createdAt: Date.now() }),
});

/** Full lineage of one asset: itself, its parents, its children, and placements. */
export const lineage = query({
  args: { id: v.id("assets") },
  handler: async (ctx, { id }) => {
    const asset = await ctx.db.get(id);
    const parents = await ctx.db.query("assetDerivations").withIndex("by_child", (q) => q.eq("childAssetId", id)).collect();
    const children = await ctx.db.query("assetDerivations").withIndex("by_parent", (q) => q.eq("parentAssetId", id)).collect();
    const placements = await ctx.db.query("placements").withIndex("by_asset", (q) => q.eq("assetId", id)).collect();
    return { asset, parents, children, placements };
  },
});

// ── Placements ──────────────────────────────────────────────────────────────

export const addPlacement = mutation({
  args: {
    assetId: v.id("assets"),
    campaignId: v.optional(v.id("campaigns")),
    platform: v.string(),
    channel: v.optional(v.string()),
    persona: v.optional(v.string()),
    influencerId: v.optional(v.id("influencers")),
    trackingCode: v.optional(v.string()),
    discountCode: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => await ctx.db.insert("placements", { ...a, status: "planned", createdAt: Date.now() }),
});

export const setPlacementStatus = mutation({
  args: {
    id: v.id("placements"),
    status: v.union(
      v.literal("planned"),
      v.literal("handed_off"),
      v.literal("scheduled"),
      v.literal("posted"),
      v.literal("failed"),
    ),
    externalId: v.optional(v.string()),
    postId: v.optional(v.id("posts")),
    result: v.optional(v.any()),
  },
  handler: async (ctx, { id, status, externalId, postId, result }) => {
    const patch: Record<string, unknown> = { status };
    if (externalId !== undefined) patch.externalId = externalId;
    if (postId !== undefined) patch.postId = postId;
    if (result !== undefined) patch.result = result;
    if (status === "posted") patch.postedAt = Date.now();
    await ctx.db.patch(id, patch);
  },
});

export const placementsForCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => await ctx.db.query("placements").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect(),
});
