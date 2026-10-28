/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import {
  assertAvailable,
  integrationBaseMinor,
  publishCostMinor,
  snapshotHash,
  website,
  localPublicationTime,
} from "../convex/marketingPolicy";

const modules = import.meta.glob("../convex/**/*.ts");
const mutation = (name: string) =>
  makeFunctionReference<"mutation">(`marketing:${name}`);
const query = (name: string) =>
  makeFunctionReference<"query">(`marketing:${name}`);
const draft = (name: string) => ({
  name,
  website: `https://${name}.example/`,
  offer: `An owned ${name} offer`,
  audience: "Small business owners",
  facts: [`${name} has a free trial`],
  goal: "signup" as const,
  tone: "Clear and direct",
  timezone: "Europe/Zurich",
  cadence: 3,
  generationLimitMinor: 500,
  advertisingLimitMinor: 2_000,
  currency: "USD",
  conversionTokenHash: snapshotHash(`${name}-server-credential`),
});

async function projects() {
  const t = convexTest(schema, modules);
  const a = await t.mutation(mutation("createProject"), draft("alpha"));
  const b = await t.mutation(mutation("createProject"), draft("beta"));
  await t.mutation(mutation("syncAccounts"), {
    accountCount: 2,
    pricingVerifiedAt: Date.now(),
    accounts: [
      {
        providerAccountId: "alpha-x",
        profileId: "alpha-profile",
        platform: "x",
        label: "Alpha X",
        connected: true,
      },
      {
        providerAccountId: "beta-x",
        profileId: "beta-profile",
        platform: "x",
        label: "Beta X",
        connected: true,
      },
    ],
  });
  const workspace = await t.query(query("listWorkspace"), { projectId: a });
  const alphaAccount = workspace.accounts.find(
    (account: { providerAccountId: string }) =>
      account.providerAccountId === "alpha-x",
  );
  const betaAccount = workspace.accounts.find(
    (account: { providerAccountId: string }) =>
      account.providerAccountId === "beta-x",
  );
  const channelA = await t.mutation(mutation("saveChannel"), {
    projectId: a,
    accountId: alphaAccount._id,
    mode: "automatic",
    communityApproved: false,
    authorisedUntil: Date.now() + 86_400_000,
  });
  const channelB = await t.mutation(mutation("saveChannel"), {
    projectId: b,
    accountId: betaAccount._id,
    mode: "draft",
    communityApproved: false,
  });
  return { t, a, b, channelA, channelB };
}

async function item(
  fixture: Awaited<ReturnType<typeof projects>>,
  key = "alpha-post",
) {
  return fixture.t.mutation(mutation("createItem"), {
    projectId: fixture.a,
    channelId: fixture.channelA,
    kind: "post",
    title: "A new useful feature",
    content: "Try the free trial https://alpha.example/",
    scheduledAt: Date.now() + 600_000,
    idempotencyKey: key,
  });
}

