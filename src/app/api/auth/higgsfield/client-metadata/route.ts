import { NextResponse } from "next/server";
import { higgsfieldClientMetadata } from "@/lib/higgsfield-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OAuth URL client-id metadata. It is intentionally public, has no credential,
 * and is pinned to MEDIA_ENGINE_PUBLIC_ORIGIN instead of request headers.
 */
export async function GET() {
  try {
    return NextResponse.json(higgsfieldClientMetadata(), {
      headers: { "cache-control": "public, max-age=3600, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "Production OAuth metadata is not configured" }, { status: 503 });
  }
}
