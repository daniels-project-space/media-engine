import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  assertDigest,
  assertNonBlank,
  ensureDefaultOrganization,
  findDefaultOrganization,
  formSevenEventType,
  intakeArtifactKind,
} from "./controlPlaneModel";

const MAX_DASHBOARD_ROWS = 100;

function dashboardLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1) throw new Error("dashboard limit must be a positive integer");
  return Math.min(value, MAX_DASHBOARD_ROWS);
}

/** Return the fixed first-party organization, without creating it on a read. */
export const getDefaultOrganization = internalQuery({
  args: {},
  handler: async (ctx) => await findDefaultOrganization(ctx),
});

/** Idempotently creates the default organization for the Media Engine hub. */
export const bootstrapDefaultOrganization = internalMutation({
  args: {},
  handler: async (ctx) => {
    const organization = await ensureDefaultOrganization(ctx);
    if (!organization) throw new Error("failed to bootstrap Media Engine organization");
    return organization;
  },
});

/**
 * A compact, safe read model for the future Control Center. With no
 * organization id it presents the whole portfolio; an explicit id narrows the
 * same model to one organization. It intentionally excludes raw webhook
 * bodies, credential material, approval snapshots, and contact details.
 */
export const listDashboard = internalQuery({
  args: { organizationId: v.optional(v.id("organizations")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = dashboardLimit(args.limit);
    let organizations: Array<Doc<"organizations">> = [];
    let primaryOrganization: Doc<"organizations"> | null = null;
    let connections: Array<Doc<"integrationConnections">>;
    let pendingApprovals: Array<Doc<"approvalRequests">>;
    let recentActions: Array<Doc<"actionLedger">>;
    let budgets: Array<Doc<"budgetEnvelopes">>;
    let recentIntakes: Array<Doc<"formSevenIntakes">>;
    let recentReceipts: Array<Doc<"eventReceipts">>;

    if (args.organizationId) {
      const organization = await ctx.db.get(args.organizationId);
      if (!organization) {
        return {
          organizations: [],
          primaryOrganization: null,
          connections: [],
          approvals: [],
          actions: [],
          budgets: [],
          intakes: [],
          receipts: [],
        };
      }
      organizations = [organization];
      primaryOrganization = organization;
      [connections, pendingApprovals, recentActions, budgets, recentIntakes, recentReceipts] = await Promise.all([
        ctx.db
          .query("integrationConnections")
          .withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
          .take(limit),
        ctx.db
          .query("approvalRequests")
          .withIndex("by_organization_status", (q) => q.eq("organizationId", organization._id).eq("status", "pending"))
          .take(limit),
        ctx.db
          .query("actionLedger")
          .withIndex("by_organization_created", (q) => q.eq("organizationId", organization._id))
          .order("desc")
          .take(limit),
        ctx.db
          .query("budgetEnvelopes")
          .withIndex("by_organization_status", (q) => q.eq("organizationId", organization._id).eq("status", "active"))
          .take(limit),
        ctx.db
          .query("formSevenIntakes")
          .withIndex("by_organization_received", (q) => q.eq("organizationId", organization._id))
          .order("desc")
          .take(limit),
        ctx.db
          .query("eventReceipts")
          .withIndex("by_organization_received", (q) => q.eq("organizationId", organization._id))
          .order("desc")
          .take(limit),
      ]);
    } else {
      const [allOrganizations, defaultOrganization] = await Promise.all([
        ctx.db.query("organizations").order("asc").take(MAX_DASHBOARD_ROWS),
        findDefaultOrganization(ctx),
      ]);
      organizations = allOrganizations;
      primaryOrganization = defaultOrganization ?? organizations[0] ?? null;
      [connections, pendingApprovals, recentActions, budgets, recentIntakes, recentReceipts] = await Promise.all([
        ctx.db.query("integrationConnections").order("desc").take(limit),
        ctx.db.query("approvalRequests").withIndex("by_status", (q) => q.eq("status", "pending")).take(limit),
        ctx.db.query("actionLedger").order("desc").take(limit),
        ctx.db.query("budgetEnvelopes").withIndex("by_status", (q) => q.eq("status", "active")).take(limit),
        ctx.db.query("formSevenIntakes").withIndex("by_received", (q) => q).order("desc").take(limit),
        ctx.db.query("eventReceipts").withIndex("by_received", (q) => q).order("desc").take(limit),
      ]);
    }

    return {
      organizations,
      primaryOrganization,
      connections,
      // Keep the names at this server boundary aligned with the protected
      // Control Center API. The view consumes these real rows directly; it
      // must never need to infer dashboard state from an incompatible shape.
      approvals: pendingApprovals.map((approval) => ({
        _id: approval._id,
        _creationTime: approval._creationTime,
        organizationId: approval.organizationId,
        resourceType: approval.resourceType,
        resourceId: approval.resourceId,
        planVersion: approval.planVersion,
        actionKind: approval.actionKind,
        snapshotHash: approval.snapshotHash,
        riskClass: approval.riskClass,
        status: approval.status,
        requestedAt: approval.requestedAt,
        requestedBy: approval.requestedBy,
        expiresAt: approval.expiresAt,
      })),
      actions: recentActions.map((action) => ({
        _id: action._id,
        _creationTime: action._creationTime,
        organizationId: action.organizationId,
        connectionId: action.connectionId,
        approvalId: action.approvalId,
        renderJobId: action.renderJobId,
        actionKind: action.actionKind,
        riskClass: action.riskClass,
        status: action.status,
        idempotencyKey: action.idempotencyKey,
        payloadHash: action.payloadHash,
        estimatedCostMinor: action.estimatedCostMinor,
        reservedCostMinor: action.reservedCostMinor,
        actualCostMinor: action.actualCostMinor,
        currency: action.currency,
        triggerRunId: action.triggerRunId,
        error: action.error,
        createdAt: action.createdAt,
        updatedAt: action.updatedAt,
      })),
      budgets,
      intakes: recentIntakes.map((intake) => ({
        _id: intake._id,
        organizationId: intake.organizationId,
        externalIntakeId: intake.externalIntakeId,
        eventType: intake.eventType,
        status: intake.status,
        businessName: intake.businessName,
        selectedService: intake.selectedService,
        referenceCount: intake.referenceCount,
        receivedAt: intake.receivedAt,
      })),
      receipts: recentReceipts.map((receipt) => ({
        _id: receipt._id,
        organizationId: receipt.organizationId,
        source: receipt.source,
        eventType: receipt.eventType,
        status: receipt.status,
        occurredAt: receipt.occurredAt,
        receivedAt: receipt.receivedAt,
      })),
    };
  },
});

/**
 * Normalized FORM / SEVEN ingress for the signed outbox route. This deliberately
 * stops at receipt + intake recording: it cannot render, email, publish, or
 * contact anyone. A later governed action must be explicitly approved.
 */
export const ingestFormSevenEvent = internalMutation({
  args: {
    organizationSlug: v.string(),
    eventId: v.string(),
    eventType: formSevenEventType,
    payloadHash: v.string(),
    occurredAt: v.optional(v.number()),
    intake: v.object({
      externalIntakeId: v.string(),
      eventType: formSevenEventType,
      contactName: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      businessName: v.optional(v.string()),
      businessType: v.optional(v.string()),
      websiteUrl: v.optional(v.string()),
      selectedService: v.optional(v.string()),
      briefDescription: v.optional(v.string()),
      referenceCount: v.number(),
      marketingOptIn: v.boolean(),
      artifacts: v.array(
        v.object({
          kind: intakeArtifactKind,
          sourceLabel: v.optional(v.string()),
          sourceUrl: v.optional(v.string()),
          sourceDigest: v.optional(v.string()),
          contentType: v.optional(v.string()),
          byteSize: v.optional(v.number()),
        }),
      ),
    }),
  },
  handler: async (ctx, args) => {
    const slug = args.organizationSlug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("invalid organization slug");
    if (slug !== "form-seven") {
      throw new Error("FORM / SEVEN ingress may only target the form-seven organization");
    }
    assertNonBlank(args.eventId, "event id");
    assertNonBlank(args.intake.externalIntakeId, "external intake id");
    assertDigest(args.payloadHash, "event payload hash");
    if (args.intake.eventType !== args.eventType) throw new Error("intake event type does not match envelope");
    if (!Number.isInteger(args.intake.referenceCount) || args.intake.referenceCount < 0) {
      throw new Error("reference count must be a non-negative integer");
    }
    if (args.occurredAt !== undefined && (!Number.isInteger(args.occurredAt) || args.occurredAt < 0)) {
      throw new Error("occurred at must be a unix millisecond timestamp");
    }
    for (const artifact of args.intake.artifacts) {
      if (artifact.sourceDigest) assertDigest(artifact.sourceDigest, "artifact source digest");
      if (artifact.byteSize !== undefined && (!Number.isInteger(artifact.byteSize) || artifact.byteSize < 0)) {
        throw new Error("artifact byte size must be a non-negative integer");
      }
    }

    let organization = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!organization) {
      const now = Date.now();
      const organizationId = await ctx.db.insert("organizations", {
        slug,
        name: "FORM / SEVEN",
        kind: "portfolio",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      organization = await ctx.db.get(organizationId);
    }
    if (!organization) throw new Error("failed to establish FORM / SEVEN organization");

    const priorReceipt = await ctx.db
      .query("eventReceipts")
      .withIndex("by_source_event", (q) => q.eq("source", "form_seven").eq("eventId", args.eventId))
      .unique();
    if (priorReceipt) {
      if (priorReceipt.payloadHash !== args.payloadHash || priorReceipt.organizationId !== organization._id) {
        throw new Error("event replay conflicts with the original receipt");
      }
      const priorIntake = await ctx.db
        .query("formSevenIntakes")
        .withIndex("by_event_receipt", (q) => q.eq("eventReceiptId", priorReceipt._id))
        .unique();
      return { created: false, receiptId: priorReceipt._id, intakeId: priorIntake?._id ?? null };
    }

    const now = Date.now();
    const receiptId = await ctx.db.insert("eventReceipts", {
      organizationId: organization._id,
      source: "form_seven",
      eventId: args.eventId,
      eventType: args.eventType,
      payloadHash: args.payloadHash,
      status: "accepted",
      occurredAt: args.occurredAt,
      receivedAt: now,
    });
    const intakeId = await ctx.db.insert("formSevenIntakes", {
      organizationId: organization._id,
      eventReceiptId: receiptId,
      externalIntakeId: args.intake.externalIntakeId,
      eventType: args.eventType,
      status: "received",
      contactName: args.intake.contactName,
      contactEmail: args.intake.contactEmail,
      contactPhone: args.intake.contactPhone,
      businessName: args.intake.businessName,
      businessType: args.intake.businessType,
      websiteUrl: args.intake.websiteUrl,
      selectedService: args.intake.selectedService,
      briefDescription: args.intake.briefDescription,
      referenceCount: args.intake.referenceCount,
      marketingOptIn: args.intake.marketingOptIn,
      receivedAt: now,
      updatedAt: now,
    });
    for (const artifact of args.intake.artifacts) {
      await ctx.db.insert("intakeArtifacts", {
        intakeId,
        kind: artifact.kind,
        status: "declared",
        sourceLabel: artifact.sourceLabel,
        sourceUrl: artifact.sourceUrl,
        sourceDigest: artifact.sourceDigest,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { created: true, receiptId, intakeId };
  },
});

/** Explicit private inspection path for an operator or trusted server process. */
export const inspectFormSevenIntake = internalQuery({
  args: { intakeId: v.id("formSevenIntakes") },
  handler: async (ctx, { intakeId }) => {
    const intake = await ctx.db.get(intakeId);
    if (!intake) return null;
    const [receipt, artifacts] = await Promise.all([
      ctx.db.get(intake.eventReceiptId),
      ctx.db.query("intakeArtifacts").withIndex("by_intake", (q) => q.eq("intakeId", intakeId)).collect(),
    ]);
    return { intake, receipt, artifacts };
  },
});
