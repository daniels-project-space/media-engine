import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const shot = v.object({
  kind: v.optional(v.string()),
  imagePrompt: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  imageKey: v.optional(v.string()),
  motion: v.string(),
  seconds: v.number(),
  onText: v.optional(v.string()),
  cardTitle: v.optional(v.string()),
  cardSub: v.optional(v.string()),
});

const stage = v.union(
  v.literal("scripting"),
  v.literal("script_ready"),
  v.literal("drafting"),
  v.literal("draft_ready"),
  v.literal("rendering"),
  v.literal("final_ready"),
  v.literal("failed"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("adProjects").order("desc").collect();
    const posts = await ctx.db.query("posts").collect();
    const byConcept = (tag: string) =>
      posts.filter((x) => x.concept === tag).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    return projects.map((p) => ({
      ...p,
      // Explicit link, else resolve the render posts by the concept tag the studio
      // render stamps (studio-<id>-draft / studio-<id>-final) — no coupling / polling.
      draft: (p.draftPostId && posts.find((x) => x._id === p.draftPostId)) || byConcept(`studio-${p._id}-draft`),
      final: (p.finalPostId && posts.find((x) => x._id === p.finalPostId)) || byConcept(`studio-${p._id}-final`),
    }));
  },
});

export const get = query({
  args: { id: v.id("adProjects") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const create = mutation({
  args: {
    buyer: v.string(),
    title: v.string(),
    brief: v.string(),
    orderId: v.optional(v.id("clientOrders")),
    musicPrompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("adProjects", { ...args, stage: "scripting", createdAt: Date.now() });
  },
});

// Save the generated / hand-edited script and move to the review gate.
export const setScript = mutation({
  args: {
    id: v.id("adProjects"),
    shots: v.array(shot),
    hook: v.optional(v.string()),
    caption: v.optional(v.string()),
  },
  handler: async (ctx, { id, shots, hook, caption }) => {
    await ctx.db.patch(id, { shots, hook, caption, stage: "script_ready", error: undefined });
  },
});

export const setStage = mutation({
  args: { id: v.id("adProjects"), stage, error: v.optional(v.string()) },
  handler: async (ctx, { id, stage: s, error }) => {
    await ctx.db.patch(id, { stage: s, error });
  },
});

export const attachDraft = mutation({
  args: { id: v.id("adProjects"), draftPostId: v.id("posts"), shots: v.optional(v.array(shot)) },
  handler: async (ctx, { id, draftPostId, shots }) => {
    const patch: Record<string, unknown> = { draftPostId, stage: "draft_ready" };
    if (shots) patch.shots = shots; // store the approved images (imageKey) for the 4K reuse
    await ctx.db.patch(id, patch);
  },
});

export const attachFinal = mutation({
  args: { id: v.id("adProjects"), finalPostId: v.id("posts") },
  handler: async (ctx, { id, finalPostId }) => {
    await ctx.db.patch(id, { finalPostId, stage: "final_ready" });
  },
});

export const remove = mutation({
  args: { id: v.id("adProjects") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
