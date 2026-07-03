import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const { email, handle } = (await req.json()) as { email?: string; handle?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  try {
    const result = await convex.mutation(api.email.subscribe, {
      email,
      source: "link-in-bio",
      personaHandle: handle,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 120) }, { status: 400 });
  }
}
