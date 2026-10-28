import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  ensureDefaultOrganization,
  findDefaultOrganization,
} from "./controlPlaneModel";
import { MAX_PROJECTS, money, text } from "./marketingPolicy";

export const overview = internalQuery({
  args: { asOfMinute: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now =
      args.asOfMinute === undefined ? Date.now() : args.asOfMinute * 60_000;
    const organization = await findDefaultOrganization(ctx);
    if (!organization)
      return {
        projects: [],
        costs: [],
        provider: null,
        capturedAt: Date.now(),
      };
    const projects = await ctx.db
      .query("marketingProjects")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(MAX_PROJECTS);
    const costs = await ctx.db
      .query("marketingCostTotals")
      .withIndex("by_organization_currency", (q) =>
        q.eq("organizationId", organization._id),
      )
      .take(5);
    const provider = await ctx.db
      .query("marketingProviderInventory")
      .withIndex("by_provider", (q) => q.eq("provider", "zernio"))
      .unique();
    const cards = await Promise.all(
      projects.map(async (project) => {
        const channels = await ctx.db
          .query("marketingChannels")
          .withIndex("by_project", (q) => q.eq("projectId", project._id))
          .take(20);
        const active = await ctx.db
          .query("marketingItems")
          .withIndex("by_project_status", (q) =>
            q.eq("projectId", project._id).eq("status", "active"),
          )
          .take(200);
        const attention = (
          await Promise.all(
            ["uncertain", "cancel_pending", "failed", "blocked"].map((status) =>
              ctx.db
                .query("marketingItems")
                .withIndex("by_project_status", (q) =>
                  q
                    .eq("projectId", project._id)
                    .eq(
                      "status",
                      status as
                        "uncertain" | "cancel_pending" | "failed" | "blocked",
                    ),
                )
                .order("desc")
                .take(1),
            ),
          )
        ).flat();
        return {
          id: project._id,
          name: project.name,
          website: project.website,
          status: project.status,
          currency: project.currency,
          goal: project.goal,
          stats: project.stats ?? null,
          openItems: project.openItemCount,
          activeCampaigns: active.filter(
            (item) =>
              project.status === "active" &&
              (item.providerStatusReadAt ?? 0) >= now - 10 * 60_000,
          ).length,
          unconfirmedCampaigns: active.filter(
            (item) => (item.providerStatusReadAt ?? 0) < now - 10 * 60_000,
          ).length,
          enabledChannels: channels.filter((row) => row.mode !== "off").length,
          needsAttention:
            attention.length > 0 ||
            !!project.planningError ||
            active.some(
              (item) => (item.providerStatusReadAt ?? 0) < now - 10 * 60_000,
            ),
          updatedAt: Math.max(
            project.updatedAt,
            ...attention.map((item) => item.updatedAt),
          ),
        };
      }),
    );
    return { projects: cards, costs, provider, capturedAt: Date.now() };
  },
});

export const contentTable = internalQuery({
  args: {
    kind: v.union(
      v.literal("uploads"),
      v.literal("content"),
      v.literal("costs"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const organization = await findDefaultOrganization(ctx);
    if (!organization) return { page: [], isDone: true, continueCursor: "" };
    // One bounded indexed page, even after years of media and content history.
    const opts = {
      ...args.paginationOpts,
      numItems: Math.min(25, args.paginationOpts.numItems),
    };
    if (args.kind === "costs")
      return await ctx.db
        .query("marketingCosts")
        .withIndex("by_organization_created", (q) =>
          q.eq("organizationId", organization._id),
        )
        .order("desc")
        .paginate(opts);
    const result =
      args.kind === "uploads"
        ? await ctx.db
            .query("marketingAssets")
            .withIndex("by_organization_created", (q) =>
              q.eq("organizationId", organization._id),
            )
            .order("desc")
            .paginate(opts)
        : await ctx.db
            .query("marketingItems")
            .withIndex("by_organization_created", (q) =>
              q.eq("organizationId", organization._id),
            )
            .order("desc")
            .paginate(opts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => {
          const project = await ctx.db.get(row.projectId);
          if (!project || project.organizationId !== organization._id)
            throw new Error("Content project ownership mismatch");
          return { ...row, projectName: project.name };
        }),
      ),
    };
  },
});

