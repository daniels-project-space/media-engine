import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// Client accounts — the agency spine (the `clients` table). Each client is a
// brand the agency runs; its brandKit is the ground truth all content is planned
// against. Module named `crm` to avoid colliding with clients.ts (Fiverr orders).

const statusV = v.union(v.literal("prospect"), v.literal("active"), v.literal("paused"), v.literal("churned"));

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "client";
}

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    status: v.optional(statusV),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    goals: v.optional(v.string()),
    brandKit: v.optional(v.any()),
    referenceImageKeys: v.optional(v.array(v.string())),
    retainerPence: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    let slug = a.slug ?? slugify(a.name);
    const existing = await ctx.db.query("clients").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (existing) slug = `${slug}-${Math.floor((Date.now() % 100000) / 7)}`;
    const now = Date.now();
    return await ctx.db.insert("clients", {
      name: a.name,
      slug,
      status: a.status ?? "prospect",
      industry: a.industry,
      website: a.website,
      contactEmail: a.contactEmail,
      goals: a.goals,
      brandKit: a.brandKit,
      referenceImageKeys: a.referenceImageKeys,
      retainerPence: a.retainerPence,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { id: v.id("clients") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => await ctx.db.query("clients").withIndex("by_slug", (q) => q.eq("slug", slug)).unique(),
});

export const list = query({
  args: { status: v.optional(statusV) },
  handler: async (ctx, { status }) => {
    const rows = status
      ? await ctx.db.query("clients").withIndex("by_status", (q) => q.eq("status", status)).collect()
      : await ctx.db.query("clients").collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const patch = mutation({
  args: {
    id: v.id("clients"),
    name: v.optional(v.string()),
    status: v.optional(statusV),
    industry: v.optional(v.string()),
    website: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    goals: v.optional(v.string()),
    brandKit: v.optional(v.any()),
    referenceImageKeys: v.optional(v.array(v.string())),
    retainerPence: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...rest }) => {
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    await ctx.db.patch(id, patch);
  },
});

// The per-client workspace: the client + everything scoped to it.
export const workspace = query({
  args: { id: v.id("clients") },
  handler: async (ctx, { id }) => {
    const client = await ctx.db.get(id);
    if (!client) return null;
    const [campaigns, stores, personas] = await Promise.all([
      ctx.db.query("campaigns").collect(),
      ctx.db.query("stores").collect(),
      ctx.db.query("personas").collect(),
    ]);
    const cid = id as Id<"clients">;
    return {
      client,
      campaigns: campaigns.filter((c) => c.clientId === cid).sort((a, b) => b.createdAt - a.createdAt),
      stores: stores.filter((s) => s.clientId === cid),
      personas: personas.filter((p) => p.clientId === cid),
    };
  },
});

export const attachCampaign = mutation({
  args: { campaignId: v.id("campaigns"), clientId: v.id("clients") },
  handler: async (ctx, { campaignId, clientId }) => await ctx.db.patch(campaignId, { clientId }),
});
export const attachStore = mutation({
  args: { storeId: v.id("stores"), clientId: v.id("clients") },
  handler: async (ctx, { storeId, clientId }) => await ctx.db.patch(storeId, { clientId }),
});
export const attachPersona = mutation({
  args: { personaId: v.id("personas"), clientId: v.id("clients") },
  handler: async (ctx, { personaId, clientId }) => await ctx.db.patch(personaId, { clientId }),
});
