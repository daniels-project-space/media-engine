"use client";

import type { ReactNode } from "react";
import { AccountHealthPanel, PersonaRail } from "./persona-rail";
import { CreatorWeekCalendar } from "./week-calendar";
import { CreatorInstagramPostPreview } from "./instagram-post-preview";
import { CreatorPersonaBible, CreatorPersonaRevisionPanel, PromptLockPanel } from "./persona-bible";
import { FanvueDestinationPanel } from "./fanvue-destinations";
import { CreatorPartnerDestinationPanel } from "./partner-destinations";
import { CreatorInboxDraftPanel } from "./inbox-drafts";
import { CreatorPortfolioOverview } from "./portfolio-overview";
import type { FanvueReadinessCapability } from "@/lib/creator-promotion/fanvue-oauth-readiness";
import type { CreatorCalendarState, CreatorContentItem, CreatorInboxDraftModelHealth, CreatorInboxThread, CreatorPartnerDestination, CreatorPersonaRevision, CreatorPersonaRevisionRequest, CreatorPromotionPersona, CreatorSocialAccount, FanvueDestination } from "./types";
import { classNames, displayTime } from "./shared";

export type CreatorPromotionWorkspaceProps = {
  personas: CreatorPromotionPersona[];
  accounts: CreatorSocialAccount[];
  content: CreatorContentItem[];
  destinations: FanvueDestination[];
  partnerDestinations?: CreatorPartnerDestination[];
  inboxThreads: CreatorInboxThread[];
  personaRevisions?: CreatorPersonaRevision[];
  selectedPersonaId?: string;
  selectedContentId?: string;
  selectedThreadId?: string;
  /** IANA timezone for the editorial calendar; falls back to the active persona timezone. */
  calendarTimezone?: string;
  weekStartsOn?: Date;
  selectedCalendarDay?: Date;
  lastReadAt?: number | string;
  headerActions?: ReactNode;
  onSelectPersona?: (personaId: string) => void;
  onSelectContent?: (contentId: string) => void;
  onSelectCalendarDay?: (day: Date) => void;
  onWeekStartsOnChange?: (weekStartsOn: Date) => void;
  onCalendarStateChange?: (state: CreatorCalendarState) => void;
  onSelectThread?: (threadId: string) => void;
  onRequestFanvueConnectionReview?: (capabilities: readonly FanvueReadinessCapability[]) => void;
  onRequestInboxDraft?: (threadId: string) => void;
  onSaveInboxDraft?: (threadId: string, draftReply: string, rationale?: string) => void;
  onApproveInboxDraft?: (threadId: string) => void;
  onRequestInboxHandoff?: (threadId: string) => void;
  onCreatePersonaRevision?: (request: CreatorPersonaRevisionRequest) => void;
  onActivatePersonaRevision?: (revisionId: string) => void;
  inboxDraftModelHealth?: CreatorInboxDraftModelHealth;
  canDispatchMetaInstagramReplies?: boolean;
  inboxBusy?: boolean;
  onRequestMetaInstagramReplyApproval?: (threadId: string) => void;
  onApproveMetaInstagramReply?: (threadId: string) => void;
  onDispatchMetaInstagramReply?: (threadId: string) => void;
  className?: string;
};

/**
 * A contained, data-driven workspace. It makes no requests and performs no
 * provider actions; a page can wire its callbacks to the protected gateway.
 */
