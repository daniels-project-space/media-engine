import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Cross-marketing across the portfolio — bundles, shoutout swaps between owned
// personas, referral reciprocity, shared retargeting audiences, UGC syndication.

const kindV = v.union(
  v.literal("bundle"),
  v.literal("shoutout_swap"),
  v.literal("referral"),
  v.literal("retarget"),
  v.literal("syndication"),
);

export const propose = mutation({
  args: {
    kind: kindV,
    campaignIds: v.optional(v.array(v.id("campaigns"))),
    productIds: v.optional(v.array(v.id("products"))),
    personaIds: v.optional(v.array(v.id("personas"))),
    terms: v.optional(v.any()),
    sharedAudienceKey: v.optional(v.string()),
    referralCode: v.optional(v.string()),
    rationale: v.optional(v.string()),
  },
  handler: async (ctx, a) => await ctx.db.insert("crossPromotions", { ...a, status: "proposed", createdAt: Date.now() }),
});

export const list = query({
  args: { status: v.optional(v.union(v.literal("proposed"), v.literal("active"), v.literal("done"), v.literal("declined"))) },
  handler: async (ctx, { status }) => {
    const rows = status
      ? await ctx.db.query("crossPromotions").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("crossPromotions").collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("crossPromotions"),
    status: v.union(v.literal("proposed"), v.literal("active"), v.literal("done"), v.literal("declined")),
  },
  handler: async (ctx, { id, status }) => await ctx.db.patch(id, { status }),
});
