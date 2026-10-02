import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { assertNonBlank, findDefaultOrganization } from "./controlPlaneModel";

/**
 * Governed Fanvue tracking-link outbox.
 *
 * This is intentionally narrower than the historical Fanvue contract shapes:
 * it creates one provider tracking link only after an active, KYC-verified
 * creator destination and an individually approved active funnel agree. It
 * neither creates accounts nor sends chats/posts, and it has no webhook or
 * background retry path.
 */

const FANVUE_TRACKING_LINK_APPROVAL_ACTION = "creator_fanvue_tracking_link_approval";
const FANVUE_TRACKING_LINK_APPROVAL_RESOURCE = "creator_fanvue_tracking_link";
const FANVUE_TRACKING_LINK_DISPATCH_ACTION = "creator-fanvue-tracking-link";
const FANVUE_TRACKING_LINK_CAPABILITY = "manage_tracking_links";
const MAX_TEXT = 2_000;
const MAX_ROWS = 250;

const fanvueTrackingPlatform = v.union(
  v.literal("facebook"),
  v.literal("instagram"),
  v.literal("other"),
  v.literal("reddit"),
  v.literal("snapchat"),
  v.literal("tiktok"),
  v.literal("twitter"),
  v.literal("youtube"),
);

type FanvueTrackingPlatform =
  | "facebook"
  | "instagram"
  | "other"
  | "reddit"
  | "snapchat"
  | "tiktok"
  | "twitter"
  | "youtube";

type FanvueTrackingSnapshot = {
  resourceType: typeof FANVUE_TRACKING_LINK_APPROVAL_RESOURCE;
  resourceId: string;
  planVersion: number;
  provider: "fanvue";
  execution: "fanvue_tracking_link";
  organizationId: string;
  creatorId: string;
  requestedBy: string;
  destination: {
    destinationId: string;
    connectionId: string;
    label: string;
    kind: "fanvue";
    manualKycStatus: "verified";
  };
  funnel: {
    funnelId: string;
    version: number;
    campaignLabel: string;
    objective: string;
  };
  trackingLink: {
    creatorUserUuid: string;
    name: string;
    externalSocialPlatform: FanvueTrackingPlatform;
  };
};

type FanvueTrackingActionContext = {
  action: Doc<"actionLedger">;
  approval: Doc<"approvalRequests">;
  snapshot: FanvueTrackingSnapshot;
  creator: Doc<"creatorProfiles">;
  destination: Doc<"creatorDestinations">;
  funnel: Doc<"creatorFunnelCampaigns">;
  connection: Doc<"integrationConnections">;
};

function normalizeText(value: string, label: string, maxLength = MAX_TEXT): string {
  const normalized = value.trim();
  assertNonBlank(normalized, label);
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function normalizeUuid(value: string, label: string): string {
  const normalized = normalizeText(value, label, 80).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label} must be a UUID from the official Fanvue connection`);
  }
  return normalized;
}

function normalizeTrackingLinkUrl(value: string): string {
  const normalized = normalizeText(value, "Fanvue tracking link URL", 2_000);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Fanvue tracking link receipt has an invalid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Fanvue tracking link receipt must be a public HTTPS URL without credentials");
  }
  return parsed.toString();
}

function normalizeTrackingLinkId(value: string): string {
  return normalizeUuid(value, "Fanvue tracking link id");
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return '"__undefined__"';
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(",")}}`;
}

function snapshotHash(value: unknown): string {
  const serialized = stableSerialize(value);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < serialized.length; index += 1) {
    const code = serialized.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `stable-v1:${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}:${serialized.length}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string, maxLength = MAX_TEXT): string {
  if (typeof value !== "string") throw new Error(`${label} is missing from the Fanvue tracking-link snapshot`);
  return normalizeText(value, label, maxLength);
}

function requiredIdentifier(value: unknown, label: string): string {
  const normalized = requiredString(value, label, 240);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
    throw new Error(`${label} is invalid in the Fanvue tracking-link snapshot`);
  }
  return normalized;
}

function requiredPositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid in the Fanvue tracking-link snapshot`);
  }
  return value;
}

function requiredPlatform(value: unknown): FanvueTrackingPlatform {
  if (
    value === "facebook" || value === "instagram" || value === "other" || value === "reddit"
    || value === "snapchat" || value === "tiktok" || value === "twitter" || value === "youtube"
  ) return value;
  throw new Error("Fanvue tracking-link platform is invalid in the immutable snapshot");
}

