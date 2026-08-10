import { NextRequest, NextResponse } from "next/server";
import {
  createOperatorAccessCode,
  createOperatorSession,
  operatorSessionCookie,
  verifyOperatorActivation,
  verifyOperatorAccessCode,
} from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

/**
 * Private operator session bootstrap. Call only from a trusted operator tool
 * with `Authorization: Bearer $MEDIA_ENGINE_OPERATOR_TOKEN`; it returns an
 * HttpOnly, signed session cookie for the browser workspace.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { accessCode?: unknown };
  const accessCode = typeof body.accessCode === "string" ? body.accessCode : undefined;
  const denied = verifyOperatorActivation(request);
  if (denied && !verifyOperatorAccessCode(accessCode)) return denied;
  const session = createOperatorSession();
  if (!session) return NextResponse.json({ error: "Operator access is not configured" }, { status: 503 });
  const response = NextResponse.json({ ok: true, expiresInSeconds: 8 * 60 * 60 });
  response.cookies.set(operatorSessionCookie(session));
  return response;
}

/**
 * Mints a ten-minute owner-access code for a trusted server/operator tool.
 * The code is intentionally separate from the long-lived activation token and
 * is accepted only through the fragment-based access page during its short TTL.
 */
export async function PUT(request: NextRequest) {
  const denied = verifyOperatorActivation(request);
  if (denied) return denied;
  const accessCode = createOperatorAccessCode();
  if (!accessCode) return NextResponse.json({ error: "Operator access is not configured" }, { status: 503 });
  return NextResponse.json({ accessCode, expiresInSeconds: 10 * 60 });
}

/** Clears a local operator session without requiring the activation token. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(operatorSessionCookie("", 0));
  return response;
}
