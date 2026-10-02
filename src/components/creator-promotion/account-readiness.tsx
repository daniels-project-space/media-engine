"use client";

import type { CreatorPromotionPersona, CreatorSocialAccount } from "./types";
import { AccountStatusPill, EmptyState, SectionHeading, classNames, displayLabel, displayTime } from "./shared";

export type CreatorAccountReadinessProviderHealth = {
  provider: "meta_instagram" | "fanvue" | "postiz";
  status: "ready" | "not_configured" | "misconfigured";
  canConnectAccounts: boolean;
  canDispatchApprovedActions: boolean;
  missing: readonly string[];
  invalid: readonly string[];
  notes: readonly string[];
};

export type CreatorAccountReadinessRendererHealth = {
  provider: "render_engine" | "novita" | "ltx" | "fal_z_image_turbo_lora";
  status: "ready" | "not_configured" | "misconfigured";
  canResolveServerCredentials: boolean;
  canResolveApprovedSourceAssets: boolean;
  canDispatchApprovedActions: boolean;
  missing: readonly string[];
  invalid: readonly string[];
  notes: readonly string[];
};

type ReadinessState = "ready" | "attention" | "blocked" | "not_applicable";
type ReadinessStep = { label: string; state: ReadinessState; detail: string; nextAction?: string };
type ProviderKey = CreatorAccountReadinessProviderHealth["provider"];

function providerForAccount(account: CreatorSocialAccount): ProviderKey | undefined {
  if (account.publisher === "postiz") return "postiz";
  if (account.publisher === "fanvue" || account.platform === "fanvue") return "fanvue";
  if (account.publisher === "meta") return "meta_instagram";
  return undefined;
}

function stateClass(state: ReadinessState): string {
  if (state === "ready") return "border-signal/40 bg-signal/[0.04] text-signal";
  if (state === "blocked") return "border-onair/45 bg-onair/[0.04] text-onair";
  if (state === "attention") return "border-amber/45 bg-amber/[0.04] text-amber";
  return "border-line-2 bg-panel-2 text-ink-faint";
}

function stateLabel(state: ReadinessState): string {
  if (state === "ready") return "Recorded";
  if (state === "blocked") return "Blocked";
  if (state === "attention") return "Needs action";
  return "Not applicable";
}

function accountHandle(account: CreatorSocialAccount): string {
  return account.handle.startsWith("@") ? account.handle : `@${account.handle}`;
}

function ownershipStep(account: CreatorSocialAccount): ReadinessStep {
  if (account.ownershipStatus === "attested_owned") return { label: "Ownership", state: "ready", detail: "Operator ownership attestation is recorded." };
  if (account.ownershipStatus === "client_authorized") return { label: "Ownership", state: "ready", detail: "Client authorization is recorded." };
  if (account.ownershipStatus === "legacy_unverified") return { label: "Ownership", state: "blocked", detail: "Historical record is not ownership-verified.", nextAction: "Re-attest ownership or record client authorization before using this channel." };
  return { label: "Ownership", state: "attention", detail: "No ownership or client-authorization state is recorded.", nextAction: "Record an ownership attestation or client authorization." };
}

function connectionStep(account: CreatorSocialAccount): ReadinessStep {
  const onboarding = account.onboarding;
  if (onboarding?.status === "ready" && account.status === "connected") {
    return { label: "Connection / onboarding", state: "ready", detail: `${displayLabel(onboarding.mode)} onboarding is recorded as ready; channel status is connected.` };
  }
  if (onboarding?.status === "blocked") {
    return { label: "Connection / onboarding", state: "blocked", detail: `${displayLabel(onboarding.mode)} onboarding is recorded as blocked.`, nextAction: "Resolve the recorded onboarding block before scheduling or publishing." };
  }
  if (onboarding?.status === "kyc_required") {
    return { label: "Connection / onboarding", state: "attention", detail: "Onboarding records a KYC requirement.", nextAction: "Complete the approved KYC workflow and record its result." };
  }
  if (onboarding?.status === "oauth_required") {
    return { label: "Connection / onboarding", state: "attention", detail: "Onboarding records an OAuth requirement.", nextAction: "Complete the provider’s official OAuth connection outside this browser flow, then refresh." };
  }
  if (onboarding?.status === "partner_approval_required") {
    return { label: "Connection / onboarding", state: "attention", detail: "Provider partner approval is still required.", nextAction: "Obtain the provider’s required partner approval and reconcile the account record." };
  }
  if (account.status === "connected") {
    return { label: "Connection / onboarding", state: "attention", detail: "Channel status is connected, but no safe onboarding completion record is available.", nextAction: "Reconcile the account’s onboarding metadata before relying on automated delivery." };
  }
  return { label: "Connection / onboarding", state: "attention", detail: `Channel status is ${displayLabel(account.status).toLowerCase()}.`, nextAction: "Complete the approved connection/onboarding step and refresh the workspace." };
}