function parseTrackingSnapshot(value: unknown): FanvueTrackingSnapshot {
  const root = isRecord(value) ? value : undefined;
  const destination = root && isRecord(root.destination) ? root.destination : undefined;
  const funnel = root && isRecord(root.funnel) ? root.funnel : undefined;
  const trackingLink = root && isRecord(root.trackingLink) ? root.trackingLink : undefined;
  if (!root || !destination || !funnel || !trackingLink) {
    throw new Error("Fanvue tracking-link action has no valid immutable snapshot");
  }
  if (root.resourceType !== FANVUE_TRACKING_LINK_APPROVAL_RESOURCE || root.provider !== "fanvue" || root.execution !== "fanvue_tracking_link") {
    throw new Error("Fanvue tracking-link snapshot belongs to the wrong action type");
  }
  if (destination.kind !== "fanvue" || destination.manualKycStatus !== "verified") {
    throw new Error("Fanvue tracking-link snapshot lacks verified Fanvue destination evidence");
  }
  return {
    resourceType: FANVUE_TRACKING_LINK_APPROVAL_RESOURCE,
    resourceId: requiredIdentifier(root.resourceId, "resource id"),
    planVersion: requiredPositiveInt(root.planVersion, "plan version"),
    provider: "fanvue",
    execution: "fanvue_tracking_link",
    organizationId: requiredIdentifier(root.organizationId, "organization id"),
    creatorId: requiredIdentifier(root.creatorId, "creator id"),
    requestedBy: requiredString(root.requestedBy, "requested by", 200),
    destination: {
      destinationId: requiredIdentifier(destination.destinationId, "destination id"),
      connectionId: requiredIdentifier(destination.connectionId, "Fanvue connection id"),
      label: requiredString(destination.label, "destination label", 200),
      kind: "fanvue",
      manualKycStatus: "verified",
    },
    funnel: {
      funnelId: requiredIdentifier(funnel.funnelId, "funnel id"),
      version: requiredPositiveInt(funnel.version, "funnel version"),
      campaignLabel: requiredString(funnel.campaignLabel, "funnel label", 200),
      objective: requiredString(funnel.objective, "funnel objective", 80),
    },
    trackingLink: {
      creatorUserUuid: normalizeUuid(requiredString(trackingLink.creatorUserUuid, "Fanvue creator user id", 80), "Fanvue creator user id"),
      name: requiredString(trackingLink.name, "tracking-link name", 120),
      externalSocialPlatform: requiredPlatform(trackingLink.externalSocialPlatform),
    },
  };
}

function trackingLinkActionKey(
  destinationId: Id<"creatorDestinations">,
  funnelId: Id<"creatorFunnelCampaigns">,
  funnelVersion: number,
  name: string,
  platform: FanvueTrackingPlatform,
): string {
  // Fanvue permits multiple tracking links per creator. This immutable key
  // admits one specifically named, platform-scoped link for one funnel version.
  return `creator-fanvue-tracking-link:${destinationId}:${funnelId}:${funnelVersion}:${platform}:${snapshotHash(name.toLocaleLowerCase())}`;
}

function trackingSnapshot(args: {
  creator: Doc<"creatorProfiles">;
  destination: Doc<"creatorDestinations">;
  funnel: Doc<"creatorFunnelCampaigns">;
  connection: Doc<"integrationConnections">;
  requestedBy: string;
  name: string;
  externalSocialPlatform: FanvueTrackingPlatform;
}): FanvueTrackingSnapshot {
  const creatorUserUuid = normalizeUuid(
    args.connection.externalAccountId ?? "",
    "official Fanvue creator account id",
  );
  return {
    resourceType: FANVUE_TRACKING_LINK_APPROVAL_RESOURCE,
    resourceId: String(args.destination._id),
    planVersion: args.funnel.version,
    provider: "fanvue",
    execution: "fanvue_tracking_link",
    organizationId: String(args.creator.organizationId),
    creatorId: String(args.creator._id),
    requestedBy: args.requestedBy,
    destination: {
      destinationId: String(args.destination._id),
      connectionId: String(args.connection._id),
      label: args.destination.label,
      kind: "fanvue",
      manualKycStatus: "verified",
    },
    funnel: {
      funnelId: String(args.funnel._id),
      version: args.funnel.version,
      campaignLabel: args.funnel.campaignLabel,
      objective: args.funnel.objective,
    },
    trackingLink: { creatorUserUuid, name: args.name, externalSocialPlatform: args.externalSocialPlatform },
  };
}

