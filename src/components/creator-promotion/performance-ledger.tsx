"use client";

import type { CreatorAttributionSnapshot, CreatorContentItem } from "./types";
import { EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime } from "./shared";

function metric(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Intl.NumberFormat("en").format(value);
}

function revenue(value: number | undefined, currency?: string): string | undefined {
  if (value === undefined) return undefined;
  if (!currency) return `${value} minor units`;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(value / 100);
  } catch {
    return `${value} ${currency} minor units`;
  }
}

export function CreatorPerformanceLedger({
  snapshots,
  content,
  selectedCreatorId,
  className,
}: {
  snapshots: CreatorAttributionSnapshot[];
  content: CreatorContentItem[];
  selectedCreatorId?: string;
  className?: string;
}) {
  const visible = snapshots
    .filter((snapshot) => !selectedCreatorId || snapshot.creatorId === selectedCreatorId)
    .sort((left, right) => new Date(right.capturedAt).getTime() - new Date(left.capturedAt).getTime());
  const contentById = new Map(content.map((item) => [item.id, item]));

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Verified performance ledger">
      <SectionHeading
        eyebrow="Learning loop"
        title="Verified performance ledger"
        description="Provider-derived observations only. Entries remain separate rather than auto-summed, so different periods and scopes are never mistaken for a single total."
        action={<span className="border border-signal/45 px-2 py-1 text-[9px] font-semibold tracking-[0.14em] text-signal">ACTUALS ONLY</span>}
      />
      {visible.length === 0 ? (
        <EmptyState title="No verified performance observations" detail="Record actual metrics from an authorised provider analytics surface to make the next editorial plan more informed." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.slice(0, 12).map((snapshot) => {
            const item = snapshot.contentId ? contentById.get(snapshot.contentId) : undefined;
            const values = [
              metric(snapshot.metrics.impressions) && `Impressions ${metric(snapshot.metrics.impressions)}`,
              metric(snapshot.metrics.reach) && `Reach ${metric(snapshot.metrics.reach)}`,
              metric(snapshot.metrics.linkClicks) && `Clicks ${metric(snapshot.metrics.linkClicks)}`,
              metric(snapshot.metrics.followers) && `Followers ${metric(snapshot.metrics.followers)}`,
              metric(snapshot.metrics.subscribers) && `Subscribers ${metric(snapshot.metrics.subscribers)}`,
              revenue(snapshot.metrics.grossRevenueMinor, snapshot.metrics.currency) && `Revenue ${revenue(snapshot.metrics.grossRevenueMinor, snapshot.metrics.currency)}`,
            ].filter((value): value is string => Boolean(value));
            return (
              <li key={snapshot.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate text-xs font-semibold text-ink">{item?.title ?? "Creator-level observation"}</p><p className="mt-1 text-[10px] text-ink-faint">Captured {displayTime(snapshot.capturedAt)}</p></div>
                  <StatusPill label={displayLabel(snapshot.source)} tone={snapshot.source === "manual" ? "amber" : "signal"} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{values.map((value) => <span key={value} className="border border-line-2 bg-panel-2 px-2 py-1 text-[9px] text-ink-dim">{value}</span>)}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
