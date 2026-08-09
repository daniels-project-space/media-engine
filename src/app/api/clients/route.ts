import { NextResponse } from "next/server";

/**
 * Retired: this endpoint turned an arbitrary brief into a paid render without a
 * saved conversation, storyboard, approval, or provider policy. The canonical
 * private path is /api/work and intentionally has no direct paid-render action.
 */
export async function POST() {
  return NextResponse.json(
    { error: "This legacy endpoint has been retired. Use the private Work workspace." },
    { status: 410 },
  );
}
