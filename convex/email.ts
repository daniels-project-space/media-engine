import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const subscribe = mutation({
  args: {
    email: v.string(),
    source: v.string(),
    personaHandle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid email");
    const existing = await ctx.db
      .query("emailContacts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      if (existing.status === "unsubscribed") await ctx.db.patch(existing._id, { status: "subscribed" });
      return { ok: true, existing: true };
    }
    await ctx.db.insert("emailContacts", {
      email,
      source: args.source,
      personaHandle: args.personaHandle,
      tags: args.personaHandle ? [args.personaHandle] : [],
      status: "subscribed",
      createdAt: Date.now(),
    });
    return { ok: true, existing: false };
  },
});

export const contacts = query({
  args: { tag: v.optional(v.string()) },
  handler: async (ctx, { tag }) => {
    const all = await ctx.db.query("emailContacts").collect();
    return all.filter((c) => c.status === "subscribed" && (!tag || c.tags.includes(tag)));
  },
});

export const unsubscribe = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const existing = await ctx.db
      .query("emailContacts")
      .withIndex("by_email", (q) => q.eq("email", email.trim().toLowerCase()))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { status: "unsubscribed" });
    return { ok: true };
  },
});
