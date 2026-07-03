import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const personas = await ctx.db.query("personas").collect();
    const accounts = await ctx.db.query("accounts").collect();
    return personas.map((p) => ({
      ...p,
      accounts: accounts.filter((a) => a.personaId === p._id),
    }));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    handle: v.string(),
    archetype: v.union(v.literal("flagship"), v.literal("faceless")),
    globalLock: v.string(),
    bio: v.optional(v.string()),
    niche: v.optional(v.string()),
    streamSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("personas", {
      ...args,
      stage: "grow",
      createdAt: Date.now(),
    });
  },
});

export const setStage = mutation({
  args: {
    id: v.id("personas"),
    stage: v.union(v.literal("grow"), v.literal("brand_ready"), v.literal("monetized")),
  },
  handler: async (ctx, { id, stage }) => {
    await ctx.db.patch(id, { stage });
  },
});
