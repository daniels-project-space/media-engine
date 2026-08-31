"use client";

import { useState } from "react";
import type {
  CreatorLoraCompatibility,
  CreatorLoraConsentStatus,
  CreatorLoraDataReadiness,
  CreatorLoraModel,
  CreatorLoraPreviewMetadata,
  CreatorLoraTrainingJob,
  CreatorLoraTrainingRequest,
  CreatorLoraTrainingStatus,
  CreatorReferenceAsset,
} from "./types";
import { EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime } from "./shared";

export type CreatorLoraTrainingPanelProps = {
  /** Durable training records from the authenticated host workflow. */
  jobs: CreatorLoraTrainingJob[];
  /** Registered models only; a ready model is not presumed loaded by a renderer. */
  models: CreatorLoraModel[];
  /** Rights-cleared source records supplied by the host; no training data is read here. */
  referenceAssets: CreatorReferenceAsset[];
  /** Scope the panel to a creator. Start requests require this explicit selection. */
  selectedCreatorId?: string;
  /**
   * Controlled reference selection from the host workflow. When omitted, the
   * panel starts with all eligible references for the selected creator.
   */
  selectedReferenceAssetIds?: string[];
  /** Receives a controlled selection change when the host owns the reference set. */
  onSelectedReferenceAssetIdsChange?: (referenceAssetIds: string[]) => void;
  /** Initial trigger word; the operator can edit it within the field's bound. */
  defaultTriggerWord?: string;
  /** Caption template supplied to the training request, bounded before dispatch. */
  defaultCaption?: string;
  /** Records an attested operator request. The UI remains unchanged until the host returns a real job. */
  onRequestStartTraining?: (request: CreatorLoraTrainingRequest) => void;
  /** Opens the host product's authenticated review workflow for a persisted job. */
  onReviewTrainingJob?: (jobId: string) => void;
  /** Moves only a persisted draft to the human review state. */
  onSubmitForReview?: (jobId: string) => void;
  /** Approves an already reviewed job for the native training queue. */
  onApproveTraining?: (jobId: string) => void;
  /** Queues an explicitly approved job; the host must return the next job state. */
  onQueueTraining?: (jobId: string) => void;
  /** Explicitly retries dispatch for an already queued, persisted training job. */
  onDispatchTraining?: (jobId: string) => void;
  /** Activates a persisted validating model only after the host has recorded review. */
  onActivateModel?: (modelId: string) => void;
  busy?: boolean;
  className?: string;
};

type Tone = "signal" | "scope" | "amber" | "onair" | "muted";

const ELIGIBLE_RIGHTS = new Set<CreatorReferenceAsset["rightsStatus"]>([
  "creator_owned",
  "consent_verified",
  "license_verified",
]);

const TRIGGER_WORD_MAX_LENGTH = 80;
const DEFAULT_CAPTION_MAX_LENGTH = 500;
const OPERATOR_ATTESTATION = "I confirm I am authorized to train this creator LoRA using only the selected rights-cleared references.";

function isEligibleReference(asset: CreatorReferenceAsset): boolean {
  return ELIGIBLE_RIGHTS.has(asset.rightsStatus);
}

function normalizeTriggerWord(value: string): string {
  return value.slice(0, TRIGGER_WORD_MAX_LENGTH);
}

function validTriggerWord(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value.trim());
}

function boundedCaption(value?: string): string {
  const caption = value?.trim().slice(0, DEFAULT_CAPTION_MAX_LENGTH);
  return caption || "creator photo";
}

