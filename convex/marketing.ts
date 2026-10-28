import { emptyMarketingStats, incrementMarketingStats } from "./marketingStats";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ensureDefaultOrganization,
  findDefaultOrganization,
} from "./controlPlaneModel";
import { goal, metrics, mode, platform } from "./marketingSchema";
import { frozenSnapshot } from "./marketingSnapshots";
import {
  assertAvailable,
  assertOwned,
  composeBrandPost,
  integrationBaseMinor,
  localPublicationTime,
  MAX_CHANNELS,
  MAX_CONTENT_ROWS,
  MAX_PROJECTS,
  money,
  monthKey,
  publishCostMinor,
  snapshotHash,
  text,
  trackingUrl,
  website,
} from "./marketingPolicy";

type Context = MutationCtx | QueryCtx;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const OPEN_STATUSES = [
  "draft",
  "approved",
  "dispatching",
  "uncertain",
  "scheduled",
  "active",
  "cancel_pending",
  "blocked",
] as const;
const TERMINAL = new Set(["published", "cancelled", "paused", "failed"]);

async function cancelQueuedItem(
  ctx: MutationCtx,
  item: Doc<"marketingItems">,
  reason: string,
) {
  const admitted = Boolean(item.reservationMonth);
  await ctx.db.patch(item._id, {
    status: admitted ? "cancel_pending" : "cancelled",
    error: reason,
    nextCheckAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!admitted) {
    if (item.actionId)
      await ctx.db.patch(item.actionId, {
        status: "cancelled",
        updatedAt: Date.now(),
      });
    if (item.approvalId)
      await ctx.db.patch(item.approvalId, {
        status: "cancelled",
        decidedAt: Date.now(),
      });
  }
  return !admitted;
}

async function projectFor(ctx: Context, id: Id<"marketingProjects">) {
  const project = await ctx.db.get(id);
  const organization = await findDefaultOrganization(ctx);
  if (!project || !organization || project.organizationId !== organization._id)
    throw new Error("Marketing project not found");
  return project;
}

async function itemContext(
  ctx: Context,
  projectId: Id<"marketingProjects">,
  itemId: Id<"marketingItems">,
) {
  const project = await projectFor(ctx, projectId);
  const item = await ctx.db.get(itemId);
  assertOwned(projectId, item);
  const channel = await ctx.db.get(item!.channelId);
  assertOwned(projectId, channel);
  const account = await ctx.db.get(channel!.accountId);
  if (!account) throw new Error("Marketing provider account not found");
  const asset = item!.assetId ? await ctx.db.get(item!.assetId) : null;
  if (item!.assetId) assertOwned(projectId, asset);
  return { project, item: item!, channel: channel!, account, asset };
}

async function allowance(
  ctx: MutationCtx,
  scope: string,
  month: string,
  limitMinor: number,
  currency: string,
) {
  const row = await ctx.db
    .query("marketingAllowances")
    .withIndex("by_scope_month", (q) => q.eq("scope", scope).eq("month", month))
    .unique();
  if (row) {
    if (row.currency !== currency)
      throw new Error(
        "Allowance currency cannot change during its billing period",
      );
    if (row.limitMinor !== limitMinor)
      await ctx.db.patch(row._id, { limitMinor, updatedAt: Date.now() });
    return { ...row, limitMinor };
  }
  const id = await ctx.db.insert("marketingAllowances", {
    scope,
    month,
    currency,
    limitMinor,
    spentMinor: 0,
    heldMinor: 0,
    updatedAt: Date.now(),
  });
  return (await ctx.db.get(id))!;
}

export const createProject = internalMutation({
  args: {
    name: v.string(),
    website: v.string(),
    offer: v.string(),
    audience: v.string(),
    facts: v.array(v.string()),
    goal,
    tone: v.string(),
    timezone: v.string(),
    cadence: v.number(),
    generationLimitMinor: v.number(),
    advertisingLimitMinor: v.number(),
    currency: v.string(),
    conversionTokenHash: v.string(),
    onboardingKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const organization = await ensureDefaultOrganization(ctx);
    if (!organization)
      throw new Error("Marketing organization could not be initialized");
    const organizationId = organization._id;
    const onboardingHash = snapshotHash({ ...args, conversionTokenHash: null });
    if (args.onboardingKey) {
      if (!/^[a-f0-9-]{36}$/.test(args.onboardingKey))
        throw new Error("Invalid onboarding request key");
      const previous = await ctx.db
        .query("marketingProjects")
        .withIndex("by_organization_onboarding", (q) =>
          q
            .eq("organizationId", organizationId)
            .eq("onboardingKey", args.onboardingKey),
        )
        .unique();
      if (previous) {
        if (
          previous.onboardingHash !== onboardingHash ||
          previous.conversionTokenHash !== args.conversionTokenHash
        )
          throw new Error(
            "This onboarding request conflicts with its original saved project",
          );
        return previous._id;
      }
    }
    const existing = await ctx.db
      .query("marketingProjects")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organizationId),
      )
      .take(MAX_PROJECTS);
    if (existing.length >= MAX_PROJECTS)
      throw new Error(
        "Project limit reached; archive or review capacity before adding more",
      );
    if (!Number.isInteger(args.cadence) || args.cadence < 1 || args.cadence > 7)
      throw new Error("Choose 1–7 posts per channel per week");
    new Intl.DateTimeFormat("en", { timeZone: args.timezone });
    if (
      !/^[A-Z]{3}$/.test(args.currency) ||
      !/^[a-f0-9]{64}$/.test(args.conversionTokenHash)
    )
      throw new Error("Invalid currency or conversion credential digest");
    if (args.facts.length < 1 || args.facts.length > 12)
      throw new Error("Confirm between 1 and 12 product facts");
    const now = Date.now();
    return await ctx.db.insert("marketingProjects", {
      ...args,
      organizationId,
      ...(args.onboardingKey ? { onboardingHash } : {}),
      name: text(args.name, "Project name", 120),
      website: website(args.website),
      offer: text(args.offer, "Offer", 2_000),
      audience: text(args.audience, "Audience", 1_000),
      tone: text(args.tone, "Tone", 300),
      facts: args.facts.map((fact) => text(fact, "Product fact", 500)),
      generationLimitMinor: money(args.generationLimitMinor),
      advertisingLimitMinor: money(args.advertisingLimitMinor),
      status: "draft",
      version: 1,
      factsConfirmedAt: now,
      openItemCount: 0,
      stats: emptyMarketingStats(now),
      createdAt: now,
      updatedAt: now,
      nextPlanAt: now,
    });
  },
});

export const listWorkspace = internalQuery({
  args: { projectId: v.optional(v.id("marketingProjects")) },
  handler: async (ctx, args) => {
    const organization = await findDefaultOrganization(ctx);
    const projects = organization
      ? await ctx.db
          .query("marketingProjects")
          .withIndex("by_organization", (q) =>
            q.eq("organizationId", organization._id),
          )
          .take(MAX_PROJECTS)
      : [];
    const project = args.projectId
      ? await projectFor(ctx, args.projectId)
      : null;
    const [channels, items, conversions, assets, accounts, inventory] =
      await Promise.all([
        project
          ? ctx.db
              .query("marketingChannels")
              .withIndex("by_project", (q) => q.eq("projectId", project._id))
              .take(MAX_CHANNELS)
          : [],
        project
          ? ctx.db
              .query("marketingItems")
              .withIndex("by_project_created", (q) =>
                q.eq("projectId", project._id),
              )
              .order("desc")
              .take(MAX_CONTENT_ROWS)
          : [],
        project
          ? ctx.db
              .query("marketingConversions")
              .withIndex("by_project_received", (q) =>
                q
                  .eq("projectId", project._id)
                  .gte("receivedAt", Date.now() - 30 * DAY),
              )
              .order("desc")
              .take(200)
          : [],
        project
          ? ctx.db
              .query("marketingAssets")
              .withIndex("by_project", (q) => q.eq("projectId", project._id))
              .take(100)
          : [],
        ctx.db
          .query("marketingProviderAccounts")
          .withIndex("by_synced")
          .order("desc")
          .take(50),
        ctx.db
          .query("marketingProviderInventory")
          .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
          .unique(),
      ]);
    const month = monthKey(Date.now());
    const scopes = [
      "integration",
      ...(project
        ? [`advertising:${project._id}`, `generation:${project._id}`]
        : []),
    ];
    const allowances = await Promise.all(
      scopes.map((scope) =>
        ctx.db
          .query("marketingAllowances")
          .withIndex("by_scope_month", (q) =>
            q.eq("scope", scope).eq("month", month),
          )
          .unique(),
      ),
    );
    const results = project
      ? await ctx.db
          .query("marketingResults")
          .withIndex("by_project_month", (q) =>
            q.eq("projectId", project._id).eq("month", month),
          )
          .unique()
      : null;
    // Credentials and conversion token digests are never projected to the browser.
    const publicProjects = projects.map((project) => {
      const row = { ...project };
      Reflect.deleteProperty(row, "conversionTokenHash");
      return row;
    });
    return {
      projects: publicProjects,
      selectedProjectId: project?._id,
      channels,
      items,
      conversions,
      assets,
      accounts,
      inventory,
      renderImports: project
        ? await ctx.db
            .query("marketingRenderImports")
            .withIndex("by_project_created", (q) =>
              q.eq("projectId", project._id),
            )
            .order("desc")
            .take(100)
        : [],
      results,
      resultsMonth: month,
      allowances: allowances.filter(Boolean),
      limits: {
        projects: MAX_PROJECTS,
        channelsPerProject: MAX_CHANNELS,
        recentItems: MAX_CONTENT_ROWS,
        conversionsWindowDays: 30,
        conversionsTruncated: conversions.length === 200,
      },
    };
  },
});

