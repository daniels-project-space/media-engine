import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import { listHiggsfieldMcpTools } from "@/lib/higgsfield";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Operator-only, non-billable MCP manifest inspection. It never calls a tool. */
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    return NextResponse.json({ tools: await listHiggsfieldMcpTools() });
  } catch {
    return NextResponse.json({ error: "Higgsfield MCP verification failed. Reconnect it from Settings if the grant was revoked." }, { status: 503 });
  }
}
