import { NextRequest, NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
import { aiEnabled } from "@/lib/ai-gate";

export const maxDuration = 30;

// Server-side bridge: UI buttons -> Trigger.dev task runs.
// Body: { action: "generate", postId } | { action: "plan", personaId, days?, postsPerDay? }
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action: "generate" | "plan" | "publish" | "short" | "campaign" | "remix";
    postId?: string;
    personaId?: string;
    days?: number;
    postsPerDay?: number;
    imageUrl?: string;
    streamSlug?: string;
    title?: string;
    subject?: string;
    html?: string;
    tag?: string;
  };

  const trigger = await vaultService("trigger");
  const key = trigger.TRIGGER_SECRET_KEY_MEDIA_ENGINE;
  if (!key) return NextResponse.json({ error: "trigger key missing in vault" }, { status: 500 });

  let taskId: string;
  let payload: Record<string, unknown>;
  if ((body.action === "generate" || body.action === "plan") && !(await aiEnabled())) {
    return NextResponse.json({ error: "AI generation is paused" }, { status: 503 });
  }

  if (body.action === "generate" && body.postId) {
    taskId = "generate-carousel";
    payload = { postId: body.postId };
  } else if (body.action === "plan" && body.personaId) {
    taskId = "plan-week";
    payload = { personaId: body.personaId, days: body.days, postsPerDay: body.postsPerDay };
  } else if (body.action === "publish" && body.postId) {
    taskId = "publish-post";
    payload = { postId: body.postId };
  } else if (body.action === "short" && body.imageUrl && body.streamSlug && body.title) {
    taskId = "generate-short";
    payload = {
      imageUrl: body.imageUrl,
      streamSlug: body.streamSlug,
      personaId: body.personaId,
      title: body.title,
    };
  } else if (body.action === "campaign" && body.subject && body.html) {
    taskId = "send-campaign";
    payload = { subject: body.subject, html: body.html, tag: body.tag };
  } else if (body.action === "remix" && body.postId) {
    taskId = "remix-content";
    payload = { sourcePostId: body.postId };
  } else {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const r = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await r.json();
  if (!r.ok) return NextResponse.json({ error: data }, { status: r.status });
  return NextResponse.json({ runId: data.id });
}