async function requireCurrentTrackingContext(
  ctx: MutationCtx,
  args: { destinationId: Id<"creatorDestinations">; funnelId: Id<"creatorFunnelCampaigns"> },
): Promise<{
  creator: Doc<"creatorProfiles">;
  destination: Doc<"creatorDestinations">;
  funnel: Doc<"creatorFunnelCampaigns">;
  connection: Doc<"integrationConnections">;
}> {
  const [destination, funnel] = await Promise.all([ctx.db.get(args.destinationId), ctx.db.get(args.funnelId)]);
  if (!destination || !funnel) throw new Error("Fanvue destination or funnel was not found");
  if (destination.kind !== "fanvue" || destination.status !== "active" || destination.manualKycStatus !== "verified") {
    throw new Error("Fanvue tracking links require an active, KYC-verified Fanvue destination");
  }
  if (!destination.ageGateRequired || !destination.disclosureText?.trim()) {
    throw new Error("Fanvue tracking links require the destination's age gate and truthful disclosure");
  }
  if (funnel.status !== "active" || funnel.destinationId !== destination._id || funnel.creatorId !== destination.creatorId || funnel.organizationId !== destination.organizationId) {
    throw new Error("Fanvue tracking links require the selected active funnel for this destination");
  }
  const [creator, connection, funnelApproval] = await Promise.all([
    ctx.db.get(destination.creatorId),
    destination.integrationConnectionId ? ctx.db.get(destination.integrationConnectionId) : null,
    funnel.approvalId ? ctx.db.get(funnel.approvalId) : null,
  ]);
  if (!creator || creator.organizationId !== destination.organizationId) {
    throw new Error("Fanvue destination creator ownership is invalid");
  }
  if (!connection || connection.provider !== "fanvue" || connection.organizationId !== creator.organizationId) {
    throw new Error("Fanvue tracking links require the destination's official Fanvue connection");
  }
  if (connection.status !== "connected" || connection.health !== "healthy") {
    throw new Error("Fanvue tracking links require a healthy official Fanvue OAuth connection");
  }
  if (!connection.capabilities.includes(FANVUE_TRACKING_LINK_CAPABILITY)) {
    throw new Error("Fanvue OAuth connection lacks manage_tracking_links capability");
  }
  if (!connection.scopes.includes("write:tracking_links")) {
    throw new Error("Fanvue OAuth grant lacks write:tracking_links scope");
  }
  normalizeUuid(connection.externalAccountId ?? "", "official Fanvue creator account id");
  if (!funnelApproval || funnelApproval.status !== "approved") {
    throw new Error("Fanvue tracking links require the active funnel's recorded approval");
  }
  const compliance = funnel.compliance;
  if (
    !compliance.ageGateRequired || !compliance.ageGateEvidenceReference || !compliance.disclosureRequired
    || !compliance.disclosureText || !compliance.operatorAttestation.confirmed
  ) {
    throw new Error("Fanvue tracking links require complete age-gate, disclosure, and operator-attestation evidence");
  }
  return { creator, destination, funnel, connection };
}

async function requireCurrentTrackingContextForSnapshot(
  ctx: MutationCtx,
  snapshot: FanvueTrackingSnapshot,
) {
  const context = await requireCurrentTrackingContext(ctx, {
    destinationId: snapshot.destination.destinationId as Id<"creatorDestinations">,
    funnelId: snapshot.funnel.funnelId as Id<"creatorFunnelCampaigns">,
  });
  if (
    String(context.creator._id) !== snapshot.creatorId
    || String(context.creator.organizationId) !== snapshot.organizationId
    || String(context.destination._id) !== snapshot.resourceId
    || String(context.connection._id) !== snapshot.destination.connectionId
    || context.funnel.version !== snapshot.funnel.version
    || context.funnel.campaignLabel !== snapshot.funnel.campaignLabel
    || context.connection.externalAccountId?.toLowerCase() !== snapshot.trackingLink.creatorUserUuid
  ) {
    throw new Error("Fanvue destination, OAuth connection, or funnel changed; request a new reviewed tracking link");
  }
  return context;
}

