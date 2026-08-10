import { NextResponse } from "next/server";
import { higgsfieldMcpLinked } from "@/lib/higgsfield";

export const maxDuration = 20;

/** Safe public health signal; it never exposes client data, credentials, or retired state. */
export async function GET() {
  const rendererSessionLinked = await higgsfieldMcpLinked().catch(() => false);
  const serviceBoundaryReady = Boolean(process.env.MEDIA_ENGINE_CONVEX_SERVICE_TOKEN);
  const originReady = Boolean(process.env.MEDIA_ENGINE_PUBLIC_ORIGIN);

  return NextResponse.json(
    {
      ok: serviceBoundaryReady && originReady && rendererSessionLinked,
      at: new Date().toISOString(),
      clientDesk: "ready",
      renderer: rendererSessionLinked ? "schema-verification-required" : "oauth-required",
      legacyDistribution: "retired",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
