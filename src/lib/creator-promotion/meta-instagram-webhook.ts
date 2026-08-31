import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Fixed public callback; credentials are read only inside the server route. */
export const META_INSTAGRAM_WEBHOOK_PATH = "/api/integrations/meta-instagram/webhook";
export const META_INSTAGRAM_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
export const META_INSTAGRAM_REPLY_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1_000;

const MAX_MESSAGE_TEXT = 2_000;
const MAX_SUMMARY_TEXT = 600;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

type UnknownRecord = Record<string, unknown>;

export type MetaInstagramInboundGatewayPayload = {
  officialRecipientId: string;
  /**
   * Opaque Instagram-scoped customer id captured only from Meta's signed
   * webhook. It is retained privately so an explicitly approved reply can be
   * addressed during the normal response window; it never reaches the UI.
   */
  customerSenderId: string;
  externalMessageId: string;
  /** A one-way hash used as the thread key shown to the control plane. */
  externalThreadId: string;
  /** Stable per-message digest, used by the atomic receipt ledger. */
  payloadHash: string;
  occurredAt: number;
  replyEligibilityEndsAt: number;
  /** Safe operator-visible summary; URLs, email addresses, and phones are redacted. */
  summary: string;
  /** Bounded private body used only for a future reviewed draft. */
  body: string;
};

type VerificationFailureCode =
  | "ingest_unconfigured"
  | "invalid_headers"
  | "invalid_signature"
  | "body_too_large"
  | "invalid_body"
  | "invalid_payload";

export type MetaInstagramWebhookVerification =
  | { ok: true; deliveries: MetaInstagramInboundGatewayPayload[] }
  | { ok: false; status: 400 | 401 | 413 | 503; code: VerificationFailureCode };
type MetaInstagramWebhookFailure = Extract<MetaInstagramWebhookVerification, { ok: false }>;

export type MetaInstagramChallengeVerification =
  | { ok: true; challenge: string }
  | { ok: false; status: 403 | 503 };

type MetaWebhookConfiguration =
  | { ok: true; appSecret: string; verifyToken: string }
  | { ok: false };

function isRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function failure(
  status: MetaInstagramWebhookFailure["status"],
  code: VerificationFailureCode,
): MetaInstagramWebhookFailure {
  return { ok: false, status, code };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function configured(): MetaWebhookConfiguration {
  const appSecret = process.env.META_APP_SECRET;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (
    !appSecret
    || !verifyToken
    || Buffer.byteLength(appSecret, "utf8") < 16
    || Buffer.byteLength(verifyToken, "utf8") < 16
  ) {
    return { ok: false };
  }
  return { ok: true, appSecret, verifyToken };
}

function exactHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  return value && value === value.trim() ? value : null;
}

async function readBodyWithinLimit(request: Request): Promise<{ ok: true; body: Uint8Array } | MetaInstagramWebhookFailure> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return failure(400, "invalid_headers");
    if (Number(contentLength) > META_INSTAGRAM_WEBHOOK_MAX_BODY_BYTES) return failure(413, "body_too_large");
  }
  if (!request.body) return { ok: true, body: new Uint8Array() };

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > META_INSTAGRAM_WEBHOOK_MAX_BODY_BYTES) return failure(413, "body_too_large");
      chunks.push(next.value);
    }
  } catch {
    return failure(400, "invalid_body");
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value !== value.trim() || !IDENTIFIER.test(value)) return undefined;
  return value;
}

function timestampMs(value: unknown): number | undefined {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^(?:\d{10}|\d{13})$/.test(raw)) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return undefined;
  const milliseconds = raw.length === 10 ? parsed * 1_000 : parsed;
  // A signed inbound message should never claim a future event. A generous
  // historical bound keeps delayed provider retries ingestible without
  // accepting malformed epoch values.
  if (milliseconds < Date.UTC(2014, 0, 1) || milliseconds > Date.now() + 5 * 60 * 1_000) return undefined;
  return milliseconds;
}

function compactText(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const compact = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/https?:\/\/[^\s]+/gi, "[link]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?<!\w)(?:\+?\d[\d(). -]{6,}\d)(?!\w)/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum)
    .trim();
  return compact || undefined;
}

function safeSummary(body: string): string {
  const summary = body
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?<!\w)(?:\+?\d[\d(). -]{6,}\d)(?!\w)/g, "[phone]")
    .slice(0, MAX_SUMMARY_TEXT - "Instagram inbound: ".length)
    .trim();
  return `Instagram inbound: ${summary || "customer message received"}`;
}

function threadKey(officialRecipientId: string, senderId: string): string {
  const customerHash = createHash("sha256")
    .update(`meta-instagram-thread-v1\u0000${officialRecipientId}\u0000${senderId}`, "utf8")
    .digest("hex");
  return `meta-instagram:${customerHash}`;
}

