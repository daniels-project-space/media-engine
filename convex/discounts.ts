import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Discount codes minted for campaigns (via the Stripe adapter, or manual).
// The adapter creates the provider-side code; this table is the local record
// the funnel reads and redemptions are counted against.

export const record = mutation({
  args: {
    code: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    provider: v.union(v.literal("stripe"), v.literal("shopify"), v.literal("manual")),
    kind: v.union(v.literal("percent"), v.literal("amount")),
    percentOff: v.optional(v.number()),
    amountOffPence: v.optional(v.number()),
    currency: v.optional(v.string()),
    externalId: v.optional(v.string()),
    maxRedemptions: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("discountCodes").withIndex("by_code", (q) => q.eq("code", a.code)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...a, status: "active" as const });
      return existing._id;
    }
    return await ctx.db.insert("discountCodes", { ...a, redemptions: 0, status: "active", createdAt: Date.now() });
  },
});

export const getByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => await ctx.db.query("discountCodes").withIndex("by_code", (q) => q.eq("code", code)).unique(),
});

export const forCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) =>
    await ctx.db.query("discountCodes").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect(),
});

export const redeem = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const d = await ctx.db.query("discountCodes").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (d) await ctx.db.patch(d._id, { redemptions: d.redemptions + 1 });
  },
});