describe("marketing isolation and dispatch invariants", () => {
  it("fences worker diagnostics, reuses retries and isolates projects", async () => {
    const f = await projects();
    const m = (name: string) => makeFunctionReference<"mutation">(`marketingPlans:${name}`);
    const q = makeFunctionReference<"query">("marketingPlans:latestAiCheck");
    const request = { projectId: f.a, requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const later = { projectId: f.a, requestKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect(await f.t.mutation(m("startAiCheck"), request)).toEqual({ status: "queued" });
    expect(await f.t.mutation(m("startAiCheck"), request)).toEqual({ status: "queued" });
    await expect(f.t.mutation(m("startAiCheck"), later)).rejects.toThrow(/Wait/);
    expect(await f.t.mutation(m("claimAiCheck"), request)).toBe(true);
    expect(await f.t.mutation(m("claimAiCheck"), request)).toBe(false);
    expect(await f.t.query(q, { projectId: f.b, asOfMinute: Math.floor(Date.now() / 60_000) })).toBeNull();
    const check = await f.t.query(q, { projectId: f.a, asOfMinute: Math.floor(Date.now() / 60_000) });
    await f.t.run(ctx => ctx.db.patch(check!._id, { updatedAt: Date.now() - 180_000 }));
    expect(await f.t.mutation(m("startAiCheck"), later)).toEqual({ status: "queued" });
    expect(await f.t.mutation(m("finishAiCheck"), { ...request, outcome: "subscription-login" })).toBe(false);
    expect(await f.t.mutation(m("claimAiCheck"), later)).toBe(true);
    expect(await f.t.mutation(m("finishAiCheck"), { ...later, outcome: "unavailable" })).toBe(true);
    expect(await f.t.query(q, { projectId: f.a, asOfMinute: Math.floor(Date.now() / 60_000) })).toMatchObject({ status: "completed", outcome: "unavailable" });
  });
  it("reads the existing AI kill switch through the internal marketing boundary and fails closed", async () => {
    const t = convexTest(schema, modules);
    const aiAllowed = makeFunctionReference<"query">("marketingPlans:aiAllowed");
    expect(await t.query(aiAllowed, {})).toBe(false);
    const id = await t.run(ctx => ctx.db.insert("settings", { key: "aiEnabled", value: "true" }));
    expect(await t.query(aiAllowed, {})).toBe(false);
    await t.run(ctx => ctx.db.patch(id, { value: true }));
    expect(await t.query(aiAllowed, {})).toBe(true);
    await t.run(ctx => ctx.db.patch(id, { value: false }));
    expect(await t.query(aiAllowed, {})).toBe(false);
  });
  it("keeps render briefs project-scoped, idempotent and tied to the current plan", async () => {
    const f = await projects();
    const planMutation = (name: string) => makeFunctionReference<"mutation">(`marketingPlans:${name}`);
    const planQuery = (name: string) => makeFunctionReference<"query">(`marketingPlans:${name}`);
    const calendar = JSON.stringify([{ day: 1, channel: "x", format: "video", videoScript: "Show the product and its benefit" }]);
    const saved = await f.t.mutation(planMutation("save"), { projectId: f.a, expectedProjectVersion: 1,
      expectedResearchVersion: 0, expectedRevision: 0, strategy: "Introduce the product", calendar, sources: "" });
    const request = { projectId: f.a, planId: saved.planId, entryIndex: 0, modelId: "minimax-h3" };
    const first = await f.t.mutation(planMutation("createRenderBrief"), request);
    expect(await f.t.mutation(planMutation("createRenderBrief"), request)).toEqual({ briefId: first.briefId, reused: true });
    expect((await f.t.query(planQuery("listRenderBriefs"), { projectId: f.a }))[0]).toMatchObject({ prompt: "Show the product and its benefit", modelId: "minimax-h3" });
    expect(await f.t.query(planQuery("listRenderBriefs"), { projectId: f.b })).toHaveLength(0);
    expect(await f.t.query(planQuery("getRenderBrief"), { projectId: f.a, briefId: first.briefId })).toEqual({ modelId: "minimax-h3", stale: false });
    await expect(f.t.query(planQuery("getRenderBrief"), { projectId: f.b, briefId: first.briefId })).rejects.toThrow();
    await expect(f.t.mutation(planMutation("createRenderBrief"), { ...request, projectId: f.b })).rejects.toThrow();
    await f.t.mutation(planMutation("save"), { projectId: f.a, expectedProjectVersion: 1,
      expectedResearchVersion: 0, expectedRevision: 1, strategy: "Revised", calendar, sources: "" });
    expect(await f.t.query(planQuery("getRenderBrief"), { projectId: f.a, briefId: first.briefId })).toEqual({ modelId: "minimax-h3", stale: true });
    await expect(f.t.mutation(planMutation("createRenderBrief"), { ...request, modelId: "qwen-image-2-1" })).rejects.toThrow(/current plan/);
  });
  it("admin cleanup refuses connected projects and removes only an exact unused draft", async () => {
    const f = await projects();
    await expect(
      f.t.mutation(mutation("removeEmptyProject"), {
        projectId: f.a,
        expectedName: "alpha",
      }),
    ).rejects.toThrow(/content or connections/);
    const empty = await f.t.mutation(
      mutation("createProject"),
      draft("unused"),
    );
    await expect(
      f.t.mutation(mutation("removeEmptyProject"), {
        projectId: empty,
        expectedName: "wrong",
      }),
    ).rejects.toThrow(/unused draft/);
    expect(
      await f.t.mutation(mutation("removeEmptyProject"), {
        projectId: empty,
        expectedName: "unused",
      }),
    ).toEqual({ removed: true });
    const checked = await f.t.mutation(mutation("createProject"), draft("checked"));
    await f.t.mutation(makeFunctionReference<"mutation">("marketingPlans:startAiCheck"), {
      projectId: checked, requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    await expect(f.t.mutation(mutation("removeEmptyProject"), { projectId: checked, expectedName: "checked" }))
      .rejects.toThrow(/content or connections/);
  });

  it("replays the same onboarding request without creating a duplicate or accepting a different brief", async () => {
    const t = convexTest(schema, modules),
      input = {
        ...draft("idempotent"),
        onboardingKey: "12345678-1234-1234-1234-123456789abc",
      };
    const id = await t.mutation(mutation("createProject"), input);
    expect(await t.mutation(mutation("createProject"), input)).toBe(id);
    await expect(
      t.mutation(mutation("createProject"), {
        ...input,
        offer: "Different offer",
      }),
    ).rejects.toThrow(/conflicts/);
    expect((await t.query(query("listWorkspace"), {})).projects).toHaveLength(
      1,
    );
  });

  it("updates a paused/draft brief with optimistic version checks and retires stale approvals", async () => {
    const f = await projects(),
      id = await item(f);
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    const definition = Object.fromEntries(
      Object.entries(draft("alpha")).filter(
        ([key]) => !["goal", "currency", "conversionTokenHash"].includes(key),
      ),
    );
    const edit = {
      ...definition,
      projectId: f.a,
      expectedVersion: 1,
      offer: "A revised owned offer",
      advertisingLimitMinor: 1_500,
    };
    expect((await f.t.mutation(mutation("updateProject"), edit)).version).toBe(
      2,
    );
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.a,
    });
    expect(workspace.items[0].status).toBe("cancelled");
    expect(
      workspace.projects.find((row: { _id: string }) => row._id === f.a).offer,
    ).toBe(edit.offer);
    await expect(f.t.mutation(mutation("updateProject"), edit)).rejects.toThrow(
      /changed/,
    );
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    await expect(
      f.t.mutation(mutation("updateProject"), { ...edit, expectedVersion: 2 }),
    ).rejects.toThrow(/Pause/);
  });

  it("keeps lifetime widget metrics and conversions exactly once across provider/event replays", async () => {
    const f = await projects(),
      id = await item(f);
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    await f.t.mutation(mutation("claimItem"), {
      projectId: f.a,
      itemId: id,
      workerRunId: "widget-worker",
    });
    const outcome = {
      projectId: f.a,
      itemId: id,
      status: "published",
      providerId: "widget-post",
      publicationUrl: "https://x.com/owned/status/1",
      metrics: {
        clicks: 4,
        impressions: 30,
        spendMinor: 0,
        currency: "USD",
        capturedAt: Date.now(),
      },
    };
    await f.t.mutation(mutation("recordOutcome"), outcome);
    await f.t.mutation(mutation("recordOutcome"), outcome);
    const event = {
      projectId: f.a,
      tokenHash: draft("alpha").conversionTokenHash,
      eventId: "widget-conversion",
      event: "signup",
      valueMinor: 500,
      currency: "USD",
      occurredAt: Date.now(),
    };
    await f.t.mutation(mutation("ingestConversion"), event);
    await f.t.mutation(mutation("ingestConversion"), event);
    const overview = await f.t.query(
      makeFunctionReference<"query">("marketingOverview:overview"),
      {},
    );
    const alpha = overview.projects.find(
        (row: { id: string }) => row.id === f.a,
      ),
      beta = overview.projects.find((row: { id: string }) => row.id === f.b);
    expect(alpha.stats).toMatchObject({
      published: 1,
      clicks: 4,
      impressions: 30,
      conversions: 1,
      valueMinor: 500,
    });
    expect(beta.stats).toMatchObject({
      published: 0,
      clicks: 0,
      conversions: 0,
    });
    const table = await f.t.query(
      makeFunctionReference<"query">("marketingOverview:contentTable"),
      { kind: "content", paginationOpts: { cursor: null, numItems: 25 } },
    );
    expect(
      table.page.find((row: { _id: string }) => row._id === id)?.projectName,
    ).toBe("alpha");
  });

  it("deduplicates actual subscription charges, separates currencies and voids without deleting receipts", async () => {
    const f = await projects(),
      record = makeFunctionReference<"mutation">(
        "marketingOverview:recordCost",
      ),
      read = makeFunctionReference<"query">("marketingOverview:overview");
    const charge = {
      label: "Owned subscription",
      category: "subscription",
      amountMinor: 1800,
      currency: "USD",
      occurredAt: Date.now(),
      reference: "invoice-widget-1",
    };
    const entry = await f.t.mutation(record, charge);
    expect((await f.t.mutation(record, charge)).reused).toBe(true);
    await expect(
      f.t.mutation(record, { ...charge, amountMinor: 1801 }),
    ).rejects.toThrow(/reference/);
    await f.t.mutation(record, {
      ...charge,
      currency: "EUR",
      amountMinor: 900,
      reference: "invoice-widget-2",
    });
    let snapshot = await f.t.query(read, {});
    expect(
      snapshot.costs.find((row: { currency: string }) => row.currency === "USD")
        .subscription,
    ).toBe(1800);
    expect(
      snapshot.costs.find((row: { currency: string }) => row.currency === "EUR")
        .subscription,
    ).toBe(900);
    const voidEntry = makeFunctionReference<"mutation">(
      "marketingOverview:voidCost",
    );
    await f.t.mutation(voidEntry, { costId: entry.id });
    expect((await f.t.mutation(voidEntry, { costId: entry.id })).reused).toBe(
      true,
    );
    snapshot = await f.t.query(read, {});
    expect(
      snapshot.costs.find((row: { currency: string }) => row.currency === "USD")
        .subscription,
    ).toBe(0);
  });

  it("prepares one week atomically with real item campaign IDs and holds draft-project approvals until start", async () => {
    const f = await projects();
    const planned = await f.t.mutation(mutation("generateWeek"), {
      projectId: f.a,
    });
    expect(planned.created).toBe(3);
    expect(
      (await f.t.mutation(mutation("generateWeek"), { projectId: f.a })).reused,
    ).toBe(true);
    let workspace = await f.t.query(query("listWorkspace"), { projectId: f.a });
    for (const row of workspace.items) {
      const url = new URL(row.content.match(/https:\/\/\S+/)![0]);
      expect(url.searchParams.get("utm_campaign")).toBe(row._id);
      expect(url.searchParams.get("utm_content")).toBe(f.a);
    }
    const id = workspace.items[0]._id;
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    expect(await f.t.query(query("dueItems"), {})).toEqual([]);
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    workspace = await f.t.query(query("listWorkspace"), { projectId: f.a });
    expect(
      workspace.items.find((row: { _id: string }) => row._id === id)
        .nextCheckAt,
    ).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("keeps 09:00 local publication across daylight-saving boundaries", () => {
    for (const date of ["2026-03-28T10:00:00Z", "2026-10-24T10:00:00Z"]) {
      const next = localPublicationTime(Date.parse(date), 1, "Europe/Zurich");
      expect(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Zurich",
          hour: "2-digit",
          minute: "2-digit",
        }).format(next),
      ).toBe("09:00");
    }
  });

  it("versions editable drafts and rejects stale edits and edits after approval", async () => {
    const f = await projects(),
      id = await item(f);
    const edit = {
      projectId: f.a,
      itemId: id,
      expectedVersion: 1,
      title: "Reviewed copy",
      content: "A truthful new version",
      scheduledAt: Date.now() + 600_000,
    };
    await f.t.mutation(mutation("editDraft"), edit);
    await expect(f.t.mutation(mutation("editDraft"), edit)).rejects.toThrow(
      /current unapproved/,
    );
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    await expect(
      f.t.mutation(mutation("editDraft"), { ...edit, expectedVersion: 2 }),
    ).rejects.toThrow(/current unapproved/);
  });

  it("cancels queued approvals immediately on a channel policy change and preserves admitted cleanup", async () => {
    const f = await projects(),
      remote = await item(f, "remote"),
      local = await item(f, "local");
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    for (const itemId of [remote, local])
      await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId });
    await f.t.mutation(mutation("claimItem"), {
      projectId: f.a,
      itemId: remote,
      workerRunId: "once",
    });
    const context = await f.t.query(query("getItem"), {
      projectId: f.a,
      itemId: remote,
    });
    await f.t.mutation(mutation("saveChannel"), {
      projectId: f.a,
      accountId: context.account._id,
      mode: "off",
      communityApproved: false,
    });
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.a,
    });
    expect(
      workspace.items.find((row: { _id: string }) => row._id === local).status,
    ).toBe("cancelled");
    expect(
      workspace.items.find((row: { _id: string }) => row._id === remote).status,
    ).toBe("cancel_pending");
    expect(
      workspace.projects.find((row: { _id: string }) => row._id === f.a)
        .openItemCount,
    ).toBe(1);
    expect(workspace.allowances[0].heldMinor).toBe(20);
    await f.t.mutation(mutation("blockItem"), {
      projectId: f.a,
      itemId: remote,
      error: "Reconnect required",
    });
    expect(await f.t.query(query("dueItems"), {})).toEqual([]);
    await f.t.mutation(mutation("recheckItem"), {
      projectId: f.a,
      itemId: remote,
    });
    expect((await f.t.query(query("dueItems"), {}))[0].itemId).toBe(remote);
  });

  it("stops permanent planning failures but allows an operator to fix setup and generate", async () => {
    const f = await projects();
    await f.t.mutation(mutation("recordPlanningFailure"), {
      projectId: f.a,
      error: "Missing project media",
    });
    expect(await f.t.query(query("dueProjects"), {})).toEqual([]);
    expect(
      (await f.t.mutation(mutation("generateWeek"), { projectId: f.a }))
        .created,
    ).toBe(3);
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.a,
    });
    expect(
      workspace.projects.find((row: { _id: string }) => row._id === f.a)
        .planningError,
    ).toBeUndefined();
    await expect(
      f.t.mutation(mutation("syncAccounts"), {
        accounts: [],
        accountCount: 0,
        pricingVerifiedAt: Date.now() + 86_400_000,
      }),
    ).rejects.toThrow(/verified integration pricing/);
  });
  it("keeps two projects isolated and rejects cross-project channel, item and conversion joins", async () => {
    const f = await projects();
    await expect(
      f.t.mutation(mutation("createItem"), {
        projectId: f.a,
        channelId: f.channelB,
        kind: "post",
        title: "Wrong channel",
        content: "This must not cross brands",
        scheduledAt: Date.now() + 60_000,
        idempotencyKey: "foreign",
      }),
    ).rejects.toThrow(/does not belong/);
    const id = await item(f);
    await expect(
      f.t.mutation(mutation("approveItem"), { projectId: f.b, itemId: id }),
    ).rejects.toThrow(/does not belong/);
    const workspaceB = await f.t.query(query("listWorkspace"), {
      projectId: f.b,
    });
    expect(workspaceB.items).toEqual([]);
    expect(
      workspaceB.projects.every(
        (project: object) => !("conversionTokenHash" in project),
      ),
    ).toBe(true);
    await expect(
      f.t.mutation(mutation("ingestConversion"), {
        projectId: f.b,
        tokenHash: draft("beta").conversionTokenHash,
        eventId: "real-event",
        event: "signup",
        itemId: id,
        valueMinor: 0,
        currency: "USD",
        occurredAt: Date.now(),
      }),
    ).rejects.toThrow(/does not belong/);
  });

  it("admits one dispatch, keeps uncertain cost reserved, and never claims provider acceptance as publication", async () => {
    const f = await projects(),
      id = await item(f);
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    await f.t.mutation(mutation("claimItem"), {
      projectId: f.a,
      itemId: id,
      workerRunId: "worker-one",
    });
    await expect(
      f.t.mutation(mutation("claimItem"), {
        projectId: f.a,
        itemId: id,
        workerRunId: "worker-two",
      }),
    ).rejects.toThrow(/not approved/);
    await f.t.mutation(mutation("recordOutcome"), {
      projectId: f.a,
      itemId: id,
      workerRunId: "worker-one",
      status: "uncertain",
      error: "Transport timeout",
    });
    let workspace = await f.t.query(query("listWorkspace"), { projectId: f.a });
    expect(workspace.allowances[0].heldMinor).toBe(20);
    await expect(
      f.t.mutation(mutation("recordOutcome"), {
        projectId: f.a,
        itemId: id,
        status: "published",
        providerId: "provider-post",
      }),
    ).rejects.toThrow(/Native publication URL/);
    await f.t.mutation(mutation("recordOutcome"), {
      projectId: f.a,
      itemId: id,
      status: "scheduled",
      providerId: "provider-post",
    });
    workspace = await f.t.query(query("listWorkspace"), { projectId: f.a });
    expect(workspace.items[0].status).toBe("scheduled");
    expect(workspace.allowances[0].heldMinor).toBe(0);
    expect(workspace.allowances[0].spentMinor).toBe(20);
    await f.t.mutation(mutation("recordOutcome"), {
      projectId: f.a,
      itemId: id,
      status: "scheduled",
      providerId: "provider-post",
    });
    workspace = await f.t.query(query("listWorkspace"), { projectId: f.a });
    expect(workspace.allowances[0].spentMinor).toBe(20);
  });

  it("marks remote work cancellation-pending on pause and ignores stale scheduled observations", async () => {
    const f = await projects(),
      id = await item(f);
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    await f.t.mutation(mutation("claimItem"), {
      projectId: f.a,
      itemId: id,
      workerRunId: "worker-one",
    });
    const paused = await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "paused",
    });
    expect(paused.cancellationPending).toBe(1);
    await f.t.mutation(mutation("recordOutcome"), {
      projectId: f.a,
      itemId: id,
      status: "scheduled",
      providerId: "provider-post",
    });
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.a,
    });
    expect(workspace.items[0].status).toBe("cancel_pending");
    await expect(
      f.t.mutation(mutation("claimItem"), {
        projectId: f.a,
        itemId: id,
        workerRunId: "another",
      }),
    ).rejects.toThrow();
  });

  it("binds approval to the exact policy and blocks an over-budget provider inventory", async () => {
    const f = await projects(),
      id = await item(f);
    await f.t.mutation(mutation("setProjectStatus"), {
      projectId: f.a,
      status: "active",
    });
    await f.t.mutation(mutation("approveItem"), { projectId: f.a, itemId: id });
    await f.t.run(async (ctx) => {
      const channel = await ctx.db.get(f.channelA as Id<"marketingChannels">);
      await ctx.db.patch(f.channelA, {
        policyVersion: channel!.policyVersion + 1,
      });
    });
    await expect(
      f.t.mutation(mutation("claimItem"), {
        projectId: f.a,
        itemId: id,
        workerRunId: "worker",
      }),
    ).rejects.toThrow(/changed/);
    const second = await item(f, "alpha-post-2");
    await f.t.mutation(mutation("approveItem"), {
      projectId: f.a,
      itemId: second,
    });
    await f.t.run(async (ctx) => {
      const inventory = await ctx.db
        .query("marketingProviderInventory")
        .first();
      await ctx.db.patch(inventory!._id, { baseMinor: 3_000, accountCount: 7 });
    });
    await expect(
      f.t.mutation(mutation("claimItem"), {
        projectId: f.a,
        itemId: second,
        workerRunId: "worker",
      }),
    ).rejects.toThrow(/Allowance exhausted/);
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.a,
    });
    expect(workspace.allowances).toEqual([]);
  });

  it("deduplicates real conversion event IDs and rejects changed or unauthenticated events", async () => {
    const f = await projects(),
      id = await item(f);
    const args = {
      projectId: f.a,
      tokenHash: draft("alpha").conversionTokenHash,
      eventId: "signup-123",
      event: "signup",
      itemId: id,
      valueMinor: 0,
      currency: "USD",
      occurredAt: Date.now(),
    };
    const first = await f.t.mutation(mutation("ingestConversion"), args);
    const second = await f.t.mutation(mutation("ingestConversion"), args);
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    await expect(
      f.t.mutation(mutation("ingestConversion"), { ...args, valueMinor: 100 }),
    ).rejects.toThrow(/conflicts/);
    await expect(
      f.t.mutation(mutation("ingestConversion"), {
        ...args,
        eventId: "different",
        tokenHash: "wrong",
      }),
    ).rejects.toThrow(/credential/);
    const workspace = await f.t.query(query("listWorkspace"), {
      projectId: f.a,
    });
    expect(workspace.conversions).toHaveLength(1);
  });
});