async function requireTrackingAction(
  ctx: MutationCtx,
  actionId: Id<"actionLedger">,
): Promise<Pick<FanvueTrackingActionContext, "action" | "approval" | "snapshot">> {
  const action = await ctx.db.get(actionId);
  if (!action || action.actionKind !== FANVUE_TRACKING_LINK_DISPATCH_ACTION) {
    throw new Error("Fanvue tracking-link action was not found");
  }
  if (!action.approvalId || action.riskClass !== "moderate") {
    throw new Error("Fanvue tracking-link action lacks its individual approval record");
  }
  const approval = await ctx.db.get(action.approvalId);
  if (!approval || approval.actionKind !== FANVUE_TRACKING_LINK_APPROVAL_ACTION || approval.resourceType !== FANVUE_TRACKING_LINK_APPROVAL_RESOURCE) {
    throw new Error("Fanvue tracking-link approval record is invalid");
  }
  const snapshot = parseTrackingSnapshot(action.payloadSnapshot);
  if (
    action.organizationId.toString() !== snapshot.organizationId
    || approval.organizationId.toString() !== snapshot.organizationId
    || approval.resourceId !== snapshot.resourceId
    || approval.planVersion !== snapshot.planVersion
    || approval.snapshotHash !== action.payloadHash
  ) {
    throw new Error("Fanvue tracking-link action/approval integrity check failed");
  }
  return { action, approval, snapshot };
}

function fanvueTrackingReceipt(value: unknown): { provider: "fanvue"; trackingLinkId: string; linkUrl: string } | undefined {
  const receipt = isRecord(value) ? value : undefined;
  if (!receipt || receipt.provider !== "fanvue") return undefined;
  try {
    return {
      provider: "fanvue",
      trackingLinkId: normalizeTrackingLinkId(requiredString(receipt.trackingLinkId, "receipt tracking-link id", 80)),
      linkUrl: normalizeTrackingLinkUrl(requiredString(receipt.linkUrl, "receipt tracking-link URL", 2_000)),
    };
  } catch {
    return undefined;
  }
}

/** Creates a pending, immutable request. It makes no Fanvue request. */
export const requestFanvueTrackingLink = internalMutation({
  args: {
    destinationId: v.id("creatorDestinations"),
    funnelId: v.id("creatorFunnelCampaigns"),
    requestedBy: v.string(),
    name: v.string(),
    externalSocialPlatform: fanvueTrackingPlatform,
  },
  handler: async (ctx, args) => {
    const requestedBy = normalizeText(args.requestedBy, "requested by", 200);
    const name = normalizeText(args.name, "Fanvue tracking-link name", 120);
    const context = await requireCurrentTrackingContext(ctx, args);
    const idempotencyKey = trackingLinkActionKey(
      context.destination._id,
      context.funnel._id,
      context.funnel.version,
      name,
      args.externalSocialPlatform,
    );
    const existing = await ctx.db
      .query("actionLedger")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) {
      const linked = await requireTrackingAction(ctx, existing._id);
      if (linked.action.status === "failed" || linked.action.status === "cancelled" || linked.action.status === "blocked") {
        throw new Error("the prior Fanvue tracking-link action did not complete; reconcile it or revise the funnel before requesting another link");
      }
      return { actionId: linked.action._id, approvalId: linked.approval._id, reused: true, status: linked.action.status };
    }

    const snapshot = trackingSnapshot({ ...context, requestedBy, name, externalSocialPlatform: args.externalSocialPlatform });
    const payloadHash = snapshotHash(snapshot);
    const now = Date.now();
    const approvalId = await ctx.db.insert("approvalRequests", {
      organizationId: context.creator.organizationId,
      resourceType: FANVUE_TRACKING_LINK_APPROVAL_RESOURCE,
      resourceId: String(context.destination._id),
      planVersion: context.funnel.version,
      actionKind: FANVUE_TRACKING_LINK_APPROVAL_ACTION,
      snapshotHash: payloadHash,
      snapshot,
      riskClass: "moderate",
      status: "pending",
      requestedAt: now,
      requestedBy,
    });
    const actionId = await ctx.db.insert("actionLedger", {
      organizationId: context.creator.organizationId,
      connectionId: context.connection._id,
      approvalId,
      actionKind: FANVUE_TRACKING_LINK_DISPATCH_ACTION,
      riskClass: "moderate",
      status: "admitted",
      idempotencyKey,
      payloadHash,
      payloadSnapshot: snapshot,
      createdAt: now,
      updatedAt: now,
    });
    return { actionId, approvalId, reused: false, status: "admitted" as const };
  },
});

