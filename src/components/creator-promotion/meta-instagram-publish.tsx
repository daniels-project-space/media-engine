"use client";

import { useState } from "react";
import type {
  CreatorContentItem,
  CreatorMetaInstagramPublish,
  CreatorMetaInstagramPublishStatus,
  CreatorSocialAccount,
} from "./types";
import { EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime, toDate } from "./shared";

type PublishTone = "signal" | "scope" | "amber" | "onair" | "muted";

function publishTone(status: CreatorMetaInstagramPublishStatus): PublishTone {
  if (status === "published") return "signal";
  if (status === "approved" || status === "queued" || status === "running") return "scope";
  if (status === "pending_approval") return "amber";
  if (status === "failed" || status === "blocked") return "onair";
  return "muted";
}

function publishLabel(status: CreatorMetaInstagramPublishStatus): string {
  if (status === "pending_approval") return "Awaiting publish approval";
  if (status === "approved") return "Publish approved";
  if (status === "queued") return "Queued for explicit handoff";
  if (status === "running") return "Official worker running";
  if (status === "published") return "Published";
  if (status === "failed") return "Publish failed";
  if (status === "blocked") return "Manual reconciliation required";
  return "No publish request";
}

function fallbackPublishState(content: CreatorContentItem): CreatorMetaInstagramPublish {
  if (content.metaInstagramPublish) return content.metaInstagramPublish;
  // A historical/manual content status is not evidence that the official Meta
  // worker accepted this exact render. Only the audited action projection can
  // show a provider publication result.
  return { status: "not_requested" };
}

function safeFailure(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1_200) || undefined;
}