describe("cost and source policy", () => {
  it("counts all accounts, reserves expensive URL writes and rejects integer overflow", () => {
    expect(integrationBaseMinor(2)).toBe(0);
    expect(integrationBaseMinor(5)).toBe(1_800);
    expect(integrationBaseMinor(10)).toBe(4_800);
    expect(publishCostMinor("x", "https://example.com")).toBe(20);
    expect(publishCostMinor("x", "A useful update")).toBe(2);
    expect(() => assertAvailable(3_000, 2_990, 5, 20)).toThrow();
    expect(() => assertAvailable(3_000, 0, 0, Number.NaN)).toThrow();
  });
  it("rejects unsafe website targets and hashes canonical snapshots independently of object key order", () => {
    for (const url of [
      "http://example.com",
      "https://127.0.0.1/",
      "https://localhost/",
      "https://a:b@example.com/",
      "https://service.internal/",
    ])
      expect(() => website(url)).toThrow();
    expect(snapshotHash({ b: 2, a: 1 })).toBe(snapshotHash({ a: 1, b: 2 }));
    expect(snapshotHash({ a: 2 })).not.toBe(snapshotHash({ a: 1 }));
  });
});

describe("project planning revisions", () => {
  it("deduplicates and rate-limits project research discovery attempts", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(mutation("createProject"), draft("discovery"));
    const start = makeFunctionReference<"mutation">("marketingResearch:startDiscovery");
    const finish = makeFunctionReference<"mutation">("marketingResearch:finishDiscovery");
    const args = { projectId, expectedProjectVersion: 1, requestKey: "4cd9662c-4267-4d8d-8f20-96ed2a2ab184" };
    const first = await t.mutation(start, args);
    expect(first.canRun).toBe(true);
    expect(await t.mutation(start, args)).toMatchObject({ discoveryId: first.discoveryId, canRun: false });
    await expect(t.mutation(start, { ...args, requestKey: "6c23d114-ef9b-41a8-aee4-2728e9fa6dab" })).rejects.toThrow(/one attempt/);
    await t.mutation(finish, { projectId, discoveryId: first.discoveryId, success: true, captured: 2 });
    expect(await t.mutation(start, args)).toMatchObject({ canRun: false, status: "completed", captured: 2 });
  });
  it("isolates attributed research and fences planning if source evidence changes", async () => {
    const t = convexTest(schema, modules);
    const a = await t.mutation(mutation("createProject"), draft("research-a"));
    const b = await t.mutation(mutation("createProject"), draft("research-b"));
    const research = makeFunctionReference<"mutation">("marketingResearch:save");
    const list = makeFunctionReference<"query">("marketingResearch:list");
    const save = makeFunctionReference<"mutation">("marketingPlans:save");
    const latest = makeFunctionReference<"query">("marketingPlans:latest");
    const start = makeFunctionReference<"mutation">("marketingPlans:start");
    const claim = makeFunctionReference<"mutation">("marketingPlans:claim");
    const finish = makeFunctionReference<"mutation">("marketingPlans:finish");
    const source = { projectId: a, expectedProjectVersion: 1, url: "https://competitor.example/", title: "Competitor", description: "Source claim", excerpt: "Untrusted page content", kind: "reference", capturedAt: Date.now() };
    await t.mutation(research, source);
    expect(await t.mutation(research, { ...source, capturedAt: Date.now() })).toMatchObject({ changed: false, researchVersion: 1 });
    expect(await t.query(list, { projectId: b })).toEqual([]);
    await t.mutation(save, { projectId: a, expectedProjectVersion: 1, expectedResearchVersion: 1, expectedRevision: 0, strategy: "Owner strategy", calendar: "", sources: "Reference" });
    const run = await t.mutation(start, { projectId: a, requestKey: "4cd9662c-4267-4d8d-8f20-96ed2a2ab184" });
    const context = await t.mutation(claim, { runId: run.runId });
    expect(context.research).toMatchObject([{ url: source.url, excerpt: source.excerpt }]);
    await t.mutation(research, { ...source, excerpt: "Changed source content", capturedAt: Date.now() });
    expect(await t.query(latest, { projectId: a })).toMatchObject({ stale: true });
    expect(await t.mutation(finish, { runId: run.runId, strategy: "AI", calendar: "Plan" })).toEqual({ saved: false });
    await expect(t.mutation(save, { projectId: a, expectedProjectVersion: 1, expectedResearchVersion: 1, expectedRevision: 1, strategy: "Old", calendar: "", sources: "" })).rejects.toThrow(/Research sources changed/);
  });
  it("does not feed an old project website to the planner after the brief points elsewhere", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(mutation("createProject"), draft("old-site"));
    const research = makeFunctionReference<"mutation">("marketingResearch:save");
    await t.mutation(research, { projectId, expectedProjectVersion: 1, url: "https://old-site.example/", title: "Old site", description: "", excerpt: "Old page", kind: "project", capturedAt: Date.now() });
    const { name, offer, audience, facts, tone, timezone, cadence, generationLimitMinor, advertisingLimitMinor } = draft("old-site");
    await t.mutation(mutation("updateProject"), { projectId, expectedVersion: 1, name, website: "https://new-site.example/", offer, audience, facts, tone, timezone, cadence, generationLimitMinor, advertisingLimitMinor });
    const start = makeFunctionReference<"mutation">("marketingPlans:start"), claim = makeFunctionReference<"mutation">("marketingPlans:claim");
    const run = await t.mutation(start, { projectId, requestKey: "4cd9662c-4267-4d8d-8f20-96ed2a2ab184" });
    expect((await t.mutation(claim, { runId: run.runId })).research).toEqual([]);
  });
  it("turns a saved calendar entry into one isolated review draft without dispatch", async () => {
    const f = await projects();
    const save = makeFunctionReference<"mutation">("marketingPlans:save");
    const create = makeFunctionReference<"mutation">("marketingPlans:createDraft");
    const calendar = JSON.stringify([{ day: 2, channel: "x", format: "Introduction", rationale: "Explain the offer", caption: "Meet our tool", hashtags: ["#design"], videoScript: "" }]);
    const plan = await f.t.mutation(save, { projectId: f.a, expectedProjectVersion: 1, expectedResearchVersion: 0, expectedRevision: 0, strategy: "Useful strategy", calendar, sources: "Owner brief" });
    const args = { projectId: f.a, planId: plan.planId, entryIndex: 0, channelId: f.channelA };
    await expect(f.t.mutation(create, { ...args, channelId: f.channelB })).rejects.toThrow(/does not belong/);
    const draftItem = await f.t.mutation(create, args);
    expect(await f.t.mutation(create, args)).toEqual({ itemId: draftItem.itemId, reused: true });
    const workspace = await f.t.query(query("listWorkspace"), { projectId: f.a });
    expect(workspace.items).toHaveLength(1);
    expect(workspace.items[0]).toMatchObject({ status: "draft", planId: plan.planId, content: "Meet our tool\n\n#design" });
    expect((await f.t.query(query("listWorkspace"), { projectId: f.b })).items).toHaveLength(0);
    await f.t.mutation(save, { projectId: f.a, expectedProjectVersion: 1, expectedResearchVersion: 0, expectedRevision: 1, strategy: "Revised strategy", calendar, sources: "Owner brief" });
    await expect(f.t.mutation(create, args)).rejects.toThrow(/current plan/);
  });
  it("saves a validated worker result as a separate AI revision", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(mutation("createProject"), draft("ai-plan"));
    const start = makeFunctionReference<"mutation">("marketingPlans:start");
    const claim = makeFunctionReference<"mutation">("marketingPlans:claim");
    const finish = makeFunctionReference<"mutation">("marketingPlans:finish");
    const latest = makeFunctionReference<"query">("marketingPlans:latest");
    const run = await t.mutation(start, { projectId, requestKey: "4cd9662c-4267-4d8d-8f20-96ed2a2ab184" });
    await t.mutation(claim, { runId: run.runId });
    expect(await t.mutation(finish, { runId: run.runId, strategy: "Strategy", calendar: "Calendar", sources: "Brief" })).toEqual({ saved: true });
    expect(await t.query(latest, { projectId })).toMatchObject({ origin: "ai", strategy: "Strategy", revision: 1 });
    expect(await t.mutation(finish, { runId: run.runId, strategy: "Duplicate", calendar: "Duplicate" })).toEqual({ saved: false });
  });
  it("deduplicates and fences AI runs when a manual plan changes", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(mutation("createProject"), draft("run-a"));
    const start = makeFunctionReference<"mutation">("marketingPlans:start");
    const claim = makeFunctionReference<"mutation">("marketingPlans:claim");
    const finish = makeFunctionReference<"mutation">("marketingPlans:finish");
    const save = makeFunctionReference<"mutation">("marketingPlans:save");
    const latest = makeFunctionReference<"query">("marketingPlans:latest");
    const args = { projectId, requestKey: "4cd9662c-4267-4d8d-8f20-96ed2a2ab184" };
    const first = await t.mutation(start, args);
    expect(await t.mutation(start, args)).toEqual(first);
    await expect(t.mutation(start, { ...args, requestKey: "6c23d114-ef9b-41a8-aee4-2728e9fa6dab" })).rejects.toThrow(/already in progress/);
    expect(await t.mutation(claim, { runId: first.runId })).toMatchObject({ name: "run-a" });
    expect(await t.mutation(claim, { runId: first.runId })).toBeNull();
    await t.mutation(save, { projectId, expectedProjectVersion: 1, expectedResearchVersion: 0, expectedRevision: 0, strategy: "Owner edits", calendar: "", sources: "" });
    expect(await t.mutation(finish, { runId: first.runId, strategy: "Model plan", calendar: "Model calendar" })).toEqual({ saved: false });
    expect(await t.query(latest, { projectId })).toMatchObject({ strategy: "Owner edits", origin: "owner" });
  });
  it("isolates plans, prevents lost edits and marks a plan stale after a brief change", async () => {
    const t = convexTest(schema, modules);
    const a = await t.mutation(mutation("createProject"), draft("plan-a"));
    const b = await t.mutation(mutation("createProject"), draft("plan-b"));
    const save = makeFunctionReference<"mutation">("marketingPlans:save");
    const latest = makeFunctionReference<"query">("marketingPlans:latest");
    const input = { projectId: a, expectedProjectVersion: 1, expectedResearchVersion: 0, expectedRevision: 0,
      strategy: "Serve alpha customers", calendar: "Day 1: introduction", sources: "Owner brief" };
    await t.mutation(save, input);
    expect(await t.query(latest, { projectId: b })).toBeNull();
    await expect(t.mutation(save, input)).rejects.toThrow(/Plan changed/);
    const plan = await t.query(latest, { projectId: a });
    expect(plan).toMatchObject({ strategy: input.strategy, revision: 1, stale: false, origin: "owner" });
    await expect(t.mutation(mutation("removeEmptyProject"), { projectId: a, expectedName: "plan-a" })).rejects.toThrow(/content or connections/);
    const { name, website, offer, audience, facts, tone, timezone, cadence, generationLimitMinor, advertisingLimitMinor } = draft("plan-a");
    await t.mutation(mutation("updateProject"), { projectId: a, expectedVersion: 1, name,
      website, offer: `${offer} revised`, audience, facts, tone, timezone, cadence,
      generationLimitMinor, advertisingLimitMinor });
    expect(await t.query(latest, { projectId: a })).toMatchObject({ revision: 1, stale: true });
    await expect(t.mutation(save, { ...input, expectedRevision: 1 })).rejects.toThrow(/brief changed/);
  });
});

