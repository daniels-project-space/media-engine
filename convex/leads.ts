import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const stage = v.union(
  v.literal("new"),
  v.literal("qualifying"),
  v.literal("sample"),
  v.literal("quoted"),
  v.literal("won"),
  v.literal("lost"),
);

export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("leads").order("desc").collect(),
});

export const get = query({
  args: { id: v.id("leads") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

// Public intake — from a landing-page form. Starts at "new".
export const create = mutation({
  args: {
    service: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    brandLink: v.optional(v.string()),
    budget: v.optional(v.string()),
    timeline: v.optional(v.string()),
    message: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("leads", {
      ...args,
      source: args.source ?? "landing",
      stage: "new",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("leads"),
    stage: v.optional(stage),
    draftReply: v.optional(v.string()),
    sampleKey: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("leads").collect();
    const open = all.filter((l) => l.stage !== "won" && l.stage !== "lost").length;
    const won = all.filter((l) => l.stage === "won").length;
    return { total: all.length, open, won };
  },
});
