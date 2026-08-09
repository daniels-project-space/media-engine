import { NextRequest, NextResponse } from "next/server";
import { presignedGet } from "@/lib/storage";
import { requireOperator } from "@/lib/operator-auth";

export const maxDuration = 15;

// Stable media URL. Client work is always private; public marketing assets keep
// their separate allowlist so a render key cannot become a public URL by name.
export async function GET(req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const objectKey = key.join("/");
  const privateKey = objectKey.startsWith("creative/") || objectKey.startsWith("posts/");
  if (privateKey) {
    const denied = requireOperator(req);
    if (denied) return denied;
  }
  const allowed = ["creative/", "posts/", "demo/", "buildout/", "reference/"];
  if (!allowed.some((p) => objectKey.startsWith(p))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const url = await presignedGet(objectKey, 60 * 60); // 1h is plenty for a redirect
    return NextResponse.redirect(url, 302);
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
