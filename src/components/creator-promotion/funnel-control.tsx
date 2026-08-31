"use client";

import type {
  CreatorFunnelCampaign,
  CreatorFunnelDestination,
  CreatorFunnelEvent,
  CreatorFunnelEventType,
  CreatorFunnelStatus,
} from "./types";
import { ApprovalStatusPill, ComplianceStatusPill, DestinationStatusPill, EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime } from "./shared";

type FunnelCallback = (funnel: CreatorFunnelCampaign) => void;

/**
 * Intent-only controls. Supplying a callback lets a parent open its governed
 * lifecycle flow; this component never calls a provider or performs a dispatch.
 */
export type CreatorFunnelControlPanelProps = {
  funnels: CreatorFunnelCampaign[];
  destinations: CreatorFunnelDestination[];
  events: CreatorFunnelEvent[];
  selectedCreatorId?: string;
  onCreate?: (creatorId: string) => void;
  onSubmit?: FunnelCallback;
  onApprove?: FunnelCallback;
  onActivate?: FunnelCallback;
  onPause?: FunnelCallback;
  busy?: boolean;
  className?: string;
};

type Tone = "signal" | "scope" | "amber" | "onair" | "muted";

const FUNNEL_STATUS_TONE: Record<CreatorFunnelStatus, Tone> = {
  draft: "muted",
  review_required: "amber",
  approved: "scope",
  active: "signal",
  paused: "onair",
  archived: "muted",
};

const EVENT_ORDER: CreatorFunnelEventType[] = [
  "link_click",
  "lead",
  "brand_inquiry",
  "signup",
  "subscription",
  "revenue_observed",
  "other",
];

function FunnelStatusPill({ status }: { status: CreatorFunnelStatus }) {
  const label = status === "review_required" ? "Review required" : displayLabel(status);
  return <StatusPill label={label} tone={FUNNEL_STATUS_TONE[status]} />;
}

function AgeGatePill({ required, evidenceRecorded }: { required: boolean; evidenceRecorded: boolean }) {
  if (!required) return <StatusPill label="Age gate not required" tone="muted" />;
  return <StatusPill label={evidenceRecorded ? "Age-gate evidence recorded" : "Age-gate evidence missing"} tone={evidenceRecorded ? "signal" : "onair"} />;
}

function DisclosurePill({ required, text }: { required: boolean; text?: string }) {
  if (!required) return <StatusPill label="Disclosure not required" tone="muted" />;
  return <StatusPill label={text ? "Disclosure recorded" : "Disclosure missing"} tone={text ? "signal" : "onair"} />;
}

function lifecycleTone(funnel: CreatorFunnelCampaign, phase: "draft" | "review" | "approved" | "active"): Tone {
  if (funnel.status === "archived" || funnel.status === "paused") return phase === "active" ? "onair" : "muted";
  const rank = { draft: 0, review_required: 1, approved: 2, active: 3 } as const;
  const phaseRank = { draft: 0, review: 1, approved: 2, active: 3 } as const;
  const current = rank[funnel.status as keyof typeof rank];
  if (current === undefined) return "muted";
  return current >= phaseRank[phase] ? (current === phaseRank[phase] ? "scope" : "signal") : "muted";
}

function ActionButton({ children, onClick, disabled, tone = "scope" }: { children: string; onClick: () => void; disabled?: boolean; tone?: "scope" | "signal" | "amber" | "onair" }) {
  const color = tone === "signal"
    ? "border-signal/55 text-signal hover:bg-signal hover:text-void"
    : tone === "amber"
      ? "border-amber/55 text-amber hover:bg-amber hover:text-void"
      : tone === "onair"
        ? "border-onair/55 text-onair hover:bg-onair hover:text-void"
        : "border-scope/55 text-scope hover:bg-scope hover:text-void";
  return <button type="button" onClick={onClick} disabled={disabled} className={`border px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] uppercase transition disabled:cursor-not-allowed disabled:opacity-45 ${color}`}>{children}</button>;
}

