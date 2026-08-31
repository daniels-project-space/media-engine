import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/storage";
import { requireOperator } from "@/lib/operator-auth";

export const maxDuration = 30;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CREATOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type UploadPurpose = "client-product" | "creator-reference";

function extensionFor(contentType: string): "jpg" | "png" | "webp" {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Browser supplied MIME types are advisory. Check the small, unambiguous image
 * signatures before storing the object so this endpoint cannot become a
 * general-purpose file upload.
 */
function contentTypeFromImageBytes(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return null;
}

function uploadPurpose(value: FormDataEntryValue | null): UploadPurpose | null {
  if (value === null || value === "") return "client-product";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized === "client-product" || normalized === "creator-reference" ? normalized : null;
}

function creatorReferenceKey(creatorId: FormDataEntryValue | null, extension: string): string | null {
  if (typeof creatorId !== "string") return null;
  const normalized = creatorId.trim();
  // Convex ids are opaque. This validates only that it is safe as one R2 path
  // segment. This route has no Convex service credential, so profile existence
  // and ownership must be checked by the protected creator service before a key
  // is associated with a profile or content item.
  if (!CREATOR_ID_PATTERN.test(normalized)) return null;
  return `creator-references/${normalized}/${randomUUID()}.${extension}`;
}

// Stores an uploaded image (client product photo) to R2 and returns its key.
export async function POST(req: NextRequest) {
  const denied = requireOperator(req);
  if (denied) return denied;
  const form = await req.formData();
  const purpose = uploadPurpose(form.get("purpose"));
  if (!purpose) {
    return NextResponse.json({ error: "Unsupported upload purpose." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });
  if (!ACCEPTED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Use a JPEG, PNG, or WebP reference image." }, { status: 415 });
  }
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Image must be between 1 byte and 25 MB." }, { status: 413 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = contentTypeFromImageBytes(bytes);
  if (!contentType || contentType !== file.type) {
    return NextResponse.json({ error: "Image bytes do not match the declared JPEG, PNG, or WebP type." }, { status: 415 });
  }
  const ext = extensionFor(contentType);

  if (purpose === "creator-reference") {
    const key = creatorReferenceKey(form.get("creatorId"), ext);
    if (!key) {
      return NextResponse.json({ error: "A valid creatorId is required for creator-reference uploads." }, { status: 400 });
    }
    await putObject(key, bytes, contentType);
    return NextResponse.json({ key, purpose });
  }

  // A unique key prevents one client upload from overwriting another file with the
  // same name and byte length.
  const safe = file.name.replace(/[^a-zA-Z0-9.]/g, "-").slice(0, 40);
  const key = `products/client/${randomUUID()}-${safe}.${ext}`;
  await putObject(key, bytes, contentType);
  return NextResponse.json({ key, purpose });
}