function safeReceiptIdentifier(value?: string): string | undefined {
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return undefined;
  return value.length <= 12 ? value : `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function statusExplanation(status: CreatorMetaInstagramPublishStatus): string {
  if (status === "pending_approval") return "The selected render is frozen into an individual publish request. Approving this decision still does not contact Meta.";
  if (status === "approved") return "The frozen publish request is approved. Return only after the calendar time has arrived, then explicitly hand it to the official worker.";
  if (status === "queued") return "The individual action is queued. The calendar will not deliver it; use the explicit worker-handoff control if the prior handoff did not begin.";
  if (status === "running") return "The official worker has claimed this one approved action. Do not create a second request while its outcome is pending.";
  if (status === "published") return "The trusted worker recorded an official provider receipt. This view does not imply live reach, metrics, or a public permalink.";
  if (status === "failed") return "The worker recorded a terminal result. Verify the provider outcome manually before creating a newly reviewed content revision; do not retry this action here.";
  if (status === "blocked") return "This action needs manual reconciliation or a newly reviewed content revision. It cannot be re-dispatched from this panel.";
  return "A selected render must receive its own Meta publish approval. A calendar date never publishes it automatically.";
}

function requiredMedia(content: CreatorContentItem): { kind: "image" | "video"; capability: "publish_feed" | "publish_reel"; label: string } | undefined {
  if (content.format === "feed") return { kind: "image", capability: "publish_feed", label: "image feed post" };
  if (content.format === "reel") return { kind: "video", capability: "publish_reel", label: "video reel" };
  return undefined;
}

function LifecycleTime({ label, value }: { label: string; value?: number | string }) {
  if (!value) return null;
  return <span>{label} {displayTime(value)}</span>;
}

function ExplicitDispatchControl({
  contentId,
  status,
  busy,
  onDispatch,
}: {
  contentId: string;
  status: CreatorMetaInstagramPublishStatus;
  busy: boolean;
  onDispatch: (contentId: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex max-w-xl items-start gap-2 text-[10px] leading-relaxed text-ink-dim"><input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" className="mt-0.5 accent-signal" /><span>I have checked the approved preview and account. This is a one-time, explicit handoff to the official Meta worker.</span></label>
      <button type="button" disabled={busy || !confirmed} onClick={() => { setConfirmed(false); onDispatch(contentId); }} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:opacity-50">{status === "queued" ? "Retry explicit worker handoff" : "Queue & dispatch now"}</button>
    </div>
  );
}

/**
 * Presentation-only controls for the separately governed Meta Instagram
 * publish lifecycle. The parent owns every action callback; no calendar timer
 * or component effect can call a provider or invoke a worker.
 */
export function CreatorMetaInstagramPublishPanel({
  content,
  account,
  now = 0,
  canDispatchApprovedActions = false,
  busy = false,
  onRequestApproval,
  onApprove,
  onDispatch,
  className,
}: {
  content?: CreatorContentItem;
  account?: CreatorSocialAccount;
  /** Snapshot time from the workspace read. Refreshing is an intentional operator action. */
  now?: number;
  /** Server-projected health only; it gates worker handoff, not review. */
  canDispatchApprovedActions?: boolean;
  busy?: boolean;
  onRequestApproval?: (contentId: string) => void;
  onApprove?: (contentId: string) => void;
  onDispatch?: (contentId: string) => void;
  className?: string;
}) {
  const lifecycle = content ? fallbackPublishState(content) : undefined;

  if (!content || !lifecycle) {
    return (
      <section className={classNames("border border-line bg-panel", className)} aria-label="Meta Instagram publication">
        <SectionHeading eyebrow="Official publication" title="Meta / Instagram publish" description="A separate approval and explicit operator handoff are required for each selected render." />
        <EmptyState title="Choose a rendered calendar item" detail="This control becomes available only for an approved selected image feed render or video reel render assigned to an official Instagram account." />
      </section>
    );
  }

  const mediaRequirement = requiredMedia(content);
  const selectedMedia = mediaRequirement
    ? content.previewMedia?.find((media) => media.kind === mediaRequirement.kind)
    : undefined;
  const isSelectedRendered = Boolean(content.selectedRenderCandidateId && content.renderState === "ready" && selectedMedia);
  const isEditoriallyApproved = content.approvalStatus === "approved";
  const isOfficialAccount = account?.platform === "instagram" && account.status === "connected";
  const hasCapability = Boolean(mediaRequirement && account?.capabilities?.includes(mediaRequirement.capability));
  const scheduledAt = toDate(content.scheduledAt);
  const scheduledTimeArrived = Boolean(scheduledAt && Number.isFinite(now) && scheduledAt.getTime() <= now);
  const eligibleForRequest = Boolean(mediaRequirement && isSelectedRendered && isEditoriallyApproved && isOfficialAccount && hasCapability);
  const canRequest = eligibleForRequest && lifecycle.status === "not_requested";
  const canApprove = eligibleForRequest && lifecycle.status === "pending_approval";
  const canDispatch = eligibleForRequest
    && canDispatchApprovedActions
    && scheduledTimeArrived
    && (lifecycle.status === "approved" || lifecycle.status === "queued");
  const blockerMessages = [
    !mediaRequirement ? "This format remains review-only. Official Meta dispatch currently supports image feed posts and video reels—not carousels or stories." : undefined,
    mediaRequirement && !content.selectedRenderCandidateId ? "Select one reviewed render candidate before requesting publication." : undefined,
    mediaRequirement && content.selectedRenderCandidateId && content.renderState !== "ready" ? "The selected render is not in a ready state." : undefined,
    mediaRequirement && content.selectedRenderCandidateId && !selectedMedia ? `The controlled preview does not prove this is the required ${mediaRequirement.kind} media type.` : undefined,
    !isEditoriallyApproved ? "The immutable editorial plan must be approved before a publish request can be created." : undefined,
    !account ? "Assign this content to an official Instagram account before publication can be reviewed." : undefined,
    account && account.platform !== "instagram" ? "The assigned account is not Instagram." : undefined,
    account && account.platform === "instagram" && account.status !== "connected" ? "The assigned Instagram account is not connected." : undefined,
    mediaRequirement && isOfficialAccount && !hasCapability ? `The assigned account lacks the recorded ${mediaRequirement.capability} capability.` : undefined,
  ].filter((message): message is string => Boolean(message));
  const receipt = lifecycle.receipt;
  const failure = safeFailure(lifecycle.failureReason);

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Meta Instagram publication">
      <SectionHeading
        eyebrow="Official publication"
        title="Meta / Instagram publish"
        description="Request approval, approve the frozen action, then explicitly hand it to the official worker. The calendar itself never publishes or queues content."
        action={<StatusPill label={publishLabel(lifecycle.status)} tone={publishTone(lifecycle.status)} />}
      />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
          <span className="border border-line-2 bg-panel-2 px-2 py-1">{mediaRequirement?.label ?? `${displayLabel(content.format)} · manual only`}</span>
          <span className="border border-line-2 bg-panel-2 px-2 py-1">{account ? `Account · ${account.handle}` : "No assigned account"}</span>
          {content.scheduledAt && <span className="border border-line-2 bg-panel-2 px-2 py-1">Calendar · {displayTime(content.scheduledAt)}</span>}
        </div>

        <p className="text-[11px] leading-relaxed text-ink-dim">{statusExplanation(lifecycle.status)}</p>

        {blockerMessages.length > 0 && lifecycle.status !== "published" && lifecycle.status !== "failed" && lifecycle.status !== "blocked" && (
          <ul className="space-y-2 border-l border-amber/55 bg-amber/[0.04] px-3 py-3 text-[10px] leading-relaxed text-amber">
            {blockerMessages.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] leading-relaxed text-ink-faint">
          <LifecycleTime label="Requested" value={lifecycle.requestedAt} />
          <LifecycleTime label="Approved" value={lifecycle.approvedAt} />
          <LifecycleTime label="Queued" value={lifecycle.queuedAt} />
          <LifecycleTime label="Started" value={lifecycle.startedAt} />
          <LifecycleTime label="Completed" value={lifecycle.completedAt} />
          <LifecycleTime label="Updated" value={lifecycle.updatedAt} />
        </div>

        {receipt && (
          <div className="border border-signal/35 bg-signal/[0.04] p-3 text-[10px] leading-relaxed text-ink-dim">
            <p className="font-semibold tracking-[0.12em] text-signal uppercase">Official receipt recorded</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-faint">
              <span>Provider · Meta Instagram</span>
              {safeReceiptIdentifier(receipt.containerId) && <span>Container · {safeReceiptIdentifier(receipt.containerId)}</span>}
              {safeReceiptIdentifier(receipt.mediaId) && <span>Media · {safeReceiptIdentifier(receipt.mediaId)}</span>}
            </div>
          </div>
        )}

        {failure && <p className="border-l border-onair/55 bg-onair/[0.04] px-3 py-3 text-[10px] leading-relaxed text-onair">Worker result: {failure}</p>}

        {lifecycle.status === "approved" && !scheduledTimeArrived && scheduledAt && (
          <p className="border-l border-scope/45 bg-scope/[0.04] px-3 py-3 text-[10px] leading-relaxed text-scope">The calendar time arrives {displayTime(scheduledAt.getTime())}. Nothing will run then—you must return and explicitly dispatch it.</p>
        )}
        {(lifecycle.status === "approved" || lifecycle.status === "queued") && !canDispatchApprovedActions && (
          <p className="border-l border-amber/55 bg-amber/[0.04] px-3 py-3 text-[10px] leading-relaxed text-amber">The official server-side Meta dispatcher is not ready, so this approved action cannot be handed to a worker yet.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {canRequest && onRequestApproval && <button type="button" disabled={busy} onClick={() => onRequestApproval(content.id)} className="border border-amber/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-amber transition hover:bg-amber hover:text-void disabled:opacity-50">Request publish approval</button>}
          {canApprove && onApprove && <button type="button" disabled={busy} onClick={() => onApprove(content.id)} className="border border-scope/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void disabled:opacity-50">Approve frozen publish</button>}
          {canDispatch && onDispatch && <ExplicitDispatchControl key={`${content.id}:${lifecycle.status}`} contentId={content.id} status={lifecycle.status} busy={busy} onDispatch={onDispatch} />}
        </div>
      </div>
    </section>
  );
}
