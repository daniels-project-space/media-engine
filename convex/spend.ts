import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const forDay = query({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const rows = await ctx.db
      .query("spend")
      .withIndex("by_day", (q) => q.eq("day", day))
      .collect();
    const totalPence = rows.reduce((sum, r) => sum + r.costPence, 0);
    const byService: Record<string, number> = {};
    for (const r of rows) byService[r.service] = (byService[r.service] ?? 0) + r.costPence;
    return { totalPence, byService, events: rows.length };
  },
});

export const log = mutation({
  args: {
    day: v.string(),
    service: v.string(),
    model: v.optional(v.string()),
    costPence: v.number(),
    ref: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("spend", { ...args, ts: Date.now() });
  },
});
