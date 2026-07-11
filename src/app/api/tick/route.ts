import { NextResponse } from "next/server";
import { tickCampaigns } from "@/lib/orchestrator/tick";

export const maxDuration = 300;

// Autonomy heartbeat — advances due campaign steps within budget (gated). Meant
// to be hit by a VPS cron against the local server, so it runs on the Claude CLI
// brain (no cloud 429). Idempotent + bounded per call.
export async function POST() {
  try {
    const res = await tickCampaigns(20);
    return NextResponse.json({ ok: true, ...res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}

export async function GET() {
  return POST();
}
