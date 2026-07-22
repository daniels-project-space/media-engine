import { NextRequest, NextResponse } from "next/server";
import { repurposeAsset, type RepurposeMode } from "@/lib/integrations/repurpose";
import { aiEnabled } from "@/lib/ai-gate";

export const maxDuration = 60;

// Reuse a marketing asset — hand to an influencer, or repurpose (cameo/reframe)
// and post to TikTok/Reels. Records lineage. Gated (dry-run unless live).
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as {
    assetId?: string;
    platform?: string;
    mode?: RepurposeMode;
    campaignId?: string;
    discountCode?: string;
    productTitle?: string;
    personaHandle?: string;
  };
  if (!b.assetId || !b.platform || !b.mode) {
    return NextResponse.json({ error: "assetId, platform and mode are required" }, { status: 400 });
  }
  if (!(await aiEnabled())) return NextResponse.json({ error: "AI generation is paused" }, { status: 503 });
  const res = await repurposeAsset({
    assetId: b.assetId,
    platform: b.platform,
    mode: b.mode,
    campaignId: b.campaignId,
    discountCode: b.discountCode,
    productTitle: b.productTitle,
    personaHandle: b.personaHandle,
  });
  return NextResponse.json(res);
}