export const updateProject = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    expectedVersion: v.number(),
    name: v.string(),
    website: v.string(),
    offer: v.string(),
    audience: v.string(),
    facts: v.array(v.string()),
    tone: v.string(),
    timezone: v.string(),
    cadence: v.number(),
    generationLimitMinor: v.number(),
    advertisingLimitMinor: v.number(),
  },
  handler: async (ctx, { projectId, expectedVersion, ...input }) => {
    const project = await projectFor(ctx, projectId);
    if (project.version !== expectedVersion)
      throw new Error("This project changed. Refresh before editing again.");
    if (project.status === "active")
      throw new Error(
        "Pause project automation before editing its brief or limits.",
      );
    if (
      !Number.isInteger(input.cadence) ||
      input.cadence < 1 ||
      input.cadence > 7
    )
      throw new Error("Choose 1–7 posts per channel per week");
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    if (input.facts.length < 1 || input.facts.length > 12)
      throw new Error("Confirm between 1 and 12 product facts");
    const open = (
      await Promise.all(
        OPEN_STATUSES.map((status) =>
          ctx.db
            .query("marketingItems")
            .withIndex("by_project_status", (q) =>
              q.eq("projectId", projectId).eq("status", status),
            )
            .take(MAX_CONTENT_ROWS),
        ),
      )
    ).flat();
    if (
      open.some(
        (item) =>
          item.reservationMonth || !["draft", "approved"].includes(item.status),
      )
    )
      throw new Error(
        "Wait for confirmed remote cancellation before changing this project.",
      );
    const values = {
      ...input,
      name: text(input.name, "Project name", 120),
      website: website(input.website),
      offer: text(input.offer, "Offer", 2_000),
      audience: text(input.audience, "Audience", 1_000),
      tone: text(input.tone, "Tone", 300),
      facts: input.facts.map((fact) => text(fact, "Product fact", 500)),
      generationLimitMinor: money(input.generationLimitMinor),
      advertisingLimitMinor: money(input.advertisingLimitMinor),
    };
    for (const item of open)
      await cancelQueuedItem(
        ctx,
        item,
        "Project brief changed; prepare fresh drafts before approval",
      );
    const now = Date.now();
    await ctx.db.patch(projectId, {
      ...values,
      version: project.version + 1,
      factsConfirmedAt: now,
      openItemCount: 0,
      nextPlanAt: now,
      planningError: undefined,
      updatedAt: now,
    });
    return {
      projectId,
      version: project.version + 1,
      retiredDrafts: open.length,
    };
  },
});

/** Admin-only cleanup of an unused onboarding record. Deliberately absent from
 * the browser/service gateway; never deletes content, credentials in use or bills. */
