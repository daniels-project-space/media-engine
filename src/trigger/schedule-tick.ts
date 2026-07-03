import { schedules, logger, tasks } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { vaultService } from "../lib/vault";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const MAX_GENERATIONS_PER_TICK = 3;
const MAX_PUBLISHES_PER_TICK = 3;

// The autopilot heartbeat. Every 30 minutes:
// 1. Planned posts due soon on ACTIVE streams -> start generation.
// 2. Ready posts on ACTIVE + fully-automatic streams -> auto-approve.
// 3. Approved posts due on ACTIVE streams with a LINKED account -> publish.
// Approval-gated streams stop at "ready" and wait for Daniel in the queue.
export const scheduleTick = schedules.task({
  id: "schedule-tick",
  cron: "*/30 * * * *",
  maxDuration: 300,
  run: async () => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const now = Date.now();
    const soon = now + 60 * 60 * 1000;

    const streams = await convex.query(api.streams.list, {});
    const active = new Map(streams.filter((s) => s.status === "active").map((s) => [s.slug, s]));
    if (active.size === 0) {
      logger.log("no active streams — idle tick");
      return { generated: 0, approved: 0, published: 0 };
    }

    let generated = 0;
    const planned = await convex.query(api.posts.due, { status: "planned", before: soon });
    for (const p of planned) {
      if (generated >= MAX_GENERATIONS_PER_TICK) break;
      if (!active.has(p.streamSlug)) continue;
      await tasks.trigger("generate-carousel", { postId: p._id });
      generated++;
    }

    let approved = 0;
    const ready = await convex.query(api.posts.byStatus, { status: "ready" });
    for (const p of ready) {
      const stream = active.get(p.streamSlug);
      if (!stream || stream.autonomy !== "auto") continue;
      await convex.mutation(api.posts.approve, { id: p._id });
      approved++;
    }

    let published = 0;
    const accounts = await convex.query(api.accounts.list, {});
    const duePosts = await convex.query(api.posts.due, { status: "approved", before: now });
    for (const p of duePosts) {
      if (published >= MAX_PUBLISHES_PER_TICK) break;
      if (!active.has(p.streamSlug)) continue;
      const account = accounts.find(
        (a) => a.platform === p.platform && (!p.personaId || a.personaId === p.personaId),
      );
      if (!account?.tokenKey) continue; // account not linked yet — leave post in approved
      const secrets = await vaultService(account.tokenService ?? "media-engine-accounts");
      if (!secrets[account.tokenKey]) continue;
      await tasks.trigger("publish-post", { postId: p._id });
      published++;
    }

    logger.log("tick", { generated, approved, published });
    return { generated, approved, published };
  },
});