function messageDigest(args: {
  officialRecipientId: string;
  customerSenderId: string;
  externalMessageId: string;
  occurredAt: number;
  externalThreadId: string;
  body: string;
}): string {
  return createHash("sha256")
    .update(
      `meta-instagram-inbound-v1\u0000${args.officialRecipientId}\u0000${args.customerSenderId}\u0000${args.externalMessageId}\u0000${args.occurredAt}\u0000${args.externalThreadId}\u0000${args.body}`,
      "utf8",
    )
    .digest("hex");
}

function customerInboundFromEvent(entryRecipientId: string, value: unknown): MetaInstagramInboundGatewayPayload | undefined {
  if (!isRecord(value) || !isRecord(value.sender) || !isRecord(value.recipient) || !isRecord(value.message)) return undefined;
  const senderId = identifier(value.sender.id);
  const officialRecipientId = identifier(value.recipient.id);
  const occurredAt = timestampMs(value.timestamp);
  const externalMessageId = identifier(value.message.mid);
  if (
    !senderId
    || !officialRecipientId
    || !occurredAt
    || !externalMessageId
    || officialRecipientId !== entryRecipientId
    || senderId === officialRecipientId
    || value.message.is_echo === true
    || value.message.is_self === true
    || value.message.is_deleted === true
    || value.message.is_unsupported === true
  ) {
    return undefined;
  }
  const body = compactText(value.message.text, MAX_MESSAGE_TEXT);
  // Attachments, postbacks, echoes, delivery receipts, and messages lacking
  // text stay in Meta. This minimum ingress accepts only actual text written
  // by the customer, never an outbound event or a rich-media URL.
  if (!body) return undefined;
  const externalThreadId = threadKey(officialRecipientId, senderId);
  return {
    officialRecipientId,
    customerSenderId: senderId,
    externalMessageId,
    externalThreadId,
    payloadHash: messageDigest({ officialRecipientId, customerSenderId: senderId, externalMessageId, occurredAt, externalThreadId, body }),
    occurredAt,
    replyEligibilityEndsAt: occurredAt + META_INSTAGRAM_REPLY_ELIGIBILITY_WINDOW_MS,
    summary: safeSummary(body),
    body,
  };
}

function parseDeliveries(text: string): MetaInstagramInboundGatewayPayload[] {
  const payload = JSON.parse(text) as unknown;
  if (!isRecord(payload) || payload.object !== "instagram" || !Array.isArray(payload.entry) || payload.entry.length > 100) {
    throw new Error("invalid Meta Instagram webhook envelope");
  }
  const deliveries: MetaInstagramInboundGatewayPayload[] = [];
  const seen = new Set<string>();
  for (const entry of payload.entry) {
    if (!isRecord(entry)) throw new Error("invalid Meta Instagram webhook entry");
    const recipientId = identifier(entry.id);
    if (!recipientId || !Array.isArray(entry.messaging) || entry.messaging.length > 100) continue;
    for (const event of entry.messaging) {
      const delivery = customerInboundFromEvent(recipientId, event);
      if (!delivery) continue;
      const idempotencyKey = `${delivery.officialRecipientId}:${delivery.externalMessageId}`;
      if (seen.has(idempotencyKey)) continue;
      seen.add(idempotencyKey);
      deliveries.push(delivery);
    }
  }
  return deliveries;
}

/** Validates Meta's GET callback handshake without exposing either secret. */
export function verifyMetaInstagramWebhookChallenge(searchParams: URLSearchParams): MetaInstagramChallengeVerification {
  const configuration = configured();
  if (!configuration.ok) return { ok: false, status: 503 };
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (
    mode !== "subscribe"
    || !token
    || !constantTimeEqual(configuration.verifyToken, token)
    || !challenge
    || !/^[A-Za-z0-9._-]{1,512}$/.test(challenge)
  ) {
    return { ok: false, status: 403 };
  }
  return { ok: true, challenge };
}

/**
 * Verifies the signature against the exact raw body before JSON parsing, then
 * narrows the batch to customer-initiated plain-text Instagram messages only.
 */
export async function verifyMetaInstagramWebhook(request: Request): Promise<MetaInstagramWebhookVerification> {
  const configuration = configured();
  if (!configuration.ok) return failure(503, "ingest_unconfigured");
  const bodyResult = await readBodyWithinLimit(request);
  if (!bodyResult.ok) return bodyResult;

  const signature = exactHeader(request.headers, "x-hub-signature-256");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature) || contentType !== "application/json") {
    return failure(400, "invalid_headers");
  }
  const expected = `sha256=${createHmac("sha256", configuration.appSecret).update(bodyResult.body).digest("hex")}`;
  if (!constantTimeEqual(expected, signature)) return failure(401, "invalid_signature");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bodyResult.body);
  } catch {
    return failure(400, "invalid_body");
  }
  try {
    return { ok: true, deliveries: parseDeliveries(text) };
  } catch {
    return failure(400, "invalid_payload");
  }
}