export const removeEmptyProject = internalMutation({
  args: { projectId: v.id("marketingProjects"), expectedName: v.string() },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    if (
      project.name !== args.expectedName ||
      project.version !== 1 ||
      project.status !== "draft" ||
      project.openItemCount ||
      Object.entries(project.stats ?? {}).some(
        ([key, value]) => !["since", "metricsAt"].includes(key) && value > 0,
      )
    )
      throw new Error("Only an unchanged, unused draft project can be removed");
    const children = await Promise.all([
      ctx.db
        .query("marketingItems")
        .withIndex("by_project_status", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingAssets")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingChannels")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingConversions")
        .withIndex("by_project_received", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingRenderImports")
        .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingPlans")
        .withIndex("by_project_revision", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingPlanRuns")
        .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingHyperImports")
        .withIndex("by_project_created", (q) => q.eq("projectId", project._id))
        .first(),
      ctx.db
        .query("marketingResearch")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .first(),
    ]);
    if (children.some(Boolean))
      throw new Error(
        "This project has content or connections and cannot be removed",
      );
    // Costs are separate immutable records; an assigned charge also prevents cleanup.
    const costs = await ctx.db
      .query("marketingCosts")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .first();
    if (costs)
      throw new Error(
        "This project has recorded charges and cannot be removed",
      );
    await ctx.db.delete(project._id);
    return { removed: true };
  },
});

export const syncAccounts = internalMutation({
  args: {
    accounts: v.array(
      v.object({
        providerAccountId: v.string(),
        profileId: v.string(),
        platform,
        label: v.string(),
        connected: v.boolean(),
      }),
    ),
    accountCount: v.number(),
    pricingVerifiedAt: v.number(),
    billing: v.optional(
      v.object({
        accountCount: v.number(),
        periodSpendMinor: v.number(),
        xSpendMinor: v.number(),
        xSpendLimitMinor: v.union(v.number(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (
      args.accounts.length > 50 ||
      args.accountCount <
        args.accounts.filter((account) => account.connected).length
    )
      throw new Error(
        "Provider account inventory is incomplete or exceeds MVP capacity",
      );
    const now = Date.now();
    if (
      !Number.isSafeInteger(args.accountCount) ||
      args.accountCount < 0 ||
      !Number.isFinite(args.pricingVerifiedAt) ||
      args.pricingVerifiedAt > now ||
      args.pricingVerifiedAt < now - 30 * DAY
    )
      throw new Error("Current verified integration pricing is required");
    if (args.billing) {
      [args.billing.periodSpendMinor, args.billing.xSpendMinor].forEach(
        (value) => money(value),
      );
      if (args.billing.xSpendLimitMinor !== null)
        money(args.billing.xSpendLimitMinor);
      if (args.billing.accountCount !== args.accountCount)
        throw new Error("Team billing inventory differs");
    }
    const seen = new Set<string>();
    for (const account of args.accounts) {
      text(account.providerAccountId, "Provider account", 100);
      text(account.profileId, "Provider profile", 100);
      if (seen.has(account.providerAccountId))
        throw new Error("Duplicate provider account in inventory");
      seen.add(account.providerAccountId);
      const previous = await ctx.db
        .query("marketingProviderAccounts")
        .withIndex("by_provider_id", (q) =>
          q.eq("providerAccountId", account.providerAccountId),
        )
        .unique();
      if (
        previous &&
        (previous.profileId !== account.profileId ||
          previous.platform !== account.platform)
      )
        throw new Error(
          "Provider changed account ownership; reconnect deliberately",
        );
      const values = {
        ...account,
        label: text(account.label, "Account label", 200),
        syncedAt: now,
      };
      if (previous) await ctx.db.patch(previous._id, values);
      else await ctx.db.insert("marketingProviderAccounts", values);
    }
    const old = await ctx.db
      .query("marketingProviderAccounts")
      .withIndex("by_synced")
      .take(51);
    if (old.length > 50)
      throw new Error("Account inventory exceeds MVP capacity");
    for (const account of old)
      if (!seen.has(account.providerAccountId))
        await ctx.db.patch(account._id, { connected: false, syncedAt: now });
    const existing = await ctx.db
      .query("marketingProviderInventory")
      .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
      .unique();
    const values = {
      provider: "zernio" as const,
      accountCount: args.accountCount,
      baseMinor: integrationBaseMinor(args.accountCount),
      checkedAt: now,
      pricingVerifiedAt: args.pricingVerifiedAt,
      periodSpendMinor: args.billing?.periodSpendMinor,
      xSpendMinor: args.billing?.xSpendMinor,
      xSpendLimitMinor: args.billing?.xSpendLimitMinor,
      nextRefreshAt: now + 12 * HOUR,
      error: undefined,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("marketingProviderInventory", values);
    return values;
  },
});

export const saveChannel = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    accountId: v.id("marketingProviderAccounts"),
    mode,
    subreddit: v.optional(v.string()),
    communityApproved: v.boolean(),
    adAccountId: v.optional(v.string()),
    pageId: v.optional(v.string()),
    authorisedUntil: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    const account = await ctx.db.get(args.accountId);
    if (!account || !account.connected || account.syncedAt < Date.now() - DAY)
      throw new Error("Refresh and connect the provider account first");
    if (
      args.mode === "automatic" &&
      (!args.authorisedUntil ||
        args.authorisedUntil <= Date.now() ||
        args.authorisedUntil > Date.now() + 30 * DAY)
    )
      throw new Error(
        "Automatic mode requires an explicit authorisation lasting at most 30 days",
      );
    if (
      args.mode !== "off" &&
      account.platform === "reddit" &&
      (!args.subreddit ||
        !/^[A-Za-z0-9_]{2,40}$/.test(args.subreddit) ||
        !args.communityApproved)
    )
      throw new Error(
        "Confirm an authorised Reddit community and its posting rules",
      );
    if (
      args.mode !== "off" &&
      (account.platform === "googleads" || account.platform === "metaads") &&
      !args.adAccountId
    )
      throw new Error("Select the provider-verified ad account");
    const channels = await ctx.db
      .query("marketingChannels")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(MAX_CHANNELS);
    const existing = channels.find(
      (channel) => channel.accountId === account._id,
    );
    if (!existing && channels.length >= MAX_CHANNELS)
      throw new Error("Channel limit reached");
    const { projectId, ...values } = args;
    if (existing) {
      const queued = (
        await Promise.all(
          OPEN_STATUSES.filter((status) => status !== "draft").map((status) =>
            ctx.db
              .query("marketingItems")
              .withIndex("by_channel_status", (q) =>
                q.eq("channelId", existing._id).eq("status", status),
              )
              .take(MAX_CONTENT_ROWS),
          ),
        )
      ).flat();
      // Remote cleanup must retain its original destination until confirmed.
      const destinationChanged =
        (args.adAccountId !== undefined &&
          args.adAccountId !== existing.adAccountId) ||
        (args.pageId !== undefined && args.pageId !== existing.pageId) ||
        (args.subreddit !== undefined && args.subreddit !== existing.subreddit);
      if (destinationChanged && queued.some((item) => item.reservationMonth))
        throw new Error(
          "Pause this channel and wait for confirmed remote cancellation before changing its destination",
        );
      let cancelled = 0;
      for (const item of queued)
        if (
          await cancelQueuedItem(
            ctx,
            item,
            "Channel policy changed; the previous approval was cancelled",
          )
        )
          cancelled++;
      if (cancelled)
        await ctx.db.patch(project._id, {
          openItemCount: Math.max(0, project.openItemCount - cancelled),
          updatedAt: Date.now(),
        });
      await ctx.db.patch(existing._id, {
        ...values,
        policyVersion: existing.policyVersion + 1,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("marketingChannels", {
      ...values,
      projectId,
      policyVersion: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const createItem = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    channelId: v.id("marketingChannels"),
    kind: v.union(v.literal("post"), v.literal("ad")),
    title: v.string(),
    content: v.string(),
    scheduledAt: v.number(),
    assetId: v.optional(v.id("marketingAssets")),
    ad: v.optional(
      v.object({
        headline: v.string(),
        description: v.string(),
        keywords: v.array(v.string()),
        countries: v.array(v.string()),
        dailyBudgetMinor: v.number(),
        durationDays: v.number(),
        maxSpendMinor: v.number(),
      }),
    ),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    const channel = await ctx.db.get(args.channelId);
    assertOwned(project._id, channel);
    const account = await ctx.db.get(channel!.accountId);
    if (!account) throw new Error("Provider account not found");
    text(args.idempotencyKey, "Idempotency key", 160);
    const existing = await ctx.db
      .query("marketingItems")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (existing) {
      const fields = {
        projectId: existing.projectId,
        channelId: existing.channelId,
        kind: existing.kind,
        title: existing.title,
        content: existing.content,
        scheduledAt: existing.scheduledAt,
        assetId: existing.assetId,
        ad: existing.ad,
        idempotencyKey: existing.idempotencyKey,
      };
      if (snapshotHash(fields) !== snapshotHash(args))
        throw new Error("Idempotency conflict: the content request changed");
      return existing._id;
    }
    if (project.openItemCount >= MAX_CONTENT_ROWS)
      throw new Error(
        "Project has 200 open items; resolve or cancel them first",
      );
    text(args.title, "Content title", 200);
    text(
      args.content,
      "Content",
      account.platform === "x"
        ? 280
        : account.platform === "instagram"
          ? 2_200
          : 10_000,
    );
    if (
      !Number.isSafeInteger(args.scheduledAt) ||
      args.scheduledAt < Date.now() - 60_000 ||
      args.scheduledAt > Date.now() + 30 * DAY
    )
      throw new Error("Choose a publication time within the next 30 days");
    const asset = args.assetId ? await ctx.db.get(args.assetId) : null;
    if (args.assetId) {
      assertOwned(project._id, asset);
      if (!asset!.rightsConfirmed)
        throw new Error("Confirm media rights first");
    }
    if (
      args.kind === "post" &&
      (account.platform === "googleads" || account.platform === "metaads")
    )
      throw new Error(
        "An advertising connection cannot publish organic content",
      );
    if (args.kind === "post" && account.platform === "instagram" && !asset)
      throw new Error("Instagram needs project-owned image or video media");
    if (args.kind === "ad") {
      if (!args.ad || !["googleads", "metaads"].includes(account.platform))
        throw new Error("Choose a supported ad template and account");
      const ad = args.ad;
      money(ad.dailyBudgetMinor);
      money(ad.maxSpendMinor);
      if (
        ad.dailyBudgetMinor < 1 ||
        !Number.isInteger(ad.durationDays) ||
        ad.durationDays < 1 ||
        ad.durationDays > 7 ||
        ad.maxSpendMinor <
          (account.platform === "googleads"
            ? ad.dailyBudgetMinor * (ad.durationDays + 1) * 2
            : ad.dailyBudgetMinor * ad.durationDays)
      )
        throw new Error(
          "The approved ad allowance must cover its bounded duration and provider overdelivery exposure",
        );
      if (
        !ad.countries.length ||
        ad.countries.length > 5 ||
        ad.countries.some((code) => !/^[A-Z]{2}$/.test(code))
      )
        throw new Error("Select 1–5 target countries");
      text(
        ad.headline,
        "Ad headline",
        account.platform === "googleads" ? 30 : 120,
      );
      text(
        ad.description,
        "Ad description",
        account.platform === "googleads" ? 90 : 1_000,
      );
      if (
        account.platform === "googleads" &&
        (!ad.keywords.length ||
          ad.keywords.length > 10 ||
          ad.keywords.some((keyword) => !keyword.trim() || keyword.length > 80))
      )
        throw new Error("Google Search needs 1–10 reviewed keywords");
      if (account.platform === "metaads" && (!asset || !channel!.pageId))
        throw new Error(
          "Meta website ads need an owned image/video and a verified Page",
        );
    } else if (args.ad)
      throw new Error("Organic content cannot carry an ad budget");
    const now = Date.now();
    const id = await ctx.db.insert("marketingItems", {
      organizationId: project.organizationId,
      ...args,
      status: "draft",
      version: 1,
      heldIntegrationMinor: 0,
      heldAdvertisingMinor: 0,
      nextCheckAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(project._id, {
      openItemCount: project.openItemCount + 1,
      updatedAt: now,
    });
    return id;
  },
});

export const approveItem = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
  },
  handler: async (ctx, args) => {
    const context = await itemContext(ctx, args.projectId, args.itemId);
    const { project, item, channel } = context;
    if (item.status === "approved") return item._id;
    if (item.status !== "draft" || channel.mode === "off")
      throw new Error("Only a draft on an enabled channel can be approved");
    const snapshot = frozenSnapshot(context),
      digest = snapshotHash(snapshot),
      now = Date.now();
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: project.organizationId,
      resourceType: "marketing_item",
      resourceId: item._id,
      planVersion: item.version,
      actionKind:
        item.kind === "ad" ? "marketing_ad_activation" : "marketing_publish",
      snapshotHash: digest,
      snapshot,
      riskClass: item.kind === "ad" ? "financial" : "high",
      status: "approved",
      requestedAt: now,
      requestedBy: "operator",
      decidedAt: now,
      decidedBy: "operator",
      expiresAt: Math.min(
        channel.authorisedUntil ?? now + 7 * DAY,
        now + 7 * DAY,
      ),
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: project.organizationId,
      approvalId,
      actionKind:
        item.kind === "ad" ? "marketing_ad_activation" : "marketing_publish",
      riskClass: item.kind === "ad" ? "financial" : "high",
      status: "queued",
      idempotencyKey: item.idempotencyKey,
      payloadHash: digest,
      payloadSnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(item._id, {
      status: "approved",
      approvalId,
      actionId,
      approvedHash: digest,
      nextCheckAt:
        project.status === "active"
          ? Math.max(now, item.scheduledAt - DAY)
          : Number.MAX_SAFE_INTEGER,
      updatedAt: now,
    });
    return item._id;
  },
});

export const editDraft = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    expectedVersion: v.number(),
    title: v.string(),
    content: v.string(),
    scheduledAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { item, account } = await itemContext(
      ctx,
      args.projectId,
      args.itemId,
    );
    if (
      item.status !== "draft" ||
      item.version !== args.expectedVersion ||
      item.reservationMonth
    )
      throw new Error("Only the current unapproved draft may be edited");
    if (item.kind !== "post")
      throw new Error(
        "Create a new advertising proposal to change its reviewed template",
      );
    text(args.title, "Content title", 200);
    text(
      args.content,
      "Content",
      account.platform === "x"
        ? 280
        : account.platform === "instagram"
          ? 2_200
          : 10_000,
    );
    if (
      !Number.isSafeInteger(args.scheduledAt) ||
      args.scheduledAt < Date.now() ||
      args.scheduledAt > Date.now() + 30 * DAY
    )
      throw new Error("Choose a future time within 30 days");
    await ctx.db.patch(item._id, {
      title: args.title,
      content: args.content,
      scheduledAt: args.scheduledAt,
      version: item.version + 1,
      updatedAt: Date.now(),
    });
    return item._id;
  },
});

export const generateWeek = internalMutation({
  args: { projectId: v.id("marketingProjects") },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId),
      now = Date.now();
    if (project.status === "paused")
      throw new Error("Resume this project before planning its next week");
    if (project.nextPlanAt > now && !project.planningError)
      return { created: 0, nextPlanAt: project.nextPlanAt, reused: true };
    const channels = await ctx.db
      .query("marketingChannels")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .take(MAX_CHANNELS);
    const assets = await ctx.db
      .query("marketingAssets")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .take(100);
    const media =
      assets.find(
        (asset) =>
          asset._id === project.defaultAssetId && asset.rightsConfirmed,
      ) ?? assets.find((asset) => asset.rightsConfirmed);
    const selected = [];
    for (const channel of channels) {
      const account = await ctx.db.get(channel.accountId);
      if (
        channel.mode === "off" ||
        !account ||
        !["instagram", "x", "reddit"].includes(account.platform)
      )
        continue;
      if (account.platform === "instagram" && !media)
        throw new Error(
          "Upload project-owned image/video media before generating Instagram content",
        );
      if (account.platform === "reddit" && !channel.communityApproved)
        throw new Error(
          "Confirm the Reddit community rules before planning posts",
        );
      selected.push({ channel, account });
    }
    if (!selected.length)
      throw new Error(
        "Add at least one enabled Instagram, X or Reddit channel",
      );
    if (
      project.openItemCount + selected.length * project.cadence >
      MAX_CONTENT_ROWS
    )
      throw new Error(
        "Resolve existing open content before adding another week",
      );
    const planKey = `week:${project._id}:${project.version}:${Math.floor(now / (7 * DAY))}`;
    const created: Id<"marketingItems">[] = [];
    for (const { channel, account } of selected) {
      for (let index = 0; index < project.cadence; index++) {
        const idempotencyKey = `${planKey}:${channel._id}:${index}`;
        const url = trackingUrl(
          project.website,
          project._id,
          "pending",
          account.platform,
        );
        const copy = composeBrandPost(
          project,
          account.platform as "instagram" | "x" | "reddit",
          index,
          url,
        );
        if (
          copy.content.length >
          (account.platform === "x"
            ? 280
            : account.platform === "instagram"
              ? 2_200
              : 10_000)
        )
          throw new Error(
            "The project facts or destination are too long for this channel; shorten them before generating",
          );
        const scheduledAt = localPublicationTime(
          now,
          1 + Math.floor((index * 7) / project.cadence),
          project.timezone,
        );
        const itemId = await ctx.db.insert("marketingItems", {
          organizationId: project.organizationId,
          projectId: project._id,
          channelId: channel._id,
          kind: "post",
          title: copy.title,
          content: copy.content,
          ...(media ? { assetId: media._id } : {}),
          scheduledAt,
          version: 1,
          status: "draft",
          idempotencyKey,
          heldIntegrationMinor: 0,
          heldAdvertisingMinor: 0,
          nextCheckAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const attributed = composeBrandPost(
          project,
          account.platform as "instagram" | "x" | "reddit",
          index,
          trackingUrl(project.website, project._id, itemId, account.platform),
        );
        text(
          attributed.content,
          "Generated content",
          account.platform === "x"
            ? 280
            : account.platform === "instagram"
              ? 2_200
              : 10_000,
        );
        await ctx.db.patch(itemId, {
          title: attributed.title,
          content: attributed.content,
        });
        created.push(itemId);
        if (
          project.status === "active" &&
          channel.mode === "automatic" &&
          channel.authorisedUntil &&
          channel.authorisedUntil > now
        ) {
          const context = await itemContext(ctx, project._id, itemId),
            snapshot = frozenSnapshot(context),
            digest = snapshotHash(snapshot);
          const policyActor = `policy:${channel._id}:v${channel.policyVersion}`;
          const approvalId = await ctx.db.insert("approvalRequests", {
            organizationId: project.organizationId,
            resourceType: "marketing_item",
            resourceId: itemId,
            planVersion: 1,
            actionKind: "marketing_publish",
            snapshotHash: digest,
            snapshot,
            riskClass: "high",
            status: "approved",
            requestedAt: now,
            requestedBy: policyActor,
            decidedAt: now,
            decidedBy: policyActor,
            expiresAt: Math.min(channel.authorisedUntil, now + 7 * DAY),
          });
          const actionId = await ctx.db.insert("actionLedger", {
            organizationId: project.organizationId,
            approvalId,
            actionKind: "marketing_publish",
            riskClass: "high",
            status: "queued",
            idempotencyKey,
            payloadHash: digest,
            payloadSnapshot: snapshot,
            createdAt: now,
            updatedAt: now,
          });
          await ctx.db.patch(itemId, {
            status: "approved",
            approvalId,
            actionId,
            approvedHash: digest,
            nextCheckAt: Math.max(now, scheduledAt - DAY),
          });
        }
      }
    }
    await ctx.db.patch(project._id, {
      nextPlanAt: now + 7 * DAY,
      planningError: undefined,
      openItemCount: project.openItemCount + created.length,
      updatedAt: now,
    });
    return {
      created: created.length,
      ids: created,
      nextPlanAt: now + 7 * DAY,
      reused: false,
      generator: "brand_templates",
      generationCostMinor: 0,
    };
  },
});

export const claimItem = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    workerRunId: v.string(),
  },
  handler: async (ctx, args) => {
    const context = await itemContext(ctx, args.projectId, args.itemId),
      { project, item, account, channel } = context;
    if (item.status !== "approved")
      throw new Error("Marketing item is not approved for a new dispatch");
    const now = Date.now();
    if (
      project.status !== "active" ||
      channel.mode !== "automatic" ||
      !channel.authorisedUntil ||
      channel.authorisedUntil <= now
    )
      throw new Error("Project or account dispatch authorisation is inactive");
    if (item.scheduledAt > now + DAY || item.scheduledAt < now - 30 * 60_000)
      throw new Error(
        "Dispatch is outside the approved publication handoff window",
      );
    if (!account.connected || account.syncedAt < now - DAY)
      throw new Error(
        "Provider connection is expired or stale; refresh accounts",
      );
    const approval = item.approvalId ? await ctx.db.get(item.approvalId) : null;
    const hash = snapshotHash(frozenSnapshot(context));
    if (
      !approval ||
      approval.status !== "approved" ||
      !approval.expiresAt ||
      approval.expiresAt <= now ||
      approval.snapshotHash !== hash ||
      item.approvedHash !== hash
    )
      throw new Error(
        "Approved content or policy changed; create a new reviewed item",
      );
    const inventory = await ctx.db
      .query("marketingProviderInventory")
      .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
      .unique();
    if (
      !inventory ||
      inventory.checkedAt < now - DAY ||
      inventory.pricingVerifiedAt < now - 30 * DAY
    )
      throw new Error(
        "Refresh complete account inventory and verify current integration pricing before dispatch",
      );
    const month = monthKey(now);
    const integration = await allowance(
      ctx,
      "integration",
      month,
      3_000,
      "USD",
    );
    // At most two provider billing periods for a <=7 day campaign. Reserve
    // managed-ad metering even when the team's free 500-ad allowance is used.
    const cost =
      item.kind === "ad" ? 2 : publishCostMinor(account.platform, item.content);
    if (
      account.platform === "x" &&
      inventory.xSpendLimitMinor !== undefined &&
      (inventory.xSpendLimitMinor === null ||
        inventory.xSpendLimitMinor > 3_000 - inventory.baseMinor)
    )
      throw new Error(
        "Set the provider's X spending cap within the remaining $30 integration allowance",
      );
    assertAvailable(
      integration.limitMinor,
      Math.max(
        integration.spentMinor + inventory.baseMinor,
        inventory.periodSpendMinor ?? 0,
      ),
      integration.heldMinor,
      cost,
    );
    await ctx.db.patch(integration._id, {
      heldMinor: integration.heldMinor + cost,
      updatedAt: now,
    });
    let advertising = 0;
    if (item.kind === "ad") {
      advertising = item.ad!.maxSpendMinor;
      const budget = await allowance(
        ctx,
        `advertising:${project._id}`,
        month,
        project.advertisingLimitMinor,
        project.currency,
      );
      const unsettled = await ctx.db
        .query("marketingItems")
        .withIndex("by_project_ad_held", (q) =>
          q
            .eq("projectId", project._id)
            .eq("kind", "ad")
            .gt("heldAdvertisingMinor", 0),
        )
        .take(MAX_CONTENT_ROWS + 1);
      if (unsettled.length > MAX_CONTENT_ROWS)
        throw new Error(
          "Reconcile outstanding advertising receipts before adding more exposure",
        );
      const carryover = unsettled.reduce(
        (sum, previous) =>
          sum +
          (previous.reservationMonth !== month
            ? previous.heldAdvertisingMinor
            : 0),
        0,
      );
      assertAvailable(
        budget.limitMinor,
        budget.spentMinor,
        budget.heldMinor + carryover,
        advertising,
      );
      await ctx.db.patch(budget._id, {
        heldMinor: budget.heldMinor + advertising,
        updatedAt: now,
      });
    }
    await ctx.db.patch(item._id, {
      status: "dispatching",
      dispatchedAt: now,
      workerRunId: text(args.workerRunId, "Worker run", 160),
      heldIntegrationMinor: cost,
      heldAdvertisingMinor: advertising,
      reservationMonth: month,
      nextCheckAt: now + 5 * 60_000,
      updatedAt: now,
    });
    await ctx.db.patch(item.actionId!, {
      status: "running",
      triggerRunId: args.workerRunId,
      reservedCostMinor: advertising,
      currency: project.currency,
      updatedAt: now,
    });
    return {
      ...context,
      snapshot: frozenSnapshot(context),
      idempotencyKey: item.idempotencyKey,
    };
  },
});

export const recordOutcome = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    workerRunId: v.optional(v.string()),
    status: v.union(
      v.literal("scheduled"),
      v.literal("published"),
      v.literal("active"),
      v.literal("uncertain"),
      v.literal("cancel_pending"),
      v.literal("cancelled"),
      v.literal("paused"),
      v.literal("failed"),
    ),
    providerId: v.optional(v.string()),
    providerCampaignId: v.optional(v.string()),
    providerNativeAdId: v.optional(v.string()),
    providerStatusReadAt: v.optional(v.number()),
    publicationUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    metrics: v.optional(metrics),
    retryAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { project, item, account } = await itemContext(
      ctx,
      args.projectId,
      args.itemId,
    );
    if (!item.actionId || !item.reservationMonth)
      throw new Error("No admitted dispatch exists for this item");
    if (args.workerRunId && item.workerRunId !== args.workerRunId)
      throw new Error("Worker does not own this dispatch");
    if (
      args.providerId &&
      item.providerId &&
      args.providerId !== item.providerId
    )
      throw new Error("Provider identity changed after dispatch");
    if (
      (args.providerCampaignId &&
        item.providerCampaignId &&
        args.providerCampaignId !== item.providerCampaignId) ||
      (args.providerNativeAdId &&
        item.providerNativeAdId &&
        args.providerNativeAdId !== item.providerNativeAdId)
    )
      throw new Error("Native campaign or ad identity changed after dispatch");
    if (
      ["scheduled", "published", "active", "paused"].includes(args.status) &&
      !(args.providerId ?? item.providerId)
    )
      throw new Error("Provider acceptance is required for this state");
    if (
      args.status === "published" &&
      !(args.publicationUrl ?? item.publicationUrl)
    )
      throw new Error(
        "Native publication URL is required before marking content published",
      );
    if (args.publicationUrl) website(args.publicationUrl);
    if (item.status === "published" && args.status !== "published")
      return {
        ignored:
          "Publication is terminal; stale observations cannot regress it",
      };
    if (
      ["cancelled", "paused", "failed"].includes(item.status) &&
      !(
        item.status === "paused" &&
        item.kind === "ad" &&
        ["cancel_pending", "uncertain"].includes(args.status)
      ) &&
      ![item.status, "published"].includes(args.status)
    )
      return { ignored: "Stale provider observation" };
    // Pausing locally never turns a late provider acceptance into an active UI state.
    const status =
      (project.status === "paused" || item.status === "cancel_pending") &&
      ["scheduled", "active"].includes(args.status)
        ? ("cancel_pending" as const)
        : args.status;
    const now = Date.now();
    if (
      args.providerStatusReadAt !== undefined &&
      (!Number.isFinite(args.providerStatusReadAt) ||
        args.providerStatusReadAt > now + 60_000 ||
        args.providerStatusReadAt < now - 5 * 60_000)
    )
      throw new Error("Native status timestamp is not current");
    if (args.metrics) {
      [
        args.metrics.impressions,
        args.metrics.clicks,
        args.metrics.spendMinor,
      ].forEach((value) => money(value, "Provider metric"));
      if (
        args.metrics.currency !== project.currency ||
        args.metrics.capturedAt > now + 60_000 ||
        args.metrics.capturedAt < now - 30 * DAY
      )
        throw new Error("Provider metrics currency or capture time is invalid");
      if (
        item.metrics &&
        (args.metrics.capturedAt < item.metrics.capturedAt ||
          args.metrics.spendMinor < item.metrics.spendMinor)
      )
        throw new Error("Cumulative provider metrics cannot move backwards");
    }
    // A provider may have accepted a timed-out create. Keep all holds until we have
    // acceptance; an ambiguous or failed dispatch is not proof of zero cost.
    let heldIntegrationMinor = item.heldIntegrationMinor;
    if (
      heldIntegrationMinor &&
      ["scheduled", "published", "active", "paused", "cancelled"].includes(
        args.status,
      )
    ) {
      const budget = await allowance(
        ctx,
        "integration",
        item.reservationMonth,
        3_000,
        "USD",
      );
      await ctx.db.patch(budget._id, {
        heldMinor: budget.heldMinor - heldIntegrationMinor,
        spentMinor: budget.spentMinor + heldIntegrationMinor,
        updatedAt: now,
      });
      heldIntegrationMinor = 0;
    }
    if (args.metrics && item.kind === "ad") {
      const accounted = Math.max(
        item.metrics?.spendMinor ?? 0,
        item.billingSettlement?.finalSpendMinor ?? 0,
      );
      const delta = Math.max(0, args.metrics.spendMinor - accounted);
      const budget = await allowance(
        ctx,
        `advertising:${project._id}`,
        item.reservationMonth,
        project.advertisingLimitMinor,
        project.currency,
      );
      const released = Math.min(item.heldAdvertisingMinor, delta);
      await ctx.db.patch(budget._id, {
        spentMinor: budget.spentMinor + delta,
        heldMinor: budget.heldMinor - released,
        updatedAt: now,
      });
      await ctx.db.patch(item._id, {
        heldAdvertisingMinor: item.heldAdvertisingMinor - released,
      });
    }
    if (
      args.metrics ||
      (status === "published" && item.status !== "published")
    ) {
      await incrementMarketingStats(ctx, project, {
        published:
          status === "published" && item.status !== "published" ? 1 : 0,
        ...(args.metrics
          ? {
              impressions:
                args.metrics.impressions - (item.metrics?.impressions ?? 0),
              clicks: args.metrics.clicks - (item.metrics?.clicks ?? 0),
              metricsAt: args.metrics.capturedAt,
              advertisingMinor:
                item.kind === "ad"
                  ? Math.max(
                      0,
                      args.metrics.spendMinor -
                        Math.max(
                          item.metrics?.spendMinor ?? 0,
                          item.billingSettlement?.finalSpendMinor ?? 0,
                        ),
                    )
                  : 0,
            }
          : {}),
      });
    }
    if (args.retryAfterMs !== undefined && !Number.isFinite(args.retryAfterMs))
      throw new Error("Invalid retry delay");
    const failures = args.error ? (item.reconciliationFailures ?? 0) + 1 : 0;
    const terminalAt =
      item.terminalAt ?? (TERMINAL.has(status) ? now : undefined);
    const nextCheckAt =
      failures >= 6
        ? Number.MAX_SAFE_INTEGER
        : args.retryAfterMs !== undefined
          ? now + Math.min(DAY, Math.max(5_000, args.retryAfterMs))
          : status === "paused" && item.kind === "ad" && terminalAt! > now - DAY
            ? now + 5 * 60_000
            : TERMINAL.has(status)
              ? item.createdAt < now - 30 * DAY
                ? Number.MAX_SAFE_INTEGER
                : now +
                  (status === "published" && account.platform === "x"
                    ? 7 * DAY
                    : DAY)
              : now + 5 * 60_000;
    await ctx.db.patch(item._id, {
      status,
      heldIntegrationMinor,
      providerId: args.providerId ?? item.providerId,
      providerCampaignId: args.providerCampaignId ?? item.providerCampaignId,
      providerNativeAdId: args.providerNativeAdId ?? item.providerNativeAdId,
      providerStatusReadAt:
        args.providerStatusReadAt ?? item.providerStatusReadAt,
      providerCampaignKey: args.providerCampaignId
        ? `${account.providerAccountId}:${args.providerCampaignId}`
        : item.providerCampaignKey,
      providerNativeAdKey: args.providerNativeAdId
        ? `${account.providerAccountId}:${args.providerNativeAdId}`
        : item.providerNativeAdKey,
      publicationUrl: args.publicationUrl ?? item.publicationUrl,
      error:
        args.error?.slice(0, 1_000) ??
        (args.metrics &&
        item.billingSettlement &&
        args.metrics.spendMinor > item.billingSettlement.finalSpendMinor
          ? "Provider reports additional charges beyond the operator-confirmed final invoice; review billing"
          : undefined),
      metrics: args.metrics ?? item.metrics,
      reconciliationFailures: failures,
      terminalAt,
      nextCheckAt,
      updatedAt: now,
    });
    if (!TERMINAL.has(item.status) && TERMINAL.has(status))
      await ctx.db.patch(project._id, {
        openItemCount: Math.max(0, project.openItemCount - 1),
        updatedAt: now,
      });
    else if (TERMINAL.has(item.status) && !TERMINAL.has(status))
      await ctx.db.patch(project._id, {
        openItemCount: project.openItemCount + 1,
        updatedAt: now,
      });
    const ledgerStatus =
      status === "uncertain" || status === "cancel_pending"
        ? "running"
        : status === "failed"
          ? "failed"
          : ["paused", "cancelled"].includes(status)
            ? "cancelled"
            : "succeeded";
    await ctx.db.patch(item.actionId, {
      status: ledgerStatus,
      error: args.error?.slice(0, 1_000),
      actualCostMinor:
        item.kind === "ad" &&
        (args.metrics || item.metrics || item.billingSettlement)
          ? Math.max(
              args.metrics?.spendMinor ?? item.metrics?.spendMinor ?? 0,
              item.billingSettlement?.finalSpendMinor ?? 0,
            )
          : undefined,
      providerReceipt: {
        provider: "zernio",
        providerAccountId: account.providerAccountId,
        providerId: args.providerId ?? item.providerId ?? null,
        nativeUrl: args.publicationUrl ?? item.publicationUrl ?? null,
        status,
        billingSettlement: item.billingSettlement ?? null,
        capturedAt: now,
      },
      updatedAt: now,
    });
    return { status };
  },
});

