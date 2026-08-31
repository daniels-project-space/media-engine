"use client";

import { useState } from "react";
import {
  DEFAULT_FANVUE_READINESS_PROFILE_ID,
  FANVUE_READINESS_PROFILES,
  getFanvueReadinessProfile,
  type FanvueReadinessCapability,
  type FanvueReadinessProfileId,
} from "@/lib/creator-promotion/fanvue-oauth-readiness";
import type { FanvueDestination } from "./types";
import { ApprovalStatusPill, ComplianceStatusPill, DestinationStatusPill, EmptyState, SectionHeading, StatusPill, classNames, displayTime } from "./shared";

function AgeGatePill({ status }: { status: FanvueDestination["ageGateStatus"] }) {
  const tone = status === "confirmed" ? "signal" : status === "pending" ? "amber" : status === "blocked" ? "onair" : "muted";
  const label = status === "confirmed" ? "Age gate confirmed" : status === "pending" ? "Age gate pending" : status === "blocked" ? "Age gate blocked" : "Age gate not configured";
  return <StatusPill label={label} tone={tone} />;
}

export function FanvueDestinationPanel({
  destinations,
  selectedCreatorId,
  onRequestConnectionReview,
  className,
}: {
  destinations: FanvueDestination[];
  selectedCreatorId?: string;
  /** Records an intent only; it never begins OAuth or performs a provider action. */
  onRequestConnectionReview?: (capabilities: readonly FanvueReadinessCapability[]) => void;
  className?: string;
}) {
  const [profileId, setProfileId] = useState<FanvueReadinessProfileId>(DEFAULT_FANVUE_READINESS_PROFILE_ID);
  const visible = selectedCreatorId ? destinations.filter((destination) => destination.creatorId === selectedCreatorId) : destinations;
  const profile = getFanvueReadinessProfile(profileId);
  const oauthConnected = visible.some((destination) => destination.connectionStatus === "connected");
  const kycAndAgeGateConfirmed = visible.some((destination) => destination.ageGateStatus === "confirmed");
  const disclosedDestinationApproved = visible.some((destination) => destination.complianceStatus === "approved");
  const action = onRequestConnectionReview ? (
    <button type="button" onClick={() => onRequestConnectionReview(profile.requestedCapabilities)} className="border border-scope/55 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void">Record readiness intent</button>
  ) : undefined;

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Fanvue destinations">
      <SectionHeading
        eyebrow="Provider-ready funnel"
        title="Fanvue destinations"
        description="A governed destination record for Fanvue. This workspace does not create accounts, send messages, manage payments, or publish through the provider."
        action={action}
      />
      <div className="border-b border-line bg-panel-2/40 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Official OAuth readiness</p>
            <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-ink-dim">Choose the smallest purpose for the creator’s official Fanvue consent. This records a review request only—no OAuth window, credential, account creation, post, message, payment, or tracking link is created here.</p>
          </div>
          <label className="shrink-0 text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">
            Requested purpose
            <select value={profileId} onChange={(event) => setProfileId(event.target.value as FanvueReadinessProfileId)} className="mt-1.5 block w-full border border-line-2 bg-panel px-2 py-1.5 text-[10px] font-medium normal-case tracking-normal text-ink outline-none focus:border-scope">
              {Object.values(FANVUE_READINESS_PROFILES).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(200px,0.7fr)]">
          <div className="border-l border-scope/45 pl-3">
            <p className="text-[10px] font-semibold text-ink">{profile.description}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{profile.boundary}</p>
          </div>
          <div className="border-l border-line-2 pl-3">
            <p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Official scopes to configure</p>
            <p className="mt-1 break-words text-[10px] leading-relaxed text-scope">{profile.requestedScopes.join(" · ")}</p>
          </div>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="Fanvue destination readiness checklist">
          <ReadinessStep complete={kycAndAgeGateConfirmed} label="Creator KYC and age-gate evidence" />
          <ReadinessStep complete={oauthConnected} label="Official OAuth connection recorded" />
          <ReadinessStep complete={disclosedDestinationApproved} label="Disclosed destination reviewed" />
        </ol>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="No Fanvue destination record" detail="Create a reviewed destination record only after the creator, disclosure, age-gate, and provider connection requirements are understood." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((destination) => (
            <li key={destination.id} className="px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-7 place-items-center border border-line-2 bg-panel-2 text-[9px] font-bold text-ink-dim">FV</span>
                    <h3 className="text-xs font-semibold text-ink">{destination.label}</h3>
                    <DestinationStatusPill status={destination.connectionStatus} />
                  </div>
                  {destination.url ? <a href={destination.url} target="_blank" rel="noreferrer" className="mt-2 inline-block max-w-full truncate text-[10px] text-scope hover:underline">{destination.url} ↗</a> : <p className="mt-2 text-[10px] text-ink-faint">No public destination URL recorded.</p>}
                </div>
                {destination.lastReviewedAt && <p className="shrink-0 text-[9px] text-ink-faint">Reviewed {displayTime(destination.lastReviewedAt)}</p>}
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
                <AgeGatePill status={destination.ageGateStatus} />
                <ComplianceStatusPill status={destination.complianceStatus} />
                <ApprovalStatusPill status={destination.approvalStatus} />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Detail label="Disclosure" value={destination.disclosure} empty="No disclosure text recorded." />
                <Detail label="Operator notes" value={destination.notes} empty="No operational note recorded." />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line bg-panel-2/50 px-4 py-3 sm:px-5">
        <p className="text-[10px] leading-relaxed text-ink-faint">Connection status is an operator record, not a claim of live provider access. Keep public content, destination disclosures, age checks, and any consequential action separately reviewed.</p>
      </div>
    </section>
  );
}

function ReadinessStep({ complete, label }: { complete: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 border border-line bg-panel px-2.5 py-2 text-[10px] leading-snug text-ink-dim">
      <span aria-hidden="true" className={classNames("grid size-4 shrink-0 place-items-center border text-[9px] font-bold", complete ? "border-signal/55 bg-signal/10 text-signal" : "border-amber/55 bg-amber/10 text-amber")}>{complete ? "✓" : "·"}</span>
      <span>{label}</span>
    </li>
  );
}

function Detail({ label, value, empty }: { label: string; value?: string; empty: string }) {
  return (
    <div className="border-l border-line-2 pl-3">
      <p className="text-[9px] font-semibold tracking-[0.13em] text-ink-faint uppercase">{label}</p>
      <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-ink-dim">{value || <span className="text-ink-faint">{empty}</span>}</p>
    </div>
  );
}
