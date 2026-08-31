import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

import { api } from "../../convex/_generated/api";
import { creativeServiceToken } from "../lib/creative-service";
import {
  MetaInstagramApprovedDispatchSchema,
  MetaInstagramProviderReceiptSchema,
  createMetaInstagramMediaContainer,
  publishMetaInstagramMediaContainer,
  resolveMetaInstagramAccessToken,
  waitForMetaInstagramMediaContainer,
} from "../lib/creator-promotion";
import { objectExists, presignedGet } from "../lib/storage";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const MEDIA_URL_TTL_SECONDS = 45 * 60;

type Payload = { contentId: string };

const ClaimSchema = z.object({
  action: z.object({
    id: z.string().min(1),
    idempotencyKey: z.string().min(16),
    payloadHash: z.string().min(1),
  }).strict(),
  snapshot: z.object({
    provider: z.literal("meta_instagram"),
    type: z.literal("instagram.publish"),
    content: z.object({
      contentId: z.string().min(1),
      contentReviewVersion: z.number().int().positive(),
      caption: z.string().min(1).max(2_200),
      format: z.enum(["feed", "reel"]),
    }).passthrough(),
    account: z.object({
      connectionId: z.string().min(1),
      igUserId: z.string().min(1),
    }).passthrough(),
    media: z.object({
      assetKey: z.string().min(1).max(1_024),
      mediaType: z.enum(["image", "video"]),
    }).passthrough(),
  }).passthrough(),
  providerReceipt: z.unknown().optional(),
  reused: z.boolean(),
}).strict();

function safeContentId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)) {
    throw new Error("creator promotion content identity is invalid");
  }
  return value;
}

function safeCreatorRenderAssetKey(value: string): string {
  if (
    !value.startsWith("creator-renders/") ||
    value.length > 1_024 ||
    value.includes("..") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error("approved Meta Instagram media is not in controlled creator render storage");
  }
  return value;
}

function assertLiveMetaInstagramDispatchGate(): void {
  if (process.env.CREATOR_META_INSTAGRAM_PUBLISH_ENABLED !== "true") {
    throw new Error("CREATOR_META_INSTAGRAM_PUBLISH_ENABLED is not true; Meta Instagram publishing remains fail-closed");
  }
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Meta Instagram publishing cannot run outside a production worker");
  }
}

function parseClaim(value: unknown) {
  const parsed = ClaimSchema.parse(value);
  const dispatch = MetaInstagramApprovedDispatchSchema.parse({
    actionId: parsed.action.id,
    idempotencyKey: parsed.action.idempotencyKey,
    payloadHash: parsed.action.payloadHash,
    connectionId: parsed.snapshot.account.connectionId,
    contentId: parsed.snapshot.content.contentId,
    contentReviewVersion: parsed.snapshot.content.contentReviewVersion,
    igUserId: parsed.snapshot.account.igUserId,
    format: parsed.snapshot.content.format,
    caption: parsed.snapshot.content.caption,
    media: parsed.snapshot.media,
  });
  const receipt = parsed.providerReceipt === undefined
    ? undefined
    : MetaInstagramProviderReceiptSchema.parse(parsed.providerReceipt);
  return { dispatch, receipt, reused: parsed.reused };
}

async function approvedMediaUrl(assetKey: string): Promise<string> {
  const key = safeCreatorRenderAssetKey(assetKey);
  if (!(await objectExists(key))) throw new Error("approved Meta Instagram render asset is no longer available");
  // The short-lived signed R2 URL exists only in worker memory and the provider
  // form request. It is never placed in Convex, a browser response, or a log.
  return await presignedGet(key, MEDIA_URL_TTL_SECONDS);
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Meta Instagram publish failed";
  // The adapter intentionally strips provider response bodies; this final bound
  // stops an unexpected library message becoming a credential/URL sink.
  return message.replace(/https?:\/\/\S+/gi, "[redacted-url]").slice(0, 2_000);
}

/**
 * One explicit operator-dispatched publish of a selected Creator Promotion
 * render. It has no schedule trigger and no retry: uncertain external outcomes
 * remain failed for an operator to verify in Meta before any new request.
 */
export const dispatchCreatorMetaInstagram = task({
  id: "dispatch-creator-meta-instagram",
  maxDuration: 300,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const contentId = safeContentId(payload.contentId);
    assertLiveMetaInstagramDispatchGate();
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    let dispatch: z.infer<typeof MetaInstagramApprovedDispatchSchema> | undefined;
    let containerId: string | undefined;

    try {
      const claim = parseClaim(await convex.action(api.creatorPromotionsGateway.claimMetaInstagramPublish, {
        serviceToken,
        payload: { contentId, triggerRunId: ctx.run.id },
      }));
      dispatch = claim.dispatch;
      if (dispatch.contentId !== contentId) throw new Error("claimed Meta Instagram publish action does not match its content");
      containerId = claim.receipt?.containerId;
      const accessToken = await resolveMetaInstagramAccessToken(dispatch.connectionId);

      if (!containerId) {
        const created = await createMetaInstagramMediaContainer({
          action: dispatch,
          mediaUrl: await approvedMediaUrl(dispatch.media.assetKey),
          accessToken,
        });
        containerId = created.containerId;
        await convex.action(api.creatorPromotionsGateway.recordMetaInstagramPublishContainer, {
          serviceToken,
          payload: { contentId, triggerRunId: ctx.run.id, containerId },
        });
      }

      await waitForMetaInstagramMediaContainer({ containerId, accessToken });
      const published = await publishMetaInstagramMediaContainer({ action: dispatch, containerId, accessToken });
      await convex.action(api.creatorPromotionsGateway.completeMetaInstagramPublish, {
        serviceToken,
        payload: { contentId, triggerRunId: ctx.run.id, containerId, mediaId: published.mediaId },
      });
      logger.log("creator Meta Instagram publication completed", {
        contentId,
        actionId: dispatch.actionId,
        containerId,
        mediaId: published.mediaId,
      });
      return { contentId, actionId: dispatch.actionId, mediaId: published.mediaId };
    } catch (error) {
      const message = safeFailure(error);
      if (dispatch) {
        await convex.action(api.creatorPromotionsGateway.failMetaInstagramPublish, {
          serviceToken,
          payload: { contentId, triggerRunId: ctx.run.id, error: message, ...(containerId ? { containerId } : {}) },
        }).catch((recordError) => logger.error("could not record Meta Instagram publication failure", {
          contentId,
          actionId: dispatch?.actionId,
          error: safeFailure(recordError),
        }));
      }
      throw new AbortTaskRunError(message);
    }
  },
});
