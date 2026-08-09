import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 15;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: "Legacy public capture is retired while the Client Desk is secured." },
    { status: 410 },
  );
}
