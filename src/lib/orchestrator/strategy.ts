import { agentJson } from "../../mastra/brain";
import type { ProductProfile, CampaignPlan } from "./types";

// The strategist. Turns a ProductProfile + market intel + budget/mode into a
// full CampaignPlan: channel mix, a dated content calendar (what content is
// NEEDED — referencing existing personas/models, never a render request), a
// funnel spec, discount, cold-email + influencer briefs, KPIs, and an ordered
// step DAG the executor will run (gated). Free mode omits all paid steps.

export type StrategyInput = {
  profile: ProductProfile;
  intelSummary: string; // condensed keywords/SERP/competitor findings
  productContext?: string; // real store catalogue + per-product channel mapping
  mode: "free" | "paid";
  budgetPence: number;
  autonomy: "manual" | "assist" | "auto";
  playbooks: { category: string; title: string; description: string; bestPractices: string[] }[];
  availableModels: { name: string; trigger?: string; personaHandle?: string }[];
  availablePlatforms: string[];
  durationDays?: number;
};

export async function strategise(input: StrategyInput): Promise<CampaignPlan> {
  const {
    profile,
    intelSummary,
    productContext,
    mode,
    budgetPence,
    playbooks,
    availableModels,
    availablePlatforms,
    durationDays = 14,
  } = input;

  const pounds = (budgetPence / 100).toFixed(2);
  const playbookBlock = playbooks
    .map((p) => `• [${p.category}] ${p.title}: ${p.description} Best practices: ${p.bestPractices.slice(0, 4).join("; ")}`)
    .join("\n");
  const modelBlock = availableModels.length
    ? availableModels.map((m) => `• ${m.name}${m.trigger ? ` (trigger "${m.trigger}")` : ""}${m.personaHandle ? ` — persona ${m.personaHandle}` : ""}`).join("\n")
    : "none registered";

  const plan = await agentJson<CampaignPlan>("strategist", {
    system:
      "You are the head of strategy at a dynamic AI ad agency. You design complete, launch-ready campaigns that a semi-autonomous system will execute. You are pragmatic about budget and deliverability, and you ground messaging in the supplied playbooks. Return ONLY a JSON object.",
    user: `PRODUCT PROFILE:\n${JSON.stringify(profile, null, 2)}\n\nMARKET INTEL:\n${intelSummary || "none gathered"}\n${productContext ? `\nPRODUCT CATALOGUE (real store — plan for THESE products on the channels each fits; treat the channel mapping as authoritative):\n${productContext}\n` : ""}\nPLAYBOOKS AVAILABLE (ground your tactics/copy in these):\n${playbookBlock}\n\nEXISTING MODELS/LORAS you may reference for visual content (do NOT invent new ones, do NOT request renders — just name which to use):\n${modelBlock}\n\nCONSTRAINTS:\n- Mode: ${mode.toUpperCase()}. ${mode === "free" ? "Use ONLY free/organic channels (organic social, SEO, community, cold email on owned lists). Every step MUST have paid:false and estCostPence:0." : `Paid allowed up to a HARD cap of £${pounds}. Allocate paid budget across channels; total of budgetSplit MUST NOT exceed ${budgetPence} pence.`}\n- Platforms the poster can reach: ${availablePlatforms.join(", ")}.\n- Duration: ${durationDays} days.\n- Content calendar describes what to POST; it references existing models by name and never asks to render new assets.\n\nReturn a JSON object with EXACTLY these keys:\n{\n  "objective": string,\n  "summary": string,\n  "channelMix": [{ "channel": string, "role": string, "paid": boolean, "weight": number }],\n  "budgetSplit": [{ "channel": string, "pence": number }],\n  "contentCalendar": [{ "day": number, "channel": string, "format": string, "angle": string, "caption": string, "hook": string, "usesModel": string, "referenceKey": string }],\n  "funnel": { "slug": string(kebab-case), "headline": string, "subhead": string, "valueProps": [{ "header": string, "body": string }], "ctaText": string, "discountBlurb": string },\n  "discount": { "code": string(UPPERCASE), "percentOff": number, "blurb": string },\n  "messagingAngles": string[],\n  "coldEmail": { "subjectLines": string[], "body": string, "targetDescription": string },\n  "influencerBrief": { "targetNiche": string, "ask": string, "deliverables": string[] },\n  "kpis": string[],\n  "steps": [{ "order": number, "kind": one of "research"|"build_funnel"|"create_discount"|"schedule_posts"|"cold_email"|"influencer_brief"|"community_post"|"analytics_check"|"adjust", "channel": string, "paid": boolean, "estCostPence": number, "scheduledOffsetHours": number, "label": string }],\n  "risks": string[]\n}\nMake the steps concrete and ordered: understand+research already done, so start at build_funnel/create_discount, then schedule_posts per channel, cold_email, influencer_brief, community_post, then analytics_check + adjust near the end.`,
    maxTokens: 3500,
  });

  // Enforce free-mode invariant regardless of what the model returned.
  if (mode === "free") {
    plan.steps = (plan.steps ?? []).map((s) => ({ ...s, paid: false, estCostPence: 0 }));
    plan.budgetSplit = [];
  } else {
    // Clamp paid budget to the cap.
    let running = 0;
    plan.budgetSplit = (plan.budgetSplit ?? []).map((b) => {
      const room = Math.max(0, budgetPence - running);
      const pence = Math.min(b.pence ?? 0, room);
      running += pence;
      return { ...b, pence };
    });
  }
  plan.steps = (plan.steps ?? []).sort((a, b) => a.order - b.order);
  return plan;
}