export const recordCost = internalMutation({
  args: {
    projectId: v.optional(v.id("marketingProjects")),
    label: v.string(),
    category: v.union(
      v.literal("subscription"),
      v.literal("generation"),
      v.literal("hosting"),
    ),
    amountMinor: v.number(),
    currency: v.string(),
    occurredAt: v.number(),
    reference: v.string(),
  },
  handler: async (ctx, args) => {
    const organization = await ensureDefaultOrganization(ctx);
    if (!organization) throw new Error("Workspace not found");
    if (args.projectId) {
      const project = await ctx.db.get(args.projectId);
      if (!project || project.organizationId !== organization._id)
        throw new Error("Project not found");
    }
    money(args.amountMinor);
    const label = text(args.label, "Charge label", 120),
      reference = text(args.reference, "Charge reference", 160);
    if (
      !["USD", "GBP", "EUR", "CHF"].includes(args.currency) ||
      !Number.isFinite(args.occurredAt) ||
      args.occurredAt > Date.now() + 60_000 ||
      args.occurredAt < Date.UTC(2020, 0, 1)
    )
      throw new Error("Choose a valid currency and actual charge date");
    const previous = await ctx.db
      .query("marketingCosts")
      .withIndex("by_organization_reference", (q) =>
        q.eq("organizationId", organization._id).eq("reference", reference),
      )
      .unique();
    if (previous) {
      if (
        previous.label !== label ||
        previous.category !== args.category ||
        previous.amountMinor !== args.amountMinor ||
        previous.currency !== args.currency ||
        previous.projectId !== args.projectId ||
        previous.occurredAt !== args.occurredAt ||
        previous.voidedAt
      )
        throw new Error(
          "This charge reference already exists; use a unique receipt or invoice reference",
        );
      return { id: previous._id, reused: true };
    }
    const now = Date.now(),
      id = await ctx.db.insert("marketingCosts", {
        ...args,
        organizationId: organization._id,
        label,
        reference,
        createdAt: now,
      });
    const totals = await ctx.db
      .query("marketingCostTotals")
      .withIndex("by_organization_currency", (q) =>
        q.eq("organizationId", organization._id).eq("currency", args.currency),
      )
      .unique();
    if (totals)
      await ctx.db.patch(totals._id, {
        [args.category]: totals[args.category] + args.amountMinor,
        updatedAt: now,
      });
    else
      await ctx.db.insert("marketingCostTotals", {
        organizationId: organization._id,
        currency: args.currency,
        subscription: 0,
        generation: 0,
        hosting: 0,
        [args.category]: args.amountMinor,
        updatedAt: now,
      });
    return { id, reused: false };
  },
});

export const voidCost = internalMutation({
  args: { costId: v.id("marketingCosts") },
  handler: async (ctx, args) => {
    const organization = await findDefaultOrganization(ctx),
      entry = await ctx.db.get(args.costId);
    if (!organization || !entry || entry.organizationId !== organization._id)
      throw new Error("Charge not found");
    if (entry.voidedAt) return { reused: true };
    const totals = await ctx.db
      .query("marketingCostTotals")
      .withIndex("by_organization_currency", (q) =>
        q.eq("organizationId", organization._id).eq("currency", entry.currency),
      )
      .unique();
    if (!totals || totals[entry.category] < entry.amountMinor)
      throw new Error("Cost totals need reconciliation");
    await ctx.db.patch(totals._id, {
      [entry.category]: totals[entry.category] - entry.amountMinor,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(entry._id, { voidedAt: Date.now() });
    return { reused: false };
  },
});
