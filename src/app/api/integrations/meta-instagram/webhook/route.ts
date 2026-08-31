import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { NextRequest, NextResponse } from "next/server";

import { creativeServiceToken } from "@/lib/creative-service";
import {
  type MetaInstagramInboundGatewayPayload,
  verifyMetaInstagramWebhook,
  verifyMetaInstagramWebhookChallenge,
} from "@/lib/creator-promotion/meta-instagram-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();

const INGEST_VERIFIED_META_INSTAGRAM_INBOUND = makeFunctionReference<
  "action",
  { serviceToken: string; payload: MetaInstagramInboundGatewayPayload },
  unknown
>("creatorPromotionsGateway:ingestVerifiedMetaInstagramInbound");

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function recorded(value: unknown): "accepted" | "ignored" | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.accepted === false) return "ignored";
  return record.accepted === true && typeof record.receiptId === "string" && record.receiptId.length > 0
    ? "accepted"
    : null;
}

/** Meta callback verification. A token match returns only the requested challenge. */
export function GET(request: NextRequest) {
  const verification = verifyMetaInstagramWebhookChallenge(request.nextUrl.searchParams);
  if (!verification.ok) {
    return new NextResponse(verification.status === 503 ? "Webhook unavailable" : "Forbidden", {
      status: verification.status,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse(verification.challenge, {
    status: 200,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * The sole inbound Meta boundary. It verifies the HMAC over raw bytes before
 * parsing, records only customer-initiated text metadata, and never invokes a
 * draft, send, worker, account creation, or external provider call.
 */
export async function POST(request: NextRequest) {
  const verification = await verifyMetaInstagramWebhook(request);
  if (!verification.ok) {
    if (verification.status === 503) return json({ error: "Webhook unavailable." }, 503);
    return json({ error: "Webhook not accepted." }, verification.status);
  }
  if (!CONVEX_URL) return json({ error: "Webhook unavailable." }, 503);

  try {
    const [serviceToken] = await Promise.all([creativeServiceToken()]);
    const convex = new ConvexHttpClient(CONVEX_URL);
    let accepted = 0;
    let ignored = 0;
    // Each mutation is independently idempotent, so a provider retry after a
    // transient failure cannot duplicate messages already recorded above it.
    for (const payload of verification.deliveries) {
      const result = recorded(await convex.action(INGEST_VERIFIED_META_INSTAGRAM_INBOUND, { serviceToken, payload }));
      if (result === "accepted") accepted += 1;
      else if (result === "ignored") ignored += 1;
      else throw new Error("Meta inbound gateway did not confirm a durable result");
    }
    return json({ accepted: true, processed: accepted, ignored }, 202);
  } catch {
    // Intentionally hide configuration, signature, account, and Convex errors
    // from the internet-facing sender. The receipt ledger makes retry safe.
    return json({ error: "Webhook unavailable." }, 503);
  }
}
