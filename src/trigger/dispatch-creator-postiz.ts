import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

import { api } from "../../convex/_generated/api";
import { creativeServiceToken } from "../lib/creative-service";
import {
  PostizApprovedScheduleSchema,
  PostizBoundAccountPlatformSchema,
  PostizScheduleProviderReceiptSchema,
  assertPostizIntegrationReady,
  buildPostizScheduleRequest,
  createPostizSchedule,
  postizProviderForBoundAccount,
  resolvePostizCredentials,
  uploadPostizMediaFromUrl,
  validatePostizScheduleDescriptor,
} from "../lib/creator-promotion";
import { objectExists, presignedGet } from "../lib/storage";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
// Postiz fetches and stores the source synchronously before this worker can
// receive its response. Seven days is the S3/R2 SigV4 maximum and gives the
// provider enough headroom without ever persisting the signed URL.
const POSTIZ_MEDIA_SOURCE_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

type Payload = { contentId: string };

const SafeIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const ClaimSchema = z.object({
  action: z.object({
    id: SafeIdentifierSchema,
    idempotencyKey: z.string().trim().min(16).max(240),
    payloadHash: z.string().trim().min(1).max(240),
  }).strict(),
  snapshot: z.object({
    resourceType: z.string().trim().min(1).max(120),
    resourceId: SafeIdentifierSchema,
    planVersion: z.number().int().positive(),
    provider: z.literal("postiz"),
    execution: z.literal("postiz_scheduled"),
    organizationId: SafeIdentifierSchema,
    creatorId: SafeIdentifierSchema,
    content: z.object({
      contentId: SafeIdentifierSchema,
      contentReviewVersion: z.number().int().positive(),
      contentReviewHash: z.string().trim().min(1).max(240),
      scheduledAt: z.number().int().positive(),
      title: z.string().trim().min(1).max(200),
      format: z.enum(["image", "carousel", "reel", "story", "short", "text"]),
      caption: z.string().trim().min(1).max(5_000),
      cta: z.string().trim().max(1_000).optional(),
    }).passthrough(),
    account: z.object({
      accountId: SafeIdentifierSchema,
      connectionId: SafeIdentifierSchema,
      integrationId: SafeIdentifierSchema,
      platform: PostizBoundAccountPlatformSchema,
      requiredCapability: z.literal("schedule_content"),
    }).passthrough(),
    media: z.object({
      candidateId: SafeIdentifierSchema,
      assetKey: z.string().trim().min(1).max(1_024),
      mediaType: z.enum(["image", "video"]),
    }).passthrough(),
  }).passthrough(),
  /** Frozen reviewed policy descriptor; it is never read from mutable account state. */
  postizSettings: z.unknown(),
  providerReceipt: z.unknown().optional(),
  reused: z.boolean(),
}).strict();

function safeContentId(value: unknown): string {
  return SafeIdentifierSchema.parse(value);
}

function safeCreatorRenderAssetKey(value: string): string {
  if (
    !value.startsWith("creator-renders/") ||
    value.length > 1_024 ||
    value.includes("..") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("approved Postiz media is not in controlled creator render storage");
  }
  return value;
}

function assertLivePostizScheduleGate(): void {
  if (process.env.CREATOR_POSTIZ_SCHEDULE_ENABLED !== "true") {
    throw new Error("CREATOR_POSTIZ_SCHEDULE_ENABLED is not true; Postiz scheduling remains fail-closed");
  }
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Postiz scheduling cannot run outside a production worker");
  }
}

function parseClaim(value: unknown) {
  const parsed = ClaimSchema.parse(value);
  const provider = postizProviderForBoundAccount({
    platform: parsed.snapshot.account.platform,
    settings: parsed.postizSettings,
  });
  const dispatch = PostizApprovedScheduleSchema.parse({
    actionId: parsed.action.id,
    idempotencyKey: parsed.action.idempotencyKey,
    payloadHash: parsed.action.payloadHash,
    connectionId: parsed.snapshot.account.connectionId,
    contentId: parsed.snapshot.content.contentId,
    contentReviewVersion: parsed.snapshot.content.contentReviewVersion,
    integrationId: parsed.snapshot.account.integrationId,
    provider,
    scheduledAt: parsed.snapshot.content.scheduledAt,
    title: parsed.snapshot.content.title,
    format: parsed.snapshot.content.format,
    caption: parsed.snapshot.content.caption,
    media: parsed.snapshot.media,
  });
  const receipt = parsed.providerReceipt === undefined
    ? undefined
    : PostizScheduleProviderReceiptSchema.parse(parsed.providerReceipt);
  return { dispatch, settings: parsed.postizSettings, receipt, reused: parsed.reused };
}

