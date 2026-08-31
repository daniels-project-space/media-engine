"use client";

import { useState } from "react";
import type {
  CreatorInboxDisclosureState,
  CreatorInboxDraftModelHealth,
  CreatorInboxFunnelIntent,
  CreatorInboxQualificationState,
  CreatorInboxSafetyState,
  CreatorInboxThread,
  CreatorMetaInstagramReplyStatus,
  CreatorSocialAccount,
} from "./types";
import { EmptyState, InboxStatusPill, SectionHeading, StatusPill, classNames, displayLabel, displayTime } from "./shared";

function IntentPill({ intent }: { intent: CreatorInboxThread["intent"] }) {
  const tone = intent === "brand_enquiry" || intent === "collaboration" ? "scope" : intent === "fanvue_interest" ? "signal" : intent === "sensitive" ? "onair" : intent === "support" ? "amber" : "muted";
  return <StatusPill label={displayLabel(intent)} tone={tone} />;
}

function hasPlainDisclosure(value?: string): boolean {
  return /\b(ai|automated|assistant)\b/i.test(value ?? "");
}

function draftModelStatusLabel(health?: CreatorInboxDraftModelHealth): string {
  if (!health) return "Model status unknown";
  if (health.status === "ready" && health.canGenerate) return "Draft AI ready";
  return health.status === "paused" ? "Draft AI paused" : "Draft AI unavailable";
}

function draftModelStatusDetail(health?: CreatorInboxDraftModelHealth): string {
  if (!health) return "Model availability has not been reported. Refresh this workspace; draft generation remains disabled.";
  return health.missing[0] ?? health.notes[0] ?? "The server-side draft model is unavailable. No draft request will be made.";
}

function DraftModelHealthPill({ health }: { health?: CreatorInboxDraftModelHealth }) {
  const ready = health?.canGenerate === true && health.status === "ready";
  return <span className={`border px-2 py-1 text-[9px] tracking-[0.14em] uppercase ${ready ? "border-signal/50 text-signal" : "border-amber/50 text-amber"}`}>{draftModelStatusLabel(health)}</span>;
}

function funnelIntent(thread: CreatorInboxThread): CreatorInboxFunnelIntent {
  if (thread.funnelIntent) return thread.funnelIntent;
  if (thread.intent === "brand_enquiry" || thread.intent === "collaboration") return "brand_partnership";
  if (thread.intent === "fanvue_interest") return "subscription_interest";
  if (thread.intent === "general_question") return "relationship_nurture";
  if (thread.intent === "support") return "support_resolution";
  return thread.intent === "sensitive" ? "not_applicable" : "unknown";
}

function safetyState(thread: CreatorInboxThread): CreatorInboxSafetyState {
  if (thread.status === "handoff_required" || thread.safetyState === "handoff_required") return "handoff_required";
  if (thread.safetyState) return thread.safetyState;
  return thread.intent === "sensitive" || (thread.safetyFlags?.length ?? 0) > 0 ? "review_required" : "clear";
}

function qualificationState(thread: CreatorInboxThread): CreatorInboxQualificationState {
  if (thread.qualificationState) return thread.qualificationState;
  if (safetyState(thread) !== "clear") return "blocked";
  const funnel = funnelIntent(thread);
  return funnel === "brand_partnership" || funnel === "subscription_interest" || funnel === "unknown" ? "needs_review" : "not_applicable";
}

function disclosureState(thread: CreatorInboxThread, draft = thread.assistantDraft): CreatorInboxDisclosureState {
  if (thread.disclosureState) return thread.disclosureState;
  if (thread.requiresDisclosure === false) return "not_required";
  if (thread.disclosureShown) return "confirmed";
  return hasPlainDisclosure(draft) ? "draft_includes_disclosure" : "required_missing";
}

function FunnelPill({ thread }: { thread: CreatorInboxThread }) {
  const intent = funnelIntent(thread);
  return <StatusPill label={`Path: ${displayLabel(intent)}`} tone={intent === "brand_partnership" ? "scope" : intent === "subscription_interest" ? "signal" : intent === "unknown" ? "amber" : "muted"} />;
}

