import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (pathname.startsWith("/f/") || pathname.startsWith("/p/")) {
    return NextResponse.redirect(new URL("/services", request.url));
  }
  if (RETIRED_PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const url = new URL("/work", request.url);
    url.searchParams.set("notice", "legacy-workflow-retired");
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