/** Records the individual decision; it does not dispatch the provider action. */
export const approveFanvueTrackingLink = internalMutation({
  args: { actionId: v.id("actionLedger"), decidedBy: v.string() },
  handler: async (ctx, args) => {
    const { action, approval, snapshot } = await requireTrackingAction(ctx, args.actionId);
    await requireCurrentTrackingContextForSnapshot(ctx, snapshot);
    if (approval.status === "approved") {
      if (!["admitted", "queued", "running", "succeeded"].includes(action.status)) {
        throw new Error("approved Fanvue tracking-link action is in an invalid state");
      }
      return { actionId: action._id, approvalId: approval._id, reused: true, status: action.status };
    }
    if (approval.status !== "pending" || action.status !== "admitted") {
      throw new Error("Fanvue tracking-link request is not pending individual approval");
    }
    const now = Date.now();
    await ctx.db.patch(approval._id, {
      status: "approved",
      decidedAt: now,
      decidedBy: normalizeText(args.decidedBy, "decided by", 200),
    });
    return { actionId: action._id, approvalId: approval._id, reused: false, status: "admitted" as const };
  },
});

/** Queues one individually approved request for an explicit Trigger handoff. */
export const queueFanvueTrackingLink = internalMutation({
  args: { actionId: v.id("actionLedger"), requestedBy: v.string() },
  handler: async (ctx, args) => {
    const { action, approval, snapshot } = await requireTrackingAction(ctx, args.actionId);
    await requireCurrentTrackingContextForSnapshot(ctx, snapshot);
    if (action.status === "queued" || action.status === "running" || action.status === "succeeded") {
      return { actionId: action._id, reused: true, status: action.status };
    }
    if (approval.status !== "approved" || action.status !== "admitted") {
      throw new Error("Fanvue tracking-link action must be individually approved before it can be queued");
    }
    normalizeText(args.requestedBy, "requested by", 200);
    await ctx.db.patch(action._id, { status: "queued", error: undefined, updatedAt: Date.now() });
    return { actionId: action._id, reused: false, status: "queued" as const };
  },
});

/** Trusted worker claim. A second run never performs an ambiguous duplicate call. */
export const claimFanvueTrackingLink = internalMutation({
  args: { actionId: v.id("actionLedger"), triggerRunId: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeText(args.triggerRunId, "Trigger run id", 240);
    const { action, approval, snapshot } = await requireTrackingAction(ctx, args.actionId);
    const context = await requireCurrentTrackingContextForSnapshot(ctx, snapshot);
    if (approval.status !== "approved" || !approval.decidedAt || !approval.decidedBy) {
      throw new Error("Fanvue tracking-link request is not individually approved");
    }
    const account = {
      accountId: String(context.connection._id),
      organizationId: String(context.creator.organizationId),
      creatorProfileId: String(context.creator._id),
      provider: "fanvue" as const,
      externalAccountId: normalizeUuid(context.connection.externalAccountId ?? "", "official Fanvue creator account id"),
      connectionStatus: "connected" as const,
      credentialHealth: "valid" as const,
      credentialStore: "server_vault" as const,
      grantedCapabilities: [FANVUE_TRACKING_LINK_CAPABILITY],
      approvalMode: "individual_action" as const,
      scopes: context.connection.scopes,
      linkedAt: new Date(context.connection.createdAt).toISOString(),
      lastVerifiedAt: new Date(context.connection.lastCheckedAt ?? context.connection.updatedAt).toISOString(),
    };
    if (action.status === "running") {
      if (action.triggerRunId !== triggerRunId) throw new Error("Fanvue tracking-link action is already claimed by another Trigger run");
      return {
        action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash, requestedAt: action.createdAt },
        snapshot,
        approval: { id: approval._id, approvedAt: approval.decidedAt, approvedBy: approval.decidedBy, snapshotHash: approval.snapshotHash },
        account,
        providerReceipt: action.providerReceipt,
        reused: true,
      };
    }
    if (action.status === "succeeded") {
      return {
        action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash, requestedAt: action.createdAt },
        snapshot,
        approval: { id: approval._id, approvedAt: approval.decidedAt, approvedBy: approval.decidedBy, snapshotHash: approval.snapshotHash },
        account,
        providerReceipt: action.providerReceipt,
        reused: true,
      };
    }
    if (action.status !== "queued") throw new Error("Fanvue tracking-link action is not eligible for worker claim");
    await ctx.db.patch(action._id, { status: "running", triggerRunId, error: undefined, updatedAt: Date.now() });
    return {
      action: { id: action._id, idempotencyKey: action.idempotencyKey, payloadHash: action.payloadHash, requestedAt: action.createdAt },
      snapshot,
      approval: { id: approval._id, approvedAt: approval.decidedAt, approvedBy: approval.decidedBy, snapshotHash: approval.snapshotHash },
      account,
      providerReceipt: action.providerReceipt,
      reused: false,
    };
  },
});

