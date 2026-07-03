import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { streamKind } from "./schema";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("streams").collect();
  },
});

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    kind: streamKind,
    goal: v.string(),
    autonomy: v.union(v.literal("auto"), v.literal("approve")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("streams")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) throw new Error(`stream ${args.slug} already exists`);
    return await ctx.db.insert("streams", {
      ...args,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("streams"),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("draft")),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

export const setAutonomy = mutation({
  args: {
    id: v.id("streams"),
    autonomy: v.union(v.literal("auto"), v.literal("approve")),
  },
  handler: async (ctx, { id, autonomy }) => {
    await ctx.db.patch(id, { autonomy });
  },
});
