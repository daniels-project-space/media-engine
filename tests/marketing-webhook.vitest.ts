/// <reference types="vite/client" />
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { verifiedWebhook } from "../src/lib/marketing/webhook";

describe("provider webhook authentication and immutable delivery receipts", () => {
  it("accepts an authenticated delayed retry, reads account.accountId and rejects tampering or an event-ID mismatch", () => {
    const secret = "private-fixture-signing-secret-000000";
    const raw = JSON.stringify({
      id: "stable-event",
      event: "ad.review.approved",
      timestamp: new Date(Date.now() - 51 * 3_600_000).toISOString(),
      account: { accountId: "owned-account" },
      adObject: { level: "AD", platformId: "native-ad", adId: "owned-ad" },
    });
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    expect(
      verifiedWebhook(raw, signature, "stable-event", secret),
    ).toMatchObject({
      providerId: "owned-ad",
      providerAccountId: "owned-account",
    });
    expect(() =>
      verifiedWebhook(raw + " ", signature, "stable-event", secret),
    ).toThrow(/signature/);
    expect(() =>
      verifiedWebhook(raw, signature, "another-event", secret),
    ).toThrow(/identity/);
  });

  it("deduplicates a signed receipt and refuses reuse of its event ID with a different body", async () => {
    const t = convexTest(schema, import.meta.glob("../convex/**/*.ts"));
    const fn = makeFunctionReference<"mutation">("marketing:ingestWebhook");
    const event = {
      eventId: "delivery-one",
      bodyHash: "a".repeat(64),
      event: "webhook.test",
    };
    expect((await t.mutation(fn, event)).reused).toBe(false);
    expect((await t.mutation(fn, event)).reused).toBe(true);
    await expect(
      t.mutation(fn, { ...event, bodyHash: "b".repeat(64) }),
    ).rejects.toThrow(/changed its original/);
  });
});
