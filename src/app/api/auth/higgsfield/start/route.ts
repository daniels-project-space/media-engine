import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import {
  HIGGSFIELD_OAUTH_COOKIE,
  beginHiggsfieldAuthorization,
  higgsfieldOAuthCookieMaxAge,
  mediaEnginePublicOrigin,
  randomOAuthState,
  sealHiggsfieldPending,
} from "@/lib/higgsfield-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts a separate, operator-authorised OAuth transaction for the deployed renderer. */
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;

  try {
    // The callback/client ID are pinned to the canonical production origin. A
    // transaction begun on Preview would strand its host-only PKCE cookie.
    if (request.nextUrl.origin !== mediaEnginePublicOrigin()) {
      return NextResponse.json(
        { error: "Open the canonical production Media Engine URL before connecting Higgsfield" },
        { status: 409 },
      );
    }
    const flow = await beginHiggsfieldAuthorization(randomOAuthState());
    const response = NextResponse.redirect(flow.authorizationUrl, 303);
    response.cookies.set({
      name: HIGGSFIELD_OAUTH_COOKIE,
      value: sealHiggsfieldPending(flow.pending),
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: higgsfieldOAuthCookieMaxAge(),
    });
    return response;
  } catch {
    // Never disclose discovery details or a partial authorization URL.
    return NextResponse.json({ error: "Could not begin the Higgsfield production connection" }, { status: 503 });
  }
}
