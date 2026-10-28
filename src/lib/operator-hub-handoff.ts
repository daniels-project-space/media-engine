import { createHmac, timingSafeEqual } from "node:crypto";

/** Hub owner authentication grants a short-lived, audience-bound session handoff.
 * This credential is separate from provider keys and the existing operator token. */
export function verifyHubHandoff(value: unknown, now = Date.now()): boolean {
  const secret = process.env.MEDIA_ENGINE_HUB_HANDOFF_SECRET;
  if (
    !secret ||
    secret.length < 32 ||
    typeof value !== "string" ||
    value.length > 600
  )
    return false;
  const [version, expiresRaw, nonce, signature, extra] = value.split(".");
  if (
    version !== "hub1" ||
    !expiresRaw ||
    !nonce ||
    !signature ||
    extra ||
    !/^[a-f0-9-]{36}$/.test(nonce)
  )
    return false;
  const expires = Number(expiresRaw),
    seconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(expires) ||
    expires <= seconds ||
    expires > seconds + 70
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`project-hub:media-engine:/marketing:${expiresRaw}:${nonce}`)
    .digest("base64url");
  const a = Buffer.from(signature),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
