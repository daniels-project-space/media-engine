import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Products synced from a store, each carrying its product-aware `channelPlan`.

const productArgs = {
  externalId: v.string(),
  title: v.string(),
  handle: v.optional(v.string()),
  productType: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  pricePence: v.optional(v.number()),
  currency: v.optional(v.string()),
  imageUrls: v.optional(v.array(v.string())),
  imageKeys: v.optional(v.array(v.string())),
  collections: v.optional(v.array(v.string())),
  status: v.optional(v.string()),
  channelPlan: v.optional(v.any()),
};

/** Replace a store's product set with a fresh sync (upsert by externalId). */
export const bulkUpsert = mutation({
  args: { storeId: v.id("stores"), products: v.array(v.object(productArgs)) },
  handler: async (ctx, { storeId, products }) => {
    const existing = await ctx.db.query("products").withIndex("by_store", (q) => q.eq("storeId", storeId)).collect();
    const byExt = new Map(existing.map((p) => [p.externalId, p]));
    const now = Date.now();
    let upserts = 0;
    for (const p of products) {
      const cur = byExt.get(p.externalId);
      if (cur) await ctx.db.patch(cur._id, { ...p, updatedAt: now });
      else await ctx.db.insert("products", { storeId, ...p, createdAt: now, updatedAt: now });
      upserts++;
    }
    return { upserts };
  },
});

export const forStore = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, { storeId }) => await ctx.db.query("products").withIndex("by_store", (q) => q.eq("storeId", storeId)).collect(),
});

export const get = query({
  args: { id: v.id("products") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const count = query({
  args: { storeId: v.id("stores") },
  handler: async (ctx, { storeId }) => (await ctx.db.query("products").withIndex("by_store", (q) => q.eq("storeId", storeId)).collect()).length,
});