function EventAggregate({ funnel, events }: { funnel: CreatorFunnelCampaign; events: CreatorFunnelEvent[] }) {
  const scoped = events.filter((event) => event.funnelId === funnel.id && event.funnelVersion === funnel.version);
  const byType = new Map<CreatorFunnelEventType, number>();
  const revenueByCurrency = new Map<string, number>();
  for (const event of scoped) {
    byType.set(event.eventType, (byType.get(event.eventType) ?? 0) + event.count);
    if (event.revenueMinor !== undefined) {
      const currency = event.currency?.toUpperCase() || "UNSPECIFIED";
      revenueByCurrency.set(currency, (revenueByCurrency.get(currency) ?? 0) + event.revenueMinor);
    }
  }
  const total = Array.from(byType.values()).reduce((sum, count) => sum + count, 0);
  const lastObservedAt = scoped.reduce<CreatorFunnelEvent["occurredAt"] | undefined>((latest, event) => {
    if (latest === undefined) return event.occurredAt;
    return new Date(event.occurredAt).getTime() > new Date(latest).getTime() ? event.occurredAt : latest;
  }, undefined);

  return (
    <div className="border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Current version event ledger</p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">Manual aggregate observations only; no visitor, message, redirect, payment, or provider webhook data is represented.</p>
        </div>
        <p className="text-[10px] text-ink-faint">{scoped.length} records · {total} aggregate events</p>
      </div>
      {scoped.length === 0 ? (
        <p className="mt-3 border border-dashed border-line px-3 py-2 text-[10px] text-ink-faint">No aggregate events recorded for v{funnel.version}.</p>
      ) : (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {EVENT_ORDER.filter((type) => byType.has(type)).map((type) => (
              <div key={type} className="border border-line bg-panel-2/40 px-3 py-2">
                <p className="text-[9px] font-semibold tracking-[0.11em] text-ink-faint uppercase">{displayLabel(type)}</p>
                <p className="mt-1 text-sm font-semibold text-ink">{byType.get(type)?.toLocaleString("en-GB")}</p>
              </div>
            ))}
          </div>
          {revenueByCurrency.size > 0 && <p className="mt-3 text-[10px] text-ink-dim">Observed aggregate revenue: {Array.from(revenueByCurrency.entries()).map(([currency, minor]) => `${formatMinorCurrency(minor, currency)}`).join(" · ")}</p>}
          {lastObservedAt !== undefined && <p className="mt-1 text-[9px] text-ink-faint">Last manual observation {displayTime(lastObservedAt)}</p>}
        </>
      )}
    </div>
  );
}

function formatMinorCurrency(minor: number, currency: string): string {
  if (!/^[A-Z]{3}$/.test(currency)) return `${minor.toLocaleString("en-GB")} minor units (${currency.toLowerCase()})`;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 100);
  } catch {
    return `${minor.toLocaleString("en-GB")} minor units (${currency})`;
  }
}

function Lifecycle({ funnel }: { funnel: CreatorFunnelCampaign }) {
  const phases: Array<{ key: "draft" | "review" | "approved" | "active"; label: string; at?: string | number }> = [
    { key: "draft", label: "Draft", at: funnel.createdAt },
    { key: "review", label: "Review", at: funnel.reviewRequestedAt },
    { key: "approved", label: "Approval", at: funnel.approvedAt },
    { key: "active", label: funnel.status === "paused" ? "Paused" : "Activation", at: funnel.status === "paused" ? funnel.pausedAt : funnel.activatedAt },
  ];
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Funnel lifecycle">
      {phases.map((phase, index) => (
        <li key={phase.key} className="border border-line bg-panel-2/35 px-3 py-2">
          <div className="flex items-center justify-between gap-2"><StatusPill label={`${index + 1}. ${phase.label}`} tone={lifecycleTone(funnel, phase.key)} /><span className="text-[9px] text-ink-faint">{phase.at ? displayTime(phase.at, { dateStyle: "medium" }) : "—"}</span></div>
        </li>
      ))}
    </ol>
  );
}

function FunnelActions({ funnel, onSubmit, onApprove, onActivate, onPause, busy }: Pick<CreatorFunnelControlPanelProps, "onSubmit" | "onApprove" | "onActivate" | "onPause" | "busy"> & { funnel: CreatorFunnelCampaign }) {
  if (funnel.status === "draft" && onSubmit) return <ActionButton onClick={() => onSubmit(funnel)} disabled={busy} tone="amber">Submit review</ActionButton>;
  if (funnel.status === "review_required" && onApprove) return <ActionButton onClick={() => onApprove(funnel)} disabled={busy} tone="scope">Record approval</ActionButton>;
  if (funnel.status === "approved") return <div className="flex flex-wrap gap-2">{onActivate && <ActionButton onClick={() => onActivate(funnel)} disabled={busy} tone="signal">Activate</ActionButton>}{onPause && <ActionButton onClick={() => onPause(funnel)} disabled={busy} tone="onair">Pause</ActionButton>}</div>;
  if (funnel.status === "active" && onPause) return <ActionButton onClick={() => onPause(funnel)} disabled={busy} tone="onair">Pause</ActionButton>;
  return null;
}

