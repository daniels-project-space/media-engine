import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * The operator gate deliberately has no permissive default. The public site can
 * collect a lead, but planning, uploads, paid render dispatch and private work
 * data require a password-backed, httpOnly session.
 *
 * Configure MEDIA_ENGINE_OPERATOR_PASSWORD in the hosting environment. A
 * separate MEDIA_ENGINE_SESSION_SECRET is recommended; when omitted the
 * password still signs the session so a fresh install fails closed rather than
 * exposing paid controls.
 */
export const OPERATOR_COOKIE = "media_engine_operator";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function operatorPassword(): string | null {
  const value = process.env.MEDIA_ENGINE_OPERATOR_PASSWORD;
  return value && value.length >= 16 ? value : null;
}

function sessionSecret(): string | null {
  return process.env.MEDIA_ENGINE_SESSION_SECRET ?? operatorPassword();
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sign(value: string): string | null {
  const secret = sessionSecret();
  return secret ? createHmac("sha256", secret).update(value).digest("base64url") : null;
}

export function operatorAuthConfigured(): boolean {
  return Boolean(operatorPassword() && sessionSecret());
}

export function createOperatorSession(now = Date.now()): string | null {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const value = `operator.${expiresAt}`;
  const signature = sign(value);
  return signature ? `${value}.${signature}` : null;
}

export function verifyOperatorSession(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [role, rawExpiry, signature, extra] = token.split(".");
  if (role !== "operator" || !rawExpiry || !signature || extra) return false;
  const expiresAt = Number(rawExpiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const expected = sign(`${role}.${rawExpiry}`);
  return Boolean(expected && equal(signature, expected));
}

export function passwordMatches(candidate: string | undefined): boolean {
  const expected = operatorPassword();
  return Boolean(candidate && expected && equal(candidate, expected));
}

export function withOperatorSession(response: NextResponse): NextResponse {
  const token = createOperatorSession();
  if (!token) return response;
  response.cookies.set({
    name: OPERATOR_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export function clearOperatorSession(response: NextResponse): NextResponse {
  response.cookies.set({ name: OPERATOR_COOKIE, value: "", httpOnly: true, path: "/", maxAge: 0 });
  return response;
}

/** Returns a JSON error response when the request is not an authenticated operator. */
export function requireOperator(request: NextRequest): NextResponse | null {
  if (!operatorAuthConfigured()) {
    return NextResponse.json(
      { error: "Operator access is not configured. Set MEDIA_ENGINE_OPERATOR_PASSWORD before enabling private workspaces." },
      { status: 503 },
    );
  }
  if (!verifyOperatorSession(request.cookies.get(OPERATOR_COOKIE)?.value)) {
    return NextResponse.json({ error: "Operator sign-in required" }, { status: 401 });
  }
  return null;
}

/**
 * Allows a scheduled internal heartbeat without opening it to the internet.
 * A real operator session still works for manual runs; otherwise callers must
 * supply `Authorization: Bearer <MEDIA_ENGINE_CRON_SECRET>`. Missing secrets
 * fail closed so a new deployment cannot accidentally expose automation.
 */
export function requireOperatorOrCron(request: NextRequest): NextResponse | null {
  if (operatorAuthConfigured() && verifyOperatorSession(request.cookies.get(OPERATOR_COOKIE)?.value)) return null;
  const expected = process.env.MEDIA_ENGINE_CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (expected && expected.length >= 32 && bearer && equal(bearer, expected)) return null;
  if (!operatorAuthConfigured() && (!expected || expected.length < 32)) {
    return NextResponse.json(
      { error: "Internal access is not configured. Set operator or cron authentication before enabling automation." },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "Operator or cron authentication required" }, { status: 401 });
}
