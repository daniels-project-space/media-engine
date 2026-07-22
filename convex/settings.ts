import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireAuthenticatedAiEnable } from "./settings_access";

export const all = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("settings").collect();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
});

// AI generation kill switch — default OFF. Only an explicit boolean true enables
// provider-backed generation; missing or malformed values remain paused.
export const aiEnabled = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "aiEnabled")).unique();
    return row?.value === true;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    // Public Convex mutations are callable without passing through the Next
    // UI. The exact boolean `true` is the only setting value that permits
    // generation, so require an authenticated owner session before writing it.
    // A caller may always force the switch off; that retains an emergency
    // stop even if the identity provider is unavailable.
    requireAuthenticatedAiEnable(key, value, (await ctx.auth.getUserIdentity()) !== null);

    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { value });
    else await ctx.db.insert("settings", { key, value });
  },
});
