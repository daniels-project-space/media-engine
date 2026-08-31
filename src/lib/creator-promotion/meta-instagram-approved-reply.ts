import "server-only";

import { z } from "zod";

import type { ProviderEnvironment } from "./provider-health";

/**
 * Narrow official Instagram Messaging API adapter. It is deliberately limited
 * to one approved plain-text reply to the Instagram-scoped recipient captured
 * by a signed customer message webhook. No media, buttons, templates, Human
 * Agent extension, scheduling, or browser/provider automation exists here.
 */
const META_INSTAGRAM_API_ORIGIN = "https://graph.instagram.com";
const SafeIdentifierSchema = z.string().trim().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const MetaInstagramApprovedReplyDispatchSchema = z
  .object({
    actionId: SafeIdentifierSchema,
    idempotencyKey: z.string().trim().min(16).max(240),
    payloadHash: z.string().trim().min(1).max(240),
    connectionId: SafeIdentifierSchema,
    threadId: SafeIdentifierSchema,
    igUserId: SafeIdentifierSchema,
    recipientId: SafeIdentifierSchema,
    replyEligibilityEndsAt: z.number().int().positive(),
    text: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type MetaInstagramApprovedReplyDispatch = z.infer<typeof MetaInstagramApprovedReplyDispatchSchema>;

export const MetaInstagramReplyProviderReceiptSchema = z
  .object({ provider: z.literal("meta_instagram"), messageId: SafeIdentifierSchema })
  .strict();
export type MetaInstagramReplyProviderReceipt = z.infer<typeof MetaInstagramReplyProviderReceiptSchema>;

type FetchImplementation = typeof fetch;

function graphVersion(env: ProviderEnvironment): string {
  const version = env.META_GRAPH_API_VERSION?.trim();
  if (!version || !/^v\d+\.\d+$/.test(version)) {
    throw new Error("Meta Instagram Graph API version is not configured");
  }
  return version;
}

function graphUrl(version: string, path: string): string {
  return `${META_INSTAGRAM_API_ORIGIN}/${version}/${path}`;
}

function assertOpenResponseWindow(action: MetaInstagramApprovedReplyDispatch): void {
  if (Date.now() >= action.replyEligibilityEndsAt) {
    throw new Error("Meta Instagram customer response window expired before the reply could be sent");
  }
}

/**
 * Performs exactly one official plaintext reply. A thrown error is intentionally
 * terminal at the caller: the worker marks the action failed for manual
 * reconciliation and never retries a possibly delivered request.
 */
export async function sendMetaInstagramApprovedReply(args: {
  action: MetaInstagramApprovedReplyDispatch;
  accessToken: string;
  env?: ProviderEnvironment;
  request?: FetchImplementation;
}): Promise<{ messageId: string }> {
  const action = MetaInstagramApprovedReplyDispatchSchema.parse(args.action);
  assertOpenResponseWindow(action);
  const response = await (args.request ?? fetch)(
    graphUrl(graphVersion(args.env ?? process.env), `${encodeURIComponent(action.igUserId)}/messages`),
    {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: action.recipientId },
        message: { text: action.text },
      }),
    },
  );
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error(`Meta Instagram reply API returned HTTP ${response.status}`);
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  const rawMessageId = record?.message_id ?? record?.id;
  const parsedMessageId = SafeIdentifierSchema.safeParse(rawMessageId);
  if (!parsedMessageId.success) throw new Error("Meta Instagram reply API returned an invalid message identifier");
  return { messageId: parsedMessageId.data };
}
