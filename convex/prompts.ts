import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("promptTemplates").collect();
  },
});

// Upsert a template by name (used to patch realism/motion guidance in place).
export const setBody = mutation({
  args: {
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
  },
  handler: async (ctx, { name, category, body }) => {
    const existing = (await ctx.db.query("promptTemplates").collect()).find((t) => t.name === name);
    if (existing) await ctx.db.patch(existing._id, { body, category });
    else await ctx.db.insert("promptTemplates", { name, category, body, createdAt: Date.now() });
  },
});