/** Persists only the bounded provider receipt after Fanvue confirms creation. */
export const completeFanvueTrackingLink = internalMutation({
  args: { actionId: v.id("actionLedger"), triggerRunId: v.string(), trackingLinkId: v.string(), linkUrl: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeText(args.triggerRunId, "Trigger run id", 240);
    const trackingLinkId = normalizeTrackingLinkId(args.trackingLinkId);
    const linkUrl = normalizeTrackingLinkUrl(args.linkUrl);
    const { action, snapshot } = await requireTrackingAction(ctx, args.actionId);
    await requireCurrentTrackingContextForSnapshot(ctx, snapshot);
    const receipt = fanvueTrackingReceipt(action.providerReceipt);
    if (action.status === "succeeded") {
      if (action.triggerRunId !== triggerRunId || !receipt || receipt.trackingLinkId !== trackingLinkId || receipt.linkUrl !== linkUrl) {
        throw new Error("Fanvue tracking-link completion belongs to a different worker state");
      }
      return { trackingLinkId, linkUrl, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this Fanvue tracking-link action may complete it");
    }
    await ctx.db.patch(action._id, {
      status: "succeeded",
      triggerRunId,
      error: undefined,
      providerReceipt: { provider: "fanvue", trackingLinkId, linkUrl },
      updatedAt: Date.now(),
    });
    return { trackingLinkId, linkUrl, reused: false };
  },
});

/** Terminal failure: intentionally no automatic retry because creation is not safely idempotent upstream. */
export const failFanvueTrackingLink = internalMutation({
  args: { actionId: v.id("actionLedger"), triggerRunId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const triggerRunId = normalizeText(args.triggerRunId, "Trigger run id", 240);
    const failure = normalizeText(args.error, "Fanvue tracking-link failure", 2_000);
    const { action } = await requireTrackingAction(ctx, args.actionId);
    if (action.status === "failed") {
      if (action.triggerRunId !== triggerRunId) throw new Error("Fanvue tracking-link failure belongs to a different worker state");
      return { recorded: true, reused: true };
    }
    if (action.status !== "running" || action.triggerRunId !== triggerRunId) {
      throw new Error("only the Trigger run that claimed this Fanvue tracking-link action may record its failure");
    }
    await ctx.db.patch(action._id, { status: "failed", triggerRunId, error: failure, updatedAt: Date.now() });
    return { recorded: true, reused: false };
  },
});

/** Safe, receipt-only projection for the operator UI. */
export const listFanvueTrackingLinks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const organization = await findDefaultOrganization(ctx as QueryCtx);
    if (!organization) return [];
    const actions = await ctx.db
      .query("actionLedger")
      .withIndex("by_organization_created", (q) => q.eq("organizationId", organization._id))
      .order("desc")
      .take(MAX_ROWS);
    const relevant = actions.filter((action) => action.actionKind === FANVUE_TRACKING_LINK_DISPATCH_ACTION);
    const approvalPairs = await Promise.all(relevant.map(async (action) => [action._id, action.approvalId ? await ctx.db.get(action.approvalId) : null] as const));
    const approvals = new Map(approvalPairs);
    return relevant.flatMap((action) => {
      try {
        const snapshot = parseTrackingSnapshot(action.payloadSnapshot);
        const approval = approvals.get(action._id);
        const receipt = fanvueTrackingReceipt(action.providerReceipt);
        return [{
          _id: action._id,
          destinationId: snapshot.destination.destinationId,
          funnelId: snapshot.funnel.funnelId,
          creatorId: snapshot.creatorId,
          connectionId: snapshot.destination.connectionId,
          name: snapshot.trackingLink.name,
          externalSocialPlatform: snapshot.trackingLink.externalSocialPlatform,
          status: action.status,
          approvalId: action.approvalId,
          approvalStatus: approval?.status ?? "missing",
          approvalDecidedAt: approval?.status === "approved" ? approval.decidedAt : undefined,
          providerReceipt: receipt,
          error: action.error?.slice(0, 500),
          createdAt: action.createdAt,
          updatedAt: action.updatedAt,
        }];
      } catch {
        // A corrupt historical payload must not become an apparently valid
        // provider resource in the operating UI.
        return [];
      }
    });
  },
});