function kycStep(account: CreatorSocialAccount): ReadinessStep {
  const applicable = account.platform === "fanvue" || account.manualKycStatus !== undefined && account.manualKycStatus !== "not_applicable" || account.onboarding?.status === "kyc_required";
  if (!applicable) return { label: "KYC", state: "not_applicable", detail: "No KYC requirement is recorded for this account." };
  if (account.manualKycStatus === "verified") return { label: "KYC", state: "ready", detail: "A verified KYC result is recorded." };
  if (account.manualKycStatus === "rejected") return { label: "KYC", state: "blocked", detail: "The recorded KYC result is rejected.", nextAction: "Resolve the KYC rejection before enabling any applicable provider workflow." };
  if (account.manualKycStatus === "pending") return { label: "KYC", state: "attention", detail: "KYC is pending in the account record.", nextAction: "Complete KYC through the applicable trusted provider workflow and record the outcome." };
  return { label: "KYC", state: "attention", detail: "KYC is required but no result is recorded.", nextAction: "Complete and record KYC before using the applicable workflow." };
}

function requiredCapability(account: CreatorSocialAccount, provider?: ProviderKey): { label: string; available: boolean; detail: string; nextAction?: string } | undefined {
  if (provider === "postiz") {
    const available = Boolean(account.capabilities?.includes("schedule_content"));
    return { label: "Schedule capability", available, detail: available ? "schedule_content is recorded for the linked Postiz channel." : "schedule_content is not recorded for the linked Postiz channel.", nextAction: "Map or reconcile the Postiz channel with schedule_content capability." };
  }
  if (provider === "meta_instagram") {
    const available = Boolean(account.capabilities?.includes("publish_feed") || account.capabilities?.includes("publish_reel"));
    return { label: "Publish capability", available, detail: available ? "At least one recorded Meta publishing capability is available; content format selects the exact requirement." : "Neither publish_feed nor publish_reel is recorded.", nextAction: "Record the official Meta publishing capability needed for the intended content format." };
  }
  return undefined;
}

function providerStep(account: CreatorSocialAccount, providerHealth?: CreatorAccountReadinessProviderHealth): ReadinessStep {
  const provider = providerForAccount(account);
  if (!provider) return { label: "Provider configuration", state: "not_applicable", detail: "No governed provider executor is recorded for this account." };
  if (!providerHealth) return { label: "Provider configuration", state: "attention", detail: "Provider configuration health was not supplied in this workspace read.", nextAction: "Refresh the workspace before relying on this provider." };
  if (providerHealth.status === "ready" && providerHealth.canDispatchApprovedActions) {
    return { label: "Provider configuration", state: "ready", detail: `${displayLabel(provider)} server configuration is ready for approved actions.` };
  }
  const cause = providerHealth.invalid[0] ?? providerHealth.missing[0] ?? "the explicit server-side dispatch gate";
  return { label: "Provider configuration", state: "blocked", detail: `${displayLabel(provider)} is ${displayLabel(providerHealth.status).toLowerCase()}: ${cause}.`, nextAction: `Repair the server-only ${displayLabel(provider)} configuration and explicit dispatch gate.` };
}

function rendererStep(rendererHealth: readonly CreatorAccountReadinessRendererHealth[]): ReadinessStep {
  const ready = rendererHealth.find((health) => health.status === "ready" && health.canResolveServerCredentials && health.canResolveApprovedSourceAssets && health.canDispatchApprovedActions);
  if (ready) return { label: "Renderer readiness", state: "ready", detail: `${displayLabel(ready.provider)} is configured for approved render dispatch.` };
  const known = rendererHealth[0];
  if (!known) return { label: "Renderer readiness", state: "attention", detail: "Renderer health was not supplied in this workspace read.", nextAction: "Refresh the workspace before dispatching a render job." };
  const cause = known.invalid[0] ?? known.missing[0] ?? "the approved renderer dispatch gate";
  return { label: "Renderer readiness", state: "blocked", detail: `No approved renderer is ready: ${cause}.`, nextAction: "Configure a server-only renderer before dispatching a render job." };
}

function deliveryStep(account: CreatorSocialAccount, provider?: ProviderKey): ReadinessStep {
  if (provider === "postiz") return { label: "Schedule eligibility", state: "not_applicable", detail: "Derived from the preceding checks; each item still needs a selected render, future time, separate approval, and explicit handoff." };
  if (provider === "meta_instagram") return { label: "Publish eligibility", state: "not_applicable", detail: "Derived from the preceding checks; each content item still needs its selected render and separate official approval." };
  if (provider === "fanvue") return { label: "Publish eligibility", state: "not_applicable", detail: "No generic Fanvue social-post executor is recorded for this account." };
  return { label: "Schedule / publish eligibility", state: "not_applicable", detail: "No governed scheduling or publishing executor is recorded; this remains a planning/account record." };
}

