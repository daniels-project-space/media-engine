import { query } from "./_generated/server";
import { v } from "convex/values";

function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// Aggregates for the analytics page. `days` = ordered list of YYYY-MM-DD strings
// (client-computed so server stays deterministic).
export const overview = query({
  args: { days: v.array(v.string()) },
  handler: async (ctx, { days }) => {
    const daySet = new Set(days);
    const posts = await ctx.db.query("posts").collect();
    const spend = await ctx.db.query("spend").collect();
    const streams = await ctx.db.query("streams").collect();

    const postsPerDay: Record<string, Record<string, number>> = {};
    for (const d of days) postsPerDay[d] = {};
    for (const p of posts) {
      const d = dayOf(p.createdAt);
      if (!daySet.has(d)) continue;
      postsPerDay[d][p.status] = (postsPerDay[d][p.status] ?? 0) + 1;
    }

    const spendPerDay: Record<string, number> = {};
    for (const d of days) spendPerDay[d] = 0;
    for (const s of spend) {
      if (daySet.has(s.day)) spendPerDay[s.day] += s.costPence;
    }

    const perStream = streams.map((s) => ({
      slug: s.slug,
      name: s.name,
      status: s.status,
      total: posts.filter((p) => p.streamSlug === s.slug).length,
      published: posts.filter((p) => p.streamSlug === s.slug && p.status === "published").length,
      ready: posts.filter((p) => p.streamSlug === s.slug && p.status === "ready").length,
      failed: posts.filter((p) => p.streamSlug === s.slug && p.status === "failed").length,
    }));

    return {
      postsPerDay,
      spendPerDay,
      perStream,
      totals: {
        posts: posts.length,
        spendPence: spend.reduce((a, b) => a + b.costPence, 0),
      },
    };
  },
});
