import { NextRequest, NextResponse } from "next/server";
import { rotateHiggsfieldSession, vaultHiggsfieldSession } from "@/lib/vault";
import {
  HIGGSFIELD_OAUTH_COOKIE,
  completeHiggsfieldAuthorization,
  matchesOAuthState,
  mediaEnginePublicOrigin,
  unsealHiggsfieldPending,
} from "@/lib/higgsfield-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function settingsRedirect(status: "connected" | "failed"): NextResponse {
  const target = new URL("/settings", mediaEnginePublicOrigin());
  target.searchParams.set("higgsfield", status);
  const response = NextResponse.redirect(target, 303);
  response.cookies.set({
    name: HIGGSFIELD_OAUTH_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

/** Completes a sealed PKCE transaction; no desktop OAuth material is ever read. */
export async function GET(request: NextRequest) {
  try {
    const pending = unsealHiggsfieldPending(request.cookies.get(HIGGSFIELD_OAUTH_COOKIE)?.value);
    const state = request.nextUrl.searchParams.get("state");
    if (!pending || !matchesOAuthState(pending.state, state)) return settingsRedirect("failed");

    // Provider error text is untrusted and can reveal account details, so it is
    // intentionally neither logged nor reflected to the browser.
    if (request.nextUrl.searchParams.has("error")) return settingsRedirect("failed");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) return settingsRedirect("failed");

    const current = await vaultHiggsfieldSession();
    const session = await completeHiggsfieldAuthorization(pending, code, request.nextUrl.searchParams.get("iss") ?? undefined);
    await rotateHiggsfieldSession(JSON.stringify(session), current?.revision ?? null);
    return settingsRedirect("connected");
  } catch {
    // Avoid error logging here: callback errors can include OAuth codes or a
    // provider body. The operator sees a generic failed status and may retry.
    return settingsRedirect("failed");
  }
}
