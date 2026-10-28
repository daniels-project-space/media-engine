import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import { hyperRenderReadiness } from "@/lib/marketing/hyper-render-readiness";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json(await hyperRenderReadiness(), { headers });
  } catch {
    return NextResponse.json(
      { error: "The new rendering service catalogue could not be checked." },
      { status: 503, headers },
    );
  }
}
