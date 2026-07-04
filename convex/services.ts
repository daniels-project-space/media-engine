import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("services").collect();
    return all.sort((a, b) => a.order - b.order);
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return await ctx.db
      .query("services")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
  },
});

// Upsert a service by slug — used by the seed script (idempotent).
export const upsert = mutation({
  args: {
    slug: v.string(),
    active: v.boolean(),
    order: v.number(),
    name: v.string(),
    tagline: v.string(),
    seoTitle: v.string(),
    seoDescription: v.string(),
    heroHeadline: v.string(),
    heroSubhead: v.string(),
    heroClipKey: v.optional(v.string()),
    proofPoints: v.array(v.string()),
    howItWorks: v.array(v.object({ title: v.string(), body: v.string() })),
    gallery: v.array(
      v.object({ clipKey: v.optional(v.string()), imageKey: v.optional(v.string()), label: v.string(), beforeKey: v.optional(v.string()) }),
    ),
    valueProps: v.array(v.object({ header: v.string(), body: v.string() })),
    pricingTiers: v.array(
      v.object({ name: v.string(), price: v.string(), unit: v.optional(v.string()), popular: v.optional(v.boolean()), features: v.array(v.string()) }),
    ),
    faq: v.array(v.object({ q: v.string(), a: v.string() })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("services")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("services", { ...args, createdAt: Date.now() });
  },
});

export const remove = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const s = await ctx.db.query("services").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (s) await ctx.db.delete(s._id);
  },
});
