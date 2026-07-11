import { NextRequest, NextResponse } from "next/server";
import { planPersonaWeek } from "@/lib/orchestrator/persona-plan";

export const maxDuration = 120;

// Run the persona content pipeline for one influencer persona → scheduled posts.
export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { personaId?: string; days?: number; postsPerDay?: number };
  if (!b.personaId) return NextResponse.json({ error: "personaId is required" }, { status: 400 });
  try {
    const res = await planPersonaWeek({ personaId: b.personaId, days: b.days, postsPerDay: b.postsPerDay });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}
