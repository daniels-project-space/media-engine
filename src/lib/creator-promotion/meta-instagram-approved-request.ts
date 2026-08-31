import { z } from "zod";

import { vaultService } from "../vault";
import {
  checkMetaInstagramApprovedDispatchHealth,
  META_INSTAGRAM_VAULT_TOKEN_RESOLVER,
  type ProviderEnvironment,
} from "./provider-health";

/**
 * Official Instagram API with Instagram Login only. This module has no browser
 * automation, device management, password handling, or account creation path.
 * It is imported only by the trusted Trigger worker after a separately approved
 * Creator Promotion action has been claimed from the durable ledger.
 */
const META_INSTAGRAM_API_ORIGIN = "https://graph.instagram.com";
const MAX_CONTAINER_POLLS = 30;
const CONTAINER_POLL_MS = 4_000;

const SafeIdentifierSchema = z.string().trim().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const MetaFormatSchema = z.enum(["feed", "reel"]);
const MediaTypeSchema = z.enum(["image", "video"]);

export const MetaInstagramApprovedDispatchSchema = z
  .object({
    actionId: SafeIdentifierSchema,
    idempotencyKey: z.string().trim().min(16).max(240),
    payloadHash: z.string().trim().min(1).max(240),
    connectionId: SafeIdentifierSchema,
    contentId: SafeIdentifierSchema,
    contentReviewVersion: z.number().int().positive(),
    igUserId: SafeIdentifierSchema,
    format: MetaFormatSchema,
    caption: z.string().trim().min(1).max(2_200),
    media: z
      .object({
        assetKey: z.string().trim().min(1).max(1_024),
        mediaType: MediaTypeSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.format === "feed" && value.media.mediaType !== "image") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media", "mediaType"], message: "Feed publishing requires an image" });
    }
    if (value.format === "reel" && value.media.mediaType !== "video") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["media", "mediaType"], message: "Reel publishing requires a video" });
    }
  });
export type MetaInstagramApprovedDispatch = z.infer<typeof MetaInstagramApprovedDispatchSchema>;

export const MetaInstagramProviderReceiptSchema = z
  .object({
    provider: z.literal("meta_instagram"),
    containerId: SafeIdentifierSchema.optional(),
    mediaId: SafeIdentifierSchema.optional(),
  })
  .strict();
export type MetaInstagramProviderReceipt = z.infer<typeof MetaInstagramProviderReceiptSchema>;

type FetchImplementation = typeof fetch;
type AccountVaultReader = typeof vaultService;

/** The deterministic vault key keeps persisted account metadata from selecting arbitrary secrets. */
export function metaInstagramAccessTokenVaultKey(connectionId: string): string {
  const parsed = SafeIdentifierSchema.safeParse(connectionId);
  if (!parsed.success) throw new Error("Meta Instagram connection identity is invalid");
  return `META_INSTAGRAM_ACCESS_TOKEN_${parsed.data}`;
}

/**
 * Resolve one official OAuth access token server-side. No environment variable,
 * browser payload, Convex document, log, or provider receipt contains the token.
 */
export async function resolveMetaInstagramAccessToken(
  connectionId: string,
  env: ProviderEnvironment = process.env,
  readVault: AccountVaultReader = vaultService,
): Promise<string> {
  const health = checkMetaInstagramApprovedDispatchHealth(env);
  if (!health.canDispatchApprovedActions) {
    throw new Error(`Meta Instagram approved dispatch is ${health.status}`);
  }
  if (env.META_ACCESS_TOKEN_RESOLVER?.trim() !== META_INSTAGRAM_VAULT_TOKEN_RESOLVER) {
    throw new Error("Meta Instagram token resolver is not the approved server vault resolver");
  }
  const token = (await readVault("media-engine-accounts"))[metaInstagramAccessTokenVaultKey(connectionId)]?.trim();
  if (!token || token.length < 20) {
    throw new Error("Meta Instagram access token is unavailable for this connected account");
  }
  return token;
}

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

function safeMediaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("approved media URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new Error("approved media URL is unsafe");
  }
  return url.toString();
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mediaContainerParams(action: MetaInstagramApprovedDispatch, mediaUrl: string, token: string): URLSearchParams {
  const params = new URLSearchParams({
    caption: action.caption,
    access_token: token,
  });
  if (action.format === "feed") {
    params.set("image_url", mediaUrl);
  } else {
    params.set("media_type", "REELS");
    params.set("video_url", mediaUrl);
  }
  return params;
}

async function metaForm(
  url: string,
  params: URLSearchParams,
  request: FetchImplementation,
): Promise<{ id: string }> {
  const response = await request(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body
      ? String((body as { error?: { code?: unknown } }).error?.code ?? "")
      : "";
    throw new Error(`Meta Instagram API returned HTTP ${response.status}${code ? ` (code ${code})` : ""}`);
  }
  const id = body && typeof body === "object" && "id" in body ? String((body as { id?: unknown }).id ?? "") : "";
  if (!SafeIdentifierSchema.safeParse(id).success) throw new Error("Meta Instagram API returned an invalid identifier");
  return { id };
}

/** Creates one official media container. Persist its sanitized id before publishing it. */
export async function createMetaInstagramMediaContainer(args: {
  action: MetaInstagramApprovedDispatch;
  mediaUrl: string;
  accessToken: string;
  env?: ProviderEnvironment;
  request?: FetchImplementation;
}): Promise<{ containerId: string }> {
  const action = MetaInstagramApprovedDispatchSchema.parse(args.action);
  const mediaUrl = safeMediaUrl(args.mediaUrl);
  const version = graphVersion(args.env ?? process.env);
  const response = await metaForm(
    graphUrl(version, `${encodeURIComponent(action.igUserId)}/media`),
    mediaContainerParams(action, mediaUrl, args.accessToken),
    args.request ?? fetch,
  );
  return { containerId: response.id };
}

/** Waits only for the container created by this separately approved action. */
export async function waitForMetaInstagramMediaContainer(args: {
  containerId: string;
  accessToken: string;
  env?: ProviderEnvironment;
  request?: FetchImplementation;
}): Promise<void> {
  const containerId = SafeIdentifierSchema.parse(args.containerId);
  const version = graphVersion(args.env ?? process.env);
  const request = args.request ?? fetch;
  for (let attempt = 0; attempt < MAX_CONTAINER_POLLS; attempt += 1) {
    if (attempt > 0) await sleep(CONTAINER_POLL_MS);
    const response = await request(
      graphUrl(version, `${encodeURIComponent(containerId)}?fields=status_code`),
      { method: "GET", redirect: "error", headers: { authorization: `Bearer ${args.accessToken}` } },
    );
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(`Meta Instagram container status returned HTTP ${response.status}`);
    const status = body && typeof body === "object" && "status_code" in body
      ? String((body as { status_code?: unknown }).status_code ?? "")
      : "";
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") throw new Error("Meta Instagram media container failed");
  }
  throw new Error("Meta Instagram media container was not ready before the worker timeout");
}

/** Publishes a ready container to the same official Professional account. */
export async function publishMetaInstagramMediaContainer(args: {
  action: MetaInstagramApprovedDispatch;
  containerId: string;
  accessToken: string;
  env?: ProviderEnvironment;
  request?: FetchImplementation;
}): Promise<{ mediaId: string }> {
  const action = MetaInstagramApprovedDispatchSchema.parse(args.action);
  const containerId = SafeIdentifierSchema.parse(args.containerId);
  const version = graphVersion(args.env ?? process.env);
  const response = await metaForm(
    graphUrl(version, `${encodeURIComponent(action.igUserId)}/media_publish`),
    new URLSearchParams({ creation_id: containerId, access_token: args.accessToken }),
    args.request ?? fetch,
  );
  return { mediaId: response.id };
}
