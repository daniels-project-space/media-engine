/// <reference types="vite/client" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { ZernioClient } from "../src/lib/marketing/zernio";
import { snapshotHash } from "../convex/marketingPolicy";

const bridge = vi.hoisted(() => ({
  call: vi.fn(),
  provider: vi.fn(),
  authorise: vi.fn(),
}));
vi.mock("../src/lib/marketing/service", () => ({
  marketingCall: bridge.call,
  providerClient: bridge.provider,
  authorisedAccount: bridge.authorise,
  publicFailure: (error: unknown) =>
    error instanceof Error ? error.message : "Provider failed",
}));
vi.mock("../src/lib/storage", () => ({
  objectExists: vi.fn(),
  presignedGet: vi.fn(),
}));
import { runMarketingItem } from "../src/lib/marketing/runner";

const modules = import.meta.glob("../convex/**/*.ts");
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`marketing:${name}`);
const query = (name: string) =>
  makeFunctionReference<"query">(`marketing:${name}`);

async function fixture(kind: "post" | "ad" = "post") {
  const t = convexTest(schema, modules);
  const projectId = await t.mutation(mutation("createProject"), {
    name: "Transport fixture",
    website: "https://fixture.example/",
    offer: "An explicitly local test offer",
    audience: "Operators",
    facts: ["This is a transport fixture"],
    goal: "signup",
    tone: "Plain",
    timezone: "UTC",
    cadence: 3,
    generationLimitMinor: 0,
    advertisingLimitMinor: 2_000,
    currency: "USD",
    conversionTokenHash: snapshotHash("fixture-only"),
  });
  await t.mutation(mutation("syncAccounts"), {
    accountCount: 1,
    pricingVerifiedAt: Date.now(),
    accounts: [
      {
        providerAccountId: "owned-account",
        profileId: "owned-profile",
        label: "Transport fixture",
        platform: kind === "post" ? "x" : "googleads",
        connected: true,
      },
    ],
  });
  const workspace = await t.query(query("listWorkspace"), { projectId });
  const accountId = workspace.accounts[0]._id;
  const channelId = await t.mutation(mutation("saveChannel"), {
    projectId,
    accountId,
    mode: "automatic",
    communityApproved: false,
    authorisedUntil: Date.now() + 86_400_000,
    ...(kind === "ad" ? { adAccountId: "123456" } : {}),
  });
  const itemId = await t.mutation(mutation("createItem"), {
    projectId,
    channelId,
    kind,
    title: "Fixture",
    content: "A confirmed fixture https://fixture.example/",
    scheduledAt: Date.now() + 600_000,
    idempotencyKey: `original-${kind}`,
    ...(kind === "ad"
      ? {
          ad: {
            headline: "A truthful fixture",
            description: "This does not run live",
            keywords: ["fixture"],
            countries: ["US"],
            dailyBudgetMinor: 100,
            durationDays: 1,
            maxSpendMinor: 400,
          },
        }
      : {}),
  });
  await t.mutation(mutation("setProjectStatus"), {
    projectId,
    status: "active",
  });
  await t.mutation(mutation("approveItem"), { projectId, itemId });
  bridge.call.mockImplementation((operation: string, payload: unknown) =>
    operation === "getItem"
      ? t.query(query(operation), payload as never)
      : t.mutation(mutation(operation), payload as never),
  );
  return { t, projectId, itemId, accountId, identity: { projectId, itemId } };
}

describe("advertising exposure and final billing recovery", () => {
  it("carries unresolved exposure over month changes before admitting another campaign", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-31T18:00:00Z"));
      const f = await fixture("ad");
      await f.t.run(async (ctx) => {
        await ctx.db.patch(f.projectId, { advertisingLimitMinor: 500 });
      });
      await f.t.mutation(mutation("claimItem"), {
        ...f.identity,
        workerRunId: "original",
      });
      const context = await f.t.query(query("getItem"), f.identity);
      vi.setSystemTime(new Date("2026-11-01T01:00:00Z"));
      const next = await f.t.mutation(mutation("createItem"), {
        projectId: f.projectId,
        channelId: context.channel._id,
        kind: "ad",
        title: context.item.title,
        content: context.item.content,
        ad: context.item.ad,
        scheduledAt: Date.now() + 600_000,
        idempotencyKey: "next-period-ad",
      });
      await f.t.mutation(mutation("approveItem"), {
        projectId: f.projectId,
        itemId: next,
      });
      await expect(
        f.t.mutation(mutation("claimItem"), {
          projectId: f.projectId,
          itemId: next,
          workerRunId: "next-period",
        }),
      ).rejects.toThrow(/Allowance exhausted/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases unused exposure only against an explicitly confirmed, immutable final invoice and avoids counting it twice", async () => {
    const f = await fixture("ad");
    await f.t.mutation(mutation("claimItem"), {
      ...f.identity,
      workerRunId: "original",
    });
    const metric = (spendMinor: number) => ({
      impressions: 1,
      clicks: 1,
      spendMinor,
      currency: "USD",
      capturedAt: Date.now(),
    });
    await f.t.mutation(mutation("recordOutcome"), {
      ...f.identity,
      status: "paused",
      providerId: "original-ad",
      providerCampaignId: "original-campaign",
      providerStatusReadAt: Date.now(),
      metrics: metric(100),
    });
    const settlement = {
      ...f.identity,
      expectedProviderId: "original-ad",
      expectedCampaignId: "original-campaign",
      reference: "fixture-final-invoice",
      finalSpendMinor: 150,
      confirmed: true,
    };
    await expect(
      f.t.mutation(mutation("settleAdBilling"), {
        ...settlement,
        confirmed: false,
      }),
    ).rejects.toThrow(/Confirm the final invoice/);
    await f.t.mutation(mutation("settleAdBilling"), settlement);
    expect(
      (await f.t.mutation(mutation("settleAdBilling"), settlement)).reused,
    ).toBe(true);
    await expect(
      f.t.mutation(mutation("settleAdBilling"), {
        ...settlement,
        finalSpendMinor: 0,
      }),
    ).rejects.toThrow(/immutable/);
    await f.t.mutation(mutation("recordOutcome"), {
      ...f.identity,
      status: "paused",
      metrics: metric(150),
    });
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.projectId,
    });
    const allowance = workspace.allowances.find((row: { scope: string }) =>
      row.scope.startsWith("advertising:"),
    );
    expect(allowance.spentMinor).toBe(150);
    expect(allowance.heldMinor).toBe(0);
    expect(workspace.items[0].heldAdvertisingMinor).toBe(0);
  });
});

