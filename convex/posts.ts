import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { postStatus } from "./schema";

export const byStatus = query({
  args: { status: postStatus },
  handler: async (ctx, { status }) => {
    return await ctx.db
      .query("posts")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .take(100);
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db.query("posts").collect();
    const byStatus: Record<string, number> = {};
    const byStream: Record<string, number> = {};
    for (const p of posts) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      byStream[p.streamSlug] = (byStream[p.streamSlug] ?? 0) + 1;
    }
    return { byStatus, byStream, total: posts.length };
  },
});

export const approve = mutation({
  args: { id: v.id("posts") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "approved" });
  },
});

export const reject = mutation({
  args: { id: v.id("posts"), reason: v.optional(v.string()) },
  handler: async (ctx, { id, reason }) => {
    await ctx.db.patch(id, { status: "rejected", error: reason });
  },
});

export const setStatus = mutation({
  args: { id: v.id("posts"), status: postStatus },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

export const attachResult = mutation({
  args: {
    id: v.id("posts"),
    slides: v.array(
      v.object({ r2Key: v.optional(v.string()), url: v.optional(v.string()), prompt: v.string() }),
    ),
  },
  handler: async (ctx, { id, slides }) => {
    await ctx.db.patch(id, { slides, status: "ready", error: undefined });
  },
});

export const fail = mutation({
  args: { id: v.id("posts"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { status: "failed", error });
  },
});

export const create = mutation({
  args: {
    streamSlug: v.string(),
    personaId: v.optional(v.id("personas")),
    platform: v.string(),
    kind: v.union(
      v.literal("carousel"),
      v.literal("reel"),
      v.literal("short"),
      v.literal("image"),
      v.literal("story"),
      v.literal("email"),
    ),
    title: v.optional(v.string()),
    hook: v.optional(v.string()),
    caption: v.optional(v.string()),
    slides: v.optional(
      v.array(v.object({ r2Key: v.optional(v.string()), url: v.optional(v.string()), prompt: v.string() })),
    ),
    scheduledAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("posts", {
      ...args,
      status: "planned",
      createdAt: Date.now(),
    });
  },
});
