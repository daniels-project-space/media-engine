import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import { findCrossPromos } from "@/lib/orchestrator/crossmarket";
import { aiEnabled } from "@/lib/ai-gate";

export const maxDuration = 60;
const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";

// POST → run the cross-marketing finder across the portfolio. GET → list proposals.
export async function POST() {
  // The finder invokes the Codex CLI after reading campaigns. Do not reach
  // Convex or the CLI while billing is disabled.
  if (!(await aiEnabled())) return NextResponse.json({ error: "AI generation is paused" }, { status: 503 });
  const res = await findCrossPromos();
  return NextResponse.json(res);
}

export async function GET() {
  const cx = new ConvexHttpClient(CONVEX_URL);
  const promotions = await cx.query(api.crossmarketing.list, {});
  return NextResponse.json({ promotions });
}
