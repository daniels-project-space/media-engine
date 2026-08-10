import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// This is deliberately duplicated instead of importing operator-auth: proxy
// only performs a cheap optimistic redirect and must not bundle node:crypto.
// Every private route independently verifies this signed HttpOnly cookie.
const OPERATOR_SESSION_COOKIE = "media_engine_operator_session";

const RETIRED_PRIVATE_PREFIXES = [
  "/accounts",
  "/ads",
  "/analytics",
  "/campaigns",
  "/instagram",
  "/launch",
  "/leads",
  "/models",
  "/personas",
  "/prompts",
  "/queue",
  "/reference",
  "/stores",
];

/** Keeps retired legacy navigation out of the active client-production app. */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/operator/access" || pathname.startsWith("/operator/access/")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (pathname.startsWith("/f/") || pathname.startsWith("/p/")) {
    return NextResponse.redirect(new URL("/services", request.url));
  }
  if (pathname === "/services" || pathname.startsWith("/services/")) return NextResponse.next();
  if (RETIRED_PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const url = new URL("/work", request.url);
    url.searchParams.set("notice", "legacy-workflow-retired");
    return NextResponse.redirect(url);
  }
  if (!request.cookies.get(OPERATOR_SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/operator/access", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