export const setProjectStatus = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    status: v.union(v.literal("active"), v.literal("paused")),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    await ctx.db.patch(project._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    if (args.status === "paused") {
      for (const status of OPEN_STATUSES) {
        const rows = await ctx.db
          .query("marketingItems")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", project._id).eq("status", status),
          )
          .take(MAX_CONTENT_ROWS);
        for (const item of rows) {
          await cancelQueuedItem(
            ctx,
            item,
            "Project paused; remote cancellation remains unconfirmed until reconciled",
          );
        }
      }
      const pending = await ctx.db
        .query("marketingItems")
        .withIndex("by_project_status", (q) =>
          q.eq("projectId", project._id).eq("status", "cancel_pending"),
        )
        .take(MAX_CONTENT_ROWS);
      await ctx.db.patch(project._id, { openItemCount: pending.length });
      return { status: "paused", cancellationPending: pending.length };
    }
    const approved = await ctx.db
      .query("marketingItems")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", project._id).eq("status", "approved"),
      )
      .take(MAX_CONTENT_ROWS);
    for (const item of approved)
      await ctx.db.patch(item._id, {
        nextCheckAt: Math.max(Date.now(), item.scheduledAt - DAY),
      });
    return { status: "active", cancellationPending: 0 };
  },
});

export const ingestConversion = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    tokenHash: v.string(),
    eventId: v.string(),
    event: goal,
    itemId: v.optional(v.id("marketingItems")),
    valueMinor: v.number(),
    currency: v.string(),
    occurredAt: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    if (args.tokenHash !== project.conversionTokenHash)
      throw new Error("Invalid project conversion credential");
    const now = Date.now();
    text(args.eventId, "Conversion event ID", 160);
    money(args.valueMinor);
    if (
      !/^[A-Z]{3}$/.test(args.currency) ||
      args.currency !== project.currency ||
      args.occurredAt > now + 60_000 ||
      args.occurredAt < now - 30 * DAY ||
      args.event !== project.goal
    )
      throw new Error(
        "Conversion must match the project's goal, currency and 30-day intake window",
      );
    if (args.itemId) {
      const item = await ctx.db.get(args.itemId);
      assertOwned(project._id, item);
    }
    const existing = await ctx.db
      .query("marketingConversions")
      .withIndex("by_project_event", (q) =>
        q.eq("projectId", project._id).eq("eventId", args.eventId),
      )
      .unique();
    if (existing) {
      if (
        existing.event !== args.event ||
        existing.itemId !== args.itemId ||
        existing.valueMinor !== args.valueMinor ||
        existing.currency !== args.currency ||
        existing.occurredAt !== args.occurredAt
      )
        throw new Error(
          "Conversion event ID conflicts with its immutable original",
        );
      return { id: existing._id, reused: true };
    }
    const {
      projectId,
      eventId,
      event,
      itemId,
      valueMinor,
      currency,
      occurredAt,
    } = args;
    const values = {
      projectId,
      eventId,
      event,
      ...(itemId ? { itemId } : {}),
      valueMinor,
      currency,
      occurredAt,
    };
    const id = await ctx.db.insert("marketingConversions", {
      ...values,
      receivedAt: now,
    });
    const month = monthKey(args.occurredAt);
    const summary = await ctx.db
      .query("marketingResults")
      .withIndex("by_project_month", (q) =>
        q.eq("projectId", project._id).eq("month", month),
      )
      .unique();
    if (summary)
      await ctx.db.patch(summary._id, {
        conversions: summary.conversions + 1,
        valueMinor: summary.valueMinor + args.valueMinor,
        updatedAt: now,
      });
    else
      await ctx.db.insert("marketingResults", {
        projectId: project._id,
        month,
        conversions: 1,
        valueMinor: args.valueMinor,
        currency: args.currency,
        updatedAt: now,
      });
    await incrementMarketingStats(ctx, project, {
      conversions: 1,
      valueMinor: args.valueMinor,
    });
    return { id, reused: false };
  },
});

