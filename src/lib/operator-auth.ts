import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Browser workspace access is intentionally ungated. This helper remains as a
 * compatibility boundary for route handlers while the product has no operator
 * password or session. It must never be used as evidence that rendering is
 * enabled: the independent Seedance release gate remains fail-closed.
 */
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** No password or browser session is required for operator-facing routes. */
export function requireOperator(_request: NextRequest): null {
  return null;
}

/**
 * Scheduled internal routes remain non-public. Browser workspace access is
 * deliberately open, but a caller invoking an internal heartbeat must still
 * supply `Authorization: Bearer <MEDIA_ENGINE_CRON_SECRET>`.
 */
export function requireOperatorOrCron(request: NextRequest): NextResponse | null {
  const expected = process.env.MEDIA_ENGINE_CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || expected.length < 32) {
    return NextResponse.json(
      { error: "Internal access is not configured. Set MEDIA_ENGINE_CRON_SECRET before enabling automation." },
      { status: 503 },
    );
  }
  if (bearer && equal(bearer, expected)) return null;
  return NextResponse.json({ error: "Cron authentication required" }, { status: 401 });
}
