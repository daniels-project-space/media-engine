import { createHash } from "node:crypto";
import { z } from "zod";

import {
  FanvueTrackingLinkActionSchema,
  ProviderAccountCapabilityGrantSchema,
  verifyApprovedCreatorPromotionAction,
} from "./contracts";
import {
  buildFanvueApprovedRequestForDispatcher,
  FANVUE_API_ORIGIN,
  type FanvueApiVersion,
  type FanvueApprovedRequest,
  type ServerProvidedFanvueAccessToken,
} from "./fanvue-approved-request";
import type { ProviderConfigHealth } from "./provider-health";

/** An approval is intentionally short-lived once an exact provider action is queued. */
export const FANVUE_TRACKING_LINK_APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const UuidSchema = z.string().uuid();

export const FanvueTrackingLinkProviderReceiptSchema = z.object({
  trackingLinkId: UuidSchema,
  linkUrl: z.string().url().max(2_000),
}).strict();
export type FanvueTrackingLinkProviderReceipt = z.infer<typeof FanvueTrackingLinkProviderReceiptSchema>;

export const FanvueTrackingLinkClaimSchema = z.object({
  action: z.object({
    id: IdentifierSchema,
    idempotencyKey: z.string().trim().min(16).max(240),
    payloadHash: z.string().trim().min(1).max(240),
    requestedAt: z.number().int().positive(),
  }).strict(),
  snapshot: z.object({
    resourceType: z.literal("creator_fanvue_tracking_link"),
    resourceId: IdentifierSchema,
    planVersion: z.number().int().positive(),
    provider: z.literal("fanvue"),
    execution: z.literal("fanvue_tracking_link"),
    organizationId: IdentifierSchema,
    creatorId: IdentifierSchema,
    requestedBy: z.string().trim().min(1).max(200),
    destination: z.object({
      destinationId: IdentifierSchema,
      connectionId: IdentifierSchema,
      label: z.string().trim().min(1).max(200),
      kind: z.literal("fanvue"),
      manualKycStatus: z.literal("verified"),
    }).strict(),
    funnel: z.object({
      funnelId: IdentifierSchema,
      version: z.number().int().positive(),
      campaignLabel: z.string().trim().min(1).max(200),
      objective: z.string().trim().min(1).max(80),
    }).strict(),
    trackingLink: z.object({
      creatorUserUuid: UuidSchema,
      name: z.string().trim().min(1).max(120),
      externalSocialPlatform: z.enum([
        "facebook",
        "instagram",
        "other",
        "reddit",
        "snapchat",
        "tiktok",
        "twitter",
        "youtube",
      ]),
    }).strict(),
  }).strict(),
  approval: z.object({
    id: IdentifierSchema,
    approvedAt: z.number().int().positive(),
    approvedBy: z.string().trim().min(1).max(200),
    snapshotHash: z.string().trim().min(1).max(240),
  }).strict(),
  account: ProviderAccountCapabilityGrantSchema,
  providerReceipt: z.unknown().optional(),
  reused: z.boolean(),
}).strict();
export type FanvueTrackingLinkClaim = z.infer<typeof FanvueTrackingLinkClaimSchema>;

export type FetchImplementation = typeof fetch;

/**
 * Produces a verified action from a worker claim. No mutable destination,
 * funnel, connection, credential, or browser value is consulted here.
 */