export const getItem = internalQuery({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
  },
  handler: async (ctx, args) => itemContext(ctx, args.projectId, args.itemId),
});

export const getAsset = internalQuery({
  args: {
    projectId: v.id("marketingProjects"),
    assetId: v.id("marketingAssets"),
  },
  handler: async (ctx, args) => {
    await projectFor(ctx, args.projectId);
    const asset = await ctx.db.get(args.assetId);
    assertOwned(args.projectId, asset);
    return asset!;
  },
});

export const dueItems = internalQuery({
  args: {},
  handler: async (ctx) => {
    const statuses = [
      "approved",
      "dispatching",
      "uncertain",
      "scheduled",
      "active",
      "cancel_pending",
      "published",
      "paused",
    ] as const;
    return (
      await Promise.all(
        statuses.map((status) =>
          ctx.db
            .query("marketingItems")
            .withIndex("by_status_next_check", (q) =>
              q.eq("status", status).lte("nextCheckAt", Date.now()),
            )
            .take(10),
        ),
      )
    )
      .flat()
      .map((item) => ({
        projectId: item.projectId,
        itemId: item._id,
        status: item.status,
      }));
  },
});

export const dueProjects = internalQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("marketingProjects")
      .withIndex("by_status_next_plan", (q) =>
        q.eq("status", "active").lte("nextPlanAt", Date.now()),
      )
      .take(10),
});

