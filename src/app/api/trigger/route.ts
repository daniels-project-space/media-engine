import { NextRequest, NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
import { aiEnabled } from "@/lib/ai-gate";
import { requireOperator } from "@/lib/operator-auth";

export const maxDuration = 30;

// Server-side bridge for non-rendering social operations. All billable media
// rendering enters through /api/work, after client-plan approval.
export async function POST(req: NextRequest) {
  const denied = requireOperator(req);
  if (denied) return denied;
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

  if (body.action === "generate" || body.action === "short") {
    return NextResponse.json(
      {
        error:
          "Social media rendering is disabled by generation policy. Existing social plans remain reviewable; create approved client video in Work with Higgsfield Seedance 2.0.",
      },
      { status: 410 },
    );
  }
  if (body.action === "plan" && !(await aiEnabled())) {
    return NextResponse.json({ error: "AI planning is paused" }, { status: 503 });
  }

  let taskId: string;
  let payload: Record<string, unknown>;
  if (body.action === "plan" && body.personaId) {
    taskId = "plan-week";
    payload = { personaId: body.personaId, days: body.days, postsPerDay: body.postsPerDay };
  } else if (body.action === "publish" && body.postId) {
    taskId = "publish-post";
    payload = { postId: body.postId };
  } else if (body.action === "campaign" && body.subject && body.html) {
    taskId = "send-campaign";
    payload = { subject: body.subject, html: body.html, tag: body.tag };
  } else if (body.action === "remix" && body.postId) {
    taskId = "remix-content";
    payload = { sourcePostId: body.postId };
  } else {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const trigger = await vaultService("trigger");
  const key = trigger.TRIGGER_SECRET_KEY_MEDIA_ENGINE;
  if (!key) return NextResponse.json({ error: "trigger key missing in vault" }, { status: 500 });

  const r = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const data = await r.json();
  if (!r.ok) return NextResponse.json({ error: data }, { status: r.status });
  return NextResponse.json({ runId: data.id });
}
