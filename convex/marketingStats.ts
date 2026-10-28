import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export const emptyMarketingStats = (since: number) => ({
  published: 0,
  impressions: 0,
  clicks: 0,
  advertisingMinor: 0,
  conversions: 0,
  valueMinor: 0,
  since,
});
type Stats = NonNullable<Doc<"marketingProjects">["stats"]>;
export async function incrementMarketingStats(
  ctx: MutationCtx,
  project: Doc<"marketingProjects">,
  delta: Partial<Omit<Stats, "since">>,
) {
  // Read our transaction's latest version: other project patches never replace stats.
  const current: Stats =
    (await ctx.db.get(project._id))?.stats ?? emptyMarketingStats(Date.now());
  const next: Stats = { ...current };
  for (const key of [
    "published",
    "impressions",
    "clicks",
    "advertisingMinor",
    "conversions",
    "valueMinor",
  ] as const)
    next[key] = Math.max(0, current[key] + (delta[key] ?? 0));
  if (delta.metricsAt !== undefined)
    next.metricsAt = Math.max(current.metricsAt ?? 0, delta.metricsAt);
  await ctx.db.patch(project._id, { stats: next });
}
