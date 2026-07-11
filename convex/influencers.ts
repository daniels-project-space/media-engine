import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const statusV = v.union(
  v.literal("sourced"),
  v.literal("contacted"),
  v.literal("negotiating"),
  v.literal("agreed"),
  v.literal("delivered"),
  v.literal("declined"),
);

export const add = mutation({
  args: {
    handle: v.string(),
    platform: v.string(),
    niche: v.optional(v.string()),
    followers: v.optional(v.number()),
    engagementRate: v.optional(v.number()),
    email: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    rateNote: v.optional(v.string()),
    source: v.optional(v.string()),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, a) =>
    await ctx.db.insert("influencers", { ...a, contactStatus: "sourced", createdAt: Date.now() }),
});

export const forCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) =>
    await ctx.db.query("influencers").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect(),
});

export const byNiche = query({
  args: { niche: v.string() },
  handler: async (ctx, { niche }) =>
    await ctx.db.query("influencers").withIndex("by_niche", (q) => q.eq("niche", niche)).collect(),
});

export const setStatus = mutation({
  args: { id: v.id("influencers"), contactStatus: statusV, briefKey: v.optional(v.string()) },
  handler: async (ctx, { id, contactStatus, briefKey }) => {
    const patch: Record<string, unknown> = { contactStatus };
    if (briefKey !== undefined) patch.briefKey = briefKey;
    await ctx.db.patch(id, patch);
  },
});
