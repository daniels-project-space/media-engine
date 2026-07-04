import { NextRequest, NextResponse } from "next/server";
import { putObject } from "@/lib/storage";

export const maxDuration = 30;

// Stores an uploaded image (client product photo) to R2 and returns its key.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.type.includes("png") ? "png" : "jpg";
  // Deterministic-ish key from name + size (no Date.now in edge-safe path; fine here).
  const safe = file.name.replace(/[^a-zA-Z0-9.]/g, "-").slice(0, 40);
  const key = `products/client/${bytes.length}-${safe}.${ext}`;
  await putObject(key, bytes, file.type || "image/jpeg");
  return NextResponse.json({ key });
}
