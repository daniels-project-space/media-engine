import { z } from "zod";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { snapshotHash, trackingUrl } from "../../../convex/marketingPolicy";
import { frozenSnapshot } from "../../../convex/marketingSnapshots";
import { presignedGet, objectExists } from "../storage";
import {
  authorisedAccount,
  marketingCall,
  providerClient,
  publicFailure,
} from "./service";
import { ZernioError, type ApprovedAd, type ApprovedPost } from "./zernio";

type Context = {
  project: Doc<"marketingProjects">;
  item: Doc<"marketingItems">;
  channel: Doc<"marketingChannels">;
  account: Doc<"marketingProviderAccounts">;
  asset: Doc<"marketingAssets"> | null;
};
type Identity = {
  projectId: Id<"marketingProjects">;
  itemId: Id<"marketingItems">;
};
const remoteAd = z.object({
  statusReadAt: z.string().nullable().optional(),
  ad: z.object({
    _id: z.string(),
    status: z.string(),
    accountId: z.union([z.string(), z.object({ _id: z.string() })]),
    platformCampaignId: z.string(),
    platformAdId: z.string().optional(),
  }),
});

async function mediaFor(context: Context) {
  if (!context.asset) return undefined;
  const asset = context.asset;
  if (
    asset.projectId !== context.project._id ||
    !asset.rightsConfirmed ||
    !asset.key.startsWith(`marketing/${context.project._id}/`) ||
    !(await objectExists(asset.key))
  )
    throw new Error("Approved project media is unavailable");
  return {
    url: await presignedGet(asset.key, 7 * 86_400),
    type: asset.contentType.startsWith("video/")
      ? ("video" as const)
      : ("image" as const),
  };
}

async function postInput(context: Context): Promise<ApprovedPost> {
  const { item, channel, account } = context;
  if (!["instagram", "x", "reddit"].includes(account.platform))
    throw new Error("Invalid organic publishing account");
  return {
    idempotencyKey: item.idempotencyKey,
    providerAccountId: account.providerAccountId,
    platform: account.platform as ApprovedPost["platform"],
    title: item.title,
    content: item.content,
    scheduledAt: item.scheduledAt,
    subreddit: channel.subreddit,
    media: await mediaFor(context),
  };
}

async function adInput(context: Context): Promise<ApprovedAd> {
  const { item, channel, account, project } = context;
  if (
    !item.ad ||
    !channel.adAccountId ||
    !["googleads", "metaads"].includes(account.platform)
  )
    throw new Error("Invalid approved advertising template");
  return {
    ...item.ad,
    idempotencyKey: item.idempotencyKey,
    providerAccountId: account.providerAccountId,
    adAccountId: channel.adAccountId,
    platform: account.platform as ApprovedAd["platform"],
    name: item.title,
    destination: trackingUrl(
      project.website,
      project._id,
      item._id,
      account.platform,
    ),
    currency: project.currency,
    startsAt: item.scheduledAt,
    pageId: channel.pageId,
    media: await mediaFor(context),
  };
}

function cancellationRequired(context: Context) {
  return (
    context.project.status === "paused" ||
    context.channel.mode === "off" ||
    !context.channel.authorisedUntil ||
    context.channel.authorisedUntil <= Date.now() ||
    context.item.status === "cancel_pending"
  );
}

