import { NextRequest, NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
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

  const convex = new ConvexHttpClient(CONVEX_URL);
  const lead = await convex.query(api.leads.get, { id: body.leadId as Id<"leads"> });
  if (!lead) return NextResponse.json({ error: "lead not found" }, { status: 404 });

  const { OPENROUTER_API_KEY } = await vaultService("openrouter");
  if (!OPENROUTER_API_KEY) return NextResponse.json({ error: "openrouter key missing" }, { status: 500 });

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 450,
      messages: [
        {
          role: "system",
          content:
            "You are a friendly, confident AI-creative-studio owner replying to a warm inbound lead. Warm, concise, no fluff, no emoji spam. Confirm you can help, ask for the ONE or two missing things you need to start (usually the product photo/link and the key goal), and offer a free sample concept as the next step. Never over-promise. Output plain text the owner can send as-is.",
        },
        {
          role: "user",
          content: `New lead for service "${lead.service ?? "general"}".\nName: ${lead.name}\nBrand/link: ${lead.brandLink ?? "(none)"}\nBudget: ${lead.budget ?? "(unspecified)"}\nTimeline: ${lead.timeline ?? "(unspecified)"}\nMessage: ${lead.message ?? "(none)"}\n\nWrite the reply.`,
        },
      ],
    }),
  });
  if (!r.ok) return NextResponse.json({ error: "draft failed" }, { status: r.status });
  const d = (await r.json()) as { choices: { message: { content: string } }[] };
  const draft = d.choices[0].message.content.trim();
  await convex.mutation(api.leads.update, { id: lead._id, draftReply: draft, stage: "qualifying" });
  return NextResponse.json({ draft });
}
