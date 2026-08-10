import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { NextRequest, NextResponse } from "next/server";
import { creativeServiceToken } from "@/lib/creative-service";
import {
  type FormSevenGatewayPayload,
  verifyFormSevenIngress,
} from "@/lib/integrations/form-seven-ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const INGEST_FORM_SEVEN_EVENT = makeFunctionReference<
  "action",
  { serviceToken: string; payload: FormSevenGatewayPayload },
  unknown
>("controlPlaneGateway:ingestFormSevenEvent");

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function recordedReceipt(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const receiptId = (value as Record<string, unknown>).receiptId;
  return typeof receiptId === "string" && receiptId.length > 0;
}

/**
 * FORM / SEVEN's signed outbox boundary. Successful calls only record an
 * idempotent receipt + intake in the private control plane. This route cannot
 * dispatch a render, contact a lead, send an email, or publish anything.
 */
export async function POST(request: NextRequest) {
  const verification = await verifyFormSevenIngress(request);
  if (!verification.ok) {
    if (verification.status === 503) {
      return response({ error: "FORM / SEVEN intake is not configured." }, 503);
    }
    return response({ error: "FORM / SEVEN event was not accepted." }, verification.status);
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!convexUrl) return response({ error: "FORM / SEVEN intake is unavailable." }, 503);

  try {
    const serviceToken = await creativeServiceToken();
    const convex = new ConvexHttpClient(convexUrl);
    const receipt = await convex.action(INGEST_FORM_SEVEN_EVENT, {
      serviceToken,
      payload: verification.payload,
    });
    // The gateway confirms a durable receipt (including idempotent replays)
    // before this endpoint can emit the accepted status.
    if (!recordedReceipt(receipt)) throw new Error("intake gateway did not confirm a receipt");
    return response({ accepted: true, eventId: verification.payload.eventId }, 202);
  } catch {
    // Do not expose provider, Convex, or credential errors to an internet-facing
    // sender. A retry with the same event id is safe at the idempotent gateway.
    return response({ error: "FORM / SEVEN intake is temporarily unavailable." }, 503);
  }
}