export async function runMarketingItem(
  identity: Identity,
  workerRunId: string,
) {
  let context = await marketingCall<Context>("getItem", identity);
  let client: Awaited<ReturnType<typeof providerClient>> | undefined;
  const outcome = (fields: Record<string, unknown>) =>
    marketingCall("recordOutcome", { ...identity, ...fields });
  try {
    if (context.item.status === "cancel_pending" && !context.item.providerId) {
      await outcome({
        status: "cancel_pending",
        error:
          "Original provider creation outcome is unknown. An operator must locate its receipt before cancellation can be confirmed.",
        retryAfterMs: 86_400_000,
      });
      return { status: "cancellation_unconfirmed" };
    }
    client = await providerClient();
    if (context.item.status === "approved") {
      authorisedAccount(context.account.providerAccountId, context.item.kind);
      if (context.project.status !== "active")
        return { status: "waiting_for_project" };
      await marketingCall("claimItem", { ...identity, workerRunId });
      context = await marketingCall<Context>("getItem", identity);
      if (cancellationRequired(context)) {
        await outcome({ status: "cancelled", workerRunId });
        return { status: "cancelled_before_provider_request" };
      }
    }
    if (
      ["dispatching", "uncertain"].includes(context.item.status) &&
      !context.item.providerId
    ) {
      if (cancellationRequired(context)) {
        await outcome({
          status: "cancel_pending",
          error:
            "Provider creation outcome is unknown; locate the original native request before confirming cancellation",
        });
        return { status: "cancellation_unconfirmed" };
      }
      // The provider's idempotency guarantee lasts 24h. Never replay a create
      // outside it, or after a policy change, just because an observer timed out.
      if (
        !context.item.dispatchedAt ||
        Date.now() - context.item.dispatchedAt > 23 * 3_600_000
      )
        throw new Error(
          "Provider idempotency window expired; reconcile the original request manually",
        );
      if (snapshotHash(frozenSnapshot(context)) !== context.item.approvedHash)
        throw new Error(
          "The exact approved account, content or policy changed; no create replay was sent",
        );
      authorisedAccount(context.account.providerAccountId, context.item.kind);
      if (context.item.kind === "post") {
        const result = await client.createPost(await postInput(context));
        await outcome(result);
      } else {
        await client.verifyAdAccount(
          context.account.providerAccountId,
          context.channel.adAccountId!,
          context.project.currency,
        );
        if (context.account.platform === "metaads")
          await client.verifyMetaPage(
            context.account.providerAccountId,
            context.channel.pageId!,
          );
        const result = await client.createPausedAd(await adInput(context));
        // Persist the provider IDs before any billable activation. If this
        // write fails, only a paused tree exists and the same key can recover it.
        await outcome({
          status: "uncertain",
          providerId: result.providerId,
          providerCampaignId: result.providerCampaignId,
          ...(result.providerNativeAdId
            ? { providerNativeAdId: result.providerNativeAdId }
            : {}),
        });
        context = await marketingCall<Context>("getItem", identity);
        if (
          !cancellationRequired(context) &&
          snapshotHash(frozenSnapshot(context)) === context.item.approvedHash
        ) {
          authorisedAccount(context.account.providerAccountId, "ad");
          await client.campaignStatus(
            result.providerCampaignId,
            context.account.providerAccountId,
            context.channel.adAccountId!,
            "active",
          );
        }
      }
      context = await marketingCall<Context>("getItem", identity);
    }
    if (!context.item.providerId) return { status: context.item.status };
    if (context.item.kind === "post") {
      const result = cancellationRequired(context)
        ? await client.cancelPost(
            context.item.providerId,
            context.account.providerAccountId,
            context.item.scheduledAt,
          )
        : await client.getPost(
            context.item.providerId,
            context.account.providerAccountId,
          );
      let metrics: unknown;
      if (
        result.status === "published" &&
        process.env.MARKETING_METRICS_ENABLED === "true" &&
        (!context.item.metrics ||
          context.item.metrics.capturedAt <
            Date.now() -
              (context.account.platform === "x" ? 7 : 1) * 86_400_000)
      ) {
        try {
          if (context.account.platform === "x")
            authorisedAccount(context.account.providerAccountId, "post");
          const requestKey = `metric:${snapshotHash({ itemId: identity.itemId, workerRunId })}`;
          const reservation = await marketingCall<{
            allowed: boolean;
            actionId: string | null;
          }>("reserveMetricsRead", { ...identity, requestKey });
          if (reservation.allowed) {
            metrics = await client.getPostAnalytics(
              context.item.providerId,
              context.account.providerAccountId,
              context.project.currency,
            );
            if (reservation.actionId)
              await marketingCall("completeMetricsRead", {
                ...identity,
                actionId: reservation.actionId,
              });
          }
        } catch (error) {
          // A metrics outage must not erase an independently verified native
          // publication. Retained holds and the item error remain observable.
          await outcome({
            ...result,
            error: `Metrics unavailable: ${publicFailure(error)}`,
          });
          return { status: result.status, metrics: "unavailable" };
        }
      }
      await outcome({
        ...result,
        ...(cancellationRequired(context) && result.status === "uncertain"
          ? { status: "cancel_pending" }
          : {}),
        ...(metrics ? { metrics } : {}),
      });
      return result;
    }
    let shouldStop =
      cancellationRequired(context) ||
      context.item.status === "paused" ||
      Boolean(
        context.item.ad &&
        (Date.now() >=
          context.item.scheduledAt +
            context.item.ad.durationDays * 86_400_000 ||
          (context.item.metrics?.spendMinor ?? 0) >=
            context.item.ad.maxSpendMinor),
      );
    if (shouldStop && context.item.providerCampaignId)
      await client.campaignStatus(
        context.item.providerCampaignId,
        context.account.providerAccountId,
        context.channel.adAccountId!,
        "paused",
      );
    let read = remoteAd.parse(await client.getAd(context.item.providerId));
    let remote = read.ad;
    const owner =
      typeof remote.accountId === "string"
        ? remote.accountId
        : remote.accountId._id;
    if (
      remote._id !== context.item.providerId ||
      owner !== context.account.providerAccountId ||
      remote.platformCampaignId !== context.item.providerCampaignId
    )
      throw new Error("Remote ad identity differs from the admitted campaign");
    const metrics = await client.getAdAnalytics(
      remote._id,
      new Date(context.item.dispatchedAt!).toISOString().slice(0, 10),
      context.project.currency,
    );
    // Reporting can lag. Stop immediately when the newest observed spend
    // exhausts the admitted exposure, rather than waiting for another tick.
    if (
      !shouldStop &&
      context.item.ad &&
      metrics.spendMinor >= context.item.ad.maxSpendMinor
    ) {
      shouldStop = true;
      await client.campaignStatus(
        context.item.providerCampaignId!,
        context.account.providerAccountId,
        context.channel.adAccountId!,
        "paused",
      );
      read = remoteAd.parse(await client.getAd(context.item.providerId));
      remote = read.ad;
      const observedOwner =
        typeof remote.accountId === "string"
          ? remote.accountId
          : remote.accountId._id;
      if (
        remote._id !== context.item.providerId ||
        observedOwner !== context.account.providerAccountId ||
        remote.platformCampaignId !== context.item.providerCampaignId
      )
        throw new Error(
          "Pause readback identity differs from admitted campaign",
        );
    }
    const liveAt = read.statusReadAt ? Date.parse(read.statusReadAt) : NaN;
    const live =
      Number.isFinite(liveAt) &&
      liveAt >= Date.now() - 5 * 60_000 &&
      liveAt <= Date.now() + 60_000;
    const paused =
      live && ["paused", "completed", "cancelled"].includes(remote.status);
    const failed = ["error", "rejected"].includes(remote.status);
    await outcome({
      providerId: remote._id,
      providerCampaignId: remote.platformCampaignId,
      ...(remote.platformAdId
        ? { providerNativeAdId: remote.platformAdId }
        : {}),
      status: shouldStop
        ? paused
          ? "paused"
          : "cancel_pending"
        : paused
          ? "paused"
          : failed
            ? "failed"
            : live && remote.status === "active"
              ? "active"
              : "uncertain",
      metrics,
      ...(live ? { providerStatusReadAt: liveAt } : {}),
      ...(!live
        ? {
            error:
              "Current platform switches could not be read; running or stopped status is unconfirmed",
          }
        : {}),
      ...(remote.status === "pending_review"
        ? { error: "Provider review pending; delivery is not confirmed" }
        : {}),
    });
    return { status: remote.status };
  } catch (error) {
    const message = publicFailure(error);
    const latest = await marketingCall<Context>("getItem", identity);
    if (latest.item.reservationMonth) {
      // Existing remote ads keep a cleanup/reconciliation obligation even when
      // authentication or reporting fails. Never mark them safely stopped.
      if (latest.item.kind === "ad" && latest.item.providerCampaignId) {
        await client
          ?.campaignStatus(
            latest.item.providerCampaignId,
            latest.account.providerAccountId,
            latest.channel.adAccountId!,
            "paused",
          )
          .catch(() => undefined);
        if (
          error instanceof ZernioError &&
          [401, 403, 404, 422].includes(error.status)
        )
          await marketingCall("blockItem", { ...identity, error: message });
        else
          await outcome({
            status: "cancel_pending",
            error: message,
            retryAfterMs:
              error instanceof ZernioError
                ? Math.max(300_000, error.retryAfterSeconds * 1_000)
                : 3_600_000,
          });
      } else if (
        error instanceof ZernioError &&
        (error.uncertain || error.status === 0)
      )
        await outcome({
          status: cancellationRequired(latest) ? "cancel_pending" : "uncertain",
          error: message,
          retryAfterMs: Math.max(300_000, error.retryAfterSeconds * 1_000),
        });
      else await marketingCall("blockItem", { ...identity, error: message });
    } else await marketingCall("blockItem", { ...identity, error: message });
    return { status: "needs_attention", error: message };
  }
}