function timestampMs(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function trainingTone(status: CreatorLoraTrainingStatus): Tone {
  if (status === "running" || status === "succeeded") return "scope";
  if (status === "failed" || status === "cancelled") return "onair";
  if (status === "review_required" || status === "approved_for_training") return "amber";
  return "muted";
}

function compatibilityPresentation(compatibility: CreatorLoraCompatibility): { label: string; detail: string; tone: Tone } {
  if (compatibility === "native") {
    return {
      label: "Z-Image Turbo native",
      detail: "This registry record was verified for the native Z-Image Turbo target.",
      tone: "signal",
    };
  }

  if (compatibility === "unverified_legacy") {
    return {
      label: "Legacy · unverified",
      detail: "An older LoRA is not assumed compatible. Validate it before it can be selected for Z-Image Turbo.",
      tone: "amber",
    };
  }

  return {
    label: "Legacy · incompatible",
    detail: "This legacy model must not be attached to a Z-Image Turbo run.",
    tone: "onair",
  };
}

function statusExplanation(status: CreatorLoraTrainingStatus): string {
  if (status === "draft") return "The operator has a draft record only; no provider run has been requested.";
  if (status === "review_required") return "An operator must review the evaluation before the model can be marked ready.";
  if (status === "approved_for_training") return "An operator approved this record, but it has not yet been sent to the controlled queue.";
  if (status === "queued") return "The host recorded a queue request. This does not establish that a training provider accepted it.";
  if (status === "running") return "The persisted job reports an active training run. Review source and provider evidence upstream.";
  if (status === "succeeded") return "The training worker recorded success. Its resulting model still requires validation and explicit activation.";
  if (status === "failed") return "The training workflow recorded a failure; no replacement job has been created automatically.";
  return "This job was cancelled and cannot be treated as a usable model.";
}

function readinessPresentation(status: CreatorLoraConsentStatus | CreatorLoraDataReadiness, kind: "consent" | "data"): { label: string; tone: Tone } {
  if (status === "confirmed" || status === "ready") return { label: kind === "consent" ? "Consent confirmed" : "Data ready", tone: "signal" };
  if (status === "blocked") return { label: kind === "consent" ? "Consent blocked" : "Data blocked", tone: "onair" };
  if (status === "review_required") return { label: kind === "consent" ? "Consent review" : "Data review", tone: "amber" };
  return { label: kind === "consent" ? "Consent unconfirmed" : "Data not ready", tone: "muted" };
}

function inventoryState(assets: CreatorReferenceAsset[]): { consent: CreatorLoraConsentStatus; data: CreatorLoraDataReadiness; eligible: number; review: number; blocked: number } {
  const eligible = assets.filter((asset) => ELIGIBLE_RIGHTS.has(asset.rightsStatus)).length;
  const review = assets.filter((asset) => asset.rightsStatus === "review_required").length;
  const blocked = assets.filter((asset) => asset.rightsStatus === "rejected").length;

  if (eligible === 0 && blocked > 0) return { consent: "blocked", data: "blocked", eligible, review, blocked };
  if (eligible === 0) return { consent: "not_confirmed", data: "not_ready", eligible, review, blocked };

  // The component cannot establish training-dataset quality from a thumbnail inventory.
  return { consent: "review_required", data: "review_required", eligible, review, blocked };
}

function PreviewMetadata({ preview }: { preview?: CreatorLoraPreviewMetadata }) {
  if (!preview) {
    return <p className="border-t border-line pt-3 text-[9px] leading-relaxed text-ink-faint">No controlled evaluation preview metadata has been returned for this record.</p>;
  }

  return (
    <div className="border-t border-line pt-3">
      <p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Evaluation preview</p>
      <div className="mt-2 flex gap-3">
        {preview.imageUrl ? (
          <div className="size-16 shrink-0 overflow-hidden border border-line bg-void">
            {/* A protected host URL may be supplied; this component never synthesizes a preview. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.imageUrl} alt={preview.label} className="size-full object-cover" />
          </div>
        ) : null}
        <div className="min-w-0 space-y-1 text-[9px] leading-relaxed text-ink-faint">
          <p className="truncate text-ink-dim" title={preview.label}>{preview.label}</p>
          {preview.promptSummary ? <p className="line-clamp-2">{preview.promptSummary}</p> : <p>Metadata only; no media preview supplied.</p>}
          <p>
            {preview.reviewStatus ? `Review ${displayLabel(preview.reviewStatus)}` : "Review state not supplied"}
            {preview.width && preview.height ? ` · ${preview.width} × ${preview.height}` : ""}
            {preview.createdAt ? ` · ${displayTime(preview.createdAt)}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function TrainingJobCard({
  job,
  disabled,
  onReview,
  onSubmitForReview,
  onApproveTraining,
  onQueueTraining,
  onDispatchTraining,
}: {
  job: CreatorLoraTrainingJob;
  disabled: boolean;
  onReview?: (jobId: string) => void;
  onSubmitForReview?: (jobId: string) => void;
  onApproveTraining?: (jobId: string) => void;
  onQueueTraining?: (jobId: string) => void;
  onDispatchTraining?: (jobId: string) => void;
}) {
  const consent = readinessPresentation(job.consentStatus, "consent");
  const data = readinessPresentation(job.dataReadiness, "data");
  const progress = typeof job.progressPercent === "number" ? Math.min(100, Math.max(0, job.progressPercent)) : undefined;

  return (
    <article className="space-y-3 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink">{job.modelLabel ?? "Creator LoRA training"}</p>
          <p className="mt-1 text-[9px] text-ink-faint">Z-Image Turbo native target · updated {displayTime(job.updatedAt)}</p>
        </div>
        <StatusPill label={displayLabel(job.status)} tone={trainingTone(job.status)} />
      </div>

      <p className="text-[10px] leading-relaxed text-ink-dim">{statusExplanation(job.status)}</p>

      <div className="flex flex-wrap gap-2">
        <StatusPill label={consent.label} tone={consent.tone} />
        <StatusPill label={data.label} tone={data.tone} />
        {job.providerLabel ? <span className="border border-line px-2 py-1 text-[8px] font-semibold tracking-[0.1em] text-ink-faint uppercase">{job.providerLabel}</span> : null}
      </div>

      {(progress !== undefined || job.completedSteps !== undefined || job.totalSteps !== undefined) ? (
        <div className="space-y-1.5">
          <div className="flex justify-between gap-3 text-[9px] text-ink-faint">
            <span>Recorded progress</span>
            <span>{progress !== undefined ? `${Math.round(progress)}%` : "Not reported"}{job.completedSteps !== undefined && job.totalSteps !== undefined ? ` · ${job.completedSteps}/${job.totalSteps} steps` : ""}</span>
          </div>
          <div className="h-1 overflow-hidden bg-panel-2"><div className="h-full bg-scope transition-[width]" style={{ width: `${progress ?? 0}%` }} /></div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] text-ink-faint">
        {job.referenceAssetCount !== undefined ? <span>{job.eligibleReferenceAssetCount ?? job.referenceAssetCount}/{job.referenceAssetCount} rights-cleared references</span> : null}
        {job.requestedAt ? <span>Requested {displayTime(job.requestedAt)}</span> : null}
        {job.startedAt ? <span>Started {displayTime(job.startedAt)}</span> : null}
        {job.completedAt ? <span>Completed {displayTime(job.completedAt)}</span> : null}
      </div>

      {job.failureReason ? <p className="border-l border-onair/55 pl-3 text-[10px] leading-relaxed text-onair">Workflow note: {job.failureReason}</p> : null}
      {job.reviewNote ? <p className="border-l border-amber/55 pl-3 text-[10px] leading-relaxed text-amber">Review note: {job.reviewNote}</p> : null}
      <PreviewMetadata preview={job.preview} />

      <div className="flex flex-wrap gap-2">
        {onReview ? <button type="button" disabled={disabled} onClick={() => onReview(job.id)} className="border border-scope/50 px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] text-scope uppercase transition hover:bg-scope hover:text-void disabled:opacity-50">Open training review</button> : null}
        {job.status === "draft" && onSubmitForReview ? <button type="button" disabled={disabled} onClick={() => onSubmitForReview(job.id)} className="border border-amber/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] text-amber uppercase transition hover:bg-amber hover:text-void disabled:opacity-50">Submit for review</button> : null}
        {job.status === "review_required" && onApproveTraining ? <button type="button" disabled={disabled} onClick={() => onApproveTraining(job.id)} className="border border-signal/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] text-signal uppercase transition hover:bg-signal hover:text-void disabled:opacity-50">Approve training</button> : null}
        {job.status === "approved_for_training" && onQueueTraining ? <button type="button" disabled={disabled} onClick={() => onQueueTraining(job.id)} className="border border-scope/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] text-scope uppercase transition hover:bg-scope hover:text-void disabled:opacity-50">Queue native training</button> : null}
        {job.status === "queued" && onDispatchTraining ? <button type="button" disabled={disabled} onClick={() => onDispatchTraining(job.id)} className="border border-scope/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] text-scope uppercase transition hover:bg-scope hover:text-void disabled:opacity-50">Dispatch queued training</button> : null}
      </div>
    </article>
  );
}

function ModelCard({ model, disabled, onActivate }: { model: CreatorLoraModel; disabled: boolean; onActivate?: (modelId: string) => void }) {
  const compatibility = compatibilityPresentation(model.compatibility);

  return (
    <article className="space-y-3 border border-line bg-panel-2 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-semibold text-ink" title={model.label}>{model.label}</h3>
          <p className="mt-1 text-[9px] text-ink-faint">{model.baseModelLabel ?? "Base model not recorded"}{model.version ? ` · v${model.version}` : ""}</p>
        </div>
        <StatusPill label={displayLabel(model.status)} tone={model.status === "active" ? "signal" : model.status === "validating" ? "scope" : model.status === "failed" ? "onair" : "muted"} />
      </div>
      <div className="space-y-1.5">
        <StatusPill label={compatibility.label} tone={compatibility.tone} />
        <p className="text-[9px] leading-relaxed text-ink-faint">{compatibility.detail}</p>
      </div>
      {model.triggerToken ? <p className="border-t border-line pt-3 font-mono text-[9px] text-ink-dim">Trigger · {model.triggerToken}</p> : null}
      <PreviewMetadata preview={model.preview} />
      {model.status === "validating" && onActivate ? <button type="button" disabled={disabled} onClick={() => onActivate(model.id)} className="border border-signal/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-[0.1em] text-signal uppercase transition hover:bg-signal hover:text-void disabled:opacity-50">Activate reviewed model</button> : null}
    </article>
  );
}

export function CreatorLoraTrainingPanel({
  jobs,
  models,
  referenceAssets,
  selectedCreatorId,
  selectedReferenceAssetIds,
  onSelectedReferenceAssetIdsChange,
  defaultTriggerWord,
  defaultCaption,
  onRequestStartTraining,
  onReviewTrainingJob,
  onSubmitForReview,
  onApproveTraining,
  onQueueTraining,
  onDispatchTraining,
  onActivateModel,
  busy,
  className,
}: CreatorLoraTrainingPanelProps) {
  const [localReferenceSelection, setLocalReferenceSelection] = useState<{ scopeKey: string; assetIds: string[] }>({ scopeKey: "", assetIds: [] });
  const [triggerWordState, setTriggerWordState] = useState<{ scopeKey: string; value: string }>({ scopeKey: "", value: "" });
  const [attestationScopeKey, setAttestationScopeKey] = useState<string | undefined>();
  const visibleJobs = jobs
    .filter((job) => !selectedCreatorId || job.creatorId === selectedCreatorId)
    .slice()
    .sort((left, right) => timestampMs(right.updatedAt) - timestampMs(left.updatedAt));
  const visibleModels = models
    .filter((model) => !selectedCreatorId || model.creatorId === selectedCreatorId)
    .slice()
    .sort((left, right) => timestampMs(right.reviewedAt ?? right.createdAt) - timestampMs(left.reviewedAt ?? left.createdAt));
  const visibleAssets = referenceAssets.filter((asset) => !selectedCreatorId || asset.creatorId === selectedCreatorId);
  const eligibleReferenceAssetIds = visibleAssets.filter(isEligibleReference).map((asset) => asset.id);
  const selectionScopeKey = selectedCreatorId ?? "no-creator-selected";
  const controlledReferenceAssetIds = selectedReferenceAssetIds?.filter((assetId) => eligibleReferenceAssetIds.includes(assetId));
  const defaultReferenceAssetIds = localReferenceSelection.scopeKey === selectionScopeKey
    ? localReferenceSelection.assetIds.filter((assetId) => eligibleReferenceAssetIds.includes(assetId))
    : eligibleReferenceAssetIds;
  const activeReferenceAssetIds = controlledReferenceAssetIds ?? defaultReferenceAssetIds;
  const triggerWord = triggerWordState.scopeKey === selectionScopeKey ? triggerWordState.value : normalizeTriggerWord(defaultTriggerWord ?? "");
  const operatorAttested = attestationScopeKey === selectionScopeKey && Boolean(selectedCreatorId);
  const inventory = inventoryState(visibleAssets);
  const activeJob = visibleJobs.find((job) => !["succeeded", "failed", "cancelled"].includes(job.status));
  const canRequest = Boolean(selectedCreatorId && !activeJob && inventory.data !== "blocked" && activeReferenceAssetIds.length > 0 && validTriggerWord(triggerWord) && operatorAttested && !busy);
  const consent = readinessPresentation(inventory.consent, "consent");
  const data = readinessPresentation(inventory.data, "data");
  const trainingCaption = boundedCaption(defaultCaption);

  function toggleReferenceAsset(assetId: string) {
    const next = activeReferenceAssetIds.includes(assetId)
      ? activeReferenceAssetIds.filter((selectedId) => selectedId !== assetId)
      : [...activeReferenceAssetIds, assetId];

    if (selectedReferenceAssetIds !== undefined) {
      onSelectedReferenceAssetIdsChange?.(next);
      return;
    }

    setLocalReferenceSelection({ scopeKey: selectionScopeKey, assetIds: next });
    onSelectedReferenceAssetIdsChange?.(next);
  }

  function requestNativeTraining() {
    if (!selectedCreatorId || !canRequest || !onRequestStartTraining) return;
    onRequestStartTraining({
      creatorId: selectedCreatorId,
      target: "z-image-turbo",
      referenceAssetIds: activeReferenceAssetIds,
      trainingParams: {
        triggerWord: triggerWord.trim(),
        trainingType: "content",
        steps: 1000,
        learningRate: 0.0001,
        defaultCaption: trainingCaption,
      },
      operatorAttestation: {
        confirmed: true,
        statement: OPERATOR_ATTESTATION,
      },
    });
  }

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Creator LoRA training">
      <SectionHeading
        eyebrow="Creator visual identity"
        title="LoRA training control"
        description="Z-Image Turbo is the native creator-model target. Older LoRAs remain explicitly unverified or incompatible until a controlled review records otherwise."
        action={<span className="border border-scope/45 px-2 py-1 text-[9px] font-semibold tracking-[0.14em] text-scope uppercase">Record-driven</span>}
      />

      <div className="grid border-b border-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-3 border-b border-line p-4 lg:border-r lg:border-b-0 sm:p-5">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.14em] text-signal uppercase">Native target</p>
            <h3 className="mt-1 text-sm font-semibold text-ink">Z-Image Turbo creator LoRA</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">Create a durable request for the native <code className="font-mono text-ink-dim">fal-ai/z-image-trainer</code> workflow. A button press does not display “training” until a persisted job says so.</p>
          </div>
          <div className="space-y-2 border-y border-line py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="creator-lora-trigger" className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Trigger word</label>
              <span className="text-[9px] text-ink-faint">Letters, numbers, <code>_</code>, or <code>-</code> · {triggerWord.length}/{TRIGGER_WORD_MAX_LENGTH}</span>
            </div>
            <input
              id="creator-lora-trigger"
              value={triggerWord}
              onChange={(event) => setTriggerWordState({ scopeKey: selectionScopeKey, value: normalizeTriggerWord(event.target.value) })}
              maxLength={TRIGGER_WORD_MAX_LENGTH}
              autoComplete="off"
              placeholder="e.g. kira_style"
              className="w-full border border-line bg-panel-2 px-2.5 py-2 font-mono text-[10px] text-ink outline-none placeholder:text-ink-faint focus:border-scope"
            />
            {!validTriggerWord(triggerWord) ? <p className="text-[9px] leading-relaxed text-amber">Enter one bounded trigger word before requesting training.</p> : null}
            <p className="text-[9px] leading-relaxed text-ink-faint">Training type: content · 1,000 steps · 0.0001 learning rate · caption template: <span className="font-mono text-ink-dim">{trainingCaption}</span></p>
          </div>

          <fieldset className="space-y-2" aria-label="Rights-cleared training references">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <legend className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Training references</legend>
              <span className="text-[9px] text-ink-faint">{activeReferenceAssetIds.length}/{eligibleReferenceAssetIds.length} selected</span>
            </div>
            {visibleAssets.length === 0 ? (
              <p className="border border-line bg-panel-2 px-3 py-2 text-[9px] leading-relaxed text-ink-faint">No creator-scoped reference records are available for this request.</p>
            ) : (
              <div className="max-h-40 space-y-1 overflow-y-auto border border-line bg-panel-2 p-2">
                {visibleAssets.map((asset) => {
                  const eligible = isEligibleReference(asset);
                  const selected = activeReferenceAssetIds.includes(asset.id);
                  const selectionLocked = selectedReferenceAssetIds !== undefined && !onSelectedReferenceAssetIdsChange;
                  return (
                    <label key={asset.id} className={classNames("flex items-start gap-2 px-1 py-1.5 text-[9px]", eligible ? "cursor-pointer text-ink-dim" : "cursor-not-allowed text-ink-faint") }>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!eligible || selectionLocked}
                        onChange={() => toggleReferenceAsset(asset.id)}
                        className="mt-0.5 size-3 accent-signal"
                      />
                      <span className="min-w-0"><span className="block truncate">{asset.label}</span><span className="block text-[8px] text-ink-faint">{displayLabel(asset.rightsStatus)}{eligible ? " · eligible" : " · excluded"}</span></span>
                    </label>
                  );
                })}
              </div>
            )}
            {selectedReferenceAssetIds !== undefined && !onSelectedReferenceAssetIdsChange ? <p className="text-[9px] leading-relaxed text-ink-faint">Reference selection is controlled by the host workflow.</p> : null}
          </fieldset>

          <label className="flex items-start gap-2 border border-amber/35 bg-amber/5 p-3 text-[9px] leading-relaxed text-ink-dim">
            <input type="checkbox" checked={operatorAttested} disabled={!selectedCreatorId} onChange={(event) => setAttestationScopeKey(event.target.checked ? selectionScopeKey : undefined)} className="mt-0.5 size-3 accent-amber disabled:opacity-50" />
            <span><span className="font-semibold tracking-[0.08em] text-amber uppercase">Operator attestation required</span><br />{OPERATOR_ATTESTATION}</span>
          </label>

          <button
            type="button"
            disabled={!canRequest || !onRequestStartTraining}
            onClick={requestNativeTraining}
            className="border border-signal/60 px-3 py-2 text-[9px] font-semibold tracking-[0.12em] text-signal uppercase transition hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:border-line disabled:text-ink-faint"
          >
            Request native training
          </button>
          {!operatorAttested ? <p className="text-[9px] leading-relaxed text-ink-faint">No operator confirmation has been recorded in this form.</p> : null}
        </div>
        <div className="space-y-3 p-4 sm:p-5">
          <div>
            <p className="text-[9px] font-semibold tracking-[0.14em] text-amber uppercase">Legacy guardrail</p>
            <h3 className="mt-1 text-sm font-semibold text-ink">No legacy model loading</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">Older LoRAs are listed only as unverified or incompatible registry records. Their URLs are never loaded or attached to the native target from this panel.</p>
          </div>
          <span className="inline-flex border border-amber/45 px-3 py-2 text-[9px] font-semibold tracking-[0.12em] text-amber uppercase">Read-only legacy records</span>
        </div>
      </div>

      <div className="grid gap-px bg-line md:grid-cols-3">
        <div className="bg-panel p-4 sm:p-5">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Consent state</p>
          <div className="mt-2"><StatusPill label={consent.label} tone={consent.tone} /></div>
          <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">Derived from the controlled reference inventory unless a persisted job reports a stricter state.</p>
        </div>
        <div className="bg-panel p-4 sm:p-5">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Dataset readiness</p>
          <div className="mt-2"><StatusPill label={data.label} tone={data.tone} /></div>
          <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">{inventory.eligible} rights-cleared · {inventory.review} pending review · {inventory.blocked} excluded.</p>
        </div>
        <div className="bg-panel p-4 sm:p-5">
          <p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Workflow status</p>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">
            {!selectedCreatorId ? "Select a creator before a training request can be recorded." : activeJob ? `Active record: ${displayLabel(activeJob.status)}.` : "No active training record."}
          </p>
          <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">{inventory.data === "blocked" ? "Requests are disabled while the source inventory is blocked." : "The host must return a job record before provider activity is shown."}</p>
        </div>
      </div>

      <div className="border-b border-line">
        <SectionHeading
          eyebrow="Durable job records"
          title="Training and review queue"
          description="Progress, timestamps, and previews below are supplied by persisted job metadata; this panel does not simulate provider status."
        />
        {visibleJobs.length === 0 ? (
          <EmptyState title="No training job recorded" detail="There is no evidence of a queued or running training request for this creator yet." />
        ) : (
          <div>{visibleJobs.map((job) => <TrainingJobCard key={job.id} job={job} disabled={Boolean(busy)} onReview={onReviewTrainingJob} onSubmitForReview={onSubmitForReview} onApproveTraining={onApproveTraining} onQueueTraining={onQueueTraining} onDispatchTraining={onDispatchTraining} />)}</div>
        )}
      </div>

      <div>
        <SectionHeading
          eyebrow="Model registry"
          title="Creator LoRA compatibility"
          description="Only models explicitly marked native are presented as Z-Image Turbo-compatible. Legacy registry entries are guarded by their recorded compatibility state."
        />
        {visibleModels.length === 0 ? (
          <EmptyState title="No creator LoRA registered" detail="A training request and review must produce a durable model record before a creator LoRA appears here." />
        ) : (
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">{visibleModels.map((model) => <ModelCard key={model.id} model={model} disabled={Boolean(busy)} onActivate={onActivateModel} />)}</div>
        )}
      </div>
    </section>
  );
}
