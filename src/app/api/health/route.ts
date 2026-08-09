import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import { higgsfieldMcpLinked } from "@/lib/higgsfield";

export const maxDuration = 20;

/** A safe operator health view; it never reads the retired public Convex plane. */
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;

  const rendererSessionLinked = await higgsfieldMcpLinked().catch(() => false);
  const serviceBoundaryReady = Boolean(process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN);
  const originReady = Boolean(process.env.MEDIA_ENGINE_PUBLIC_ORIGIN);

  return NextResponse.json({
    ok: serviceBoundaryReady && originReady && rendererSessionLinked,
    at: new Date().toISOString(),
    clientDesk: "ready",
    renderer: rendererSessionLinked ? "schema-verification-required" : "oauth-required",
    legacyDistribution: "retired",
  });
}
