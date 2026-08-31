"use client";

import { useMemo, useState } from "react";
import type { CreatorCalendarState, CreatorContentFormat, CreatorContentItem, CreatorSocialAccount } from "./types";
import { ApprovalStatusPill, ContentStatusPill, EmptyState, FormatPill, SectionHeading, classNames, displayTime, toDate } from "./shared";

const CONTENT_FORMATS: CreatorContentFormat[] = ["reel", "feed", "carousel", "story"];

type CalendarDateParts = { year: number; month: number; day: number };

type QuietHours = { start: number; end: number };

type CalendarWarning = {
  id: string;
  tone: "amber" | "onair";
  title: string;
  detail: string;
};

export type CreatorWeekCalendarProps = {
  content: CreatorContentItem[];
  accounts: CreatorSocialAccount[];
  /** IANA timezone used to group dates and display scheduled times. */
  timezone?: string;
  /** A controlled week when paired with `onWeekStartsOnChange`; otherwise it is the initial week. */
  weekStartsOn?: Date;
  selectedContentId?: string;
  /** Optional controlled day selection in the calendar timezone. */
  selectedCalendarDay?: Date;
  onSelectContent?: (contentId: string) => void;
  onSelectCalendarDay?: (day: Date) => void;
  onWeekStartsOnChange?: (weekStartsOn: Date) => void;
  onCalendarStateChange?: (state: CreatorCalendarState) => void;
  className?: string;
};

function resolveTimezone(value?: string): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const candidate = value?.trim() || fallback;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "UTC";
  }
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  return Number(value ?? 0);
}

function calendarDateParts(value: Date, timezone: string): CalendarDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
  };
}

function timezoneOffsetMilliseconds(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const localAsUtc = Date.UTC(
    numberPart(parts, "year"),
    numberPart(parts, "month") - 1,
    numberPart(parts, "day"),
    numberPart(parts, "hour"),
    numberPart(parts, "minute"),
    numberPart(parts, "second"),
  );
  return localAsUtc - value.getTime();
}

/**
 * Keeps navigation dates on local noon so they remain the intended calendar
 * date over DST shifts and at the outer IANA timezone offsets.
 */
function calendarDateAtNoon(parts: CalendarDateParts, timezone: string): Date {
  const localNoon = Date.UTC(parts.year, parts.month - 1, parts.day, 12);
  let instant = localNoon - timezoneOffsetMilliseconds(new Date(localNoon), timezone);
  const corrected = localNoon - timezoneOffsetMilliseconds(new Date(instant), timezone);
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}

function calendarDayKey(value: Date, timezone: string): string {
  const parts = calendarDateParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addCalendarDays(value: Date, days: number, timezone: string): Date {
  const parts = calendarDateParts(value, timezone);
  const arithmetic = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12));
  return calendarDateAtNoon({
    year: arithmetic.getUTCFullYear(),
    month: arithmetic.getUTCMonth() + 1,
    day: arithmetic.getUTCDate(),
  }, timezone);
}

function mondayFor(value: Date, timezone: string): Date {
  const date = Number.isNaN(value.getTime()) ? new Date() : value;
  const parts = calendarDateParts(date, timezone);
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12)).getUTCDay();
  return addCalendarDays(calendarDateAtNoon(parts, timezone), -((weekday + 6) % 7), timezone);
}

function formatDate(value: Date, timezone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone }).format(value);
}

function dayLabel(value: Date, timezone: string): { weekday: string; date: string } {
  return {
    weekday: formatDate(value, timezone, { weekday: "short" }),
    date: formatDate(value, timezone, { day: "numeric", month: "short" }),
  };
}

