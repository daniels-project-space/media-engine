import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

export const maxDuration = 20;
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// Engine health — no LLM spend. Codex work runs only in the pinned Trigger
// worker, never in this Vercel route, so this reports configuration not auth.
export async function GET() {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const out: Record<string, unknown> = { ok: false, at: new Date().toISOString() };

  // Brain availability (no calls made).
  out.brain = { runtime: "Trigger Codex CLI", ready: Boolean(process.env.CODEX_CLI) };

  try {
    const settings = (await cx.query(api.settings.all, {})) as Record<string, unknown>;
    out.convex = true;
    out.aiEnabled = settings.aiEnabled === true;
    out.liveMode = Boolean(settings.liveMode);
    out.socialProvider = settings.socialProvider ?? "ayrshare";

    const [postCounts, campaigns, failedPosts] = await Promise.all([
      cx.query(api.posts.counts, {}),
      cx.query(api.campaigns.list, {}),
      cx.query(api.posts.byStatus, { status: "failed" }),
    ]);
    out.posts = postCounts;
    const byStatus: Record<string, number> = {};
    for (const c of campaigns) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    out.campaigns = { total: campaigns.length, byStatus };
    out.recentFailures = [
      ...failedPosts.slice(0, 5).map((p) => ({ kind: "post", title: p.title, error: p.error })),
      ...campaigns.filter((c) => c.status === "failed").slice(0, 5).map((c) => ({ kind: "campaign", name: c.name, error: c.error })),
    ];
    out.ok = Boolean(settings.aiEnabled === true);
  } catch (e) {
    out.convex = false;
    out.error = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(out);
}
