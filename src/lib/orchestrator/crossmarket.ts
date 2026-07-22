import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { agentJson } from "../brain";

const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

type Proposal = {
  kind: "bundle" | "shoutout_swap" | "referral" | "retarget" | "syndication";
  campaignNames: string[];
  rationale: string;
};

// Cross-marketing finder — looks across the portfolio of campaigns and proposes
// concrete cross-promotion moves (bundles, shoutout swaps, referrals, shared
// retargeting, UGC syndication), avoiding cannibalization. Persists proposals.
export async function findCrossPromos(): Promise<{ proposed: number; proposals: Proposal[] }> {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const campaigns = await cx.query(api.campaigns.list, {});
  const active = campaigns.filter((c) => ["planned", "awaiting_approval", "live", "done"].includes(c.status));
  if (active.length < 2) return { proposed: 0, proposals: [] };

  const summary = active
    .map((c) => `- ${c.name} | product: ${c.productName ?? "?"} | category: ${c.category} | mode: ${c.mode}`)
    .join("\n");

  let proposals: Proposal[] = [];
  try {
    const out = await agentJson<{ proposals: Proposal[] }>("cross_marketer", {
      system:
        "You find cross-marketing opportunities across a brand portfolio. Only propose moves where audiences complement (avoid cannibalizing sibling brands). Return ONLY JSON {\"proposals\":[{\"kind\":\"bundle|shoutout_swap|referral|retarget|syndication\",\"campaignNames\":string[],\"rationale\":string}]}.",
      user: `PORTFOLIO CAMPAIGNS:\n${summary}\n\nPropose up to 5 concrete cross-promotion moves between these campaigns. Reference campaigns by their exact name.`,
      maxTokens: 1200,
    });
    proposals = out.proposals ?? [];
  } catch {
    proposals = [];
  }

  const nameToId = new Map(active.map((c) => [c.name, c._id]));
  for (const p of proposals.slice(0, 5)) {
    const ids = (p.campaignNames ?? []).map((n) => nameToId.get(n)).filter(Boolean) as Id<"campaigns">[];
    await cx.mutation(api.crossmarketing.propose, {
      kind: p.kind,
      campaignIds: ids.length ? ids : undefined,
      rationale: p.rationale,
    });
  }
  return { proposed: proposals.length, proposals };
}
