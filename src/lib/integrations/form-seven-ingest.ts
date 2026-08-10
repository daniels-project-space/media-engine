import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The public FORM / SEVEN site owns the original submission and uploads. This
 * module accepts only a small, signed metadata envelope that is safe to put in
 * the Media Engine control plane. It deliberately has no renderer, mailer, or
 * publishing dependency.
 */
export const FORM_SEVEN_INGEST_PATH = "/api/integrations/form-seven/events";
export const FORM_SEVEN_MAX_BODY_BYTES = 128 * 1024;
const FORM_SEVEN_REPLAY_WINDOW_MS = 5 * 60 * 1_000;

const CURRENT_KEY_ID_ENV = "FORM_SEVEN_INGEST_KEY_ID";
const CURRENT_SECRET_ENV = "FORM_SEVEN_INGEST_HMAC_SECRET";
const PREVIOUS_KEY_ID_ENV = "FORM_SEVEN_INGEST_PREVIOUS_KEY_ID";
const PREVIOUS_SECRET_ENV = "FORM_SEVEN_INGEST_PREVIOUS_HMAC_SECRET";

const EVENT_TYPES = new Set([
  "form_seven.free_video_brief.created",
  "form_seven.service_inquiry.created",
] as const);

const ARTIFACT_KINDS = new Set(["image", "video", "document", "pdf", "website", "other"] as const);

type FormSevenEventType = "form_seven.free_video_brief.created" | "form_seven.service_inquiry.created";
type FormSevenArtifactKind = "image" | "video" | "document" | "pdf" | "website" | "other";

type FormSevenArtifact = {
  kind: FormSevenArtifactKind;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceDigest?: string;
  contentType?: string;
  byteSize?: number;
};

export type FormSevenGatewayPayload = {
  organizationSlug: "form-seven";
  eventId: string;
  eventType: FormSevenEventType;
  payloadHash: string;
  occurredAt?: number;
  intake: {
    externalIntakeId: string;
    eventType: FormSevenEventType;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    businessName?: string;
    businessType?: string;
    websiteUrl?: string;
    selectedService?: string;
    briefDescription?: string;
    referenceCount: number;
    marketingOptIn: boolean;
    artifacts: FormSevenArtifact[];
  };
};

export type FormSevenIngressFailure = {
  ok: false;
  status: 400 | 401 | 413 | 503;
  code: "invalid_body" | "invalid_headers" | "invalid_payload" | "invalid_signature" | "expired_timestamp" | "ingest_unconfigured" | "body_too_large";
};

export type FormSevenIngressSuccess = {
  ok: true;
  payload: FormSevenGatewayPayload;
};

export type FormSevenIngressVerification = FormSevenIngressSuccess | FormSevenIngressFailure;

type SigningKey = { keyId: string; secret: string };
type SigningConfiguration = { ok: true; keys: SigningKey[] } | { ok: false };
type UnknownRecord = Record<string, unknown>;

function failure(status: FormSevenIngressFailure["status"], code: FormSevenIngressFailure["code"]): FormSevenIngressFailure {
  return { ok: false, status, code };
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allowedKeys(record: UnknownRecord, keys: readonly string[]): boolean {
  const permitted = new Set(keys);
  return Object.keys(record).every((key) => permitted.has(key));
}

function requiredString(value: unknown, maxLength: number, pattern?: RegExp): string {
  if (typeof value !== "string") throw new Error("expected string");
  const clean = value.trim();
  if (!clean || clean.length > maxLength || (pattern && !pattern.test(clean))) throw new Error("invalid string");
  return clean;
}

function requiredIdentifier(value: unknown, maxLength: number, pattern: RegExp): string {
  if (typeof value !== "string" || value !== value.trim() || !value || value.length > maxLength || !pattern.test(value)) {
    throw new Error("invalid identifier");
  }
  return value;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, maxLength);
}

function optionalHttpUrl(value: unknown): string | undefined {
  const sourceUrl = optionalString(value, 2_048);
  if (!sourceUrl) return undefined;
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid URL");
  return parsed.toString();
}

function optionalDigest(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, 64, /^[a-f0-9]{64}$/);
}

function optionalInteger(value: unknown, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error("invalid integer");
  }
  return value;
}

