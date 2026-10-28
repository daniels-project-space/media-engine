import type { Doc } from "./_generated/dataModel";

export function frozenSnapshot(context: {
  project: Doc<"marketingProjects">;
  item: Doc<"marketingItems">;
  channel: Doc<"marketingChannels">;
  account: Doc<"marketingProviderAccounts">;
  asset: Doc<"marketingAssets"> | null;
}) {
  const { project, item, channel, account, asset } = context;
  return {
    projectId: project._id,
    projectVersion: project.version,
    website: project.website,
    offer: project.offer,
    facts: project.facts,
    itemId: item._id,
    version: item.version,
    kind: item.kind,
    title: item.title,
    content: item.content,
    scheduledAt: item.scheduledAt,
    ad: item.ad,
    channelId: channel._id,
    policyVersion: channel.policyVersion,
    providerAccountId: account.providerAccountId,
    profileId: account.profileId,
    platform: account.platform,
    subreddit: channel.subreddit,
    communityApproved: channel.communityApproved,
    adAccountId: channel.adAccountId,
    pageId: channel.pageId,
    asset: asset
      ? {
          id: asset._id,
          key: asset.key,
          sha256: asset.sha256,
          bytes: asset.bytes,
          contentType: asset.contentType,
        }
      : null,
  };
}
