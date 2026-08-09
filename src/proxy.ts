import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { OPERATOR_COOKIE } from "@/lib/operator-auth";

const PUBLIC_PREFIXES = ["/login", "/services", "/f/", "/p/", "/api/auth", "/api/health", "/api/subscribe", "/api/media/"];

/**
 * This is an optimistic UI gate only. Every sensitive route handler verifies the
 * signed cookie again through requireOperator(); Proxy must stay cheap and never
 * become the sole authorization check.
 */
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (!request.cookies.get(OPERATOR_COOKIE)?.value) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
