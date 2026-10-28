import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/operator-auth";
import { marketingCall } from "@/lib/marketing/service";
import { presignedGet } from "@/lib/storage";
import type { Doc } from "../../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const maxDuration = 15;
export const dynamic = "force-dynamic";
const id = z.string().regex(/^[a-z0-9]{20,64}$/);

export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const projectId = id.parse(request.nextUrl.searchParams.get("projectId"));
    const assetId = id.parse(request.nextUrl.searchParams.get("assetId"));
    const asset = await marketingCall<Doc<"marketingAssets">>("getAsset", {
      projectId,
      assetId,
    });
    if (
      !asset.rightsConfirmed ||
      !asset.key.startsWith(`marketing/${projectId}/`)
    )
      throw new Error("Invalid project asset");
    return NextResponse.redirect(await presignedGet(asset.key, 900), {
      status: 302,
      headers: {
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Project media unavailable" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
