import { NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
import { aiEnabled } from "@/lib/ai-gate";

export const maxDuration = 300;

// Autonomy heartbeat — enqueue durable work. The Vercel route never starts a
// local model process; subscription Codex CLI work belongs in Trigger.
export async function POST() {
  if (!(await aiEnabled())) return NextResponse.json({ ok: false, error: "AI generation is paused" }, { status: 503 });
  try {
    const trigger = await vaultService("trigger");
    const key = trigger.TRIGGER_SECRET_KEY_MEDIA_ENGINE;
    if (!key) return NextResponse.json({ ok: false, error: "trigger key missing" }, { status: 500 });
    const r = await fetch("https://api.trigger.dev/api/v1/tasks/campaign-tick/trigger", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ payload: { limit: 20 } }),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ ok: false, error: data }, { status: r.status });
    return NextResponse.json({ ok: true, runId: data.id }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 200 });
  }
}

export async function GET() {
  return POST();
}