export function buildApprovedFanvueTrackingLinkRequest(args: {
  claim: FanvueTrackingLinkClaim;
  accessToken: ServerProvidedFanvueAccessToken;
  apiVersion: FanvueApiVersion;
  providerHealth: ProviderConfigHealth;
  now?: Date;
}): FanvueApprovedRequest {
  const now = args.now ?? new Date();
  const approvedAt = new Date(args.claim.approval.approvedAt);
  if (Number.isNaN(approvedAt.getTime())) throw new Error("Fanvue tracking-link approval time is invalid");
  const expiresAt = new Date(approvedAt.getTime() + FANVUE_TRACKING_LINK_APPROVAL_TTL_MS);
  const payload = {
    creatorUserUuid: args.claim.snapshot.trackingLink.creatorUserUuid,
    name: args.claim.snapshot.trackingLink.name,
    externalSocialPlatform: args.claim.snapshot.trackingLink.externalSocialPlatform,
  };
  const contentDigest = actionPayloadDigest({
    type: "fanvue.create_tracking_link",
    accountId: args.claim.account.accountId,
    payload,
  });
  const action = FanvueTrackingLinkActionSchema.parse({
    actionId: args.claim.action.id,
    idempotencyKey: args.claim.action.idempotencyKey,
    organizationId: args.claim.snapshot.organizationId,
    creatorProfileId: args.claim.snapshot.creatorId,
    accountId: args.claim.account.accountId,
    requestedBy: args.claim.snapshot.requestedBy,
    requestedAt: new Date(args.claim.action.requestedAt).toISOString(),
    requestedFrom: "operator",
    executionMode: "approval_required",
    requiresIndividualApproval: true,
    correlationId: args.claim.snapshot.funnel.funnelId,
    contentDigest,
    approval: {
      approvalId: args.claim.approval.id,
      status: "approved",
      approvedBy: args.claim.approval.approvedBy,
      approvedAt: approvedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      contentDigest,
      policyVersion: "creator-fanvue-tracking-link/v1",
    },
    provider: "fanvue",
    type: "fanvue.create_tracking_link",
    payload,
  });
  const verified = verifyApprovedCreatorPromotionAction(action, now);
  if (!verified.ok) throw new Error(`Fanvue tracking-link approval is invalid: ${verified.errors.join("; ")}`);
  return buildFanvueApprovedRequestForDispatcher({
    approvedAction: verified.action,
    account: args.claim.account,
    accessToken: args.accessToken,
    apiVersion: args.apiVersion,
    providerHealth: args.providerHealth,
  }, now);
}

/** Performs exactly one documented tracking-link request and returns a bounded receipt. */
export async function createFanvueTrackingLink(args: {
  request: FanvueApprovedRequest;
  fetchImplementation?: FetchImplementation;
}): Promise<FanvueTrackingLinkProviderReceipt> {
  assertOfficialTrackingLinkRequest(args.request);
  const response = await (args.fetchImplementation ?? fetch)(args.request.url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    headers: args.request.headers,
    body: JSON.stringify(args.request.body),
  });
  const text = await response.text();
  if (response.status !== 201) {
    // Do not surface provider response bodies through operator routes/logs;
    // they can contain data that is unrelated to the approved action.
    throw new Error(`Fanvue tracking-link creation returned HTTP ${response.status}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Fanvue tracking-link creation returned an invalid response");
  }
  const receipt = FanvueTrackingLinkProviderReceiptSchema.safeParse({
    trackingLinkId: isRecord(parsed) ? parsed.uuid : undefined,
    linkUrl: isRecord(parsed) ? parsed.linkUrl : undefined,
  });
  if (!receipt.success) throw new Error("Fanvue tracking-link creation response lacks a valid link receipt");
  const linkUrl = new URL(receipt.data.linkUrl);
  if (linkUrl.protocol !== "https:" || linkUrl.username || linkUrl.password) {
    throw new Error("Fanvue tracking-link receipt is not a public HTTPS URL");
  }
  return receipt.data;
}

function assertOfficialTrackingLinkRequest(request: FanvueApprovedRequest): void {
  const url = new URL(request.url);
  if (
    url.origin !== FANVUE_API_ORIGIN
    || !/^\/creators\/[0-9a-f-]{36}\/tracking-links$/i.test(url.pathname)
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    throw new Error("Fanvue dispatcher refused a non-official tracking-link request");
  }
}

function actionPayloadDigest(value: unknown): string {
  return createHash("sha256").update(stableSerialize(value)).digest("hex");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
