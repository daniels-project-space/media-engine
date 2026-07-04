import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const tier = v.union(v.literal("basic"), v.literal("standard"), v.literal("premium"));
const status = v.union(
  v.literal("new"),
  v.literal("in_progress"),
  v.literal("delivered"),
  v.literal("revision"),
  v.literal("complete"),
  v.literal("cancelled"),
);

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("clientOrders").order("desc").collect();
    const posts = await ctx.db.query("posts").collect();
    return orders.map((o) => {
      // Explicit link, else auto-resolve by the concept tag the client-ad job stamps
      // (concept = "order-<id>") — no coupling between the ad task and orders.
      const tag = `order-${o._id}`;
      const delivery =
        (o.deliveryPostId && posts.find((p) => p._id === o.deliveryPostId)) ||
        posts
          .filter((p) => p.concept === tag && (p.slides ?? []).some((s) => s.r2Key))
          .sort((a, b) => b.createdAt - a.createdAt)[0] ||
        null;
      return { ...o, delivery };
    });
  },
});

export const create = mutation({
  args: {
    buyer: v.string(),
    source: v.string(),
    tier,
    brief: v.string(),
    productImageKey: v.optional(v.string()),
    pricePence: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clientOrders", { ...args, status: "new", createdAt: Date.now() });
  },
});

export const update = mutation({
  args: {
    id: v.id("clientOrders"),
    status: v.optional(status),
    brief: v.optional(v.string()),
    tier: v.optional(tier),
    pricePence: v.optional(v.number()),
    costPence: v.optional(v.number()),
    deliveryPostId: v.optional(v.id("posts")),
    productImageKey: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const remove = mutation({
  args: { id: v.id("clientOrders") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// Summary stats for the clients dashboard header.
export const stats = query({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query("clientOrders").collect();
    const revenue = orders.reduce((s, o) => s + (o.pricePence ?? 0), 0);
    const cost = orders.reduce((s, o) => s + (o.costPence ?? 0), 0);
    const open = orders.filter((o) => o.status === "new" || o.status === "in_progress" || o.status === "revision").length;
    return { total: orders.length, open, revenuePence: revenue, costPence: cost };
  },
});
