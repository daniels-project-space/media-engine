import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Market/SEO intel gathered per campaign (keywords, SERP, competitors, positioning).

export const add = mutation({
  args: {
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
  },
  handler: async (ctx, a) => await ctx.db.insert("intelReports", { ...a, createdAt: Date.now() }),
});

export const forCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) =>
    await ctx.db.query("intelReports").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect(),
});