function formatHour(value: CreatorContentItem["scheduledAt"], timezone: string): string {
  if (!value) return "Unscheduled";
  const date = toDate(value);
  return date ? formatDate(date, timezone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "Invalid time";
}

function accountHandle(account: CreatorSocialAccount): string {
  return account.handle.startsWith("@") ? account.handle : `@${account.handle}`;
}

function AccountLabel({ content, accounts }: { content: CreatorContentItem; accounts: CreatorSocialAccount[] }) {
  const account = content.accountId ? accounts.find((candidate) => candidate.id === content.accountId) : undefined;
  if (!account) return <span className="text-[9px] text-ink-faint">No account assigned</span>;
  return <span className="truncate text-[9px] text-ink-dim">{account.platform === "instagram" ? "IG" : account.platform.toUpperCase()} · {accountHandle(account)}</span>;
}

function CalendarItem({
  content,
  accounts,
  selected,
  timezone,
  onSelect,
}: {
  content: CreatorContentItem;
  accounts: CreatorSocialAccount[];
  selected: boolean;
  timezone: string;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] font-semibold leading-relaxed text-ink">{content.title}</span>
        <span className="shrink-0 text-[9px] text-scope">{formatHour(content.scheduledAt, timezone)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <FormatPill format={content.format} />
        <ContentStatusPill status={content.status} />
      </div>
      <div className="mt-2"><AccountLabel content={content} accounts={accounts} /></div>
      {content.approvalStatus && <div className="mt-2"><ApprovalStatusPill status={content.approvalStatus} /></div>}
    </>
  );

  if (!onSelect) return <div className={classNames("border p-2.5", selected ? "border-scope/55 bg-scope/[0.07]" : "border-line-2 bg-panel-2")}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={classNames("w-full border p-2.5 text-left transition", selected ? "border-scope/55 bg-scope/[0.07]" : "border-line-2 bg-panel-2 hover:border-scope/45")}
    >
      {body}
    </button>
  );
}

function parseQuietHours(value?: string): QuietHours | null {
  const match = value?.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*$/i);
  if (!match) return null;
  const start = Number(match[1]) * 60 + Number(match[2] ?? 0);
  const end = Number(match[3]) * 60 + Number(match[4] ?? 0);
  if (start >= 24 * 60 || end >= 24 * 60) return null;
  return { start, end };
}

