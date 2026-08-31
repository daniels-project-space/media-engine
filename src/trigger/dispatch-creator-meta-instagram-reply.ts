import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { z } from "zod";

import { api } from "../../convex/_generated/api";
import { creativeServiceToken } from "../lib/creative-service";
import {
  MetaInstagramApprovedReplyDispatchSchema,
  resolveMetaInstagramAccessToken,
  sendMetaInstagramApprovedReply,
} from "../lib/creator-promotion";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

type Payload = { threadId: string };

const ClaimSchema = z.object({
  action: z.object({
    id: z.string().min(1),
    idempotencyKey: z.string().min(16),
    payloadHash: z.string().min(1),
  }).strict(),
  snapshot: z.object({
    provider: z.literal("meta_instagram"),
    type: z.literal("instagram.reply"),
    thread: z.object({
      threadId: z.string().min(1),
      replyEligibilityEndsAt: z.number().int().positive(),
    }).passthrough(),
    account: z.object({
      connectionId: z.string().min(1),
      igUserId: z.string().min(1),
      requiredCapability: z.literal("reply_to_inbound_message"),
      requiredScope: z.literal("instagram_business_manage_messages"),
    }).passthrough(),
    recipient: z.object({ instagramScopedId: z.string().min(1) }).strict(),
    reply: z.object({
      approvedDraftMessageId: z.string().min(1),
      text: z.string().min(1).max(1_000),
    }).strict(),
  }).passthrough(),
  reused: z.boolean(),
}).strict();

function safeThreadId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/.test(value)) {
    throw new Error("creator promotion inbox thread identity is invalid");
  }
  return value;
}

function assertLiveMetaInstagramReplyDispatchGate(): void {
  if (process.env.CREATOR_META_INSTAGRAM_REPLY_ENABLED !== "true") {
    throw new Error("CREATOR_META_INSTAGRAM_REPLY_ENABLED is not true; Meta Instagram replies remain fail-closed");
  }
  if (process.env.NODE_ENV !== "production") {
    throw new Error("Meta Instagram replies cannot run outside a production worker");
  }
}

function parseClaim(value: unknown) {
  const parsed = ClaimSchema.parse(value);
  const dispatch = MetaInstagramApprovedReplyDispatchSchema.parse({
    actionId: parsed.action.id,
    idempotencyKey: parsed.action.idempotencyKey,
    payloadHash: parsed.action.payloadHash,
    connectionId: parsed.snapshot.account.connectionId,
    threadId: parsed.snapshot.thread.threadId,
    igUserId: parsed.snapshot.account.igUserId,
    recipientId: parsed.snapshot.recipient.instagramScopedId,
    replyEligibilityEndsAt: parsed.snapshot.thread.replyEligibilityEndsAt,
    text: parsed.snapshot.reply.text,
  });
  return { dispatch, reused: parsed.reused };
}

function safeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Meta Instagram reply failed";
  return message.replace(/https?:\/\/\S+/gi, "[redacted-url]").slice(0, 2_000);
}

/**
 * One explicit approved response to a customer-initiated signed inbound
 * Instagram text. Trigger retries are disabled: every possible provider
 * outcome uncertainty becomes a human-reconciliation handoff instead.
 */
export const dispatchCreatorMetaInstagramReply = task({
  id: "dispatch-creator-meta-instagram-reply",
  maxDuration: 120,
  machine: "small-1x",
  retry: { maxAttempts: 1 },
  run: async (payload: Payload, { ctx }) => {
    const threadId = safeThreadId(payload.threadId);
    assertLiveMetaInstagramReplyDispatchGate();
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    let dispatch: z.infer<typeof MetaInstagramApprovedReplyDispatchSchema> | undefined;

    try {
      const claim = parseClaim(await convex.action(api.creatorPromotionsGateway.claimMetaInstagramReply, {
        serviceToken,
        payload: { threadId, triggerRunId: ctx.run.id },
      }));
      dispatch = claim.dispatch;
      if (dispatch.threadId !== threadId) throw new Error("claimed Meta Instagram reply action does not match its inbox thread");
      const accessToken = await resolveMetaInstagramAccessToken(dispatch.connectionId);
      await convex.action(api.creatorPromotionsGateway.confirmMetaInstagramReplySend, {
        serviceToken,
        payload: { threadId, triggerRunId: ctx.run.id },
      });
      const sent = await sendMetaInstagramApprovedReply({ action: dispatch, accessToken });
      await convex.action(api.creatorPromotionsGateway.completeMetaInstagramReply, {
        serviceToken,
        payload: { threadId, triggerRunId: ctx.run.id, messageId: sent.messageId },
      });
      logger.log("creator Meta Instagram reply completed", {
        threadId,
        actionId: dispatch.actionId,
        messageId: sent.messageId,
      });
      return { threadId, actionId: dispatch.actionId, messageId: sent.messageId };
    } catch (error) {
      const message = safeFailure(error);
      if (dispatch) {
        await convex.action(api.creatorPromotionsGateway.failMetaInstagramReply, {
          serviceToken,
          payload: { threadId, triggerRunId: ctx.run.id, error: message },
        }).catch((recordError) => logger.error("could not record Meta Instagram reply failure", {
          threadId,
          actionId: dispatch?.actionId,
          error: safeFailure(recordError),
        }));
      }
      throw new AbortTaskRunError(message);
    }
  },
});
