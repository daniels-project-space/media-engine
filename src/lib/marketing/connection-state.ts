import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const connectionPlatforms = [
  "instagram",
  "x",
  "reddit",
  "metaads",
  "googleads",
] as const;

export type ConnectionPlatform = (typeof connectionPlatforms)[number];

const MAX_AGE_MS = 30 * 60_000;
const payloadSchema = z
  .object({
    projectId: z.string().regex(/^[a-z0-9]{20,64}$/),
    profileId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
    platform: z.enum(connectionPlatforms),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/),
  })
  .strict();

export type MarketingConnectionState = z.infer<typeof payloadSchema>;

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(`media-engine-marketing-connect:v1:${encodedPayload}`)
    .digest();
}

export function signMarketingConnectionState(
  input: Pick<MarketingConnectionState, "projectId" | "profileId" | "platform">,
  secret: string,
  now = Date.now(),
): string {
  if (secret.length < 32) throw new Error("Marketing connection signing key is unavailable");
  const payload = payloadSchema.parse({
    ...input,
    issuedAt: now,
    expiresAt: now + MAX_AGE_MS,
    nonce: randomBytes(18).toString("base64url"),
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${signature(encodedPayload, secret).toString("base64url")}`;
}

export function verifyMarketingConnectionState(
  token: string | null,
  secret: string,
  now = Date.now(),
): MarketingConnectionState | null {
  if (!token || secret.length < 32 || token.length > 2_000) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra !== undefined) return null;
  let actual: Buffer;
  try {
    actual = Buffer.from(encodedSignature, "base64url");
  } catch {
    return null;
  }
  const expected = signature(encodedPayload, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const payload = payloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")),
    );
    if (
      payload.issuedAt > now ||
      payload.expiresAt < now ||
      payload.expiresAt - payload.issuedAt !== MAX_AGE_MS
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
