import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Campaign = one product/app being marketed. Created from a natural-language
// brief (by Jarvis or the search bar), then enriched with a profile, intel and a
// plan, then executed as a DAG of campaignSteps. Reasoning/infra only.

const categoryV = v.union(
  v.literal("app_launch"),
  v.literal("ecommerce"),
  v.literal("fiverr_service"),
  v.literal("personal_brand"),
  v.literal("saas"),
  v.literal("content"),
  v.literal("other"),
);
const modeV = v.union(v.literal("free"), v.literal("paid"));
const autonomyV = v.union(v.literal("manual"), v.literal("assist"), v.literal("auto"));
const statusV = v.union(
  v.literal("draft"),
  v.literal("researching"),
  v.literal("planned"),
  v.literal("awaiting_approval"),
  v.literal("live"),
  v.literal("paused"),
  v.literal("done"),
  v.literal("failed"),
);

export const create = mutation({
  args: {
    name: v.string(),
    brief: v.string(),
    productUrl: v.optional(v.string()),
    productName: v.optional(v.string()),
    category: v.optional(categoryV),
    mode: v.optional(modeV),
    budgetPence: v.optional(v.number()),
    autonomy: v.optional(autonomyV),
    objective: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    return await ctx.db.insert("campaigns", {
      name: a.name,
      brief: a.brief,
      productUrl: a.productUrl,
      productName: a.productName,
      category: a.category ?? "other",
      mode: a.mode ?? "free",
      budgetPence: a.budgetPence ?? 0,
      spentPence: 0,
      autonomy: a.autonomy ?? "assist",
      status: "draft",
      objective: a.objective,
      personaId: a.personaId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const list = query({
  args: { status: v.optional(statusV), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit }) => {
    const rows = status
      ? await ctx.db.query("campaigns").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("campaigns").collect();
    return rows.sort((x, y) => y.createdAt - x.createdAt).slice(0, limit ?? 50);
  },
});

export const patch = mutation({
  args: {
    id: v.id("campaigns"),
    status: v.optional(statusV),
    plan: v.optional(v.any()),
    profile: v.optional(v.any()),
    objective: v.optional(v.string()),
    category: v.optional(categoryV),
    mode: v.optional(modeV),
    budgetPence: v.optional(v.number()),
    autonomy: v.optional(autonomyV),
    productName: v.optional(v.string()),
    funnelSlug: v.optional(v.string()),
    discountCode: v.optional(v.string()),
    referenceImageKeys: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(id, patch);
  },
});

/** Atomic-ish budget commit. Adds spend and auto-pauses if the cap is hit. */
export const addSpend = mutation({
  args: { id: v.id("campaigns"), costPence: v.number() },
  handler: async (ctx, { id, costPence }) => {
    const c = await ctx.db.get(id);
    if (!c) return { spentPence: 0, capped: false };
    const spentPence = (c.spentPence ?? 0) + costPence;
    const capped = c.mode === "paid" && c.budgetPence > 0 && spentPence >= c.budgetPence;
    await ctx.db.patch(id, { spentPence, updatedAt: Date.now(), ...(capped ? { status: "paused" as const } : {}) });
    return { spentPence, capped };
  },
});

// ── Steps ────────────────────────────────────────────────────────────────────

export const createSteps = mutation({
  args: {
    campaignId: v.id("campaigns"),
    steps: v.array(
      v.object({
        order: v.number(),
        kind: v.string(),
        channel: v.optional(v.string()),
        paid: v.optional(v.boolean()),
        estCostPence: v.optional(v.number()),
        scheduledAt: v.optional(v.number()),
        payload: v.optional(v.any()),
      }),
    ),
  },
  handler: async (ctx, { campaignId, steps }) => {
    const now = Date.now();
    const ALLOWED = new Set([
      "research", "understand", "strategy", "build_funnel", "create_discount",
      "schedule_posts", "cold_email", "influencer_brief", "community_post", "analytics_check", "adjust",
    ]);
    const ids = [];
    for (const s of steps) {
      // Guard against the LLM emitting an off-schema kind (would throw on insert).
      const kind = ALLOWED.has(s.kind) ? s.kind : "adjust";
      ids.push(
        await ctx.db.insert("campaignSteps", {
          campaignId,
          order: s.order,
          kind: kind as never,
          channel: s.channel,
          status: "queued",
          paid: s.paid ?? false,
          estCostPence: s.estCostPence,
          scheduledAt: s.scheduledAt,
          payload: s.payload,
          createdAt: now,
        }),
      );
    }
    return ids;
  },
});

export const steps = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const rows = await ctx.db
      .query("campaignSteps")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    return rows.sort((a, b) => a.order - b.order);
  },
});

/** Queued steps whose scheduledAt (if any) has passed — the tick's work list. */
export const dueSteps = query({
  args: { now: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { now, limit }) => {
    const t = now ?? Date.now();
    const rows = await ctx.db
      .query("campaignSteps")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    return rows.filter((s) => !s.scheduledAt || s.scheduledAt <= t).sort((a, b) => a.order - b.order).slice(0, limit ?? 20);
  },
});

/** Delete a campaign and everything hanging off it (steps, intel, funnel). */
export const remove = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    for (const s of await ctx.db.query("campaignSteps").withIndex("by_campaign", (q) => q.eq("campaignId", id)).collect())
      await ctx.db.delete(s._id);
    for (const r of await ctx.db.query("intelReports").withIndex("by_campaign", (q) => q.eq("campaignId", id)).collect())
      await ctx.db.delete(r._id);
    for (const d of await ctx.db.query("discountCodes").withIndex("by_campaign", (q) => q.eq("campaignId", id)).collect())
      await ctx.db.delete(d._id);
    const c = await ctx.db.get(id);
    if (c?.funnelSlug) {
      const f = await ctx.db.query("funnels").withIndex("by_slug", (q) => q.eq("slug", c.funnelSlug!)).unique();
      if (f) await ctx.db.delete(f._id);
    }
    await ctx.db.delete(id);
  },
});

export const setStepStatus = mutation({
  args: {
    id: v.id("campaignSteps"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("failed"),
      v.literal("skipped"),
      v.literal("blocked"),
    ),
    result: v.optional(v.any()),
    costPence: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(id, patch);
  },
});