describe("new-service render import", () => {
  it("requires rights, claims once, fences workers and registers only a scoped verified receipt", async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.mutation(mutation("createProject"), draft("hyper-import"));
    const other = await t.mutation(mutation("createProject"), draft("hyper-other"));
    const req = makeFunctionReference<"mutation">("marketingHyperImports:request");
    const claim = makeFunctionReference<"mutation">("marketingHyperImports:claim");
    const settle = makeFunctionReference<"mutation">("marketingHyperImports:settle");
    const jobId = "6c23d114-ef9b-41a8-aee4-2728e9fa6dab";
    await expect(t.mutation(req, { projectId, jobId, rightsConfirmed: false })).rejects.toThrow(/rights/);
    const pending = await t.mutation(req, { projectId, jobId, rightsConfirmed: true });
    expect(await t.mutation(req, { projectId, jobId, rightsConfirmed: true })).toEqual(pending);
    const identity = { projectId, importId: pending.importId, attempt: 1, workerRunId: "worker-1" };
    await expect(t.mutation(claim, { ...identity, projectId: other })).rejects.toThrow();
    await t.mutation(claim, identity);
    await expect(t.mutation(claim, identity)).rejects.toThrow();
    const sha256 = "a".repeat(64);
    const receipt = { key: `marketing/${projectId}/assets/${sha256}.png`, sha256, bytes: 50, contentType: "image/png" };
    await expect(t.mutation(settle, { ...identity, workerRunId: "wrong", receipt })).rejects.toThrow();
    await expect(t.mutation(settle, { ...identity, receipt: { ...receipt, key: `marketing/${other}/assets/${sha256}.png` } })).rejects.toThrow(/invalid/);
    expect(await t.mutation(settle, { ...identity, receipt })).toMatchObject({ status: "verified" });
    const workspace = await t.query(query("listWorkspace"), { projectId });
    expect(workspace.assets).toHaveLength(1);
    expect((await t.query(query("listWorkspace"), { projectId: other })).assets).toHaveLength(0);
  });
});