function FunnelCard({ funnel, destinations, events, onSubmit, onApprove, onActivate, onPause, busy }: Pick<CreatorFunnelControlPanelProps, "destinations" | "events" | "onSubmit" | "onApprove" | "onActivate" | "onPause" | "busy"> & { funnel: CreatorFunnelCampaign }) {
  const destination = destinations.find((item) => item.id === funnel.destinationId);
  const destinationName = destination?.label || `Unresolved destination · ${funnel.linkPolicy.destinationHost}`;
  const destinationKind = destination?.provider === "fanvue" ? "Fanvue" : destination?.kind ? displayLabel(destination.kind) : "Destination record";
  return (
    <li className="px-4 py-5 sm:px-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold text-ink">{funnel.campaignLabel}</h3><FunnelStatusPill status={funnel.status} /><StatusPill label={`v${funnel.version}`} tone="muted" /></div>
          <p className="mt-2 text-[10px] text-ink-dim">{displayLabel(funnel.objective)} · {destinationKind} · {destinationName}</p>
        </div>
        <FunnelActions funnel={funnel} onSubmit={onSubmit} onApprove={onApprove} onActivate={onActivate} onPause={onPause} busy={busy} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
        {destination ? <DestinationStatusPill status={destination.connectionStatus} /> : <StatusPill label="Destination unresolved" tone="onair" />}
        {destination && <ComplianceStatusPill status={destination.complianceStatus} />}
        {destination && <ApprovalStatusPill status={destination.approvalStatus} />}
        {funnel.approvalStatus && <StatusPill label={`Funnel review ${displayLabel(funnel.approvalStatus)}`} tone={funnel.approvalStatus === "approved" ? "signal" : funnel.approvalStatus === "pending" ? "amber" : "onair"} />}
        <DisclosurePill required={funnel.compliance.disclosureRequired} text={funnel.compliance.disclosureText} />
        <AgeGatePill required={funnel.compliance.ageGateRequired} evidenceRecorded={funnel.compliance.ageGateEvidenceRecorded} />
      </div>

      <div className="mt-4"><Lifecycle funnel={funnel} /></div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="border border-line bg-panel-2/35 p-3">
          <p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Disclosure</p>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">{funnel.compliance.disclosureText || (funnel.compliance.disclosureRequired ? "Required disclosure text is missing; this funnel should not be activated." : "No disclosure is required by this campaign record.")}</p>
        </div>
        <div className="border border-line bg-panel-2/35 p-3">
          <p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Destination & link policy</p>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">{funnel.linkPolicy.destinationHost} · {funnel.linkPolicy.utmSource}/{funnel.linkPolicy.utmMedium}/{funnel.linkPolicy.utmCampaign}{funnel.linkPolicy.utmContentPrefix ? `/${funnel.linkPolicy.utmContentPrefix}` : ""}</p>
          <p className="mt-1 text-[9px] text-ink-faint">Only the governed host and naming policy are shown; this panel never creates a public link or redirect.</p>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Stage mapping & approved CTA copy</p>
        <ol className="mt-3 grid gap-2 lg:grid-cols-5">
          {funnel.stages.map((stage, index) => (
            <li key={stage.stage} className="border border-line bg-panel-2/25 p-3">
              <p className="text-[9px] font-semibold tracking-[0.11em] text-scope uppercase">{index + 1}. {displayLabel(stage.stage)}</p>
              <p className="mt-1 text-xs font-semibold text-ink">{stage.label}</p>
              <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">{stage.purpose}</p>
              <p className="mt-3 border-t border-line pt-2 text-[10px] leading-relaxed text-ink"><span className="font-semibold text-ink-faint">CTA · </span>{stage.ctaText}</p>
            </li>
          ))}
        </ol>
      </div>

      {funnel.pauseReason && <p className="mt-4 border-l border-onair/60 pl-3 text-[10px] leading-relaxed text-ink-dim"><span className="font-semibold text-onair">Pause reason · </span>{funnel.pauseReason}</p>}
      <div className="mt-4"><EventAggregate funnel={funnel} events={events} /></div>
    </li>
  );
}

/**
 * Presentational control surface for governed creator funnel campaigns.
 * All controls only notify the parent; they do not publish, message, generate
 * a link, create an account, process payments, or call a provider.
 */
export function CreatorFunnelControlPanel({ funnels, destinations, events, selectedCreatorId, onCreate, onSubmit, onApprove, onActivate, onPause, busy = false, className }: CreatorFunnelControlPanelProps) {
  const visible = selectedCreatorId ? funnels.filter((funnel) => funnel.creatorId === selectedCreatorId) : funnels;
  const action = selectedCreatorId && onCreate ? <ActionButton onClick={() => onCreate(selectedCreatorId)} disabled={busy}>Create draft</ActionButton> : undefined;
  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Creator funnel controls">
      <SectionHeading
        eyebrow="Governed conversion map"
        title="Funnel control"
        description="Lifecycle and stage rules for governed creator funnels. The panel is a control-plane view only: no provider dispatch, publishing, messaging, account creation, redirect, payment, or conversion action occurs here."
        action={action}
      />
      {visible.length === 0 ? (
        <EmptyState title="No funnel campaign recorded" detail="Create a controlled draft only after a truthful destination, stage plan, disclosure, age-gate requirement, and operator attestation have been established. This panel will not create any external resource." />
      ) : (
        <ul className="divide-y divide-line">{visible.map((funnel) => <FunnelCard key={funnel.id} funnel={funnel} destinations={destinations} events={events} onSubmit={onSubmit} onApprove={onApprove} onActivate={onActivate} onPause={onPause} busy={busy} />)}</ul>
      )}
      <div className="border-t border-line bg-panel-2/45 px-4 py-3 sm:px-5">
        <p className="text-[10px] leading-relaxed text-ink-faint">No-dispatch boundary: lifecycle buttons only invoke optional parent callbacks. Parent code must collect required approval and pause-reason inputs, enforce backend guards, and separately authorize any provider-side action.</p>
      </div>
    </section>
  );
}
