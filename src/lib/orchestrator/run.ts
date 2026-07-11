import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { understand } from "./understand";
import { strategise } from "./strategy";
import { keywords, serp } from "../integrations/seo";
import { supportedPlatforms } from "../integrations/social";
import { createDiscount } from "../integrations/discounts";
import type { CampaignPlan } from "./types";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Full launch pipeline, shared by the Trigger task and the API fallback:
//   understand → research → strategise → persist (funnel + discount + steps).
// Every outward effect is gated (dry-run by default); this function only reasons
// and writes to Convex. It never renders an asset.
export async function runLaunch(campaignId: string): Promise<{ status: string; plan?: CampaignPlan }> {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const id = campaignId as Id<"campaigns">;
  const campaign = await cx.query(api.campaigns.get, { id });
  if (!campaign) throw new Error("campaign not found");

  try {
    await cx.mutation(api.campaigns.patch, { id, status: "researching" });

    // 1) Understand the product (pulls real reference stills, no render).
    const profile = await understand({ brief: campaign.brief, productUrl: campaign.productUrl });
    await cx.mutation(api.campaigns.patch, {
      id,
      profile,
      productName: profile.productName,
      category: profile.category,
      referenceImageKeys: profile.referenceImageKeys,
    });

    // 2) Research — keywords + SERP for the top seed terms.
    const seed = profile.keywords[0] ?? profile.productName;
    const [kw, sr] = await Promise.all([keywords(seed), serp(`${profile.productName} ${profile.category}`)]);
    await cx.mutation(api.intel.add, { campaignId: id, kind: "seo", query: seed, data: kw, source: kw.source });
    await cx.mutation(api.intel.add, { campaignId: id, kind: "competitor", query: profile.productName, data: sr, source: sr.source });
    const intelSummary = [
      `Keywords (${kw.source}): ${kw.data.slice(0, 12).map((k) => `${k.keyword}${k.volume ? ` (${k.volume}/mo)` : ""}`).join(", ") || kw.note}`,
      `SERP (${sr.source}): ${sr.data.slice(0, 6).map((s) => s.title).join(" | ") || sr.note}`,
    ].join("\n");

    // 3) Strategise, grounded in playbooks + existing models.
    const [playbooks, models, platforms] = await Promise.all([
      cx.query(api.playbooks.list, {}),
      cx.query(api.models.list, {}),
      supportedPlatforms(),
    ]);
    const personas = await cx.query(api.personas.list, {});
    const plan = await strategise({
      profile,
      intelSummary,
      mode: campaign.mode,
      budgetPence: campaign.budgetPence,
      autonomy: campaign.autonomy,
      playbooks: playbooks.map((p) => ({ category: p.category, title: p.title, description: p.description, bestPractices: p.bestPractices })),
      availableModels: models.map((m) => ({
        name: m.name,
        trigger: m.trigger,
        personaHandle: personas.find((pp) => pp._id === m.personaId)?.handle,
      })),
      availablePlatforms: platforms,
    });

    // 4) Persist funnel (DB-driven landing page — no page asset generated).
    const funnelSlug = plan.funnel.slug;
    await cx.mutation(api.funnels.upsert, {
      slug: funnelSlug,
      campaignId: id,
      productName: profile.productName,
      headline: plan.funnel.headline,
      subhead: plan.funnel.subhead,
      valueProps: plan.funnel.valueProps ?? [],
      ctaText: plan.funnel.ctaText ?? "Get started",
      ctaUrl: campaign.productUrl ?? "#",
      discountCode: plan.discount?.code,
      discountBlurb: plan.funnel.discountBlurb ?? plan.discount?.blurb,
      heroImageKey: profile.referenceImageKeys[0],
      referenceImageKeys: profile.referenceImageKeys,
      captureEmail: true,
      published: false,
    });

    // 5) Discount (gated — dry-run mints nothing but records the code for preview).
    if (plan.discount?.code) {
      const res = await createDiscount({
        code: plan.discount.code,
        percentOff: plan.discount.percentOff,
        amountOffPence: plan.discount.amountOffPence,
        maxRedemptions: 500,
      });
      await cx.mutation(api.discounts.record, {
        code: plan.discount.code,
        campaignId: id,
        provider: "stripe",
        kind: plan.discount.percentOff ? "percent" : "amount",
        percentOff: plan.discount.percentOff,
        amountOffPence: plan.discount.amountOffPence,
        externalId: res.data?.externalId,
      });
    }

    // 6) Persist the step DAG (scheduled relative to launch).
    const launchAt = Date.now();
    await cx.mutation(api.campaigns.createSteps, {
      campaignId: id,
      steps: (plan.steps ?? []).map((s) => ({
        order: s.order,
        kind: s.kind,
        channel: s.channel,
        paid: s.paid,
        estCostPence: s.estCostPence,
        scheduledAt: s.scheduledOffsetHours != null ? launchAt + s.scheduledOffsetHours * 3600_000 : undefined,
        payload: { label: s.label, ...(s.payload ?? {}) },
      })),
    });

    // 7) Set final status by autonomy. auto → live; else await sign-off.
    const status = campaign.autonomy === "auto" ? "live" : "awaiting_approval";
    await cx.mutation(api.campaigns.patch, { id, plan, funnelSlug, discountCode: plan.discount?.code, status });
    return { status, plan };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await cx.mutation(api.campaigns.patch, { id, status: "failed", error: msg });
    throw e;
  }
}