function parseArtifact(value: unknown): FormSevenArtifact {
  if (!isPlainRecord(value) || !allowedKeys(value, ["kind", "sourceLabel", "sourceUrl", "sourceDigest", "contentType", "byteSize"])) {
    throw new Error("invalid artifact");
  }
  const kind = requiredIdentifier(value.kind, 16, /^[a-z]+$/) as FormSevenArtifactKind;
  if (!ARTIFACT_KINDS.has(kind)) throw new Error("invalid artifact kind");

  const sourceLabel = optionalString(value.sourceLabel, 240);
  const sourceUrl = optionalHttpUrl(value.sourceUrl);
  const sourceDigest = optionalDigest(value.sourceDigest);
  if (!sourceLabel && !sourceUrl && !sourceDigest) throw new Error("artifact needs a safe reference");

  const contentType = optionalString(value.contentType, 128);
  if (contentType && !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(?:;\s*[a-z0-9!#$&^_.+-]+=[^;\s]+)*$/i.test(contentType)) {
    throw new Error("invalid content type");
  }

  return {
    kind,
    sourceLabel,
    sourceUrl,
    sourceDigest,
    contentType,
    byteSize: optionalInteger(value.byteSize, Number.MAX_SAFE_INTEGER),
  };
}

function parseOccurredAt(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  // The source event time is observational metadata. The signed request time is
  // the replay-control clock, so this value cannot relax the five-minute gate.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid occurredAt");
  return value;
}

function parsePayload(text: string, payloadHash: string): FormSevenGatewayPayload {
  const candidate = JSON.parse(text) as unknown;
  if (!isPlainRecord(candidate) || !allowedKeys(candidate, ["eventId", "eventType", "occurredAt", "intake"])) {
    throw new Error("invalid envelope");
  }

  const eventId = requiredIdentifier(candidate.eventId, 160, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/);
  const eventType = requiredIdentifier(candidate.eventType, 80, /^[a-z0-9._-]+$/) as FormSevenEventType;
  if (!EVENT_TYPES.has(eventType)) throw new Error("invalid event type");

  if (!isPlainRecord(candidate.intake) || !allowedKeys(candidate.intake, [
    "externalIntakeId",
    "eventType",
    "contactName",
    "contactEmail",
    "contactPhone",
    "businessName",
    "businessType",
    "websiteUrl",
    "selectedService",
    "briefDescription",
    "referenceCount",
    "marketingOptIn",
    "artifacts",
  ])) {
    throw new Error("invalid intake");
  }
  const intake = candidate.intake;
  const intakeEventType = requiredIdentifier(intake.eventType, 80, /^[a-z0-9._-]+$/) as FormSevenEventType;
  if (!EVENT_TYPES.has(intakeEventType) || intakeEventType !== eventType) throw new Error("event type mismatch");

  const contactEmail = optionalString(intake.contactEmail, 320);
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error("invalid contact email");
  const contactPhone = optionalString(intake.contactPhone, 64);
  if (contactPhone && !/^[0-9+(). -]{5,64}$/.test(contactPhone)) throw new Error("invalid contact phone");
  if (typeof intake.marketingOptIn !== "boolean") throw new Error("marketing opt-in must be explicit");
  if (!Array.isArray(intake.artifacts) || intake.artifacts.length > 64) throw new Error("invalid artifacts");
  const artifacts = intake.artifacts.map(parseArtifact);
  const referenceCount = optionalInteger(intake.referenceCount, 10_000);
  if (referenceCount === undefined) throw new Error("reference count is required");

  return {
    organizationSlug: "form-seven",
    eventId,
    eventType,
    payloadHash,
    occurredAt: parseOccurredAt(candidate.occurredAt),
    intake: {
      externalIntakeId: requiredIdentifier(intake.externalIntakeId, 160, /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/),
      eventType: intakeEventType,
      contactName: optionalString(intake.contactName, 160),
      contactEmail,
      contactPhone,
      businessName: optionalString(intake.businessName, 160),
      businessType: optionalString(intake.businessType, 120),
      websiteUrl: optionalHttpUrl(intake.websiteUrl),
      selectedService: optionalString(intake.selectedService, 120),
      briefDescription: optionalString(intake.briefDescription, 12_000),
      referenceCount,
      marketingOptIn: intake.marketingOptIn,
      artifacts,
    },
  };
}

function readSigningConfiguration(): SigningConfiguration {
  const currentKeyId = process.env[CURRENT_KEY_ID_ENV]?.trim();
  const currentSecret = process.env[CURRENT_SECRET_ENV];
  if (
    !currentKeyId
    || !/^[A-Za-z0-9._-]{1,128}$/.test(currentKeyId)
    || !currentSecret
    || Buffer.byteLength(currentSecret, "utf8") < 32
  ) return { ok: false };

  const previousKeyId = process.env[PREVIOUS_KEY_ID_ENV]?.trim();
  const previousSecret = process.env[PREVIOUS_SECRET_ENV];
  if (Boolean(previousKeyId) !== Boolean(previousSecret)) return { ok: false };

  const keys: SigningKey[] = [{ keyId: currentKeyId, secret: currentSecret }];
  if (previousKeyId && previousSecret) {
    if (
      !/^[A-Za-z0-9._-]{1,128}$/.test(previousKeyId)
      || previousKeyId === currentKeyId
      || Buffer.byteLength(previousSecret, "utf8") < 32
    ) return { ok: false };
    keys.push({ keyId: previousKeyId, secret: previousSecret });
  }
  return { ok: true, keys };
}

function exactHeader(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  return value && value === value.trim() ? value : null;
}

function parseSignedTimestamp(value: string): number | null {
  // Support Unix seconds and milliseconds so a deliberate key rotation does
  // not require a simultaneous deploy of both services. The raw header value
  // still participates unchanged in the canonical signed message.
  if (!/^(?:\d{10}|\d{13})$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return value.length === 10 ? parsed * 1_000 : parsed;
}

async function readBodyWithinLimit(request: Request): Promise<{ ok: true; body: Uint8Array } | FormSevenIngressFailure> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return failure(400, "invalid_headers");
    if (Number(contentLength) > FORM_SEVEN_MAX_BODY_BYTES) return failure(413, "body_too_large");
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
      if (total > FORM_SEVEN_MAX_BODY_BYTES) return failure(413, "body_too_large");
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

/**
 * Reads and authenticates the exact raw request body. No `request.json()` call
 * is made before verification, which prevents a parser/re-serialization change
 * from changing the bytes covered by FORM / SEVEN's signature.
 */
export async function verifyFormSevenIngress(request: Request): Promise<FormSevenIngressVerification> {
  const configuration = readSigningConfiguration();
  if (!configuration.ok) return failure(503, "ingest_unconfigured");

  const bodyResult = await readBodyWithinLimit(request);
  if (!bodyResult.ok) return bodyResult;

  const keyId = exactHeader(request.headers, "X-Form-Seven-Key-Id");
  const eventId = exactHeader(request.headers, "X-Form-Seven-Event-Id");
  const timestamp = exactHeader(request.headers, "X-Form-Seven-Timestamp");
  const bodyHashHeader = exactHeader(request.headers, "X-Form-Seven-Body-SHA256");
  const signature = exactHeader(request.headers, "X-Form-Seven-Signature");
  if (!keyId || !eventId || !timestamp || !bodyHashHeader || !signature) return failure(400, "invalid_headers");
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(keyId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(eventId)
    || !/^[a-f0-9]{64}$/.test(bodyHashHeader)
    || !/^[a-f0-9]{64}$/.test(signature)) {
    return failure(400, "invalid_headers");
  }

  const timestampMs = parseSignedTimestamp(timestamp);
  if (timestampMs === null || Math.abs(Date.now() - timestampMs) > FORM_SEVEN_REPLAY_WINDOW_MS) {
    return failure(401, "expired_timestamp");
  }

  const payloadHash = createHash("sha256").update(bodyResult.body).digest("hex");
  if (!constantTimeEqual(bodyHashHeader, payloadHash)) return failure(401, "invalid_signature");

  const signingKey = configuration.keys.find((candidate) => candidate.keyId === keyId);
  if (!signingKey) return failure(401, "invalid_signature");
  const canonical = `FORM-SEVEN-V1\nPOST\n${FORM_SEVEN_INGEST_PATH}\n${timestamp}\n${eventId}\n${payloadHash}`;
  const expectedSignature = createHmac("sha256", signingKey.secret).update(canonical, "utf8").digest("hex");
  if (!constantTimeEqual(signature, expectedSignature)) return failure(401, "invalid_signature");

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return failure(400, "invalid_headers");

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bodyResult.body);
  } catch {
    return failure(400, "invalid_body");
  }
  try {
    const payload = parsePayload(text, payloadHash);
    if (!constantTimeEqual(eventId, payload.eventId)) return failure(400, "invalid_payload");
    return { ok: true, payload };
  } catch {
    return failure(400, "invalid_payload");
  }
}