function QualificationPill({ thread }: { thread: CreatorInboxThread }) {
  const state = qualificationState(thread);
  return <StatusPill label={`Qualification: ${displayLabel(state)}`} tone={state === "qualified" ? "signal" : state === "blocked" ? "onair" : state === "needs_review" ? "amber" : "muted"} />;
}

function DisclosurePill({ state }: { state: CreatorInboxDisclosureState }) {
  return <StatusPill label={state === "draft_includes_disclosure" ? "Disclosure in draft" : displayLabel(state)} tone={state === "confirmed" || state === "draft_includes_disclosure" ? "signal" : state === "required_missing" ? "amber" : "muted"} />;
}

function SafetyPill({ state }: { state: CreatorInboxSafetyState }) {
  return <StatusPill label={state === "clear" ? "Safety clear" : state === "review_required" ? "Safety review" : "Human handoff"} tone={state === "clear" ? "signal" : state === "review_required" ? "amber" : "onair"} />;
}

export function CreatorInboxDraftPanel({
  threads,
  accounts,
  selectedCreatorId,
  selectedThreadId,
  draftModelHealth,
  canDispatchMetaInstagramReplies = false,
  busy = false,
  onSelectThread,
  onRequestDraft,
  onSaveDraft,
  onApproveDraft,
  onRequestHandoff,
  onRequestMetaInstagramReplyApproval,
  onApproveMetaInstagramReply,
  onDispatchMetaInstagramReply,
  className,
}: {
  threads: CreatorInboxThread[];
  accounts: CreatorSocialAccount[];
  selectedCreatorId?: string;
  selectedThreadId?: string;
  /** Safe server-only model availability projection; no credentials or diagnostics. */
  draftModelHealth?: CreatorInboxDraftModelHealth;
  /** Server-projected health only; it gates the explicit worker handoff. */
  canDispatchMetaInstagramReplies?: boolean;
  busy?: boolean;
  onSelectThread?: (threadId: string) => void;
  onRequestDraft?: (threadId: string) => void;
  onSaveDraft?: (threadId: string, draftReply: string, rationale?: string) => void;
  onApproveDraft?: (threadId: string) => void;
  onRequestHandoff?: (threadId: string) => void;
  onRequestMetaInstagramReplyApproval?: (threadId: string) => void;
  onApproveMetaInstagramReply?: (threadId: string) => void;
  onDispatchMetaInstagramReply?: (threadId: string) => void;
  className?: string;
}) {
  const visible = selectedCreatorId ? threads.filter((thread) => thread.creatorId === selectedCreatorId) : threads;

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Inbox drafts and handoff">
      <SectionHeading
        eyebrow="Inbound conversations"
        title="Drafts & human handoff"
        description="AI may propose a reply from the approved persona brief. Manual threads remain draft-only; a verified inbound Instagram message can enter its own reviewed, one-reply handoff."
        action={<div className="flex flex-wrap items-center gap-1.5"><DraftModelHealthPill health={draftModelHealth} /><span className="border border-amber/50 px-2 py-1 text-[9px] tracking-[0.14em] text-amber">REVIEW-GATED</span></div>}
      />
      {visible.length === 0 ? (
        <EmptyState title="No inbound conversation records" detail="When a permitted provider inbox connection delivers metadata, each thread can be assessed for a draft or human handoff here." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((thread) => {
            const account = thread.accountId ? accounts.find((candidate) => candidate.id === thread.accountId) : undefined;
            const selected = thread.id === selectedThreadId;
            const summary = (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{thread.participantLabel ?? "Unlabelled participant"}</p>
                    <p className="mt-1 text-[9px] text-ink-faint">{account ? `${displayLabel(account.platform)} · ${account.handle.startsWith("@") ? account.handle : `@${account.handle}`}` : thread.platform ? `${displayLabel(thread.platform)} · account not linked` : "No account linked"}</p>
                  </div>
                  <InboxStatusPill status={thread.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5"><IntentPill intent={thread.intent} /><FunnelPill thread={thread} /><QualificationPill thread={thread} /><DisclosurePill state={disclosureState(thread)} /><SafetyPill state={safetyState(thread)} /></div>
                {thread.summary ? <p className="mt-3 line-clamp-2 text-[10px] leading-relaxed text-ink-dim">{thread.summary}</p> : <p className="mt-3 text-[10px] text-ink-faint">No thread summary recorded.</p>}
                {(thread.safetyFlags?.length ?? 0) > 0 && <p className="mt-2 text-[9px] leading-relaxed text-onair">Safety flags: {thread.safetyFlags?.join(", ")}</p>}
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-ink-faint">
                  {thread.receivedAt && <span>Received {displayTime(thread.receivedAt)}</span>}
                  {thread.responseDueAt && <span className="text-amber">Review by {displayTime(thread.responseDueAt)}</span>}
                </div>
              </>
            );
            return (
              <li key={thread.id} className={classNames("transition", selected && "bg-scope/[0.04]")}>
                {onSelectThread ? <button type="button" onClick={() => onSelectThread(thread.id)} aria-pressed={selected} className="w-full px-4 py-4 text-left hover:bg-panel-2 sm:px-5">{summary}</button> : <div className="px-4 py-4 sm:px-5">{summary}</div>}
                {selected && <ThreadDetail thread={thread} account={account} draftModelHealth={draftModelHealth} busy={busy} canDispatchMetaInstagramReplies={canDispatchMetaInstagramReplies} onRequestDraft={onRequestDraft} onSaveDraft={onSaveDraft} onApproveDraft={onApproveDraft} onRequestHandoff={onRequestHandoff} onRequestMetaInstagramReplyApproval={onRequestMetaInstagramReplyApproval} onApproveMetaInstagramReply={onApproveMetaInstagramReply} onDispatchMetaInstagramReply={onDispatchMetaInstagramReply} />}
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-line bg-panel-2/50 px-4 py-3 sm:px-5"><p className="text-[10px] leading-relaxed text-ink-faint">Do not use this surface for cold outreach, delayed re-engagement, or automatic sends. Sensitive, commercial, and ambiguous conversations should move to human handoff.</p></div>
    </section>
  );
}

function ThreadDetail({
  thread,
  account,
  draftModelHealth,
  busy,
  canDispatchMetaInstagramReplies,
  onRequestDraft,
  onSaveDraft,
  onApproveDraft,
  onRequestHandoff,
  onRequestMetaInstagramReplyApproval,
  onApproveMetaInstagramReply,
  onDispatchMetaInstagramReply,
}: {
  thread: CreatorInboxThread;
  account?: CreatorSocialAccount;
  draftModelHealth?: CreatorInboxDraftModelHealth;
  busy?: boolean;
  canDispatchMetaInstagramReplies?: boolean;
  onRequestDraft?: (threadId: string) => void;
  onSaveDraft?: (threadId: string, draftReply: string, rationale?: string) => void;
  onApproveDraft?: (threadId: string) => void;
  onRequestHandoff?: (threadId: string) => void;
  onRequestMetaInstagramReplyApproval?: (threadId: string) => void;
  onApproveMetaInstagramReply?: (threadId: string) => void;
  onDispatchMetaInstagramReply?: (threadId: string) => void;
}) {
  const safety = safetyState(thread);
  const disclosure = disclosureState(thread);
  const handoffRequired = safety !== "clear";
  const draftModelReady = draftModelHealth?.canGenerate === true && draftModelHealth.status === "ready";
  return (
    <div className="border-t border-line bg-panel-2/50 px-4 py-4 sm:px-5">
      {thread.metaInstagramReplyProof?.verifiedInbound && thread.metaInstagramReplyProof.responseWindowOpen
        ? <div className="mb-4 border border-scope/40 bg-scope/[0.04] px-3 py-2 text-[10px] leading-relaxed text-ink-dim"><span className="font-semibold tracking-[0.12em] text-scope uppercase">Verified inbound</span><span className="ml-2">This customer-initiated Instagram thread may enter a separate one-reply approval path. It never schedules, follows up, or sends automatically.</span></div>
        : <div className="mb-4 border border-onair/40 bg-onair/[0.04] px-3 py-2 text-[10px] leading-relaxed text-ink-dim"><span className="font-semibold tracking-[0.12em] text-onair uppercase">Draft-only</span><span className="ml-2">Local drafts can be reviewed or handed off here, but this thread cannot be sent, queued, scheduled, or followed up.</span></div>}
      <div className="mb-4 flex flex-wrap gap-1.5"><FunnelPill thread={thread} /><QualificationPill thread={thread} /><DisclosurePill state={disclosure} /><SafetyPill state={safety} /></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <p className="text-[9px] font-semibold tracking-[0.15em] text-amber uppercase">Assistant draft · review before use</p>
          {thread.assistantDraft ? <DraftEditor key={`${thread.id}:${thread.assistantDraft}:${thread.draftReviewStatus ?? "draft"}`} thread={thread} onSaveDraft={onSaveDraft} onApproveDraft={onApproveDraft} /> : <p className="mt-2 text-[11px] text-ink-faint">No assistant draft has been generated.</p>}
          <OfficialMetaInstagramReplyControl thread={thread} account={account} busy={busy} canDispatch={canDispatchMetaInstagramReplies} onRequestApproval={onRequestMetaInstagramReplyApproval} onApprove={onApproveMetaInstagramReply} onDispatch={onDispatchMetaInstagramReply} />
          {thread.handoffReason && <p className="mt-3 border-l border-onair/55 pl-3 text-[10px] leading-relaxed text-onair">Handoff reason: {thread.handoffReason}{thread.handoffAssignee ? ` · owner: ${thread.handoffAssignee}` : ""}</p>}
        </div>
        {(onRequestDraft || onRequestHandoff) && (
          <div className="flex flex-wrap items-start gap-2 lg:flex-col lg:items-stretch">
            {onRequestDraft && !thread.assistantDraft && safety === "clear" && thread.status !== "closed" && <button type="button" disabled={busy || !draftModelReady} onClick={() => onRequestDraft(thread.id)} aria-describedby={!draftModelReady ? `draft-model-status-${thread.id}` : undefined} className="border border-amber/55 px-3 py-2 text-[10px] font-semibold tracking-wide text-amber transition hover:bg-amber hover:text-void disabled:cursor-not-allowed disabled:opacity-45">Request draft</button>}
            {onRequestHandoff && thread.status !== "closed" && thread.status !== "handoff_required" && <button type="button" onClick={() => onRequestHandoff(thread.id)} className="border border-onair/55 px-3 py-2 text-[10px] font-semibold tracking-wide text-onair transition hover:bg-onair hover:text-void">{handoffRequired ? "Human handoff required" : "Escalate to human"}</button>}
          </div>
        )}
      </div>
      {!draftModelReady && <p id={`draft-model-status-${thread.id}`} className="mt-3 border-l border-amber/55 pl-3 text-[10px] leading-relaxed text-amber">Draft assistant unavailable: {draftModelStatusDetail(draftModelHealth)}</p>}
    </div>
  );
}

function metaInstagramReplyLabel(status: CreatorMetaInstagramReplyStatus): string {
  return {
    not_requested: "Not requested",
    pending_approval: "Send approval needed",
    approved: "Frozen reply approved",
    queued: "Queued for one reply",
    running: "Sending once",
    sent: "Official receipt recorded",
    failed: "Manual reconciliation needed",
    blocked: "Reply blocked",
  }[status];
}

function metaInstagramReplyTone(status: CreatorMetaInstagramReplyStatus): "signal" | "scope" | "amber" | "onair" | "muted" {
  if (status === "sent") return "signal";
  if (status === "failed" || status === "blocked") return "onair";
  if (status === "approved") return "scope";
  if (status === "queued" || status === "running") return "amber";
  return "muted";
}

function safeFailure(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 800) || undefined;
}

function safeReceiptIdentifier(value?: string): string | undefined {
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return undefined;
  return value.length <= 12 ? value : `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function OfficialMetaInstagramReplyControl({
  thread,
  account,
  busy = false,
  canDispatch = false,
  onRequestApproval,
  onApprove,
  onDispatch,
}: {
  thread: CreatorInboxThread;
  account?: CreatorSocialAccount;
  busy?: boolean;
  canDispatch?: boolean;
  onRequestApproval?: (threadId: string) => void;
  onApprove?: (threadId: string) => void;
  onDispatch?: (threadId: string) => void;
}) {
  const proof = thread.metaInstagramReplyProof;
  const reply = thread.metaInstagramReply ?? { status: "not_requested" as const };
  const [confirmed, setConfirmed] = useState(false);
  if (!proof?.verifiedInbound) return null;

  const safetyClear = safetyState(thread) === "clear";
  const disclosureReady = disclosureState(thread) !== "required_missing";
  const locallyApproved = thread.draftReviewStatus === "approved";
  const officialAccount = account?.platform === "instagram" && account.status === "connected";
  const inboxCapability = Boolean(account?.capabilities?.includes("read_inbox") && account.capabilities.includes("reply_to_inbound_message"));
  const eligible = proof.responseWindowOpen
    && thread.platform === "instagram"
    && thread.status !== "handoff_required"
    && thread.status !== "closed"
    && safetyClear
    && disclosureReady
    && locallyApproved
    && officialAccount
    && inboxCapability;
  const canRequest = eligible && reply.status === "not_requested";
  const canApprove = eligible && reply.status === "pending_approval";
  const canQueue = eligible && canDispatch && (reply.status === "approved" || reply.status === "queued");
  const receiptId = safeReceiptIdentifier(reply.receipt?.messageId);
  const failure = safeFailure(reply.failureReason);
  const label = reply.status === "sent" && !receiptId ? "Manual reconciliation needed" : metaInstagramReplyLabel(reply.status);
  const tone = reply.status === "sent" && !receiptId ? "onair" : metaInstagramReplyTone(reply.status);
  const blockers = [
    !proof.responseWindowOpen ? "The normal customer response window is closed; no automated or delayed reply is available." : undefined,
    !locallyApproved ? "Record local approval for the exact draft before requesting an official reply approval." : undefined,
    !safetyClear ? "Safety review or human handoff blocks this reply." : undefined,
    !disclosureReady ? "The required disclosure is missing from the draft." : undefined,
    !officialAccount ? "This thread is not assigned to a connected official Instagram account." : undefined,
    officialAccount && !inboxCapability ? "The assigned account lacks the recorded inbound-reply capability." : undefined,
  ].filter((message): message is string => Boolean(message));

  return (
    <div className="mt-4 border border-scope/35 bg-scope/[0.035] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[9px] font-semibold tracking-[0.15em] text-scope uppercase">Official Meta reply</p>
        <StatusPill label={label} tone={tone} />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">Only a verified customer-initiated inbound message is eligible. The provider recipient and original message remain private; this control can send one reviewed plaintext reply only after separate approval.</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-ink-faint">
        {proof.verifiedInboundAt && <span>Verified inbound · {displayTime(proof.verifiedInboundAt)}</span>}
        {proof.replyEligibilityEndsAt && <span className={proof.responseWindowOpen ? "text-amber" : "text-onair"}>Response window · {proof.responseWindowOpen ? "open until" : "closed"} {displayTime(proof.replyEligibilityEndsAt)}</span>}
        {receiptId && <span className="text-signal">Meta receipt · {receiptId}</span>}
      </div>
      {blockers.length > 0 && reply.status !== "sent" && reply.status !== "failed" && reply.status !== "blocked" && <ul className="mt-3 space-y-1 border-l border-amber/55 px-3 text-[10px] leading-relaxed text-amber">{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
      {reply.status === "sent" && !receiptId && <p className="mt-3 border-l border-onair/55 px-3 text-[10px] leading-relaxed text-onair">No safe provider receipt is recorded. Treat the outcome as unresolved and reconcile it manually; do not send again from this desk.</p>}
      {failure && <p className="mt-3 border-l border-onair/55 px-3 text-[10px] leading-relaxed text-onair">Worker result: {failure}</p>}
      {reply.status === "approved" && !canDispatch && <p className="mt-3 border-l border-amber/55 px-3 text-[10px] leading-relaxed text-amber">The official server-side dispatcher is not ready. This frozen reply cannot be handed to Meta yet.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canRequest && onRequestApproval && <button type="button" disabled={busy} onClick={() => onRequestApproval(thread.id)} className="border border-amber/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-amber transition hover:bg-amber hover:text-void disabled:opacity-50">Request send approval</button>}
        {canApprove && onApprove && <button type="button" disabled={busy} onClick={() => onApprove(thread.id)} className="border border-scope/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void disabled:opacity-50">Approve frozen reply</button>}
        {canQueue && onDispatch && <label className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-dim"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-scope" />I checked the frozen reply and current response window. Queue one reply for the official Meta worker.</label>}
        {canQueue && onDispatch && <button type="button" disabled={busy || !confirmed} onClick={() => { setConfirmed(false); onDispatch(thread.id); }} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:opacity-50">Queue one reply</button>}
      </div>
    </div>
  );
}

function DraftEditor({
  thread,
  onSaveDraft,
  onApproveDraft,
}: {
  thread: CreatorInboxThread;
  onSaveDraft?: (threadId: string, draftReply: string, rationale?: string) => void;
  onApproveDraft?: (threadId: string) => void;
}) {
  const [draftReply, setDraftReply] = useState(thread.assistantDraft ?? "");
  const [rationale, setRationale] = useState(thread.draftRationale ?? "");
  const [editingApproved, setEditingApproved] = useState(false);

  const canReview = thread.status !== "handoff_required" && thread.status !== "closed";
  const approved = thread.draftReviewStatus === "approved";
  const canEdit = canReview && (!approved || editingApproved);
  const safetyBlocked = safetyState(thread) !== "clear";
  const disclosure = disclosureState(thread, draftReply);
  const canApprove = !safetyBlocked && (disclosure === "not_required" || disclosure === "draft_includes_disclosure" || disclosure === "confirmed");
  return (
    <div className="mt-2 space-y-3">
      {onSaveDraft && canEdit ? <textarea value={draftReply} onChange={(event) => setDraftReply(event.target.value)} rows={4} className="w-full border border-line-2 bg-panel px-3 py-2 text-[11px] leading-relaxed text-ink outline-none focus:border-scope" aria-label="Reply draft for operator review" /> : <p className="whitespace-pre-line text-[11px] leading-relaxed text-ink">{thread.assistantDraft}</p>}
      {onSaveDraft && canEdit && <input value={rationale} onChange={(event) => setRationale(event.target.value)} className="w-full border border-line-2 bg-panel px-3 py-2 text-[10px] text-ink-dim outline-none focus:border-scope" placeholder="Operator rationale (optional)" aria-label="Draft rationale" />}
      {approved ? <p className="border-l border-signal/55 pl-3 text-[10px] leading-relaxed text-signal">Approved locally{thread.draftReviewedBy ? ` by ${thread.draftReviewedBy}` : ""}{thread.draftReviewedAt ? ` · ${displayTime(thread.draftReviewedAt)}` : ""}. It did not send or queue a message.</p> : <p className="text-[10px] leading-relaxed text-ink-faint">{safetyBlocked ? "Safety review blocks approval; use human handoff." : disclosure === "required_missing" ? "Add a plain AI-assistance disclosure before approval." : "Edit as needed, then record local approval only."}</p>}
      {approved && onSaveDraft && !editingApproved && canReview && <button type="button" onClick={() => setEditingApproved(true)} className="border border-scope/55 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void">Revise approved draft</button>}
      {canEdit && (onSaveDraft || onApproveDraft) && <div className="flex flex-wrap gap-2">{onSaveDraft && <button type="button" disabled={!draftReply.trim()} onClick={() => onSaveDraft(thread.id, draftReply, rationale || undefined)} className="border border-scope/55 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void disabled:cursor-not-allowed disabled:opacity-50">{approved ? "Save revision & reopen review" : "Save revision"}</button>}{approved && editingApproved && <button type="button" onClick={() => { setDraftReply(thread.assistantDraft ?? ""); setRationale(thread.draftRationale ?? ""); setEditingApproved(false); }} className="border border-line-2 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-dim">Keep approved version</button>}{onApproveDraft && !approved && <button type="button" disabled={!draftReply.trim() || !canApprove} title={!canApprove ? "A safe draft and required disclosure are needed before local approval." : undefined} onClick={() => onApproveDraft(thread.id)} className="border border-signal/55 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:opacity-50">Approve local draft</button>}</div>}
    </div>
  );
}
