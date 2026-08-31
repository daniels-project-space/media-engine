"use client";

import type { CreatorContentItem, CreatorPromotionPersona, CreatorSocialAccount, CreatorTimestamp } from "./types";
import { AccountStatusPill, EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime, toDate } from "./shared";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;

type BlockerTone = "amber" | "onair";
type PortfolioBlocker = { id: string; detail: string; tone: BlockerTone };

function inNextSevenDays(item: CreatorContentItem, from: number, until: number): boolean {
  const scheduledAt = toDate(item.scheduledAt)?.getTime();
  return scheduledAt !== undefined && scheduledAt >= from && scheduledAt < until;
}

function pendingApprovalRecords(item: CreatorContentItem): number {
  return [
    item.approvalStatus,
    item.metaInstagramPublish?.approvalStatus,
    item.postizSchedule?.approvalStatus,
  ].filter((status) => status === "pending").length;
}

function deliveryStateBlocked(item: CreatorContentItem): boolean {
  return item.status === "blocked"
    || item.renderState === "blocked"
    || item.renderState === "failed"
    || item.metaInstagramPublish?.status === "blocked"
    || item.metaInstagramPublish?.status === "failed"
    || item.postizSchedule?.status === "blocked"
    || item.postizSchedule?.status === "failed";
}

function accountLabel(account: CreatorSocialAccount): string {
  return account.handle.startsWith("@") ? account.handle : `@${account.handle}`;
}

/**
 * Read-only portfolio inventory. It deliberately measures calendar records
 * and pending approval records only; none of its counts claim a provider
 * delivery, social-network post, or external health check.
 */
