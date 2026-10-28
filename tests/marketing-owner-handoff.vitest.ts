import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { verifyHubHandoff } from "../src/lib/operator-hub-handoff";

afterEach(() => vi.unstubAllEnvs());
it("accepts only the isolated, short-lived Hub handoff for the marketing audience", () => {
  const secret = "fixture-handoff-secret-with-at-least-32-bytes",
    now = Date.now(),
    expires = Math.floor(now / 1000) + 60,
    nonce = "12345678-1234-1234-1234-123456789abc";
  vi.stubEnv("MEDIA_ENGINE_HUB_HANDOFF_SECRET", secret);
  const sign = (deadline: number, audience = "/marketing") =>
    `hub1.${deadline}.${nonce}.${createHmac("sha256", secret).update(`project-hub:media-engine:${audience}:${deadline}:${nonce}`).digest("base64url")}`;
  const code = sign(expires);
  expect(verifyHubHandoff(code, now)).toBe(true);
  expect(verifyHubHandoff(code, now + 61_000)).toBe(false);
  expect(verifyHubHandoff(sign(expires + 60), now)).toBe(false);
  expect(verifyHubHandoff(sign(expires, "/settings"), now)).toBe(false);
  expect(verifyHubHandoff(`${code}x`, now)).toBe(false);
  vi.stubEnv(
    "MEDIA_ENGINE_HUB_HANDOFF_SECRET",
    "another-isolated-secret-of-at-least-32-bytes",
  );
  expect(verifyHubHandoff(code, now)).toBe(false);
  vi.stubEnv("MEDIA_ENGINE_HUB_HANDOFF_SECRET", "");
  expect(verifyHubHandoff(code, now)).toBe(false);
});