function isInsideQuietHours(value: Date, timezone: string, quietHours: QuietHours): boolean {
  if (quietHours.start === quietHours.end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const minute = numberPart(parts, "hour") * 60 + numberPart(parts, "minute");
  return quietHours.start < quietHours.end
    ? minute >= quietHours.start && minute < quietHours.end
    : minute >= quietHours.start || minute < quietHours.end;
}

function wholeNumber(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function buildCalendarWarnings({
  scheduled,
  accounts,
  days,
  timezone,
}: {
  scheduled: CreatorContentItem[];
  accounts: CreatorSocialAccount[];
  days: Date[];
  timezone: string;
}): CalendarWarning[] {
  const warnings: CalendarWarning[] = [];
  const dayKeys = days.map((day) => calendarDayKey(day, timezone));

  for (const account of accounts) {
    const policy = account.policy;
    if (!policy) continue;
    const accountItems = scheduled.filter((item) => item.accountId === account.id && item.status !== "blocked");
    const label = accountHandle(account);
    const dailyCap = wholeNumber(policy.dailyCap);

    if (dailyCap !== undefined) {
      for (const dayKey of dayKeys) {
        const count = accountItems.filter((item) => {
          const scheduledAt = toDate(item.scheduledAt);
          return Boolean(scheduledAt && calendarDayKey(scheduledAt, timezone) === dayKey);
        }).length;
        if (count > dailyCap) {
          warnings.push({
            id: `cap-${account.id}-${dayKey}`,
            tone: "onair",
            title: `${label} exceeds its daily cap`,
            detail: `${count} items are set for ${dayKey}; the recorded limit is ${dailyCap}.`,
          });
        }
      }
    }

    const quietHours = parseQuietHours(policy.quietHours);
    if (quietHours) {
      const quietItems = accountItems.filter((item) => {
        const scheduledAt = toDate(item.scheduledAt);
        return Boolean(scheduledAt && isInsideQuietHours(scheduledAt, timezone, quietHours));
      });
      if (quietItems.length > 0) {
        warnings.push({
          id: `quiet-${account.id}`,
          tone: "amber",
          title: `${label} has a quiet-hours conflict`,
          detail: `${quietItems.length} scheduled ${quietItems.length === 1 ? "item falls" : "items fall"} inside ${policy.quietHours}.`,
        });
      }
    }

    if (policy.approvalRequired !== false) {
      const unapproved = accountItems.filter((item) => item.status !== "published" && item.approvalStatus !== "approved" && item.approvalStatus !== "not_required");
      if (unapproved.length > 0) {
        warnings.push({
          id: `approval-${account.id}`,
          tone: "amber",
          title: `${label} needs approval before dispatch`,
          detail: `${unapproved.length} scheduled ${unapproved.length === 1 ? "item is" : "items are"} not approved.`,
        });
      }
    }

    const weeklyTarget = wholeNumber(policy.weeklyTarget);
    if (weeklyTarget !== undefined && accountItems.length < weeklyTarget) {
      warnings.push({
        id: `cadence-${account.id}`,
        tone: "amber",
        title: `${label} is below its weekly cadence`,
        detail: `${accountItems.length} of ${weeklyTarget} planned posts are in this week.`,
      });
    }

    const maxGapDays = wholeNumber(policy.maxGapDays);
    if (maxGapDays !== undefined) {
      let gapStart: number | undefined;
      for (let index = 0; index <= days.length; index += 1) {
        const hasPost = index < days.length && accountItems.some((item) => {
          const scheduledAt = toDate(item.scheduledAt);
          return Boolean(scheduledAt && calendarDayKey(scheduledAt, timezone) === dayKeys[index]);
        });
        if (!hasPost && gapStart === undefined) gapStart = index;
        if ((hasPost || index === days.length) && gapStart !== undefined) {
          const gapLength = index - gapStart;
          if (gapLength > maxGapDays) {
            const first = formatDate(days[gapStart], timezone, { day: "numeric", month: "short" });
            const last = formatDate(days[index - 1], timezone, { day: "numeric", month: "short" });
            warnings.push({
              id: `gap-${account.id}-${gapStart}-${index}`,
              tone: "amber",
              title: `${label} has an open cadence gap`,
              detail: `${gapLength} consecutive days (${first}–${last}) have no scheduled post; policy permits ${maxGapDays}.`,
            });
          }
          gapStart = undefined;
        }
      }
    }

    for (const format of CONTENT_FORMATS) {
      const target = wholeNumber(policy.formatTargets?.[format]);
      if (target === undefined) continue;
      const count = accountItems.filter((item) => item.format === format).length;
      if (count < target) {
        warnings.push({
          id: `mix-${account.id}-${format}`,
          tone: "amber",
          title: `${label} is below its ${format} mix`,
          detail: `${count} of ${target} ${format}${target === 1 ? "" : "s"} are in this week's queue.`,
        });
      }
    }
  }

  return warnings;
}

function rangeLabel(start: Date, end: Date, timezone: string): string {
  const sameYear = calendarDateParts(start, timezone).year === calendarDateParts(end, timezone).year;
  const startLabel = formatDate(start, timezone, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  const endLabel = formatDate(end, timezone, { day: "numeric", month: "short", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

export function CreatorWeekCalendar({
  content,
  accounts,
  timezone: timezoneProp,
  weekStartsOn,
  selectedContentId,
  selectedCalendarDay,
  onSelectContent,
  onSelectCalendarDay,
  onWeekStartsOnChange,
  onCalendarStateChange,
  className,
}: CreatorWeekCalendarProps) {
  const timezone = resolveTimezone(timezoneProp);
  const [internalWeekStartsOn, setInternalWeekStartsOn] = useState(() => mondayFor(weekStartsOn ?? new Date(), timezone));
  const [internalSelectedDay, setInternalSelectedDay] = useState<Date | undefined>(() => selectedCalendarDay ? calendarDateAtNoon(calendarDateParts(selectedCalendarDay, timezone), timezone) : undefined);
  const isWeekControlled = weekStartsOn !== undefined && onWeekStartsOnChange !== undefined;
  const isDayControlled = selectedCalendarDay !== undefined && onSelectCalendarDay !== undefined;

  const start = isWeekControlled && weekStartsOn ? mondayFor(weekStartsOn, timezone) : mondayFor(internalWeekStartsOn, timezone);
  const selectedDay = isDayControlled && selectedCalendarDay
    ? calendarDateAtNoon(calendarDateParts(selectedCalendarDay, timezone), timezone)
    : internalSelectedDay ? calendarDateAtNoon(calendarDateParts(internalSelectedDay, timezone), timezone) : undefined;
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index, timezone)), [start, timezone]);
  const end = days[6];
  const dayKeys = useMemo(() => new Set(days.map((day) => calendarDayKey(day, timezone))), [days, timezone]);
  const scheduled = useMemo(() => content
    .filter((item) => {
      const scheduledAt = toDate(item.scheduledAt);
      return Boolean(scheduledAt && dayKeys.has(calendarDayKey(scheduledAt, timezone)));
    })
    .sort((left, right) => (toDate(left.scheduledAt)?.getTime() ?? 0) - (toDate(right.scheduledAt)?.getTime() ?? 0)), [content, dayKeys, timezone]);
  const unscheduled = content.filter((item) => !item.scheduledAt && item.status !== "published");
  const scheduledByDay = useMemo(() => {
    const entries = new Map<string, CreatorContentItem[]>();
    for (const item of scheduled) {
      const scheduledAt = toDate(item.scheduledAt);
      if (!scheduledAt) continue;
      const key = calendarDayKey(scheduledAt, timezone);
      entries.set(key, [...(entries.get(key) ?? []), item]);
    }
    return entries;
  }, [scheduled, timezone]);
  const warnings = useMemo(() => buildCalendarWarnings({ scheduled, accounts, days, timezone }), [accounts, days, scheduled, timezone]);
  const contentMix = useMemo(() => CONTENT_FORMATS.map((format) => ({
    format,
    count: scheduled.filter((item) => item.format === format).length,
    target: accounts.reduce((total, account) => total + (wholeNumber(account.policy?.formatTargets?.[format]) ?? 0), 0),
  })), [accounts, scheduled]);
  const weeklyTarget = accounts.reduce((total, account) => total + (wholeNumber(account.policy?.weeklyTarget) ?? 0), 0);
  const selectedDayKey = selectedDay ? calendarDayKey(selectedDay, timezone) : undefined;
  const todayKey = calendarDayKey(new Date(), timezone);

  function reportState(nextWeek: Date, nextDay = selectedDay, nextContentId = selectedContentId) {
    onCalendarStateChange?.({ weekStartsOn: nextWeek, timezone, selectedDay: nextDay, selectedContentId: nextContentId });
  }

  function changeWeek(nextWeek: Date) {
    const normalized = mondayFor(nextWeek, timezone);
    if (!isWeekControlled) setInternalWeekStartsOn(normalized);
    onWeekStartsOnChange?.(normalized);
    reportState(normalized);
  }

  function selectDay(day: Date, nextContentId = selectedContentId) {
    const normalized = calendarDateAtNoon(calendarDateParts(day, timezone), timezone);
    if (!isDayControlled) setInternalSelectedDay(normalized);
    onSelectCalendarDay?.(normalized);
    reportState(start, normalized, nextContentId);
  }

  function selectContent(item: CreatorContentItem) {
    onSelectContent?.(item.id);
    const scheduledAt = toDate(item.scheduledAt);
    if (scheduledAt) selectDay(scheduledAt, item.id);
    else reportState(start, selectedDay, item.id);
  }

  const hasCalendarContent = scheduled.length > 0 || unscheduled.length > 0;
  const hasRecordedCalendarPolicy = accounts.some((account) => {
    const policy = account.policy;
    return Boolean(policy && (
      policy.dailyCap !== undefined
      || policy.approvalRequired !== undefined
      || policy.quietHours
      || policy.weeklyTarget !== undefined
      || policy.maxGapDays !== undefined
      || Object.keys(policy.formatTargets ?? {}).length > 0
    ));
  });
  const hasOperatingSchedule = hasCalendarContent || hasRecordedCalendarPolicy;

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Weekly publishing schedule">
      <SectionHeading
        eyebrow="Publishing outbox"
        title="Week schedule"
        description="Times, days, and policy checks are shown in the selected calendar timezone. A queue entry is not a publication until its provider connection and approval are valid."
        action={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="max-w-[150px] truncate border border-line-2 px-2 py-1 text-[9px] tracking-[0.1em] text-ink-faint" title={`Calendar timezone: ${timezone}`}>{timezone}</span>
            <button type="button" onClick={() => changeWeek(addCalendarDays(start, -7, timezone))} className="border border-line-2 px-2 py-1 text-[9px] font-semibold tracking-[0.1em] text-ink-dim transition hover:border-scope/45 hover:text-ink" aria-label="Show previous week">Prev</button>
            <button type="button" onClick={() => changeWeek(mondayFor(new Date(), timezone))} className="border border-line-2 px-2 py-1 text-[9px] font-semibold tracking-[0.1em] text-ink-dim transition hover:border-scope/45 hover:text-ink">Today</button>
            <button type="button" onClick={() => changeWeek(addCalendarDays(start, 7, timezone))} className="border border-line-2 px-2 py-1 text-[9px] font-semibold tracking-[0.1em] text-ink-dim transition hover:border-scope/45 hover:text-ink" aria-label="Show next week">Next</button>
            <span className="border border-scope/30 bg-scope/[0.05] px-2 py-1 text-[9px] tracking-[0.1em] text-scope">{rangeLabel(start, end, timezone)}</span>
          </div>
        }
      />
      {hasOperatingSchedule && (
        <div className="grid gap-px border-b border-line bg-line sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="bg-panel px-4 py-3 sm:px-5">
            <p className="text-[9px] font-semibold tracking-[0.14em] text-signal uppercase">Cadence & content mix</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="border border-line-2 bg-panel-2 px-2 py-1 text-[10px] text-ink-dim"><strong className="text-ink">{scheduled.length}</strong> scheduled{weeklyTarget > 0 ? ` / ${weeklyTarget} target` : ""}</span>
              {contentMix.map((entry) => entry.count > 0 || entry.target > 0 ? <span key={entry.format} className="border border-line-2 bg-panel-2 px-2 py-1 text-[10px] text-ink-dim"><strong className="text-ink">{entry.count}</strong> {entry.format}{entry.target > 0 ? ` / ${entry.target}` : ""}</span> : null)}
              {unscheduled.length > 0 && <span className="border border-amber/35 bg-amber/[0.05] px-2 py-1 text-[10px] text-amber">{unscheduled.length} unscheduled</span>}
            </div>
          </div>
          <div className="bg-panel px-4 py-3 sm:px-5">
            <p className="text-[9px] font-semibold tracking-[0.14em] text-signal uppercase">Schedule checks</p>
            {warnings.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {warnings.slice(0, 3).map((warning) => <li key={warning.id} className={classNames("text-[10px] leading-relaxed", warning.tone === "onair" ? "text-onair" : "text-amber")}><span className="font-semibold">{warning.title}:</span> {warning.detail}</li>)}
                {warnings.length > 3 && <li className="text-[10px] text-ink-faint">+{warnings.length - 3} more policy checks need attention.</li>}
              </ul>
            ) : <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">No conflicts in the supplied account policies for this week.</p>}
          </div>
        </div>
      )}
      {!hasOperatingSchedule ? (
        <EmptyState title="No content in this schedule" detail="Planned posts will appear here only when the workspace receives real schedule records." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="grid min-w-[760px] grid-cols-7 divide-x divide-line">
              {days.map((day) => {
                const key = calendarDayKey(day, timezone);
                const label = dayLabel(day, timezone);
                const items = scheduledByDay.get(key) ?? [];
                const isToday = key === todayKey;
                const isSelected = key === selectedDayKey;
                return (
                  <section key={key} className="min-h-64 bg-panel">
                    <header className={classNames("border-b border-line", isToday && "bg-signal/[0.04]", isSelected && "bg-scope/[0.08]")}>
                      <button type="button" onClick={() => selectDay(day)} aria-pressed={isSelected} className="w-full px-3 py-3 text-left transition hover:bg-scope/[0.05]">
                        <p className={classNames("text-[9px] font-semibold tracking-[0.13em] uppercase", isToday ? "text-signal" : "text-ink-faint")}>{label.weekday}</p>
                        <p className="mt-1 text-[11px] font-semibold text-ink">{label.date}</p>
                      </button>
                    </header>
                    <div className="space-y-2 p-2">
                      {items.length ? items.map((item) => <CalendarItem key={item.id} content={item} accounts={accounts} selected={item.id === selectedContentId} timezone={timezone} onSelect={onSelectContent ? () => selectContent(item) : undefined} />) : <p className="px-1 py-2 text-[9px] leading-relaxed text-ink-faint">No scheduled posts</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
          {unscheduled.length > 0 && (
            <div className="border-t border-line px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold tracking-[0.14em] text-amber uppercase">Unscheduled queue</p>
                  <p className="mt-1 text-[10px] text-ink-faint">These planned items have no publishing time. They cannot be dispatched from this view.</p>
                </div>
                <span className="text-[10px] text-ink-dim">{unscheduled.length} waiting</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {unscheduled.map((item) => <CalendarItem key={item.id} content={item} accounts={accounts} selected={item.id === selectedContentId} timezone={timezone} onSelect={onSelectContent ? () => selectContent(item) : undefined} />)}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ScheduleTimestamp({ value, timezone }: { value?: CreatorContentItem["scheduledAt"]; timezone?: string }) {
  return <>{value ? displayTime(value, { dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: resolveTimezone(timezone) } : {}) }) : "Not scheduled"}</>;
}