export const providerInventory = internalQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("marketingProviderInventory")
      .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
      .unique(),
});

export const recordInventoryFailure = internalMutation({
  args: { error: v.string(), retryAfterMs: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("marketingProviderInventory")
      .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
      .unique();
    const values = {
      error: text(args.error, "Inventory error", 1_000),
      nextRefreshAt:
        Date.now() + Math.min(DAY, Math.max(HOUR, args.retryAfterMs)),
    };
    if (row) await ctx.db.patch(row._id, values);
    else
      await ctx.db.insert("marketingProviderInventory", {
        provider: "zernio",
        accountCount: 0,
        baseMinor: 0,
        checkedAt: 0,
        pricingVerifiedAt: 0,
        ...values,
      });
  },
});

export const recordPlanningFailure = internalMutation({
  args: { projectId: v.id("marketingProjects"), error: v.string() },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    await ctx.db.patch(project._id, {
      planningError: text(args.error, "Planning error", 1_000),
      nextPlanAt: Number.MAX_SAFE_INTEGER,
      updatedAt: Date.now(),
    });
  },
});

export const blockItem = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const { item } = await itemContext(ctx, args.projectId, args.itemId);
    if (TERMINAL.has(item.status)) return;
    if (item.reservationMonth) {
      // A permanent error cannot erase a possibly live remote schedule.
      await ctx.db.patch(item._id, {
        status: "cancel_pending",
        error: text(args.error, "Blocking reason", 1_000),
        nextCheckAt: Number.MAX_SAFE_INTEGER,
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(item._id, {
      status: "blocked",
      error: text(args.error, "Blocking reason", 1_000),
      updatedAt: Date.now(),
    });
    if (item.actionId)
      await ctx.db.patch(item.actionId, {
        status: "blocked",
        error: args.error.slice(0, 1_000),
        updatedAt: Date.now(),
      });
  },
});

