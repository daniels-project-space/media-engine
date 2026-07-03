import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("accounts").collect();
  },
});

export const update = mutation({
  args: {
    id: v.id("accounts"),
    status: v.optional(
      v.union(v.literal("unlinked"), v.literal("warming"), v.literal("active"), v.literal("banned")),
    ),
    tokenService: v.optional(v.string()),
    tokenKey: v.optional(v.string()),
    meta: v.optional(v.any()),
    handle: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});
