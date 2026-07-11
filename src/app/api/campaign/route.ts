import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { vaultService } from "@/lib/vault";
import { runLaunch } from "@/lib/orchestrator/run";

export const maxDuration = 120;

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// The Jarvis intake. POST a natural-language brief → a campaign is created and
// the launch pipeline runs (Trigger task, or inline if no Trigger key). GET
// returns full campaign state (plan, steps, funnel, intel, engagement).

async function dispatch(taskId: string, payload: unknown): Promise<string | null> {
  try {
    const { TRIGGER_SECRET_KEY_MEDIA_ENGINE } = await vaultService("trigger");
    if (!TRIGGER_SECRET_KEY_MEDIA_ENGINE) return null;
    const r = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
      method: "POST",
      headers: { authorization: `Bearer ${TRIGGER_SECRET_KEY_MEDIA_ENGINE}`, "content-type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { id?: string };
    return data.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    brief?: string;
    productUrl?: string;
    name?: string;
    mode?: "free" | "paid";
    budgetPence?: number;
    autonomy?: "manual" | "assist" | "auto";
    inline?: boolean;
  };
  if (!body.brief || body.brief.trim().length < 4) {
    return NextResponse.json({ error: "brief is required" }, { status: 400 });
  }
  const cx = new ConvexHttpClient(CONVEX_URL);
  const name = body.name ?? body.brief.slice(0, 60);
  const campaignId = await cx.mutation(api.campaigns.create, {
    name,
    brief: body.brief,
    productUrl: body.productUrl,
    mode: body.mode ?? "free",
    budgetPence: body.budgetPence ?? 0,
    autonomy: body.autonomy ?? "assist",
  });

  // Prefer async Trigger dispatch; fall back to running inline so the engine
  // works even without a Trigger key (e.g. local/dev, or first-run testing).
  let runId: string | null = null;
  if (!body.inline) runId = await dispatch("launch-campaign", { campaignId });
  if (!runId) {
    try {
      await runLaunch(campaignId);
    } catch (e) {
      return NextResponse.json(
        { campaignId, error: e instanceof Error ? e.message : String(e) },
        { status: 200 },
      );
    }
  }
  return NextResponse.json({ campaignId, runId, dispatched: Boolean(runId) });
}

export async function GET(req: NextRequest) {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    const campaigns = await cx.query(api.campaigns.list, {});
    return NextResponse.json({ campaigns });
  }
  const cid = id as Id<"campaigns">;
  const [campaign, steps, intel, engagement] = await Promise.all([
    cx.query(api.campaigns.get, { id: cid }),
    cx.query(api.campaigns.steps, { campaignId: cid }),
    cx.query(api.intel.forCampaign, { campaignId: cid }),
    cx.query(api.engagement.campaignSummary, { campaignId: cid }),
  ]);
  const funnel = campaign?.funnelSlug ? await cx.query(api.funnels.getBySlug, { slug: campaign.funnelSlug }) : null;
  return NextResponse.json({ campaign, steps, intel, engagement, funnel });
}