export const settleAdBilling = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    expectedProviderId: v.string(),
    expectedCampaignId: v.string(),
    reference: v.string(),
    finalSpendMinor: v.number(),
    confirmed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { project, item } = await itemContext(
      ctx,
      args.projectId,
      args.itemId,
    );
    money(args.finalSpendMinor);
    const reference = text(args.reference, "Final invoice reference", 160);
    if (
      !args.confirmed ||
      item.kind !== "ad" ||
      item.status !== "paused" ||
      item.providerId !== args.expectedProviderId ||
      item.providerCampaignId !== args.expectedCampaignId ||
      !item.reservationMonth ||
      !item.actionId
    )
      throw new Error(
        "Confirm the final invoice for this exact stopped campaign",
      );
    if (item.billingSettlement) {
      if (
        item.billingSettlement.reference !== reference ||
        item.billingSettlement.finalSpendMinor !== args.finalSpendMinor
      )
        throw new Error("Final billing receipt is immutable");
      return { reused: true };
    }
    if (
      item.error ||
      !item.providerStatusReadAt ||
      item.providerStatusReadAt < Date.now() - 5 * 60_000
    )
      throw new Error(
        "Refresh and confirm the current native paused state before settling billing",
      );
    const reported = item.metrics?.spendMinor ?? 0;
    if (args.finalSpendMinor < reported)
      throw new Error(
        "Final spend cannot erase reported charges; reconcile refunds separately",
      );
    const budget = await allowance(
      ctx,
      `advertising:${project._id}`,
      item.reservationMonth,
      project.advertisingLimitMinor,
      project.currency,
    );
    const billingSettlement = {
      reference,
      finalSpendMinor: args.finalSpendMinor,
      currency: project.currency,
      confirmedAt: Date.now(),
    };
    await ctx.db.patch(budget._id, {
      spentMinor: budget.spentMinor + args.finalSpendMinor - reported,
      heldMinor: budget.heldMinor - item.heldAdvertisingMinor,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(item._id, {
      heldAdvertisingMinor: 0,
      billingSettlement,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(item.actionId, {
      actualCostMinor: args.finalSpendMinor,
      providerReceipt: {
        provider: "zernio",
        providerId: item.providerId,
        providerCampaignId: item.providerCampaignId,
        billingSettlement,
        evidenceSource: "operator_confirmed_final_platform_invoice",
      },
      updatedAt: Date.now(),
    });
    await incrementMarketingStats(ctx, project, {
      advertisingMinor: args.finalSpendMinor - reported,
    });
    return { reused: false, releasedMinor: item.heldAdvertisingMinor };
  },
});

export const recheckItem = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
  },
  handler: async (ctx, args) => {
    const { item } = await itemContext(ctx, args.projectId, args.itemId);
    if (
      !["blocked", "uncertain", "cancel_pending", "paused"].includes(
        item.status,
      )
    )
      throw new Error("This item does not need an operator recheck");
    if (item.reservationMonth) {
      await ctx.db.patch(item._id, {
        status: item.status === "blocked" ? "cancel_pending" : item.status,
        nextCheckAt: Date.now(),
        reconciliationFailures: 0,
        updatedAt: Date.now(),
      });
    } else {
      if (item.actionId)
        await ctx.db.patch(item.actionId, {
          status: "cancelled",
          updatedAt: Date.now(),
        });
      if (item.approvalId)
        await ctx.db.patch(item.approvalId, {
          status: "cancelled",
          decidedAt: Date.now(),
        });
      await ctx.db.patch(item._id, {
        status: "draft",
        version: item.version + 1,
        actionId: undefined,
        approvalId: undefined,
        approvedHash: undefined,
        error: undefined,
        reconciliationFailures: 0,
        updatedAt: Date.now(),
      });
    }
    return { status: item.reservationMonth ? "recheck_requested" : "draft" };
  },
});

