"use client";

import type { CreatorPromotionPersona, CreatorSocialAccount } from "./types";
import { AccountStatusPill, EmptyState, SectionHeading, classNames, displayLabel, displayTime } from "./shared";

function PersonaAvatar({ persona, selected }: { persona: CreatorPromotionPersona; selected: boolean }) {
  const initials = persona.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span className={classNames("grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border text-[11px] font-bold", selected ? "border-signal bg-signal/10 text-signal" : "border-line-2 bg-panel-2 text-ink-dim")}>
      {persona.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={persona.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        initials || "—"
      )}
    </span>
  );
}

export function PersonaRail({
  personas,
  accounts,
  selectedPersonaId,
  onSelectPersona,
  className,
}: {
  personas: CreatorPromotionPersona[];
  accounts: CreatorSocialAccount[];
  selectedPersonaId?: string;
  onSelectPersona?: (personaId: string) => void;
  className?: string;
}) {
  return (
    <aside className={classNames("border border-line bg-panel", className)} aria-label="Creator personas">
      <SectionHeading
        eyebrow="Creator roster"
        title="Personas"
        description="Identity, creative direction, and owned social-account records remain separate."
        action={<span className="border border-line-2 px-2 py-1 text-[9px] tracking-[0.14em] text-ink-faint">{personas.length} TOTAL</span>}
      />
      {personas.length === 0 ? (
        <EmptyState title="No creator personas yet" detail="Create a persona and its identity brief before scheduling content or connecting an owned account." />
      ) : (
        <ul className="divide-y divide-line">
          {personas.map((persona) => {
            const selected = persona.id === selectedPersonaId;
            const accountCount = accounts.filter((account) => account.creatorId === persona.id).length;
            const connectedCount = accounts.filter((account) => account.creatorId === persona.id && account.status === "connected").length;
            const body = (
              <>
                <PersonaAvatar persona={persona} selected={selected} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-ink">{persona.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-ink-faint">{persona.handle.startsWith("@") ? persona.handle : `@${persona.handle}`}</span>
                    </span>
                    <span className={classNames("size-2 shrink-0 rounded-full", persona.stage === "active" ? "bg-signal" : persona.stage === "paused" ? "bg-amber" : "bg-ink-faint")} aria-label={displayLabel(persona.stage)} />
                  </span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] tracking-wide text-ink-dim">
                    <span>{persona.archetype ?? "No archetype"}</span>
                    <span>{accountCount} account{accountCount === 1 ? "" : "s"}</span>
                    <span>{connectedCount} connected</span>
                  </span>
                </span>
              </>
            );

            return (
              <li key={persona.id}>
                {onSelectPersona ? (
                  <button
                    type="button"
                    onClick={() => onSelectPersona(persona.id)}
                    aria-pressed={selected}
                    className={classNames("flex w-full items-center gap-3 px-4 py-3 text-left transition sm:px-5", selected ? "bg-signal/[0.06]" : "hover:bg-panel-2")}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={classNames("flex items-center gap-3 px-4 py-3 sm:px-5", selected ? "bg-signal/[0.06]" : "")}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

export function AccountHealthPanel({
  accounts,
  selectedCreatorId,
  onSelectAccount,
  selectedAccountId,
  className,
}: {
  accounts: CreatorSocialAccount[];
  selectedCreatorId?: string;
  onSelectAccount?: (accountId: string) => void;
  selectedAccountId?: string;
  className?: string;
}) {
  const visible = selectedCreatorId ? accounts.filter((account) => account.creatorId === selectedCreatorId) : accounts;

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Account control plane">
      <SectionHeading
        eyebrow="Account control plane"
        title="Owned account health"
        description="Connection records, publishing limits, and approved capabilities—not device or credential controls."
        action={<span className="border border-line-2 px-2 py-1 text-[9px] tracking-[0.14em] text-ink-faint">{visible.length} RECORDS</span>}
      />
      {visible.length === 0 ? (
        <EmptyState title="No account records" detail="A social-account record is needed before a content item can be assigned to a publishing destination." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((account) => {
            const selected = account.id === selectedAccountId;
            const body = (
              <>
                <span className="grid size-8 shrink-0 place-items-center border border-line-2 bg-panel-2 text-[9px] font-bold text-ink-dim">{account.platform.slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[11px] font-semibold text-ink">{account.label ?? displayLabel(account.platform)}</span>
                    <AccountStatusPill status={account.status} />
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-ink-faint">{account.handle.startsWith("@") ? account.handle : `@${account.handle}`}</span>
                  <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] leading-relaxed text-ink-dim">
                    <span>{account.policy?.dailyCap ? `${account.policy.dailyCap}/day cap` : "No daily cap recorded"}</span>
                    <span>{account.policy?.approvalRequired === false ? "Policy does not require approval" : "Approval required"}</span>
                    {account.policy?.quietHours && <span>Quiet: {account.policy.quietHours}</span>}
                  </span>
                  {account.nextScheduledAt && <span className="mt-1 block text-[9px] text-scope">Next scheduled: {displayTime(account.nextScheduledAt)}</span>}
                </span>
              </>
            );
            return (
              <li key={account.id}>
                {onSelectAccount ? (
                  <button type="button" onClick={() => onSelectAccount(account.id)} aria-pressed={selected} className={classNames("flex w-full items-start gap-3 px-4 py-3 text-left transition sm:px-5", selected ? "bg-scope/[0.06]" : "hover:bg-panel-2")}>
                    {body}
                  </button>
                ) : (
                  <div className={classNames("flex items-start gap-3 px-4 py-3 sm:px-5", selected ? "bg-scope/[0.06]" : "")}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
