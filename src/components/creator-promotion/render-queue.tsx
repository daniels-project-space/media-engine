"use client";

import { useState } from "react";
import type { CreatorContentItem, CreatorRenderCandidate, CreatorRenderJob } from "./types";
import { EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime } from "./shared";

function statusTone(status: CreatorRenderJob["status"]): "signal" | "amber" | "onair" | "scope" | "muted" {
  if (status === "selected") return "signal";
  if (status === "running" || status === "candidates_ready") return "scope";
  if (status === "failed" || status === "cancelled") return "onair";
  if (status === "blocked") return "amber";
  return "muted";
}

function jobExplanation(status: CreatorRenderJob["status"]): string {
  if (status === "queued") return "Approved and waiting for the separately configured server dispatcher.";
  if (status === "blocked") return "The plan is approved, but its configured renderer cannot be dispatched yet.";
  if (status === "running") return "A permitted worker is awaiting a verified provider result for the immutable approved brief.";
  if (status === "candidates_ready") return "Controlled candidate media is ready for operator selection. Selection still does not publish.";
  if (status === "selected") return "One reviewed candidate is selected for the content preview. A separate publish approval is still required.";
  if (status === "failed") return "The dispatcher recorded a failure. Resolve the provider error before creating a new attempt.";
  return "This approved job was cancelled and cannot be dispatched.";
}

