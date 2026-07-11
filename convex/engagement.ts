import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Real engagement snapshots — replaces the deterministic fake like counts on the
// /instagram and /p pages. Fed by the campaign tick pulling platform insights.

export const record = mutation({
  args: {
    postId: v.optional(v.id("posts")),
    campaignId: v.optional(v.id("campaigns")),
    platform: v.string(),
    externalId: v.optional(v.string()),
    impressions: v.optional(v.number()),
    reach: v.optional(v.number()),
    likes: v.optional(v.number()),
    comments: v.optional(v.number()),
    shares: v.optional(v.number()),
    saves: v.optional(v.number()),
    clicks: v.optional(v.number()),
    followersDelta: v.optional(v.number()),
    raw: v.optional(v.any()),
  },
  handler: async (ctx, a) => await ctx.db.insert("engagement", { ...a, ts: Date.now() }),
});

export const forPost = query({
  args: { postId: v.id("posts") },
  handler: async (ctx, { postId }) =>
    (await ctx.db.query("engagement").withIndex("by_post", (q) => q.eq("postId", postId)).collect()).sort((a, b) => b.ts - a.ts),
});

export const forCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) =>
    (await ctx.db.query("engagement").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect()).sort((a, b) => b.ts - a.ts),
});

/** Latest snapshot per post for a campaign — the "real engagement" dashboard feed. */
export const campaignSummary = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const rows = await ctx.db.query("engagement").withIndex("by_campaign", (q) => q.eq("campaignId", campaignId)).collect();
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows.sort((a, b) => a.ts - b.ts)) latest.set(r.externalId ?? String(r.postId ?? r._id), r);
    const snaps = [...latest.values()];
    const sum = (k: "impressions" | "reach" | "likes" | "comments" | "shares" | "saves" | "clicks") =>
      snaps.reduce((t, s) => t + (s[k] ?? 0), 0);
    return {
      posts: snaps.length,
      impressions: sum("impressions"),
      reach: sum("reach"),
      likes: sum("likes"),
      comments: sum("comments"),
      shares: sum("shares"),
      saves: sum("saves"),
      clicks: sum("clicks"),
    };
  },
});
