import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Model / LoRA registry — view and add trained looks. Personas point at these.
// This is a catalogue, not a trainer: no asset is generated here.

const kindV = v.union(v.literal("lora"), v.literal("checkpoint"), v.literal("base"));
const providerV = v.union(
  v.literal("fal"),
  v.literal("higgsfield"),
  v.literal("replicate"),
  v.literal("local"),
  v.literal("other"),
);

export const create = mutation({
  args: {
    name: v.string(),
    kind: kindV,
    provider: providerV,
    url: v.optional(v.string()),
    trigger: v.optional(v.string()),
    baseModel: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    previewKeys: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => await ctx.db.insert("models", { ...a, status: "active", createdAt: Date.now() }),
});

export const list = query({
  args: { kind: v.optional(kindV) },
  handler: async (ctx, { kind }) => {
    const rows = kind
      ? await ctx.db.query("models").withIndex("by_kind", (q) => q.eq("kind", kind)).collect()
      : await ctx.db.query("models").collect();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const get = query({
  args: { id: v.id("models") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const setStatus = mutation({
  args: { id: v.id("models"), status: v.union(v.literal("active"), v.literal("archived"), v.literal("training")) },
  handler: async (ctx, { id, status }) => await ctx.db.patch(id, { status }),
});
