import { describe, expect, it } from "vitest";
import {
  buildAd,
  buildPost,
  ZernioClient,
  ZernioError,
} from "../src/lib/marketing/zernio";

const key = "private-test-key-never-log";
const post = {
  idempotencyKey: "immutable-post-key",
  providerAccountId: "owned-x",
  platform: "x" as const,
  title: "An update",
  content: "An original update",
  scheduledAt: Date.now() + 600_000,
};
const ad = {
  idempotencyKey: "immutable-ad-key",
  providerAccountId: "owned-google",
  adAccountId: "123456",
  platform: "googleads" as const,
  name: "Trial signup",
  headline: "A useful free trial",
  description: "Try our reviewed offer",
  destination: "https://example.com/?utm_campaign=trial",
  keywords: ["workflow tool"],
  countries: ["GB"],
  dailyBudgetMinor: 100,
  maxSpendMinor: 800,
  currency: "GBP",
  durationDays: 3,
  startsAt: Date.now() + 600_000,
};

describe("Zernio contract and failure boundaries", () => {
  it("keeps due-send cancellation unconfirmed and can repeat a native pause without a cached create key", async () => {
    const methods: string[] = [],
      keys: unknown[] = [];
    const client = new ZernioClient(key, async (_url, init) => {
      methods.push(init?.method ?? "GET");
      keys.push((init?.headers as Record<string, string>)["Idempotency-Key"]);
      return init?.method === "GET"
        ? Response.json({
            post: {
              _id: "scheduled-post",
              status: "scheduled",
              platforms: [
                {
                  platform: "twitter",
                  accountId: "owned-x",
                  status: "pending",
                },
              ],
            },
          })
        : Response.json({ success: true });
    });
    expect(
      (await client.cancelPost("scheduled-post", "owned-x", Date.now())).status,
    ).toBe("uncertain");
    await client.campaignStatus("campaign", "owned-x", "123456", "paused");
    await client.campaignStatus("campaign", "owned-x", "123456", "paused");
    expect(methods).toEqual(["GET", "DELETE", "PUT", "PUT"]);
    expect(keys).toEqual([undefined, undefined, undefined, undefined]);
  });
  it("reads team-wide metering and the actual X cap rather than treating a scoped account list as the bill", async () => {
    const client = new ZernioClient(key, async (url) => {
      expect(String(url)).toBe("https://zernio.com/api/v1/usage");
      return Response.json({
        billingSystem: "metronome",
        hasAccess: true,
        usage: { connectedAccounts: 6 },
        spend: {
          currentPeriodCents: 2_800,
          xSpendCents: 400,
          xSpendLimitCents: 500,
        },
      });
    });
    expect(await client.billingSnapshot()).toEqual({
      accountCount: 6,
      periodSpendMinor: 2_800,
      xSpendMinor: 400,
      xSpendLimitMinor: 500,
    });
    const legacy = new ZernioClient(key, async () =>
      Response.json({ billingSystem: "stripe", hasAccess: true }),
    );
    await expect(legacy.billingSnapshot()).rejects.toThrow();
  });

  it("rejects ad-account scope/currency mismatches and inaccessible Meta Pages before a write", async () => {
    const client = new ZernioClient(key, async (url) =>
      String(url).includes("facebook-page")
        ? Response.json({ pages: [{ id: "owned-page" }] })
        : Response.json({
            accounts: [
              {
                id: "123456",
                currency: "EUR",
                selected: true,
                selectable: true,
              },
            ],
          }),
    );
    await expect(
      client.verifyAdAccount("connection", "123456", "USD"),
    ).rejects.toThrow(/currency/);
    expect(
      (await client.verifyAdAccount("connection", "123456", "EUR")).id,
    ).toBe("123456");
    await expect(
      client.verifyMetaPage("connection", "foreign-page"),
    ).rejects.toThrow(/not accessible/);
  });
  it("sends the same idempotency key and exact immutable platform body on a safe retry", async () => {
    const bodies: string[] = [],
      keys: string[] = [];
    const client = new ZernioClient(key, async (url, init) => {
      expect(String(url)).toBe("https://zernio.com/api/v1/posts");
      bodies.push(init!.body as string);
      keys.push((init!.headers as Record<string, string>)["Idempotency-Key"]);
      return Response.json({
        post: {
          _id: "provider-post",
          status: "scheduled",
          platforms: [
            { platform: "twitter", accountId: "owned-x", status: "pending" },
          ],
        },
      });
    });
    expect((await client.createPost(post)).status).toBe("scheduled");
    expect((await client.createPost(post)).status).toBe("scheduled");
    expect(bodies[0]).toBe(bodies[1]);
    expect(keys).toEqual([post.idempotencyKey, post.idempotencyKey]);
    expect(JSON.parse(bodies[0]).platforms).toEqual([
      { platform: "twitter", accountId: "owned-x", platformSpecificData: {} },
    ]);
  });

  it("cannot treat a scheduled response, missing native URL or foreign account as publication", async () => {
    const client = new ZernioClient(key, async () =>
      Response.json({
        post: {
          _id: "p",
          status: "published",
          platforms: [
            { platform: "twitter", accountId: "owned-x", status: "published" },
          ],
        },
      }),
    );
    expect((await client.createPost(post)).status).toBe("uncertain");
    const foreign = new ZernioClient(key, async () =>
      Response.json({
        post: {
          _id: "p",
          status: "published",
          platforms: [
            {
              platform: "twitter",
              accountId: "foreign",
              status: "published",
              platformPostUrl: "https://x.com/foreign/status/1",
            },
          ],
        },
      }),
    );
    await expect(foreign.createPost(post)).rejects.toThrow(/approved account/);
  });

  it("does not retry an ambiguous create internally and strips credential-bearing provider errors", async () => {
    let calls = 0;
    const client = new ZernioClient(key, async () => {
      calls++;
      throw new Error(`transport leaked ${key}`);
    });
    try {
      await client.createPost(post);
      throw new Error("expected provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ZernioError);
      expect((error as ZernioError).uncertain).toBe(true);
      expect(String(error)).not.toContain(key);
    }
    expect(calls).toBe(1);
    const denied = new ZernioClient(
      key,
      async () => new Response(`bad credential ${key}`, { status: 401 }),
    );
    await expect(denied.createPost(post)).rejects.toMatchObject({
      status: 401,
      uncertain: false,
    });
  });

  it("handles 429 with bounded Retry-After and never swallows malformed success receipts", async () => {
    const limited = new ZernioClient(
      key,
      async () =>
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "120" },
        }),
    );
    await expect(limited.createPost(post)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 120,
    });
    const malformed = new ZernioClient(key, async () =>
      Response.json({ ok: true }),
    );
    await expect(malformed.createPost(post)).rejects.toThrow();
  });

  it("counts every provider account for fees while returning only supported channel records", async () => {
    let calls = 0;
    const client = new ZernioClient(key, async (url) => {
      calls++;
      const params = new URL(String(url)).searchParams;
      expect(params.get("includeOverLimit")).toBe("true");
      return Response.json({
        accounts:
          calls === 1
            ? [
                {
                  _id: "instagram",
                  platform: "instagram",
                  profileId: { _id: "brand" },
                  isActive: true,
                },
                {
                  _id: "youtube",
                  platform: "youtube",
                  profileId: "brand",
                  isActive: true,
                },
              ]
            : [
                {
                  _id: "reddit",
                  platform: "reddit",
                  profileId: "brand",
                  isActive: true,
                  needsReconnection: true,
                },
              ],
        pagination: { nextCursor: calls === 1 ? "next" : null },
      });
    });
    const inventory = await client.listAccounts();
    expect(inventory.accountCount).toBe(3);
    expect(inventory.accounts).toHaveLength(2);
    expect(inventory.accounts[1].connected).toBe(false);
  });

  it("never deletes an already-published post when a project is paused", async () => {
    const methods: string[] = [];
    const client = new ZernioClient(key, async (_url, init) => {
      methods.push(init!.method!);
      return Response.json({
        post: {
          _id: "p",
          status: "published",
          platforms: [
            {
              platform: "twitter",
              accountId: "owned-x",
              status: "published",
              platformPostUrl: "https://x.com/brand/status/1",
            },
          ],
        },
      });
    });
    expect((await client.cancelPost("p", "owned-x")).status).toBe("published");
    expect(methods).toEqual(["GET"]);
  });

  it("creates ad trees paused, converts cents to whole currency units once and sets an explicit end", () => {
    const body = buildAd(ad);
    expect(body.status).toBe("PAUSED");
    expect(body.budgetAmount).toBe(1);
    expect(body.budgetType).toBe("daily");
    expect(body.endDate).toBe(
      new Date(ad.startsAt + 3 * 86_400_000).toISOString(),
    );
    expect(() => buildAd({ ...ad, currency: "JPY" })).toThrow(
      /currencies|accounts only/,
    );
    expect(() => buildAd({ ...ad, maxSpendMinor: 1 })).toThrow(/budget/);
    expect(() => buildAd({ ...ad, countries: [] })).toThrow(/countries/);
    expect(() => buildPost({ ...post, platform: "instagram" })).toThrow(
      /media/,
    );
    expect(() =>
      buildPost({
        ...post,
        platform: "reddit",
        subreddit: "unauthorised community",
      }),
    ).toThrow(/subreddit/);
  });
});