/**
 * Compact account-by-account readiness checklist. It reads only projected
 * records and server configuration health; it never starts OAuth, KYC, a
 * provider probe, account creation, or a delivery action.
 */
export function CreatorAccountReadinessPanel({
  personas,
  accounts,
  providerHealth,
  rendererHealth,
  className,
}: {
  personas: CreatorPromotionPersona[];
  accounts: CreatorSocialAccount[];
  providerHealth?: Partial<Record<ProviderKey, CreatorAccountReadinessProviderHealth>>;
  rendererHealth?: Partial<Record<CreatorAccountReadinessRendererHealth["provider"], CreatorAccountReadinessRendererHealth>>;
  className?: string;
}) {
  const creatorById = new Map(personas.map((persona) => [persona.id, persona]));
  const renderers = Object.values(rendererHealth ?? {}).filter((health): health is CreatorAccountReadinessRendererHealth => Boolean(health));
  const rows = [...accounts]
    .sort((left, right) => (creatorById.get(left.creatorId)?.name ?? "Unassigned creator").localeCompare(creatorById.get(right.creatorId)?.name ?? "Unassigned creator") || left.platform.localeCompare(right.platform))
    .map((account) => {
      const provider = providerForAccount(account);
      const capability = requiredCapability(account, provider);
      const steps: ReadinessStep[] = [
        ownershipStep(account),
        connectionStep(account),
        kycStep(account),
        providerStep(account, provider ? providerHealth?.[provider] : undefined),
        capability
          ? { label: capability.label, state: capability.available ? "ready" : "attention", detail: capability.detail, nextAction: capability.available ? undefined : capability.nextAction }
          : { label: "Required capability", state: "not_applicable", detail: "No universal automated capability is defined for this account’s recorded executor." },
        rendererStep(renderers),
        deliveryStep(account, provider),
      ];
      const next = steps.find((step) => step.state === "blocked") ?? steps.find((step) => step.state === "attention");
      return { account, creator: creatorById.get(account.creatorId), steps, next };
    });

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Account readiness">
      <SectionHeading
        eyebrow="Account control"
        title="Account readiness"
        description="A recorded readiness checklist for each creator channel. It shows account metadata and server configuration only; it does not assert a live provider, OAuth, KYC, renderer, schedule, or publication result."
        action={<span className="border border-line-2 px-2 py-1 text-[9px] tracking-[0.14em] text-ink-faint">{accounts.length} CHANNEL{accounts.length === 1 ? "" : "S"}</span>}
      />
      {rows.length === 0 ? (
        <EmptyState title="No account records" detail="Register a creator account record before its ownership, onboarding, capabilities, and readiness can be reviewed." />
      ) : (
        <div className="grid gap-px bg-line lg:grid-cols-2">
          {rows.map(({ account, creator, steps, next }) => (
            <article key={account.id} className="bg-panel p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold tracking-[0.12em] text-ink-faint uppercase">{creator?.name ?? "Unassigned creator"}</p>
                  <h3 className="mt-1 truncate text-sm font-semibold text-ink">{displayLabel(account.platform)} · {accountHandle(account)}</h3>
                  <p className="mt-1 text-[10px] text-ink-faint">Recorded health · account {account.health ?? "unknown"}{account.connectionHealth ? ` · connection ${account.connectionHealth}` : ""}{account.lastCheckedAt ? ` · checked ${displayTime(account.lastCheckedAt)}` : ""}</p>
                </div>
                <AccountStatusPill status={account.status} />
              </div>

              <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                {steps.map((step) => (
                  <li key={step.label} className={`border px-3 py-2 ${stateClass(step.state)}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-semibold tracking-[0.1em] uppercase">{step.label}</span><span className="text-[8px] font-semibold tracking-[0.1em] uppercase">{stateLabel(step.state)}</span></div>
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{step.detail}</p>
                  </li>
                ))}
              </ol>

              <div className={`mt-4 border-l px-3 py-2 text-[10px] leading-relaxed ${next?.state === "blocked" ? "border-onair text-onair" : next ? "border-amber text-amber" : "border-signal text-signal"}`}>
                <span className="font-semibold tracking-[0.1em] uppercase">Next operator action · </span>
                {next?.nextAction ?? "Account prerequisites are recorded. Select reviewed content and use its separate governed approval flow when appropriate."}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
