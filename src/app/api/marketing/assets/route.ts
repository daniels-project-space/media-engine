import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import { marketingCall, publicFailure } from "@/lib/marketing/service";
import { storeMarketingImage } from "@/lib/marketing/assets";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const limit = 4 * 1024 * 1024 + 16_384;
    if (Number(request.headers.get("content-length")) > limit)
      return NextResponse.json(
        { error: "Image exceeds 4 MB" },
        { status: 413 },
      );
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Image body is required");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit) {
          await reader.cancel();
          throw new Error("Image exceeds 4 MB");
        }
        parts.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const form = await new Response(bytes, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const projectId = form.get("projectId"),
      file = form.get("file");
    if (
      typeof projectId !== "string" ||
      !/^[a-z0-9]{20,64}$/.test(projectId) ||
      !(file instanceof File) ||
      form.get("rightsConfirmed") !== "true"
    )
      throw new Error("Select a project image and confirm its usage rights");
    await marketingCall("listWorkspace", { projectId }); // Ownership before R2 writes.
    const receipt = await storeMarketingImage(
      projectId,
      Buffer.from(await file.arrayBuffer()),
    );
    const assetId = await marketingCall("registerAsset", {
      projectId,
      ...receipt,
      source: "upload",
      rightsConfirmed: true,
    });
    return NextResponse.json(
      { assetId, ...receipt },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: publicFailure(error) }, { status: 400 });
  }
}
