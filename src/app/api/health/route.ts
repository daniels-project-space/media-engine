import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { vaultTry } from "@/lib/integrations/gate";

export const maxDuration = 20;
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// Engine health — no LLM spend. Reports whether the brain is reachable (CLI on
// the VPS and/or the subscription API token), the master switches, and recent
// failures. Used by the autonomy worker + a status view.
export async function GET() {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const out: Record<string, unknown> = { ok: false, at: new Date().toISOString() };

  // Brain availability (no calls made).
  const cli = existsSync(process.env.CLAUDE_CLI ?? "/usr/bin/claude");
  const anthropic = await vaultTry("anthropic");
  const apiToken = Boolean(anthropic.ANTHROPIC_AUTH_TOKEN || anthropic.ANTHROPIC_API_KEY);
  out.brain = { cli, apiToken, ready: cli || apiToken };

  try {
    const settings = (await cx.query(api.settings.all, {})) as Record<string, unknown>;
    out.convex = true;
    out.aiEnabled = settings.aiEnabled !== false;
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
    out.ok = Boolean((cli || apiToken) && (settings.aiEnabled !== false));
  } catch (e) {
    out.convex = false;
    out.error = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(out);
}
