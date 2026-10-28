import { z } from "zod";
import {
  accountPlatform,
  type MarketingPlatform,
} from "../../../convex/marketingPolicy";
import type { ConnectionPlatform } from "./connection-state";

// Qualified against official endpoint contracts on 2026-10-28. Live account
// qualification is separately gated; documentation is not a successful publish.
const ORIGIN = "https://zernio.com/api/v1";
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);
const rawAccount = z.object({
  _id: providerId,
  platform: z.string(),
  profileId: z.union([providerId, z.object({ _id: providerId })]),
  username: z.string().optional(),
  displayName: z.string().optional(),
  isActive: z.boolean(),
  needsReconnection: z.boolean().optional(),
});
const rawPost = z.object({
  _id: providerId,
  status: z.string(),
  platforms: z
    .array(
      z.object({
        platform: z.string(),
        accountId: z.union([providerId, z.object({ _id: providerId })]),
        status: z.string().optional(),
        platformPostUrl: z.string().optional(),
        platformPostId: z.string().optional(),
      }),
    )
    .optional(),
});

export class ZernioError extends Error {
  constructor(
    public readonly status: number,
    public readonly uncertain: boolean,
    public readonly retryAfterSeconds = 60,
  ) {
    super(
      status
        ? `Marketing provider returned HTTP ${status}; ${status === 401 || status === 403 ? "reconnect or check account access" : "reconcile before retrying a write"}`
        : "Marketing provider transport outcome is unknown; reconcile before retrying",
    );
  }
}

export type ProviderAccount = {
  providerAccountId: string;
  profileId: string;
  platform: MarketingPlatform;
  label: string;
  connected: boolean;
};
export type ProviderConnectResult =
  | { authUrl: string }
  | { alreadyConnected: true; accountId: string; platform: string };
export type PostState = {
  providerId: string;
  status: "scheduled" | "published" | "failed" | "uncertain" | "cancelled";
  publicationUrl?: string;
  error?: string;
};
export type ApprovedPost = {
  idempotencyKey: string;
  providerAccountId: string;
  platform: "instagram" | "x" | "reddit";
  title: string;
  content: string;
  scheduledAt: number;
  subreddit?: string;
  media?: { url: string; type: "image" | "video" };
};
export type ApprovedAd = {
  idempotencyKey: string;
  providerAccountId: string;
  adAccountId: string;
  platform: "googleads" | "metaads";
  name: string;
  headline: string;
  description: string;
  destination: string;
  keywords: string[];
  countries: string[];
  dailyBudgetMinor: number;
  maxSpendMinor: number;
  currency: string;
  durationDays: number;
  startsAt: number;
  pageId?: string;
  media?: { url: string; type: "image" | "video" };
};

function httpsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Provider media and destination URLs must be HTTPS");
  return url.toString();
}

export function buildPost(input: ApprovedPost) {
  providerId.parse(input.providerAccountId);
  if (
    !input.content.trim() ||
    input.content.length >
      (input.platform === "x"
        ? 280
        : input.platform === "instagram"
          ? 2_200
          : 10_000)
  )
    throw new Error("Content exceeds the channel limit");
  if (input.platform === "instagram" && !input.media)
    throw new Error("Instagram requires approved media");
  if (
    input.platform === "reddit" &&
    (!input.subreddit || !/^[A-Za-z0-9_]{2,40}$/.test(input.subreddit))
  )
    throw new Error("An approved subreddit is required");
  if (!Number.isSafeInteger(input.scheduledAt))
    throw new Error("Publication time is invalid");
  // Instagram derives a feed image/Reel from its media; only Stories need
  // contentType. Do not send invented "post"/"reel" enum values.
  const platformSpecificData =
    input.platform === "reddit"
      ? {
          subreddit: input.subreddit,
          title: input.title,
          ...(input.media ? {} : { forceSelf: true }),
        }
      : {};
  return {
    title: input.title,
    content: input.content,
    platforms: [
      {
        platform: input.platform === "x" ? "twitter" : input.platform,
        accountId: input.providerAccountId,
        platformSpecificData,
      },
    ],
    scheduledFor: new Date(input.scheduledAt).toISOString(),
    timezone: "UTC",
    ...(input.media
      ? {
          mediaItems: [
            { type: input.media.type, url: httpsUrl(input.media.url) },
          ],
        }
      : {}),
  };
}