async function approvedMediaSourceUrl(assetKey: string): Promise<string> {
  const key = safeCreatorRenderAssetKey(assetKey);
  if (!(await objectExists(key))) throw new Error("approved Postiz render asset is no longer available");
  // This controlled, long-lived source URL is sent solely to Postiz's official
  // upload-from-url endpoint. The returned Postiz asset is used for scheduling;
  // the source URL is never logged, returned, or persisted.
  return await presignedGet(key, POSTIZ_MEDIA_SOURCE_URL_TTL_SECONDS);
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Postiz scheduling failed";
  return message.replace(/https?:\/\/\S+/gi, "[redacted-url]").slice(0, 2_000);
}

/**
 * One explicit, individually approved future schedule through Postiz.
 *
 * Trigger retries are disabled. If a network timeout leaves the provider
 * outcome uncertain, this task marks the action failed for manual Postiz
 * reconciliation instead of risking a duplicate schedule.
 */
export const dispatchCreatorPostizSchedule = task({
  id: "dispatch-creator-postiz-schedule",
  maxDuration: 300,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const contentId = safeContentId(payload.contentId);
    assertLivePostizScheduleGate();
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    let dispatch: z.infer<typeof PostizApprovedScheduleSchema> | undefined;

    try {
      const claim = parseClaim(await convex.action(api.creatorPromotionsGateway.claimPostizSchedule, {
        serviceToken,
        payload: { contentId, triggerRunId: ctx.run.id },
      }));
      dispatch = claim.dispatch;
      if (dispatch.contentId !== contentId) {
        throw new Error("claimed Postiz schedule action does not match its content");
      }
      // Re-running the same Trigger run after an interruption is ambiguous:
      // Postiz may already have created a schedule without a persisted receipt.
      if (claim.reused) {
        if (
          claim.receipt
          && claim.receipt.integrationId === dispatch.integrationId
          && claim.receipt.scheduledAt === dispatch.scheduledAt
        ) {
          logger.log("creator Postiz schedule was already completed", {
            contentId,
            actionId: dispatch.actionId,
            postId: claim.receipt.postId,
            integrationId: claim.receipt.integrationId,
            scheduledAt: claim.receipt.scheduledAt,
          });
          return {
            contentId,
            actionId: dispatch.actionId,
            postId: claim.receipt.postId,
            integrationId: claim.receipt.integrationId,
            scheduledAt: claim.receipt.scheduledAt,
            reused: true,
          };
        }
        throw new Error("Postiz schedule action was already claimed; manual reconciliation is required");
      }

      // Validate the immutable descriptor before media import so an unsupported
      // format cannot create an orphaned Postiz upload.
      validatePostizScheduleDescriptor({ action: dispatch, settings: claim.settings });
      const credentials = await resolvePostizCredentials();
      await assertPostizIntegrationReady({
        credentials,
        integrationId: dispatch.integrationId,
        provider: dispatch.provider,
      });
      const media = await uploadPostizMediaFromUrl({
        credentials,
        sourceUrl: await approvedMediaSourceUrl(dispatch.media.assetKey),
      });
      const request = buildPostizScheduleRequest({ action: dispatch, media, settings: claim.settings });
      const scheduled = await createPostizSchedule({
        credentials,
        request,
        expectedIntegrationId: dispatch.integrationId,
      });
      await convex.action(api.creatorPromotionsGateway.completePostizSchedule, {
        serviceToken,
        payload: {
          contentId,
          triggerRunId: ctx.run.id,
          postId: scheduled.postId,
          integrationId: scheduled.integrationId,
          scheduledAt: dispatch.scheduledAt,
        },
      });
      logger.log("creator Postiz schedule completed", {
        contentId,
        actionId: dispatch.actionId,
        postId: scheduled.postId,
        integrationId: scheduled.integrationId,
        scheduledAt: dispatch.scheduledAt,
      });
      return {
        contentId,
        actionId: dispatch.actionId,
        postId: scheduled.postId,
        integrationId: scheduled.integrationId,
        scheduledAt: dispatch.scheduledAt,
      };
    } catch (error) {
      const message = safeFailure(error);
      if (dispatch) {
        await convex.action(api.creatorPromotionsGateway.failPostizSchedule, {
          serviceToken,
          payload: { contentId, triggerRunId: ctx.run.id, error: message },
        }).catch((recordError) => logger.error("could not record Postiz scheduling failure", {
          contentId,
          actionId: dispatch?.actionId,
          error: safeFailure(recordError),
        }));
      }
      throw new AbortTaskRunError(message);
    }
  },
});
