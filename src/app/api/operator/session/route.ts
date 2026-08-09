import { NextRequest, NextResponse } from "next/server";
import {
  createOperatorSession,
  operatorSessionCookie,
  verifyOperatorActivation,
} from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

/**
 * Private operator session bootstrap. Call only from a trusted operator tool
 * with `Authorization: Bearer $MEDIA_ENGINE_OPERATOR_TOKEN`; it returns an
 * HttpOnly, signed session cookie for the browser workspace.
 */
export async function POST(request: NextRequest) {
  const denied = verifyOperatorActivation(request);
  if (denied) return denied;
  const session = createOperatorSession();
  if (!session) return NextResponse.json({ error: "Operator access is not configured" }, { status: 503 });
  const response = NextResponse.json({ ok: true, expiresInSeconds: 8 * 60 * 60 });
  response.cookies.set(operatorSessionCookie(session));
  return response;
}

/** Clears a local operator session without requiring the activation token. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(operatorSessionCookie("", 0));
  return response;
}
