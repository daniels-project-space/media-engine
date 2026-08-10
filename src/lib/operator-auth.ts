import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const OPERATOR_SESSION_COOKIE = "media_engine_operator_session";
const OPERATOR_SESSION_TTL_SECONDS = 8 * 60 * 60;
const OPERATOR_ACCESS_CODE_TTL_SECONDS = 10 * 60;

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function operatorToken(): string | null {
  const token = process.env.MEDIA_ENGINE_OPERATOR_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

function sessionSignature(expiresAt: number, token: string): string {
  return createHmac("sha256", token).update(`media-engine-operator-session:${expiresAt}`).digest("base64url");
}

function accessCodeSignature(expiresAt: number, nonce: string, token: string): string {
  return createHmac("sha256", token).update(`media-engine-operator-access:${expiresAt}:${nonce}`).digest("base64url");
}

function operatorSessionValid(value: string | undefined, token: string): boolean {
  if (!value) return false;
  const [expiresRaw, signature, extra] = value.split(".");
  if (!expiresRaw || !signature || extra) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  return equal(signature, sessionSignature(expiresAt, token));
}

function bearer(request: NextRequest): string | undefined {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return value || undefined;
}

function operatorUnavailable() {
  return NextResponse.json(
    { error: "Operator access is not configured. Set MEDIA_ENGINE_OPERATOR_TOKEN before enabling private workspace access." },
    { status: 503 },
  );
}

/**
 * Creates a short-lived, HttpOnly session after a trusted operator presents the
 * server-only activation token to `/api/operator/session`. The browser never
 * receives that long-lived token in JavaScript or in a cookie.
 */
export function createOperatorSession(): string | null {
  const token = operatorToken();
  if (!token) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + OPERATOR_SESSION_TTL_SECONDS;
  return `${expiresAt}.${sessionSignature(expiresAt, token)}`;
}

/**
 * Creates a short-lived, passwordless owner-access code. It is minted only by
 * a trusted server caller holding the long-lived operator token, then consumed
 * by `/operator/access` from the URL fragment so it is never sent in a URL.
 */
export function createOperatorAccessCode(): string | null {
  const token = operatorToken();
  if (!token) return null;
  const expiresAt = Math.floor(Date.now() / 1000) + OPERATOR_ACCESS_CODE_TTL_SECONDS;
  const nonce = randomUUID();
  return `v1.${expiresAt}.${nonce}.${accessCodeSignature(expiresAt, nonce, token)}`;
}

/** Validates a short-lived owner-access code without ever accepting it as a general API credential. */
export function verifyOperatorAccessCode(value: string | undefined): boolean {
  const token = operatorToken();
  if (!token || !value) return false;
  const [version, expiresRaw, nonce, signature, extra] = value.split(".");
  if (version !== "v1" || !expiresRaw || !nonce || !signature || extra) return false;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  return equal(signature, accessCodeSignature(expiresAt, nonce, token));
}

export function operatorSessionCookie(value: string, maxAge = OPERATOR_SESSION_TTL_SECONDS) {
  return {
    name: OPERATOR_SESSION_COOKIE,
    value,
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

/**
 * Validates the server-only activation token used solely to mint a browser
 * session. It is deliberately not accepted as a general API credential.
 */
export function verifyOperatorActivation(request: NextRequest): NextResponse | null {
  const expected = operatorToken();
  if (!expected) return operatorUnavailable();
  const candidate = bearer(request);
  if (!candidate || !equal(candidate, expected)) {
    return NextResponse.json({ error: "Operator activation required" }, { status: 401 });
  }
  return null;
}

/** Private browser/operator route guard. Fails closed when no production token is configured. */
export function requireOperator(request: NextRequest): NextResponse | null {
  const token = operatorToken();
  if (!token) return operatorUnavailable();
  if (operatorSessionValid(request.cookies.get(OPERATOR_SESSION_COOKIE)?.value, token)) return null;
  return NextResponse.json({ error: "Operator session required" }, { status: 401 });
}

/**
 * Scheduled internal routes accept the isolated cron credential, or an
 * authenticated operator browser session for manual inspection. Do not reuse
 * the cron credential as an operator session secret.
 */
export function requireOperatorOrCron(request: NextRequest): NextResponse | null {
  const expected = process.env.MEDIA_ENGINE_CRON_SECRET;
  const token = operatorToken();
  if (token && operatorSessionValid(request.cookies.get(OPERATOR_SESSION_COOKIE)?.value, token)) return null;
  const supplied = bearer(request);
  if (!expected || expected.length < 32) {
    return NextResponse.json(
      { error: "Internal access is not configured. Set MEDIA_ENGINE_CRON_SECRET before enabling automation." },
      { status: 503 },
    );
  }
  if (supplied && equal(supplied, expected)) return null;
  return NextResponse.json({ error: "Cron authentication required" }, { status: 401 });
}
