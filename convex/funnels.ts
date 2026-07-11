import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// DB-driven funnels. `/f/[slug]` renders straight from a row — no page asset is
// generated; the orchestrator writes structured copy + reference-image keys.

const propV = v.object({ header: v.string(), body: v.string() });

export const upsert = mutation({
  args: {
    slug: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    productName: v.string(),
    headline: v.string(),
    subhead: v.optional(v.string()),
    valueProps: v.array(propV),
    ctaText: v.string(),
    ctaUrl: v.string(),
    discountCode: v.optional(v.string()),
    discountBlurb: v.optional(v.string()),
    heroImageKey: v.optional(v.string()),
    referenceImageKeys: v.optional(v.array(v.string())),
    sections: v.optional(v.any()),
    theme: v.optional(v.string()),
    captureEmail: v.optional(v.boolean()),
    published: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("funnels").withIndex("by_slug", (q) => q.eq("slug", a.slug)).unique();
    const fields = {
      campaignId: a.campaignId,
      productName: a.productName,
      headline: a.headline,
      subhead: a.subhead,
      valueProps: a.valueProps,
      ctaText: a.ctaText,
      ctaUrl: a.ctaUrl,
      discountCode: a.discountCode,
      discountBlurb: a.discountBlurb,
      heroImageKey: a.heroImageKey,
      referenceImageKeys: a.referenceImageKeys,
      sections: a.sections,
      theme: a.theme,
      captureEmail: a.captureEmail ?? true,
      published: a.published ?? false,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("funnels", { slug: a.slug, ...fields, views: 0, conversions: 0, createdAt: Date.now() });
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => await ctx.db.query("funnels").withIndex("by_slug", (q) => q.eq("slug", slug)).unique(),
});

export const list = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("funnels").collect()).sort((a, b) => b.createdAt - a.createdAt),
});

export const track = mutation({
  args: { slug: v.string(), event: v.union(v.literal("view"), v.literal("conversion")) },
  handler: async (ctx, { slug, event }) => {
    const f = await ctx.db.query("funnels").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (!f) return;
    await ctx.db.patch(f._id, event === "view" ? { views: f.views + 1 } : { conversions: f.conversions + 1 });
  },
});

export const setPublished = mutation({
  args: { slug: v.string(), published: v.boolean() },
  handler: async (ctx, { slug, published }) => {
    const f = await ctx.db.query("funnels").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (f) await ctx.db.patch(f._id, { published });
  },
});
