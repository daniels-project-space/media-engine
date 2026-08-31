"use client";

import type { ReactNode } from "react";
import type {
  CreatorAccountStatus,
  CreatorApprovalStatus,
  CreatorComplianceStatus,
  CreatorContentFormat,
  CreatorContentStatus,
  CreatorDestinationStatus,
  CreatorInboxStatus,
  CreatorTimestamp,
} from "./types";

type Tone = "signal" | "scope" | "amber" | "onair" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  signal: "border-signal/50 bg-signal/5 text-signal",
  scope: "border-scope/50 bg-scope/5 text-scope",
  amber: "border-amber/50 bg-amber/5 text-amber",
  onair: "border-onair/55 bg-onair/5 text-onair",
  muted: "border-line-2 bg-panel-2 text-ink-faint",
};

const ACCOUNT_TONE: Record<CreatorAccountStatus, Tone> = {
  connected: "signal",
  pending: "amber",
  degraded: "onair",
  paused: "muted",
  unlinked: "muted",
};

const CONTENT_TONE: Record<CreatorContentStatus, Tone> = {
  approved: "signal",
  published: "signal",
  scheduled: "scope",
  ready_for_review: "amber",
  planned: "amber",
  idea: "muted",
  blocked: "onair",
};

const APPROVAL_TONE: Record<CreatorApprovalStatus, Tone> = {
  approved: "signal",
  not_required: "scope",
  pending: "amber",
  not_requested: "muted",
  rejected: "onair",
};

const DESTINATION_TONE: Record<CreatorDestinationStatus, Tone> = {
  connected: "signal",
  connection_review: "amber",
  not_connected: "muted",
  unavailable: "onair",
};

const COMPLIANCE_TONE: Record<CreatorComplianceStatus, Tone> = {
  approved: "signal",
  review_required: "amber",
  not_reviewed: "muted",
  blocked: "onair",
};

const INBOX_TONE: Record<CreatorInboxStatus, Tone> = {
  closed: "muted",
  draft_ready: "amber",
  handoff_required: "onair",
  new: "scope",
};

const FORMAT_TONE: Record<CreatorContentFormat, Tone> = {
  feed: "scope",
  reel: "signal",
  story: "amber",
  carousel: "scope",
};

function sentence(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function displayLabel(value: string): string {
  return sentence(value);
}

export function StatusPill({ label, tone = "muted", className = "" }: { label: string; tone?: Tone; className?: string }) {
  return <span className={`inline-flex max-w-full items-center border px-2 py-1 text-[9px] font-semibold tracking-[0.12em] uppercase ${TONE_CLASS[tone]} ${className}`}>{label}</span>;
}

export function AccountStatusPill({ status }: { status: CreatorAccountStatus }) {
  return <StatusPill label={displayLabel(status)} tone={ACCOUNT_TONE[status]} />;
}

export function ContentStatusPill({ status }: { status: CreatorContentStatus }) {
  return <StatusPill label={displayLabel(status)} tone={CONTENT_TONE[status]} />;
}

export function ApprovalStatusPill({ status }: { status: CreatorApprovalStatus }) {
  return <StatusPill label={status === "not_required" ? "No approval needed" : displayLabel(status)} tone={APPROVAL_TONE[status]} />;
}

export function DestinationStatusPill({ status }: { status: CreatorDestinationStatus }) {
  return <StatusPill label={displayLabel(status)} tone={DESTINATION_TONE[status]} />;
}

export function ComplianceStatusPill({ status }: { status: CreatorComplianceStatus }) {
  return <StatusPill label={displayLabel(status)} tone={COMPLIANCE_TONE[status]} />;
}

export function InboxStatusPill({ status }: { status: CreatorInboxStatus }) {
  return <StatusPill label={displayLabel(status)} tone={INBOX_TONE[status]} />;
}

export function FormatPill({ format }: { format: CreatorContentFormat }) {
  return <StatusPill label={format} tone={FORMAT_TONE[format]} />;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[9px] font-semibold tracking-[0.16em] text-signal uppercase">{eyebrow}</p>}
        <h2 className="display text-xl font-bold tracking-tight text-ink">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-ink-faint">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-28 flex-col items-start justify-center gap-3 px-4 py-5 sm:px-5">
      <div>
        <p className="text-xs font-semibold text-ink-dim">{title}</p>
        <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-ink-faint">{detail}</p>
      </div>
      {action}
    </div>
  );
}

export function displayTime(value?: CreatorTimestamp, options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }): string {
  if (value === undefined || value === null) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid timestamp";
  return new Intl.DateTimeFormat("en-GB", options).format(date);
}

export function toDate(value?: CreatorTimestamp): Date | null {
  if (value === undefined || value === null) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calendarDayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