export function buildAd(input: ApprovedAd) {
  providerId.parse(input.providerAccountId);
  providerId.parse(input.adAccountId);
  // MVP deliberately supports cent-based account currencies only; JPY and
  // other minor-unit exponents require their exact qualified conversion.
  if (!["USD", "GBP", "EUR", "CHF"].includes(input.currency))
    throw new Error(
      "This ad template supports USD, GBP, EUR and CHF accounts only",
    );
  if (
    !Number.isSafeInteger(input.dailyBudgetMinor) ||
    input.dailyBudgetMinor < 1 ||
    !Number.isSafeInteger(input.maxSpendMinor) ||
    input.maxSpendMinor <
      (input.platform === "googleads"
        ? input.dailyBudgetMinor * (input.durationDays + 1) * 2
        : input.dailyBudgetMinor * input.durationDays) ||
    !Number.isInteger(input.durationDays) ||
    input.durationDays < 1 ||
    input.durationDays > 7
  )
    throw new Error("Ad budget or duration is invalid");
  if (
    !input.countries.length ||
    input.countries.length > 5 ||
    input.countries.some((country) => !/^[A-Z]{2}$/.test(country))
  )
    throw new Error("Ad targeting countries are required");
  if (input.platform === "metaads" && (!input.pageId || !input.media))
    throw new Error("Meta requires a verified Page and approved creative");
  if (
    input.platform === "googleads" &&
    (!input.keywords.length ||
      input.keywords.length > 10 ||
      input.headline.length > 30 ||
      input.description.length > 90)
  )
    throw new Error("Google Search needs reviewed keywords and valid ad copy");
  return {
    accountId: input.providerAccountId,
    adAccountId: input.adAccountId,
    name: input.name,
    headline: input.headline,
    body: input.description,
    linkUrl: httpsUrl(input.destination),
    goal: "traffic",
    budgetAmount:
      (input.platform === "metaads"
        ? input.maxSpendMinor
        : input.dailyBudgetMinor) / 100,
    budgetType: input.platform === "metaads" ? "lifetime" : "daily",
    currency: input.currency,
    startDate: new Date(input.startsAt).toISOString(),
    endDate: new Date(
      input.startsAt + input.durationDays * 86_400_000,
    ).toISOString(),
    countries: input.countries,
    // Never rely on the provider default, which creates ACTIVE entities.
    // Hold the new campaign; the provider creates its children enabled under
    // that hold, so one separately authorised campaign activation is sufficient.
    status: "PAUSED",
    ...(input.platform === "googleads"
      ? { campaignType: "search", keywords: input.keywords }
      : { pageId: input.pageId }),
    ...(input.media
      ? input.media.type === "video"
        ? { video: { url: httpsUrl(input.media.url) } }
        : { imageUrl: httpsUrl(input.media.url) }
      : {}),
  };
}

function postState(value: unknown, expectedAccount: string): PostState {
  const envelope = z.object({ post: rawPost }).parse(value);
  const targets = envelope.post.platforms ?? [];
  const target = targets.find(
    (row) =>
      (typeof row.accountId === "string"
        ? row.accountId
        : row.accountId._id) === expectedAccount,
  );
  if (!target || targets.length !== 1)
    throw new Error("Provider post does not match the single approved account");
  if (target.platformPostUrl) {
    const hostname = new URL(
      httpsUrl(target.platformPostUrl),
    ).hostname.toLowerCase();
    const domains =
      target.platform === "twitter"
        ? ["x.com", "twitter.com"]
        : target.platform === "instagram"
          ? ["instagram.com"]
          : target.platform === "reddit"
            ? ["reddit.com", "redd.it"]
            : [];
    if (
      !domains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      )
    )
      throw new Error(
        "Publication URL does not belong to the approved native platform",
      );
  }
  const state = target.status ?? envelope.post.status;
  const status =
    state === "published" && target.platformPostUrl
      ? "published"
      : state === "failed"
        ? "failed"
        : state === "cancelled"
          ? "cancelled"
          : ["scheduled", "pending"].includes(state) ||
              envelope.post.status === "scheduled"
            ? "scheduled"
            : "uncertain";
  return {
    providerId: envelope.post._id,
    status,
    ...(target.platformPostUrl
      ? { publicationUrl: httpsUrl(target.platformPostUrl) }
      : {}),
  };
}

