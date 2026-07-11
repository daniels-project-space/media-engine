import { NextRequest, NextResponse } from "next/server";
import { repurposeAsset, type RepurposeMode } from "@/lib/integrations/repurpose";

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
