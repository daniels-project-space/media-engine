import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Connected commerce stores (Shopify). Products sync into `products`.

export const connect = mutation({
  args: {
    platform: v.optional(v.union(v.literal("shopify"), v.literal("woocommerce"), v.literal("manual"))),
    domain: v.string(),
    name: v.optional(v.string()),
    tokenService: v.optional(v.string()),
    tokenKey: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("stores").withIndex("by_domain", (q) => q.eq("domain", a.domain)).unique();
    const fields = {
      platform: a.platform ?? ("shopify" as const),
      name: a.name,
      tokenService: a.tokenService ?? "shopify",
      tokenKey: a.tokenKey,
      currency: a.currency,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("stores", { domain: a.domain, ...fields, createdAt: Date.now() });
  },
});

export const get = query({
  args: { id: v.id("stores") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const byDomain = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => await ctx.db.query("stores").withIndex("by_domain", (q) => q.eq("domain", domain)).unique(),
});

export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("stores").collect()).sort((a, b) => b.createdAt - a.createdAt),
});

export const markSynced = mutation({
  args: { id: v.id("stores") },
  handler: async (ctx, { id }) => await ctx.db.patch(id, { lastSyncedAt: Date.now() }),
});
