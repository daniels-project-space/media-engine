import { NextRequest, NextResponse } from "next/server";
import {
  clearOperatorSession,
  operatorAuthConfigured,
  passwordMatches,
  withOperatorSession,
} from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  if (!operatorAuthConfigured()) {
    return NextResponse.json(
      { error: "Operator access has not been configured on this deployment." },
      { status: 503 },
    );
  }
  if (!passwordMatches(body.password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  return withOperatorSession(NextResponse.json({ ok: true }));
}

export async function DELETE() {
  return clearOperatorSession(NextResponse.json({ ok: true }));
}

