import { NextRequest, NextResponse } from "next/server";
import { aiEnabled } from "@/lib/ai-gate";
import { IMAGE_WORKFLOW_PAUSED_REASON } from "@/lib/image-workflow";

export const maxDuration = 60;

// Client-order fulfilment bridge (Fiverr AI-ads agency).
//   action "generate": turn a brief (+ optional product image) into a 4K Seedance ad
//   action "draft-reply": AI-draft a buyer reply the seller sends manually (Fiverr
//                         forbids automated buyer messaging — drafts only)
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action: "generate" | "draft-reply";
    orderId?: string;
    brief?: string;
    tier?: "basic" | "standard" | "premium";
    productImageKey?: string;
    buyerMessage?: string;
    buyer?: string;
  };

  if (body.action === "generate") {
    if (!(await aiEnabled())) return NextResponse.json({ error: "AI generation is paused" }, { status: 503 });
    // This route creates prompt-only lifestyle frames for at least one scene.
    // Do not enqueue work that the Trigger task would have to abort.
    return NextResponse.json({ error: IMAGE_WORKFLOW_PAUSED_REASON }, { status: 503 });
  }

  if (body.action === "draft-reply") {
    return NextResponse.json({ error: "Draft replies are paused until the UI hands them to a durable Codex CLI task." }, { status: 503 });
  }

  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
