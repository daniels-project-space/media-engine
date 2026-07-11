import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/llm";
import { aiEnabled } from "@/lib/ai-gate";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const maxDuration = 30;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

// Drafts a qualification reply for a lead. On our own surfaces this can auto-send;
// on marketplaces it stays a draft for a human send-click (auto-messaging = ban).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { action: "draft"; leadId: string };
  if (body.action !== "draft" || !body.leadId) return NextResponse.json({ error: "bad request" }, { status: 400 });

  if (!(await aiEnabled())) return NextResponse.json({ paused: true, error: "AI drafting paused" });

  const convex = new ConvexHttpClient(CONVEX_URL);
  const lead = await convex.query(api.leads.get, { id: body.leadId as Id<"leads"> });
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  let draft: string;
  try {
    draft = (
      await chat({
        system:
          "You are a friendly, confident AI-creative-studio owner replying to a warm inbound lead. Warm, concise, no fluff, no emoji spam. Confirm you can help, ask for the ONE or two missing things you need to start (usually the product photo/link and the key goal), and offer a free sample concept as the next step. Never over-promise. Output plain text the owner can send as-is.",
        user: `New lead for service "${lead.service ?? "general"}".\nName: ${lead.name}\nBrand/link: ${lead.brandLink ?? "(none)"}\nBudget: ${lead.budget ?? "(unspecified)"}\nTimeline: ${lead.timeline ?? "(unspecified)"}\nMessage: ${lead.message ?? "(none)"}\n\nWrite the reply.`,
        maxTokens: 450,
      })
    ).trim();
  } catch {
    return NextResponse.json({ error: "draft failed" }, { status: 500 });
  }
  await convex.mutation(api.leads.update, { id: lead._id, draftReply: draft, stage: "qualifying" });
  return NextResponse.json({ draft });
}
