import { NextRequest, NextResponse } from "next/server";
import { presignedGet } from "@/lib/storage";

export const maxDuration = 15;

// Stable media URL: /api/media/posts/<id>/ad.mp4 -> 302 to a freshly presigned R2
// URL. Presigned URLs expire, so the UI references R2 KEYS through this route and
// never shows a dead link.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const objectKey = key.join("/");
  if (!objectKey.startsWith("posts/") && !objectKey.startsWith("demo/") && !objectKey.startsWith("buildout/")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const url = await presignedGet(objectKey, 60 * 60); // 1h is plenty for a redirect
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
