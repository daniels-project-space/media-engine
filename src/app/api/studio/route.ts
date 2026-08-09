import { NextResponse } from "next/server";

/**
 * Retired after the production flow moved to /api/work. Keeping this explicit
 * 410 avoids silently sending legacy callers through an unaudited paid path.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This legacy endpoint has been retired. Use the private Work workspace." },
    { status: 410 },
  );
}
