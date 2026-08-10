import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Shared validators and invariant helpers for the governed control plane.
 *
 * This module deliberately contains no token, secret, OAuth refresh material,
 * or provider credential fields. Credential lookup stays in the server-side
 * vault boundary; Convex stores only the connection metadata required to
 * govern and observe an integration.
 */
export const DEFAULT_MEDIA_ENGINE_ORGANIZATION = {
  slug: "media-engine",
  name: "Media Engine",
  kind: "agency" as const,
  status: "active" as const,
};

export const organizationKind = v.union(
  v.literal("agency"),
  v.literal("portfolio"),
  v.literal("client"),
  v.literal("partner"),
);

export const organizationStatus = v.union(
  v.literal("active"),
  v.literal("inactive"),
  v.literal("archived"),
);

export const integrationConnectionStatus = v.union(
  v.literal("disconnected"),
  v.literal("pending"),
  v.literal("connected"),
  v.literal("degraded"),
  v.literal("revoked"),
);

export const integrationHealth = v.union(
  v.literal("unknown"),
  v.literal("healthy"),
  v.literal("degraded"),
  v.literal("unhealthy"),
);

export const eventReceiptStatus = v.union(
  v.literal("received"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("processed"),
);

export const formSevenEventType = v.union(
  v.literal("form_seven.free_video_brief.created"),
  v.literal("form_seven.service_inquiry.created"),
);

export const formSevenIntakeStatus = v.union(
  v.literal("received"),
  v.literal("qualifying"),
  v.literal("qualified"),
  v.literal("rejected"),
  v.literal("converted"),
  v.literal("archived"),
);

export const intakeArtifactKind = v.union(
  v.literal("image"),
  v.literal("video"),
  v.literal("document"),
  v.literal("pdf"),
  v.literal("website"),
  v.literal("other"),
);

export const intakeArtifactStatus = v.union(
  v.literal("declared"),
  v.literal("pending_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("revoked"),
);

export const approvalRiskClass = v.union(
  v.literal("low"),
  v.literal("moderate"),
  v.literal("high"),
  v.literal("financial"),
);

export const approvalRequestStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("expired"),
  v.literal("cancelled"),
);

export const actionLedgerStatus = v.union(
  v.literal("admitted"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("blocked"),
);

export const budgetEnvelopeStatus = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("closed"),
);

export function assertNonBlank(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
}

export function assertDigest(value: string, label: string): void {
  // Ingress body hashes are SHA-256 hex. Immutable internal plan/action
  // snapshots use a compact, deterministic `stable-v1` fingerprint. Both are
  // bounded hashes rather than opaque user-controlled blobs.
  const isSha256 = /^[a-fA-F0-9]{64}$/.test(value);
  const isStableSnapshot = /^stable-v1:[a-fA-F0-9]{16,64}:\d{1,12}$/.test(value);
  if (!isSha256 && !isStableSnapshot) throw new Error(`${label} must be a bounded content fingerprint`);
}

export function assertSafeClientArtifactKey(value: string): void {
  if (!value.startsWith("products/client/")) {
    throw new Error("approved intake artifacts must use a private client object key");
  }
}

export function assertNonNegativeMoney(value: number | undefined, label: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label} must be a non-negative integer in minor currency units`);
  }
}

export function isTerminalActionStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

export async function findDefaultOrganization(ctx: Pick<QueryCtx, "db">) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_slug", (q) => q.eq("slug", DEFAULT_MEDIA_ENGINE_ORGANIZATION.slug))
    .unique();
}

/** Idempotently creates the single first-party organization used by the hub. */
export async function ensureDefaultOrganization(ctx: MutationCtx) {
  const existing = await findDefaultOrganization(ctx);
  if (existing) return existing;

  const now = Date.now();
  const organizationId = await ctx.db.insert("organizations", {
    ...DEFAULT_MEDIA_ENGINE_ORGANIZATION,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(organizationId);
}
