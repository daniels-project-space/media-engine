import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const all = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("settings").collect();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
});

// AI (OpenRouter) kill switch — default ON; set false to pause all LLM spend.
export const aiEnabled = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "aiEnabled")).unique();
    return row ? Boolean(row.value) : true;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value });
    else await ctx.db.insert("settings", { key, value });
  },
});
