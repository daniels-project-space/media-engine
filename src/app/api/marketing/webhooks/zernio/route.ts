import { NextRequest, NextResponse } from "next/server";
import { marketingCall } from "@/lib/marketing/service";
import { verifiedWebhook } from "@/lib/marketing/webhook";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: NextRequest) {
  const secret = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secret || secret.length < 32)
    return NextResponse.json(
      { error: "Webhook is not configured" },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length")) > 64 * 1024)
    return new NextResponse(null, { status: 413 });
  try {
    // Bounded streaming keeps an absent Content-Length from bypassing the cap.
    const reader = request.body?.getReader();
    if (!reader) return new NextResponse(null, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 64 * 1024) {
          await reader.cancel();
          return new NextResponse(null, { status: 413 });
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const event = verifiedWebhook(
      raw,
      request.headers.get("x-zernio-signature"),
      request.headers.get("x-zernio-event-id"),
      secret,
    );
    const result = await marketingCall("ingestWebhook", event);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        error:
          "Webhook rejected or temporarily unavailable; provider may retry",
      },
      { status: 400 },
    );
  }
}
