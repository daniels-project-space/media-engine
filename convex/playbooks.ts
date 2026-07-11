import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Marketing playbooks — the reusable "how to market X, what to say, what works".
// The strategist selects a playbook per channel/category and fills its templates.

const categoryV = v.union(
  v.literal("cold_email"),
  v.literal("fiverr_niche"),
  v.literal("branding"),
  v.literal("ig_influencer_funnel"),
  v.literal("app_launch"),
  v.literal("community"),
  v.literal("seo"),
);

export const upsert = mutation({
  args: {
    slug: v.string(),
    category: categoryV,
    title: v.string(),
    channel: v.optional(v.string()),
    description: v.string(),
    structure: v.any(),
    templates: v.array(v.object({ label: v.string(), body: v.string() })),
    bestPractices: v.array(v.string()),
    kpis: v.array(v.string()),
    defaultBudgetSplit: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const existing = (await ctx.db.query("playbooks").withIndex("by_category", (q) => q.eq("category", a.category)).collect()).find(
      (p) => p.slug === a.slug,
    );
    if (existing) {
      await ctx.db.patch(existing._id, { ...a });
      return existing._id;
    }
    return await ctx.db.insert("playbooks", { ...a, createdAt: Date.now() });
  },
});

export const list = query({
  args: { category: v.optional(categoryV) },
  handler: async (ctx, { category }) => {
    return category
      ? await ctx.db.query("playbooks").withIndex("by_category", (q) => q.eq("category", category)).collect()
      : await ctx.db.query("playbooks").collect();
  },
});