export function CreatorPromotionWorkspace({
  personas,
  accounts,
  content,
  destinations,
  partnerDestinations = [],
  inboxThreads,
  personaRevisions = [],
  selectedPersonaId,
  selectedContentId,
  selectedThreadId,
  calendarTimezone,
  weekStartsOn,
  selectedCalendarDay,
  lastReadAt,
  headerActions,
  onSelectPersona,
  onSelectContent,
  onSelectCalendarDay,
  onWeekStartsOnChange,
  onCalendarStateChange,
  onSelectThread,
  onRequestFanvueConnectionReview,
  onRequestInboxDraft,
  onSaveInboxDraft,
  onApproveInboxDraft,
  onRequestInboxHandoff,
  onCreatePersonaRevision,
  onActivatePersonaRevision,
  inboxDraftModelHealth,
  canDispatchMetaInstagramReplies,
  inboxBusy,
  onRequestMetaInstagramReplyApproval,
  onApproveMetaInstagramReply,
  onDispatchMetaInstagramReply,
  className,
}: CreatorPromotionWorkspaceProps) {
  const activePersonaId = selectedPersonaId ?? personas[0]?.id;
  const activePersona = personas.find((persona) => persona.id === activePersonaId);
  const activeContent = content.find((item) => item.id === selectedContentId) ?? content.find((item) => item.creatorId === activePersonaId);
  const activeAccount = activeContent?.accountId ? accounts.find((account) => account.id === activeContent.accountId) : undefined;
  const activeThreadId = selectedThreadId ?? inboxThreads.find((thread) => thread.creatorId === activePersonaId)?.id;

  return (
    <div className={classNames("mx-auto max-w-[1540px] space-y-5", className)}>
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-signal uppercase">Media Engine · creator promotion</p>
          <h1 className="display text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Creator promotion desk</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">A focused operating view for persona direction, owned-account health, editorial scheduling, creative review, and drafted inbound replies. Provider actions stay connection- and approval-gated.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastReadAt && <span className="text-[10px] text-ink-faint">Workspace read {displayTime(lastReadAt)}</span>}
          {headerActions}
        </div>
      </header>

      <CreatorPortfolioOverview personas={personas} accounts={accounts} content={content} now={lastReadAt} />

      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
          <PersonaRail personas={personas} accounts={accounts} selectedPersonaId={activePersonaId} onSelectPersona={onSelectPersona} />
          <AccountHealthPanel accounts={accounts} selectedCreatorId={activePersonaId} selectedAccountId={activeAccount?.id} />
        </div>
        <div className="min-w-0 space-y-5">
          <CreatorWeekCalendar
            content={activePersonaId ? content.filter((item) => item.creatorId === activePersonaId) : content}
            accounts={activePersonaId ? accounts.filter((account) => account.creatorId === activePersonaId) : accounts}
            timezone={calendarTimezone ?? activePersona?.timezone}
            weekStartsOn={weekStartsOn}
            selectedCalendarDay={selectedCalendarDay}
            selectedContentId={activeContent?.id}
            onSelectContent={onSelectContent}
            onSelectCalendarDay={onSelectCalendarDay}
            onWeekStartsOnChange={onWeekStartsOnChange}
            onCalendarStateChange={onCalendarStateChange}
          />
          <div className="grid gap-5 2xl:grid-cols-[minmax(380px,0.82fr)_minmax(0,1.18fr)]">
            <CreatorInstagramPostPreview persona={activePersona} content={activeContent} account={activeAccount} />
            <div className="space-y-5">
              <CreatorPersonaBible persona={activePersona} />
              <PromptLockPanel visualSystem={activePersona?.visualSystem} />
              <CreatorPersonaRevisionPanel persona={activePersona} revisions={personaRevisions} busy={inboxBusy} onSave={onCreatePersonaRevision} onActivate={onActivatePersonaRevision} />
            </div>
          </div>
          <div className="grid gap-5 2xl:grid-cols-2">
            <FanvueDestinationPanel destinations={destinations} selectedCreatorId={activePersonaId} onRequestConnectionReview={onRequestFanvueConnectionReview} />
            <CreatorPartnerDestinationPanel destinations={partnerDestinations} selectedCreatorId={activePersonaId} />
            <CreatorInboxDraftPanel threads={inboxThreads} accounts={accounts} selectedCreatorId={activePersonaId} selectedThreadId={activeThreadId} draftModelHealth={inboxDraftModelHealth} canDispatchMetaInstagramReplies={canDispatchMetaInstagramReplies} busy={inboxBusy} onSelectThread={onSelectThread} onRequestDraft={onRequestInboxDraft} onSaveDraft={onSaveInboxDraft} onApproveDraft={onApproveInboxDraft} onRequestHandoff={onRequestInboxHandoff} onRequestMetaInstagramReplyApproval={onRequestMetaInstagramReplyApproval} onApproveMetaInstagramReply={onApproveMetaInstagramReply} onDispatchMetaInstagramReply={onDispatchMetaInstagramReply} />
          </div>
        </div>
      </div>
    </div>
  );
}