describe("marketing worker with real Convex mutations and simulated provider transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MARKETING_METRICS_ENABLED", "false");
  });

  it("recovers an ambiguous create using the original key, preserving one admission and requiring the native link", async () => {
    const f = await fixture(),
      writes: string[] = [];
    let first = true;
    bridge.provider.mockResolvedValue(
      new ZernioClient("test-private-key-never-live", async (url, init) => {
        if (init?.method === "POST") {
          writes.push(
            (init.headers as Record<string, string>)["Idempotency-Key"],
          );
          if (first) {
            first = false;
            throw new Error("ACK lost after creation");
          }
          return Response.json({
            post: {
              _id: "original-post",
              status: "scheduled",
              platforms: [
                {
                  platform: "twitter",
                  accountId: "owned-account",
                  status: "pending",
                },
              ],
            },
          });
        }
        expect(String(url)).toContain("/posts/original-post");
        return Response.json({
          post: {
            _id: "original-post",
            status: "published",
            platforms: [
              {
                platform: "twitter",
                accountId: "owned-account",
                status: "published",
                platformPostUrl: "https://x.com/fixture/status/123",
              },
            ],
          },
        });
      }),
    );
    await runMarketingItem(f.identity, "first-run");
    let workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.projectId,
    });
    expect(workspace.items[0].status).toBe("uncertain");
    expect(workspace.allowances[0].heldMinor).toBe(20);
    await runMarketingItem(f.identity, "reconcile-run");
    workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.projectId,
    });
    expect(workspace.items[0].status).toBe("published");
    expect(workspace.items[0].publicationUrl).toBe(
      "https://x.com/fixture/status/123",
    );
    expect(workspace.allowances[0].spentMinor).toBe(20);
    expect(writes).toEqual(["original-post", "original-post"]);
  });

  it("never reports a cached paused ad as confirmed stopped", async () => {
    const f = await fixture("ad");
    await f.t.mutation(mutation("claimItem"), {
      ...f.identity,
      workerRunId: "original",
    });
    await f.t.mutation(mutation("recordOutcome"), {
      ...f.identity,
      status: "uncertain",
      providerId: "original-ad",
      providerCampaignId: "original-campaign",
    });
    bridge.provider.mockResolvedValue(
      new ZernioClient("test-private-key-never-live", async (url) => {
        if (String(url).includes("/analytics?"))
          return Response.json({
            ad: { id: "original-ad", currency: "USD" },
            analytics: { summary: { spend: 0, impressions: 0, clicks: 0 } },
          });
        expect(String(url)).toContain("live=true");
        return Response.json({
          statusReadAt: null,
          ad: {
            _id: "original-ad",
            status: "paused",
            accountId: "owned-account",
            platformCampaignId: "original-campaign",
          },
        });
      }),
    );
    await runMarketingItem(f.identity, "read-run");
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.projectId,
    });
    expect(workspace.items[0].status).toBe("uncertain");
    expect(workspace.items[0].error).toMatch(/unconfirmed/);
  });

  it("persists a paused creation and cancels it without activating if policy changes during the request", async () => {
    const f = await fixture("ad"),
      switches: string[] = [];
    bridge.provider.mockResolvedValue(
      new ZernioClient("test-private-key-never-live", async (url, init) => {
        if (String(url).includes("/ads/accounts?"))
          return Response.json({
            accounts: [{ id: "123456", currency: "USD", selected: true }],
          });
        if (String(url).endsWith("/ads/create")) {
          expect(JSON.parse(init!.body as string).status).toBe("PAUSED");
          await f.t.mutation(mutation("saveChannel"), {
            projectId: f.projectId,
            accountId: f.accountId,
            mode: "off",
            communityApproved: false,
          });
          return Response.json({
            ad: {
              _id: "original-ad",
              accountId: "owned-account",
              platformCampaignId: "original-campaign",
              status: "paused",
            },
          });
        }
        if (init?.method === "PUT") {
          switches.push(JSON.parse(init.body as string).status);
          return Response.json({ success: true });
        }
        if (String(url).includes("/analytics?"))
          return Response.json({
            ad: { id: "original-ad", currency: "USD" },
            analytics: { summary: { spend: 0, impressions: 0, clicks: 0 } },
          });
        return Response.json({
          statusReadAt: new Date().toISOString(),
          ad: {
            _id: "original-ad",
            status: "paused",
            accountId: "owned-account",
            platformCampaignId: "original-campaign",
          },
        });
      }),
    );
    await runMarketingItem(f.identity, "create-run");
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.projectId,
    });
    expect(switches).toEqual(["paused"]);
    expect(workspace.items[0].status).toBe("paused");
    expect(workspace.items[0].providerId).toBe("original-ad");
    expect(workspace.items[0].heldAdvertisingMinor).toBe(400);
  });
});
