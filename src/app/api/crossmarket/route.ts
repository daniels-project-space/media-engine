import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { findCrossPromos } from "@/lib/orchestrator/crossmarket";
import { requireOperator } from "@/lib/operator-auth";
import { legacyControlPlaneRetired } from "@/lib/legacy-control-plane";

export const maxDuration = 60;
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// POST → run the cross-marketing finder across the portfolio. GET → list proposals.
export async function POST(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  if (legacyControlPlaneRetired()) {
    return NextResponse.json({ error: "Legacy cross-marketing is retired" }, { status: 410 });
  }
  const res = await findCrossPromos();
  return NextResponse.json(res);
}

export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  if (legacyControlPlaneRetired()) {
    return NextResponse.json({ error: "Legacy cross-marketing is retired" }, { status: 410 });
  }
  const cx = new ConvexHttpClient(CONVEX_URL);
  const promotions = await cx.query(api.crossmarketing.list, {});
  return NextResponse.json({ promotions });
}