function timestampMs(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function CandidateCard({
  candidate,
  disabled,
  onSelect,
  onReject,
}: {
  candidate: CreatorRenderCandidate;
  disabled: boolean;
  onSelect?: (candidateId: string) => void;
  onReject?: (candidateId: string, reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const selected = candidate.status === "selected";
  const rejected = candidate.status === "rejected";
  const media = candidate.previewUrl;

  return (
    <article className={classNames("overflow-hidden border bg-panel-2", selected ? "border-signal/60" : rejected ? "border-onair/35" : "border-line-2")}>
      <div className="relative aspect-[4/5] bg-void">
        {media ? candidate.mediaType === "video" ? (
          <video className="size-full object-cover" controls preload="metadata" src={media} aria-label="Rendered video candidate" />
        ) : (
          // Candidate URLs are supplied only by the protected Creator Promotion API.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="size-full object-cover" src={media} alt="Rendered image candidate" />
        ) : (
          <div className="grid size-full place-items-center px-4 text-center text-[10px] leading-relaxed text-white/40">Media is controlled by the renderer worker and is not available in this environment.</div>
        )}
        <span className="absolute left-2 top-2 border border-white/25 bg-black/65 px-1.5 py-1 text-[8px] font-semibold tracking-[0.12em] text-white uppercase">{displayLabel(candidate.mediaType)}</span>
        <span className="absolute right-2 top-2 border border-white/25 bg-black/65 px-1.5 py-1 text-[8px] font-semibold tracking-[0.12em] text-white uppercase">{displayLabel(candidate.status)}</span>
      </div>
      <div className="space-y-2 p-3">
        <p className="text-[9px] text-ink-faint">Attempt {candidate.attemptNumber} · {displayLabel(candidate.provider)} · {displayTime(candidate.createdAt)}</p>
        {(candidate.width || candidate.height || candidate.durationSeconds) && <p className="text-[9px] text-ink-faint">{candidate.width && candidate.height ? `${candidate.width} × ${candidate.height}` : ""}{candidate.durationSeconds ? `${candidate.width && candidate.height ? " · " : ""}${candidate.durationSeconds}s` : ""}</p>}
        {rejected && <p className="border-l border-onair/55 pl-2 text-[9px] leading-relaxed text-onair">Rejected: {candidate.rejectionReason ?? "No reason recorded."}</p>}
        {!selected && !rejected && (onSelect || onReject) && <div className="space-y-2 border-t border-line pt-2">
          {onReject && <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Reason if rejecting" className="w-full border border-line bg-panel px-2 py-1.5 text-[9px] text-ink outline-none placeholder:text-ink-faint focus:border-onair" />}
          <div className="flex gap-2">
            {onSelect && <button type="button" disabled={disabled} onClick={() => onSelect(candidate.id)} className="border border-signal/60 px-2 py-1.5 text-[9px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:opacity-50">Select</button>}
            {onReject && <button type="button" disabled={disabled || !reason.trim()} onClick={() => { onReject(candidate.id, reason.trim()); setReason(""); }} className="border border-onair/50 px-2 py-1.5 text-[9px] font-semibold tracking-wide text-onair transition hover:bg-onair hover:text-void disabled:opacity-50">Reject</button>}
          </div>
        </div>}
        {selected && <p className="text-[9px] font-semibold tracking-wide text-signal uppercase">Selected · not published</p>}
      </div>
    </article>
  );
}

export function CreatorRenderQueue({
  jobs,
  candidates,
  content,
  selectedCreatorId,
  onSelectCandidate,
  onRejectCandidate,
  onRetryJob,
  onDispatchJob,
  busy,
  className,
}: {
  jobs: CreatorRenderJob[];
  candidates: CreatorRenderCandidate[];
  content: CreatorContentItem[];
  selectedCreatorId?: string;
  onSelectCandidate?: (candidateId: string) => void;
  onRejectCandidate?: (candidateId: string, reason: string) => void;
  onRetryJob?: (jobId: string) => void;
  onDispatchJob?: (jobId: string) => void;
  busy?: boolean;
  className?: string;
}) {
  const visible = selectedCreatorId ? jobs.filter((job) => job.creatorId === selectedCreatorId) : jobs;
  const contentById = new Map(content.map((item) => [item.id, item]));
  const candidatesByJob = new Map<string, CreatorRenderCandidate[]>();
  for (const candidate of candidates) {
    const existing = candidatesByJob.get(candidate.jobId) ?? [];
    existing.push(candidate);
    candidatesByJob.set(candidate.jobId, existing);
  }

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Approved render queue">
      <SectionHeading
        eyebrow="Creative execution"
        title="Render review queue"
        description="Every job is tied to an immutable approved brief. Candidate selection changes only the internal preview; it never publishes a post or calls a platform."
        action={<span className="border border-scope/45 px-2 py-1 text-[9px] font-semibold tracking-[0.14em] text-scope">GOVERNED</span>}
      />
      {visible.length === 0 ? (
        <EmptyState title="No approved render work" detail="Approve a reviewed calendar item to create its durable render job." />
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((job) => {
            const item = contentById.get(job.contentId);
            const jobCandidates = (candidatesByJob.get(job.id) ?? []).slice().sort((left, right) => timestampMs(right.createdAt) - timestampMs(left.createdAt));
            const canRetry = job.status === "failed" || job.status === "blocked";
            const canDispatch = job.status === "queued";
            return (
              <li key={job.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-ink">{item?.title ?? "Approved creator content"}</p>
                    <p className="mt-1 text-[10px] text-ink-faint">{displayLabel(job.provider)} · attempt {job.attemptNumber}/{job.maxAttempts} · created {displayTime(job.createdAt)}</p>
                  </div>
                  <StatusPill label={displayLabel(job.status)} tone={statusTone(job.status)} />
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-ink-dim">{jobExplanation(job.status)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-ink-faint">
                  {job.scheduledAt && <span>Planned for {displayTime(job.scheduledAt)}</span>}
                  {typeof job.referenceCount === "number" && <span>{job.referenceCount} rights-cleared reference{job.referenceCount === 1 ? "" : "s"}</span>}
                  <span>Updated {displayTime(job.updatedAt)}</span>
                  {canDispatch && onDispatchJob && <button type="button" disabled={busy} onClick={() => onDispatchJob(job.id)} className="border border-signal/55 px-2 py-1 font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:opacity-50">Start permitted render</button>}
                  {canRetry && onRetryJob && <button type="button" disabled={busy} onClick={() => onRetryJob(job.id)} className="border border-scope/45 px-2 py-1 font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void disabled:opacity-50">Create retry attempt</button>}
                </div>
                {job.failureReason && <p className="mt-3 border-l border-onair/55 pl-3 text-[10px] leading-relaxed text-onair">Dispatcher note: {job.failureReason}</p>}
                {jobCandidates.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{jobCandidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} disabled={Boolean(busy)} onSelect={onSelectCandidate} onReject={onRejectCandidate} />)}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
