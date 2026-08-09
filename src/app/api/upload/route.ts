import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/storage";
import { requireOperator } from "@/lib/operator-auth";

export const maxDuration = 30;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Stores an uploaded image (client product photo) to R2 and returns its key.
export async function POST(req: NextRequest) {
  const denied = requireOperator(req);
  if (denied) return denied;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Use a JPEG, PNG, or WebP reference image." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image must be between 1 byte and 25 MB." }, { status: 413 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = file.type.includes("png") ? "png" : "jpg";
  // A unique key prevents one client upload from overwriting another file with the
  // same name and byte length.
  const safe = file.name.replace(/[^a-zA-Z0-9.]/g, "-").slice(0, 40);
  const key = `products/client/${randomUUID()}-${safe}.${ext}`;
  await putObject(key, bytes, file.type || "image/jpeg");
  return NextResponse.json({ key });
}
