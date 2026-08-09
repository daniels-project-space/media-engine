import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function retiredPasswordSignIn() {
  return NextResponse.json(
    { error: "Password sign-in has been removed. The workspace no longer requires a browser password." },
    { status: 410 },
  );
}

export async function POST() {
  return retiredPasswordSignIn();
}

export async function DELETE() {
  return retiredPasswordSignIn();
}