export class ZernioClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (apiKey.trim().length < 16 || /\s/.test(apiKey))
      throw new Error("ZERNIO_API_KEY is not configured");
  }

  private async request(
    path: string,
    method = "GET",
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes(".."))
      throw new Error("Invalid provider path");
    let response: Response;
    try {
      response = await this.fetcher(ORIGIN + path, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body ? { "content-type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ZernioError(0, method !== "GET");
    }
    if (!response.ok) {
      const retry = Number(response.headers.get("retry-after"));
      throw new ZernioError(
        response.status,
        method !== "GET" &&
          (response.status >= 500 ||
            response.status === 409 ||
            response.status === 429),
        Number.isFinite(retry) && retry > 0 ? Math.min(retry, 86_400) : 60,
      );
    }
    try {
      if (Number(response.headers.get("content-length")) > 2_000_000) {
        await response.body?.cancel();
        throw new Error("Provider response is too large");
      }
      const reader = response.body?.getReader(),
        chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            length += part.value.byteLength;
            if (length > 2_000_000) {
              await reader.cancel();
              throw new Error("Provider response is too large");
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const raw = new TextDecoder().decode(body);
      return raw ? JSON.parse(raw) : {};
    } catch {
      throw new ZernioError(502, method !== "GET");
    }
  }

  async ensureProjectProfile(projectId: string): Promise<string> {
    const externalId = `media-engine-project:${projectId}`;
    const params = new URLSearchParams({
      externalId,
      includeOverLimit: "true",
    });
    const listProfiles = async () =>
      z
        .object({ profiles: z.array(z.object({ _id: providerId })) })
        .parse(await this.request(`/profiles?${params}`)).profiles;

    const existing = await listProfiles();
    if (existing.length > 1)
      throw new Error("More than one provider profile matches this project; resolve the duplicate before connecting accounts");
    if (existing[0]) return existing[0]._id;

    const idempotencyKey = `media-engine-profile:${projectId}`;
    try {
      const created = z
        .object({ profile: z.object({ _id: providerId }) })
        .parse(
          await this.request(
            "/profiles",
            "POST",
            {
              name: `Media Engine project ${projectId}`,
              description: "Dedicated social and advertising accounts for one Media Engine project.",
              externalId,
            },
            idempotencyKey,
          ),
        );
      return created.profile._id;
    } catch (error) {
      if (error instanceof ZernioError && error.status === 409) {
        const recovered = await listProfiles();
        if (recovered.length === 1) return recovered[0]._id;
      }
      throw error;
    }
  }

  async getConnectUrl(
    platform: ConnectionPlatform,
    profileId: string,
    redirectUrl: string,
  ): Promise<ProviderConnectResult> {
    providerId.parse(profileId);
    const redirect = new URL(redirectUrl);
    if (redirect.protocol !== "https:" || redirect.username || redirect.password)
      throw new Error("The provider callback must use the configured HTTPS site origin");

    let path: string;
    const query = new URLSearchParams({
      profileId,
      redirect_url: redirect.toString(),
    });
    if (platform === "instagram" || platform === "x" || platform === "reddit") {
      path = `/connect/${platform === "x" ? "twitter" : platform}`;
      query.set("scopes", "posting,analytics");
    } else if (platform === "metaads") {
      path = "/connect/facebook/ads";
      query.set("loginMode", "business");
    } else {
      path = "/connect/googleads/ads";
    }

    const response = z
      .object({
        authUrl: z.string().url().optional(),
        alreadyConnected: z.boolean().optional(),
        accountId: providerId.optional(),
        platform: z.string().optional(),
      })
      .parse(await this.request(`${path}?${query}`));
    if (response.alreadyConnected) {
      if (!response.accountId || !response.platform)
        throw new Error("Provider reported an existing account without its identity");
      return {
        alreadyConnected: true,
        accountId: response.accountId,
        platform: response.platform,
      };
    }
    if (!response.authUrl)
      throw new Error("Provider did not return an OAuth authorization URL");
    const authUrl = new URL(response.authUrl);
    if (authUrl.protocol !== "https:" || authUrl.username || authUrl.password)
      throw new Error("Provider returned an unsafe OAuth authorization URL");
    return { authUrl: authUrl.toString() };
  }

  async listAccounts(): Promise<{
    accounts: ProviderAccount[];
    accountCount: number;
  }> {
    const accounts: ProviderAccount[] = [];
    let cursor: string | null = null,
      accountCount = 0;
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        limit: "50",
        includeOverLimit: "true",
      });
      if (cursor) params.set("cursor", cursor);
      const value = z
        .object({
          accounts: z.array(rawAccount),
          pagination: z.object({ nextCursor: z.string().nullable() }),
        })
        .parse(await this.request(`/accounts?${params}`));
      accountCount += value.accounts.length;
      for (const account of value.accounts) {
        if (seen.has(account._id))
          throw new Error("Provider account pagination repeated an account");
        seen.add(account._id);
        if (
          !["instagram", "twitter", "reddit", "googleads", "metaads"].includes(
            account.platform,
          )
        )
          continue;
        accounts.push({
          providerAccountId: account._id,
          profileId:
            typeof account.profileId === "string"
              ? account.profileId
              : account.profileId._id,
          platform: accountPlatform(account.platform),
          label: account.displayName ?? account.username ?? account._id,
          connected: account.isActive && !account.needsReconnection,
        });
      }
      cursor = value.pagination.nextCursor;
      if (!cursor) return { accounts, accountCount };
    }
    throw new Error(
      "Provider account inventory exceeded 500 accounts; no partial pricing estimate was accepted",
    );
  }

  async createPost(input: ApprovedPost): Promise<PostState> {
    return postState(
      await this.request(
        "/posts",
        "POST",
        buildPost(input),
        input.idempotencyKey,
      ),
      input.providerAccountId,
    );
  }

  async getPost(id: string, accountId: string): Promise<PostState> {
    return postState(
      await this.request(`/posts/${providerId.parse(id)}`),
      accountId,
    );
  }

  async cancelPost(
    id: string,
    accountId: string,
    scheduledAt?: number,
  ): Promise<PostState> {
    const current = await this.getPost(id, accountId);
    if (["published", "cancelled", "failed"].includes(current.status))
      return current;
    if (current.status !== "scheduled")
      throw new Error(
        "Post may already be publishing; cancellation remains unconfirmed",
      );
    await this.request(`/posts/${providerId.parse(id)}`, "DELETE");
    // Zernio can delete a record while a native send is already in flight.
    // A future queued schedule is cancellable; a due send needs native proof.
    return scheduledAt && scheduledAt > Date.now() + 5 * 60_000
      ? { providerId: id, status: "cancelled" }
      : {
          providerId: id,
          status: "uncertain",
          error:
            "Remote schedule was deleted, but an in-flight native publication remains unconfirmed",
        };
  }

  async createPausedAd(input: ApprovedAd) {
    const result = z
      .object({
        ad: z.object({
          _id: providerId,
          accountId: z
            .union([providerId, z.object({ _id: providerId })])
            .optional(),
          platformCampaignId: providerId,
          platformAdId: providerId.optional(),
          status: z.string(),
        }),
      })
      .parse(
        await this.request(
          "/ads/create",
          "POST",
          buildAd(input),
          input.idempotencyKey,
        ),
      );
    const owner = result.ad.accountId;
    if (
      owner &&
      (typeof owner === "string" ? owner : owner._id) !==
        input.providerAccountId
    )
      throw new Error("Provider ad account differs from approved account");
    return {
      providerId: result.ad._id,
      providerCampaignId: result.ad.platformCampaignId,
      providerNativeAdId: result.ad.platformAdId,
      providerStatus: result.ad.status,
    };
  }

  async campaignStatus(
    campaignId: string,
    accountId: string,
    adAccountId: string,
    status: "active" | "paused",
  ) {
    // PUT of the desired native switch is repeatable. A cached create receipt
    // must never substitute for reapplying a stop after an external resume.
    return this.request(
      `/ads/campaigns/${providerId.parse(campaignId)}/status`,
      "PUT",
      {
        accountId: providerId.parse(accountId),
        adAccountId: providerId.parse(adAccountId),
        status,
      },
    );
  }

  async getAd(id: string) {
    return this.request(`/ads/${providerId.parse(id)}?live=true`);
  }

  async verifyAdAccount(
    accountId: string,
    adAccountId: string,
    currency: string,
  ) {
    const params = new URLSearchParams({
      accountId: providerId.parse(accountId),
      adAccountId: providerId.parse(adAccountId),
      inScopeOnly: "true",
      limit: "1",
    });
    const result = z
      .object({
        accounts: z
          .array(
            z.object({
              id: providerId,
              currency: z.string(),
              selected: z.boolean(),
              selectable: z.boolean().optional(),
              billingStatus: z.string().optional(),
            }),
          )
          .max(1),
        stale: z.boolean().optional(),
      })
      .parse(await this.request(`/ads/accounts?${params}`));
    const account = result.accounts[0];
    if (
      result.stale ||
      !account ||
      account.id !== adAccountId ||
      account.currency !== currency ||
      !account.selected ||
      account.selectable === false ||
      account.billingStatus === "missing"
    )
      throw new Error(
        "Ad account access, selected scope, billing or currency could not be verified",
      );
    return {
      id: account.id,
      currency: account.currency,
      verifiedAt: Date.now(),
    };
  }

  async verifyMetaPage(accountId: string, pageId: string) {
    providerId.parse(pageId);
    const result = z
      .object({ pages: z.array(z.object({ id: providerId })).max(1_000) })
      .parse(
        await this.request(
          `/accounts/${providerId.parse(accountId)}/facebook-page?refresh=true`,
        ),
      );
    if (!result.pages.some((page) => page.id === pageId))
      throw new Error(
        "The selected Meta Page is not accessible through this connection",
      );
    return { id: pageId, verifiedAt: Date.now() };
  }

  async billingSnapshot() {
    const usage = z
      .object({
        billingSystem: z.literal("metronome"),
        hasAccess: z.boolean(),
        usage: z.object({ connectedAccounts: z.number().int().nonnegative() }),
        spend: z.object({
          currentPeriodCents: z.number().int().nonnegative(),
          xSpendCents: z.number().int().nonnegative(),
          xSpendLimitCents: z.number().int().nonnegative().nullable(),
        }),
      })
      .parse(await this.request("/usage"));
    if (!usage.hasAccess)
      throw new Error(
        "Provider billing access is unavailable; resolve the account without upgrading automatically",
      );
    return {
      accountCount: usage.usage.connectedAccounts,
      periodSpendMinor: usage.spend.currentPeriodCents,
      xSpendMinor: usage.spend.xSpendCents,
      xSpendLimitMinor: usage.spend.xSpendLimitCents,
    };
  }

  async getAdAnalytics(id: string, fromDate: string, currency: string) {
    const response = z
      .object({
        ad: z.object({ id: z.string(), currency: z.string().nullable() }),
        analytics: z.object({
          summary: z.object({
            spend: z.number().nonnegative().finite(),
            impressions: z.number().int().nonnegative(),
            clicks: z.number().int().nonnegative(),
          }),
        }),
      })
      .parse(
        await this.request(
          `/ads/${providerId.parse(id)}/analytics?${new URLSearchParams({ fromDate, toDate: new Date().toISOString().slice(0, 10) })}`,
        ),
      );
    if (response.ad.id !== id || response.ad.currency !== currency)
      throw new Error(
        "Ad analytics identity or currency differs from the approved campaign",
      );
    const spendMinor = Math.round(response.analytics.summary.spend * 100);
    if (!Number.isSafeInteger(spendMinor))
      throw new Error("Provider ad spend is invalid");
    return {
      impressions: response.analytics.summary.impressions,
      clicks: response.analytics.summary.clicks,
      spendMinor,
      currency,
      capturedAt: Date.now(),
    };
  }

  async getPostAnalytics(id: string, accountId: string, currency: string) {
    const value = z
      .object({
        postId: z.string(),
        analytics: z.object({
          impressions: z.number().int().nonnegative(),
          clicks: z.number().int().nonnegative(),
        }),
      })
      .parse(
        await this.request(
          `/analytics?${new URLSearchParams({ postId: providerId.parse(id), accountId: providerId.parse(accountId), limit: "1" })}`,
        ),
      );
    if (value.postId !== id)
      throw new Error("Post analytics identity differs from the admitted post");
    return {
      impressions: value.analytics.impressions,
      clicks: value.analytics.clicks,
      spendMinor: 0,
      currency,
      capturedAt: Date.now(),
    };
  }
}
