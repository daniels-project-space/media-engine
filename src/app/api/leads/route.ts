import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

// Drafts a qualification reply for a lead. On our own surfaces this can auto-send;
// on marketplaces it stays a draft for a human send-click (auto-messaging = ban).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { action: "draft"; leadId: string };
  if (body.action !== "draft" || !body.leadId) return NextResponse.json({ error: "bad request" }, { status: 400 });
  return NextResponse.json({ error: "Lead drafting is paused until the UI hands it to a durable Codex CLI task." }, { status: 503 });
}