export const reserveMetricsRead = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    requestKey: v.string(),
  },
  handler: async (ctx, args) => {
    const { project, account, item } = await itemContext(
      ctx,
      args.projectId,
      args.itemId,
    );
    if (account.platform !== "x") return { allowed: true, actionId: null };
    text(args.requestKey, "Read reservation key", 160);
    const previous = await ctx.db
      .query("actionLedger")
      .withIndex("by_idempotency", (q) =>
        q.eq("idempotencyKey", args.requestKey),
      )
      .unique();
    if (previous) return { allowed: false, actionId: previous._id };
    const now = Date.now(),
      month = monthKey(now);
    const inventory = await ctx.db
      .query("marketingProviderInventory")
      .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
      .unique();
    if (!inventory || inventory.checkedAt < now - DAY)
      throw new Error("Refresh provider inventory before metered X analytics");
    if (
      inventory.xSpendLimitMinor !== undefined &&
      (inventory.xSpendLimitMinor === null ||
        inventory.xSpendLimitMinor > 3_000 - inventory.baseMinor)
    )
      throw new Error(
        "Set the provider's X spending cap within the integration allowance",
      );
    const budget = await allowance(ctx, "integration", month, 3_000, "USD");
    // One post/resource at $0.005, rounded up to one cent for conservative admission.
    assertAvailable(
      budget.limitMinor,
      Math.max(
        budget.spentMinor + inventory.baseMinor,
        inventory.periodSpendMinor ?? 0,
      ),
      budget.heldMinor,
      1,
    );
    await ctx.db.patch(budget._id, {
      heldMinor: budget.heldMinor + 1,
      updatedAt: now,
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: project.organizationId,
      actionKind: "marketing_x_metric_read",
      riskClass: "low",
      status: "running",
      idempotencyKey: args.requestKey,
      payloadHash: snapshotHash({ itemId: item._id, month }),
      payloadSnapshot: { itemId: item._id, month },
      estimatedCostMinor: 1,
      reservedCostMinor: 1,
      currency: "USD",
      createdAt: now,
      updatedAt: now,
    });
    return { allowed: true, actionId };
  },
});

export const completeMetricsRead = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    itemId: v.id("marketingItems"),
    actionId: v.id("actionLedger"),
  },
  handler: async (ctx, args) => {
    const { project, item } = await itemContext(
      ctx,
      args.projectId,
      args.itemId,
    );
    const action = await ctx.db.get(args.actionId);
    const payload = action?.payloadSnapshot as
      { itemId?: string; month?: string } | undefined;
    if (
      !action ||
      action.organizationId !== project.organizationId ||
      action.actionKind !== "marketing_x_metric_read" ||
      payload?.itemId !== item._id ||
      !payload.month
    )
      throw new Error("Metrics reservation does not belong to this item");
    if (action.status === "succeeded") return;
    const budget = await allowance(
      ctx,
      "integration",
      payload.month,
      3_000,
      "USD",
    );
    await ctx.db.patch(budget._id, {
      heldMinor: budget.heldMinor - 1,
      spentMinor: budget.spentMinor + 1,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(action._id, {
      status: "succeeded",
      reservedCostMinor: 0,
      providerReceipt: {
        status: "read_received",
        accountedConservativeMinor: 1,
        actualInvoicedMinor: null,
      },
      updatedAt: Date.now(),
    });
  },
});

export const registerAsset = internalMutation({
  args: {
    projectId: v.id("marketingProjects"),
    key: v.string(),
    sha256: v.string(),
    bytes: v.number(),
    contentType: v.string(),
    source: v.union(v.literal("upload"), v.literal("approved_render")),
    rightsConfirmed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const project = await projectFor(ctx, args.projectId);
    if (
      !args.rightsConfirmed ||
      !args.key.startsWith(`marketing/${args.projectId}/`) ||
      args.key.includes("..") ||
      args.key.includes("\\") ||
      !/^[a-f0-9]{64}$/.test(args.sha256) ||
      !Number.isSafeInteger(args.bytes) ||
      args.bytes < 1 ||
      args.bytes > 500_000_000 ||
      !["image/jpeg", "image/png", "image/webp", "video/mp4"].includes(
        args.contentType,
      )
    )
      throw new Error(
        "Verified project media and confirmed usage rights are required",
      );
    const existing = await ctx.db
      .query("marketingAssets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      if (
        existing.projectId !== args.projectId ||
        existing.sha256 !== args.sha256 ||
        existing.bytes !== args.bytes
      )
        throw new Error("Asset key conflicts with its original receipt");
      return existing._id;
    }
    const assets = await ctx.db
      .query("marketingAssets")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    if (assets.length >= 100)
      throw new Error("MVP project media limit reached");
    const assetId = await ctx.db.insert("marketingAssets", {
      organizationId: project.organizationId,
      ...args,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, {
      defaultAssetId: assetId,
      updatedAt: Date.now(),
    });
    return assetId;
  },
});

export const ingestWebhook = internalMutation({
  args: {
    eventId: v.string(),
    bodyHash: v.string(),
    event: v.string(),
    providerId: v.optional(v.string()),
    providerAccountId: v.optional(v.string()),
    nativeCampaignId: v.optional(v.string()),
    nativeAdId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    text(args.eventId, "Webhook event ID", 160);
    if (!/^[a-f0-9]{64}$/.test(args.bodyHash))
      throw new Error("Invalid webhook digest");
    const old = await ctx.db
      .query("marketingWebhookReceipts")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (old) {
      if (old.bodyHash !== args.bodyHash)
        throw new Error("Webhook replay changed its original body");
      return { reused: true };
    }
    const nativeKey = args.providerAccountId
      ? `${args.providerAccountId}:${args.nativeCampaignId ?? args.nativeAdId}`
      : undefined;
    const item = args.providerId
      ? await ctx.db
          .query("marketingItems")
          .withIndex("by_provider_id", (q) =>
            q.eq("providerId", args.providerId),
          )
          .unique()
      : nativeKey && args.nativeCampaignId
        ? await ctx.db
            .query("marketingItems")
            .withIndex("by_provider_campaign_key", (q) =>
              q.eq("providerCampaignKey", nativeKey),
            )
            .unique()
        : nativeKey && args.nativeAdId
          ? await ctx.db
              .query("marketingItems")
              .withIndex("by_provider_native_ad_key", (q) =>
                q.eq("providerNativeAdKey", nativeKey),
              )
              .unique()
          : null;
    if (item) {
      const channel = await ctx.db.get(item.channelId),
        account = channel ? await ctx.db.get(channel.accountId) : null;
      if (
        !account ||
        (args.providerAccountId &&
          account.providerAccountId !== args.providerAccountId)
      )
        throw new Error("Webhook account differs from the admitted item");
      // The event is a wake hint. Re-read authoritative provider state in the
      // worker instead of trusting an out-of-order webhook as current state.
      await ctx.db.patch(item._id, { nextCheckAt: Date.now() });
    }
    if (args.event === "account.disconnected" && args.providerAccountId) {
      const account = await ctx.db
        .query("marketingProviderAccounts")
        .withIndex("by_provider_id", (q) =>
          q.eq("providerAccountId", args.providerAccountId!),
        )
        .unique();
      if (account)
        await ctx.db.patch(account._id, {
          connected: false,
          syncedAt: Date.now(),
        });
    }
    await ctx.db.insert("marketingWebhookReceipts", {
      eventId: args.eventId,
      bodyHash: args.bodyHash,
      receivedAt: Date.now(),
      ...(item ? { itemId: item._id } : {}),
    });
    return { reused: false, itemId: item?._id };
  },
});