export function CreatorPortfolioOverview({
  personas,
  accounts,
  content,
  now,
  className,
}: {
  personas: CreatorPromotionPersona[];
  accounts: CreatorSocialAccount[];
  content: CreatorContentItem[];
  /** Workspace-read timestamp: the seven-day window is intentionally static until refresh. */
  now?: CreatorTimestamp;
  className?: string;
}) {
  const windowStart = toDate(now)?.getTime();
  const creatorById = new Map(personas.map((persona) => [persona.id, persona]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const calendarItems = windowStart === undefined
    ? []
    : content.filter((item) => inNextSevenDays(item, windowStart, windowStart + SEVEN_DAYS_MS));
  const pendingApprovals = content.reduce((total, item) => total + pendingApprovalRecords(item), 0);
  const blockers: PortfolioBlocker[] = [];

  const creatorsWithoutChannels = personas.filter((persona) => persona.stage === "active" && !accounts.some((account) => account.creatorId === persona.id));
  for (const persona of creatorsWithoutChannels) {
    blockers.push({ id: `creator-channel-${persona.id}`, tone: "amber", detail: `${persona.name} has no channel record.` });
  }

  const unassignedCalendarItems = calendarItems.filter((item) => !item.accountId || !accountById.has(item.accountId));
  if (unassignedCalendarItems.length) {
    blockers.push({
      id: "unassigned-calendar-items",
      tone: "onair",
      detail: `${unassignedCalendarItems.length} next-seven-day calendar ${unassignedCalendarItems.length === 1 ? "item has" : "items have"} no registered channel assignment.`,
    });
  }

  const rows = [...accounts]
    .sort((left, right) => {
      const leftCreator = creatorById.get(left.creatorId)?.name ?? "Unassigned creator";
      const rightCreator = creatorById.get(right.creatorId)?.name ?? "Unassigned creator";
      return leftCreator.localeCompare(rightCreator) || left.platform.localeCompare(right.platform) || left.handle.localeCompare(right.handle);
    })
    .map((account) => {
      const creator = creatorById.get(account.creatorId);
      const accountItems = calendarItems.filter((item) => item.accountId === account.id);
      const nextScheduledAt = accountItems
        .map((item) => toDate(item.scheduledAt)?.getTime())
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => left - right)[0];
      const accountPendingApprovals = content
        .filter((item) => item.accountId === account.id)
        .reduce((total, item) => total + pendingApprovalRecords(item), 0);
      const accountBlockers: PortfolioBlocker[] = [];

      if (!creator) accountBlockers.push({ id: `missing-creator-${account.id}`, tone: "onair", detail: "Channel is not attached to a visible creator profile." });
      if (account.status !== "connected" && (accountItems.length > 0 || account.status === "degraded")) accountBlockers.push({ id: `account-status-${account.id}`, tone: account.status === "degraded" ? "onair" : "amber", detail: `Channel is ${displayLabel(account.status).toLowerCase()}.` });
      if (account.publisher === "postiz" && accountItems.length > 0 && !account.integrationConnectionId) accountBlockers.push({ id: `postiz-map-${account.id}`, tone: "onair", detail: "Postiz channel mapping is missing." });
      if (account.publisher === "postiz" && accountItems.length > 0 && !account.capabilities?.includes("schedule_content")) accountBlockers.push({ id: `postiz-capability-${account.id}`, tone: "amber", detail: "Postiz schedule_content capability is not recorded." });

      const blockedItems = accountItems.filter(deliveryStateBlocked);
      if (blockedItems.length) accountBlockers.push({ id: `blocked-content-${account.id}`, tone: "onair", detail: `${blockedItems.length} calendar ${blockedItems.length === 1 ? "item is" : "items are"} blocked or failed.` });
      if (accountPendingApprovals) accountBlockers.push({ id: `pending-approval-${account.id}`, tone: "amber", detail: `${accountPendingApprovals} approval ${accountPendingApprovals === 1 ? "record awaits" : "records await"} a decision.` });
      blockers.push(...accountBlockers);

      return {
        account,
        creator,
        calendarLoad: accountItems.length,
        pendingApprovals: accountPendingApprovals,
        nextScheduledAt,
        blockers: accountBlockers,
      };
    });

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Creator portfolio overview">
      <SectionHeading
        eyebrow="Portfolio control"
        title="Creator portfolio overview"
        description={windowStart === undefined
          ? "All recorded channels and approval records are shown. Refresh the workspace to calculate its exact seven-day calendar window."
          : "All recorded channels, calendar load for the next seven 24-hour periods from this workspace read, pending approval records, and blockers visible in the current data."}
        action={<span className="border border-line-2 px-2 py-1 text-[9px] tracking-[0.14em] text-ink-faint">READ-ONLY SNAPSHOT</span>}
      />

      <div className="grid divide-y divide-line border-b border-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3 sm:px-5"><p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Channels</p><p className="mt-1 text-lg font-semibold text-ink">{accounts.length}</p></div>
        <div className="px-4 py-3 sm:px-5"><p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">7-day calendar load</p><p className="mt-1 text-lg font-semibold text-ink">{windowStart === undefined ? "—" : calendarItems.length}</p></div>
        <div className="px-4 py-3 sm:px-5"><p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Pending approval records</p><p className="mt-1 text-lg font-semibold text-amber">{pendingApprovals}</p></div>
        <div className="px-4 py-3 sm:px-5"><p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Operational blockers</p><p className={`mt-1 text-lg font-semibold ${blockers.length ? "text-onair" : "text-signal"}`}>{blockers.length}</p></div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No channel records yet" detail="The portfolio view will populate from registered social accounts; it does not create or infer channels." />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(220px,1.35fr)_minmax(150px,0.9fr)_110px_130px_minmax(220px,1.15fr)] gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase sm:px-5">
              <span>Creator / channel</span><span>Connection</span><span>7-day load</span><span>Approvals</span><span>Operations</span>
            </div>
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.account.id} className="grid grid-cols-[minmax(220px,1.35fr)_minmax(150px,0.9fr)_110px_130px_minmax(220px,1.15fr)] items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold text-ink">{row.creator?.name ?? "Unassigned creator"} <span className="font-normal text-ink-faint">· {displayLabel(row.account.platform)}</span></p>
                    <p className="mt-1 truncate text-[10px] text-ink-faint">{accountLabel(row.account)}{row.account.label ? ` · ${row.account.label}` : ""}</p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2"><AccountStatusPill status={row.account.status} />{row.account.publisher && <StatusPill label={displayLabel(row.account.publisher)} tone="muted" />}</div>
                  <div><p className="text-[11px] font-semibold text-ink">{row.calendarLoad} item{row.calendarLoad === 1 ? "" : "s"}</p>{row.nextScheduledAt && <p className="mt-1 text-[9px] text-ink-faint">Next {displayTime(row.nextScheduledAt)}</p>}</div>
                  <div>{row.pendingApprovals ? <StatusPill label={`${row.pendingApprovals} pending`} tone="amber" /> : <span className="text-[10px] text-ink-faint">None</span>}</div>
                  <div className="min-w-0">{row.blockers.length ? <span className={`text-[10px] leading-relaxed ${row.blockers.some((blocker) => blocker.tone === "onair") ? "text-onair" : "text-amber"}`}>{row.blockers[0].detail}{row.blockers.length > 1 ? ` +${row.blockers.length - 1} more` : ""}</span> : <span className="text-[10px] text-signal">No blocker derived</span>}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="border-t border-line px-4 py-3 sm:px-5">
        {blockers.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-signal">No operational blocker is derivable from this workspace read. Calendar entries remain plans until their separate controlled approval and provider handoff complete.</p>
        ) : (
          <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-[10px] leading-relaxed">
            <span className="font-semibold tracking-[0.12em] text-onair uppercase">Current blockers</span>
            {blockers.slice(0, 6).map((blocker) => <span key={blocker.id} className={blocker.tone === "onair" ? "text-onair" : "text-amber"}>{blocker.detail}</span>)}
            {blockers.length > 6 && <span className="text-ink-faint">+{blockers.length - 6} more in the account rows</span>}
          </div>
        )}
      </div>
    </section>
  );
}
