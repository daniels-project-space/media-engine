import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { snapshotHash } from "../../../convex/marketingPolicy";

const bodySchema = z.object({
  id: z.string().min(1).max(160),
  event: z.string().min(1).max(100),
  timestamp: z.string().datetime({ offset: true }),
  test: z.boolean().optional(),
  post: z
    .object({ _id: z.string().optional(), id: z.string().optional() })
    .optional(),
  account: z
    .object({
      accountId: z.string().optional(),
      _id: z.string().optional(),
      id: z.string().optional(),
    })
    .optional(),
  adObject: z
    .object({
      level: z.string(),
      platformId: z.string(),
      adId: z.string().optional(),
    })
    .optional(),
});

export function verifiedWebhook(
  raw: string,
  signature: string | null,
  eventId: string | null,
  secret: string,
) {
  if (
    secret.length < 32 ||
    raw.length > 64 * 1024 ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new Error("Invalid marketing webhook signature");
  const expected = createHmac("sha256", secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new Error("Invalid marketing webhook signature");
  const body = bodySchema.parse(JSON.parse(raw));
  if (body.id !== eventId || Date.parse(body.timestamp) > Date.now() + 60_000)
    throw new Error("Webhook identity or timestamp is invalid");
  // Provider retries can arrive over 51 hours later; stable event-ID dedup is
  // authoritative. Do not reject legitimate redelivery after five minutes.
  if (body.test)
    return {
      eventId: body.id,
      event: "webhook.test",
      bodyHash: snapshotHash(raw),
    };
  return {
    eventId: body.id,
    event: body.event,
    bodyHash: snapshotHash(raw),
    providerId: body.post?._id ?? body.post?.id ?? body.adObject?.adId,
    nativeCampaignId:
      body.adObject?.level === "CAMPAIGN"
        ? body.adObject.platformId
        : undefined,
    nativeAdId:
      body.adObject?.level === "AD" ? body.adObject.platformId : undefined,
    providerAccountId:
      body.account?.accountId ?? body.account?._id ?? body.account?.id,
  };
}
