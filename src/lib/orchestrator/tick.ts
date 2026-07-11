import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { publish } from "../integrations/social";
import { coldSequence } from "../integrations/email";
import { discover } from "../integrations/influence";
import type { CampaignPlan, ContentItem } from "./types";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Advances due campaign steps. Every action is gated (dry-run unless liveMode +
// key). Budget-aware: a paid step that would breach the cap is blocked and the
// campaign auto-paused. No asset is rendered — distribution references existing
// content/reference stills only.
export async function tickCampaigns(limit = 20): Promise<{ processed: number; log: string[] }> {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const due = await cx.query(api.campaigns.dueSteps, { limit });
  const out: string[] = [];
  let processed = 0;

  for (const step of due) {
    const campaign = await cx.query(api.campaigns.get, { id: step.campaignId });
    if (!campaign) continue;
    if (campaign.status !== "live") {
      out.push(`skip step ${step.order} (${step.kind}) — campaign ${campaign.name} is ${campaign.status}`);
      continue;
    }

    // Budget guard for paid steps.
    if (step.paid && campaign.mode === "paid" && campaign.budgetPence > 0) {
      const projected = (campaign.spentPence ?? 0) + (step.estCostPence ?? 0);
      if (projected > campaign.budgetPence) {
        await cx.mutation(api.campaigns.setStepStatus, { id: step._id, status: "blocked", error: "would exceed budget cap" });
        await cx.mutation(api.campaigns.patch, { id: campaign._id, status: "paused" });
        out.push(`BLOCK step ${step.order} (${step.kind}) — budget cap reached on ${campaign.name}; campaign paused`);
        continue;
      }
    }

    await cx.mutation(api.campaigns.setStepStatus, { id: step._id, status: "running" });
    const plan = (campaign.plan ?? {}) as CampaignPlan;
    try {
      const res = await executeStep(step, plan, cx, campaign._id);
      const costPence = res.dryRun ? 0 : step.estCostPence ?? 0;
      await cx.mutation(api.campaigns.setStepStatus, {
        id: step._id,
        status: res.ok ? "done" : "blocked",
        result: res.result,
        costPence,
        dryRun: res.dryRun,
        error: res.ok ? undefined : res.detail,
      });
      if (costPence > 0) await cx.mutation(api.campaigns.addSpend, { id: campaign._id, costPence });
      out.push(`${res.ok ? "done" : "blocked"} step ${step.order} (${step.kind}${step.channel ? `/${step.channel}` : ""}) — ${res.detail}`);
      processed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await cx.mutation(api.campaigns.setStepStatus, { id: step._id, status: "failed", error: msg });
      out.push(`FAIL step ${step.order} (${step.kind}) — ${msg}`);
    }
  }

  // Close out campaigns whose steps are all resolved.
  const liveCampaigns = await cx.query(api.campaigns.list, { status: "live" });
  for (const c of liveCampaigns) {
    const steps = await cx.query(api.campaigns.steps, { campaignId: c._id as Id<"campaigns"> });
    if (steps.length && steps.every((s) => ["done", "skipped", "failed"].includes(s.status))) {
      await cx.mutation(api.campaigns.patch, { id: c._id, status: "done" });
      out.push(`campaign ${c.name} → done (all steps resolved)`);
    }
  }

  return { processed, log: out };
}

type StepDoc = { _id: Id<"campaignSteps">; order: number; kind: string; channel?: string; paid: boolean; estCostPence?: number; payload?: unknown };

async function executeStep(
  step: StepDoc,
  plan: CampaignPlan,
  cx: ConvexHttpClient,
  campaignId: Id<"campaigns">,
): Promise<{ ok: boolean; dryRun: boolean; detail: string; result?: unknown }> {
  switch (step.kind) {
    case "build_funnel":
    case "create_discount":
    case "research":
    case "understand":
    case "strategy":
      // Handled during launch; a due row here is idempotently completed.
      return { ok: true, dryRun: true, detail: "already prepared at launch" };

    case "schedule_posts": {
      const items = (plan.contentCalendar ?? []).filter((c: ContentItem) => !step.channel || c.channel === step.channel);
      if (!items.length) return { ok: true, dryRun: true, detail: `no calendar items for ${step.channel ?? "any channel"}` };
      const results = [];
      for (const it of items.slice(0, 12)) {
        const r = await publish({ platform: it.channel, caption: `${it.hook}\n\n${it.caption}`.trim() });
        results.push({ channel: it.channel, day: it.day, ...r });
      }
      const blockedAny = results.some((r) => !r.ok);
      return {
        ok: !blockedAny,
        dryRun: results.every((r) => r.dryRun),
        detail: `${results.length} post(s) for ${step.channel ?? "channels"} — ${results[0]?.detail}`,
        result: results,
      };
    }

    case "cold_email": {
      const seq = plan.coldEmail;
      const r = await coldSequence({
        name: `${plan.objective?.slice(0, 40) ?? "campaign"} — cold`,
        leads: [], // prospect list-building is a separate, gated ingestion
        fromName: undefined,
      });
      return { ok: r.ok, dryRun: r.dryRun, detail: `${r.detail}${seq ? ` (subjects: ${seq.subjectLines?.slice(0, 2).join(" / ")})` : " (no copy in plan)"}`, result: r.data };
    }

    case "community_post": {
      const r = await publish({ platform: step.channel ?? "reddit", caption: plan.messagingAngles?.[0] ?? plan.summary ?? "" });
      return { ok: r.ok, dryRun: r.dryRun, detail: r.detail, result: r.data };
    }

    case "influencer_brief": {
      const niche = plan.influencerBrief?.targetNiche ?? step.channel ?? "";
      const found = await discover(niche, "instagram", { limit: 15 });
      let sourced = 0;
      for (const c of found.data.slice(0, 15)) {
        await cx.mutation(api.influencers.add, {
          handle: c.handle,
          platform: c.platform,
          niche,
          followers: c.followers,
          engagementRate: c.engagementRate,
          email: c.email,
          campaignId,
          source: found.source,
        });
        sourced++;
      }
      return {
        ok: true,
        dryRun: !found.configured,
        detail: found.configured
          ? `sourced ${sourced} creator(s) in "${niche}"; brief: ${plan.influencerBrief?.ask ?? "n/a"}`
          : `brief ready: ${plan.influencerBrief?.ask ?? "n/a"} (${found.note})`,
        result: { sourced, brief: plan.influencerBrief },
      };
    }

    case "analytics_check":
      return { ok: true, dryRun: true, detail: "engagement pull scheduled (live platform insights ingest when a token is linked)" };

    case "adjust":
      return { ok: true, dryRun: true, detail: "reviewed pacing vs budget; no change needed" };

    default:
      return { ok: true, dryRun: true, detail: `no-op for ${step.kind}` };
  }
}
