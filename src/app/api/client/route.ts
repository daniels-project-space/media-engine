import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { understand } from "@/lib/orchestrator/understand";
import { aiEnabled } from "@/lib/ai-gate";

export const maxDuration = 120;
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// Onboard a client account. Creates the client IMMEDIATELY (never depends on the
// LLM), then best-effort enriches the brand kit from its website/brief via
// understand(). GET lists clients.
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as {
    name?: string;
    website?: string;
    brief?: string;
    industry?: string;
    contactEmail?: string;
    goals?: string;
  };
  if (!b.name || b.name.trim().length < 2) return NextResponse.json({ error: "name is required" }, { status: 400 });
  // Brand enrichment can launch Codex and fetch a customer URL. Preserve a
  // plain CRM create, but keep the enrichment path side-effect free while
  // billing is disabled.
  if ((b.website || b.brief) && !(await aiEnabled())) {
    return NextResponse.json({ error: "AI generation is paused" }, { status: 503 });
  }
  const cx = new ConvexHttpClient(CONVEX_URL);

  const clientId = await cx.mutation(api.crm.create, {
    name: b.name,
    status: "active",
    website: b.website,
    industry: b.industry,
    contactEmail: b.contactEmail,
    goals: b.goals,
  });

  let enriched = false;
  if (b.website || b.brief) {
    try {
      const profile = await understand({ brief: b.brief || b.name, productUrl: b.website });
      await cx.mutation(api.crm.patch, {
        id: clientId as Id<"clients">,
        industry: b.industry ?? profile.category,
        referenceImageKeys: profile.referenceImageKeys,
        brandKit: {
          oneLiner: profile.oneLiner,
          voice: profile.tone,
          audience: profile.audience,
          painPoints: profile.painPoints,
          valueProps: profile.valueProps,
          differentiators: profile.differentiators,
          competitors: profile.competitors,
          keywords: profile.keywords,
          colors: profile.brandColors ?? [],
          suggestedChannels: profile.suggestedChannels,
          category: profile.category,
        },
      });
      enriched = true;
    } catch {
      /* brand kit can be filled later — client already exists */
    }
  }
  return NextResponse.json({ clientId, enriched });
}

export async function GET() {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const clients = await cx.query(api.crm.list, {});
  return NextResponse.json({ clients });
}
