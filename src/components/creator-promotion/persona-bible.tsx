"use client";

import type { FormEvent } from "react";
import type { CreatorPersonaRevision, CreatorPersonaRevisionRequest, CreatorPromotionPersona, CreatorVisualSystem } from "./types";
import { EmptyState, SectionHeading, classNames } from "./shared";

function Field({ label, value, empty = "Not recorded", mono = false }: { label: string; value?: string; empty?: string; mono?: boolean }) {
  return (
    <div className="border-l border-line-2 pl-3">
      <p className="text-[9px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{label}</p>
      <p className={classNames("mt-1 whitespace-pre-line text-[11px] leading-relaxed", mono ? "text-ink-dim" : "text-ink")}>{value || <span className="text-ink-faint">{empty}</span>}</p>
    </div>
  );
}

function ListField({ label, values, empty }: { label: string; values?: string[]; empty: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{label}</p>
      {values?.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => <li key={value} className="border border-line-2 bg-panel-2 px-2 py-1 text-[9px] leading-relaxed text-ink-dim">{value}</li>)}
        </ul>
      ) : (
        <p className="mt-1 text-[10px] text-ink-faint">{empty}</p>
      )}
    </div>
  );
}

export function PromptLockPanel({ visualSystem, className }: { visualSystem?: CreatorVisualSystem; className?: string }) {
  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Visual prompt lock">
      <SectionHeading
        eyebrow="Creative consistency"
        title="Visual prompt lock"
        description="The approved visual direction used to evaluate a planned render. Changing this should create a new reviewed version upstream."
        action={visualSystem?.version ? <span className="border border-scope/50 px-2 py-1 text-[9px] tracking-[0.14em] text-scope">V{visualSystem.version}</span> : undefined}
      />
      <div className="space-y-4 p-4 sm:p-5">
        <Field label="Prompt lock" value={visualSystem?.promptLock} empty="No locked image direction has been recorded." mono />
        <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <Field label="Style direction" value={visualSystem?.promptStyle} empty="No style direction recorded." />
          <Field label="Model trigger" value={visualSystem?.loraTrigger} empty="No model trigger recorded." mono />
        </div>
        <Field label="Reference notes & rights check" value={visualSystem?.referenceNotes} empty="No reference notes recorded. Use only rights-cleared, consented reference material." />
      </div>
    </section>
  );
}

export function CreatorPersonaBible({ persona, className }: { persona?: CreatorPromotionPersona; className?: string }) {
  if (!persona) {
    return (
      <section className={classNames("border border-line bg-panel", className)} aria-label="Persona bible">
        <SectionHeading eyebrow="Persona operating brief" title="Persona bible" description="Narrative, voice, audience, boundaries, and visual system for one creator." />
        <EmptyState title="Choose a creator persona" detail="The persona bible becomes available when a creator record is selected." />
      </section>
    );
  }

  const identity = persona.identity;
  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label={`${persona.name} persona bible`}>
      <SectionHeading
        eyebrow="Persona operating brief"
        title="Persona bible"
        description="The durable context that keeps voice, emotional narrative, and visual intent consistent across the calendar."
        action={<span className="border border-line-2 px-2 py-1 text-[9px] tracking-[0.14em] text-ink-faint">{persona.stage.toUpperCase()}</span>}
      />
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-1 border-b border-line pb-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <div>
            <h3 className="display text-xl font-bold tracking-tight text-ink">{persona.name}</h3>
            <p className="mt-1 text-[10px] text-ink-faint">{persona.handle.startsWith("@") ? persona.handle : `@${persona.handle}`}{persona.archetype ? ` · ${persona.archetype}` : ""}</p>
          </div>
          {persona.timezone && <p className="text-[10px] text-ink-dim">Operating timezone: {persona.timezone}</p>}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="Identity summary" value={identity?.identitySummary} empty="No identity summary recorded." />
          <Field label="Public bio" value={identity?.bio} empty="No public bio recorded." />
          <Field label="Emotional backstory" value={identity?.emotionalBackstory} empty="No emotional backstory recorded." />
          <Field label="Voice guide" value={identity?.voiceGuide} empty="No voice guide recorded." />
          <Field label="Audience" value={identity?.audience} empty="No audience definition recorded." />
          <Field label="Primary commercial goal" value={persona.primaryGoal} empty="No commercial goal recorded." />
        </div>
        <div className="grid gap-5 border-t border-line pt-4 sm:grid-cols-2">
          <ListField label="Content pillars" values={identity?.contentPillars} empty="No content pillars recorded." />
          <ListField label="Hard boundaries" values={identity?.boundaries} empty="No boundaries recorded. Publishing should remain approval-gated until they are set." />
        </div>
      </div>
    </section>
  );
}

function splitValues(value: FormDataEntryValue | null): string[] {
  return typeof value === "string" ? value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
}

/** Immutable future-plan editing; the parent owns persistence and refresh. */
export function CreatorPersonaRevisionPanel({
  persona,
  revisions,
  busy = false,
  onSave,
  onActivate,
}: {
  persona?: CreatorPromotionPersona;
  revisions: CreatorPersonaRevision[];
  busy?: boolean;
  onSave?: (request: CreatorPersonaRevisionRequest) => void;
  onActivate?: (revisionId: string) => void;
}) {
  if (!persona) return null;
  const history = revisions.filter((revision) => revision.creatorId === persona.id).sort((left, right) => right.revisionNumber - left.revisionNumber);
  const active = history.find((revision) => revision.id === persona.activePersonaRevisionId) ?? history.find((revision) => revision.status === "active");
  const snapshot = active ?? { identity: persona.identity ?? {}, visualSystem: persona.visualSystem ?? {} };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSave) return;
    const form = new FormData(event.currentTarget);
    const changeNote = form.get("changeNote");
    onSave({
      creatorId: persona.id,
      changeNote: typeof changeNote === "string" && changeNote.trim() ? changeNote.trim() : undefined,
      identity: {
        bio: String(form.get("bio") ?? ""),
        identitySummary: String(form.get("identitySummary") ?? ""),
        emotionalBackstory: String(form.get("emotionalBackstory") ?? ""),
        voiceGuide: String(form.get("voiceGuide") ?? ""),
        audience: String(form.get("audience") ?? ""),
        contentPillars: splitValues(form.get("contentPillars")),
        boundaries: splitValues(form.get("boundaries")),
      },
      visualSystem: {
        promptLock: String(form.get("promptLock") ?? ""),
        promptStyle: String(form.get("promptStyle") ?? ""),
        loraTrigger: String(form.get("loraTrigger") ?? ""),
        referenceNotes: String(form.get("referenceNotes") ?? ""),
      },
    });
  };
  return (
    <section className="border border-line bg-panel" aria-label="Persona Bible revision history">
      <SectionHeading eyebrow="Governed persona state" title="Persona Bible revisions" description="Saving creates a new immutable revision for future plans only. Existing approved content is never changed." action={active ? <span className="border border-scope/50 px-2 py-1 text-[9px] tracking-[0.14em] text-scope">ACTIVE V{active.revisionNumber}</span> : undefined} />
      <div className="space-y-4 p-4 sm:p-5">
        <form key={`${persona.id}:${active?.id ?? "current"}`} onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><label className="text-[10px] text-ink-dim">Change note<input name="changeNote" required className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" placeholder="Why this future persona version changes" /></label></div>
          <div className="sm:col-span-2"><label className="text-[10px] text-ink-dim">Public bio<input name="bio" defaultValue={snapshot.identity.bio ?? ""} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label></div>
          <div className="sm:col-span-2"><label className="text-[10px] text-ink-dim">Identity summary<textarea name="identitySummary" required defaultValue={snapshot.identity.identitySummary ?? ""} rows={2} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label></div>
          <label className="text-[10px] text-ink-dim">Voice guide<input name="voiceGuide" defaultValue={snapshot.identity.voiceGuide ?? ""} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label>
          <label className="text-[10px] text-ink-dim">Audience<input name="audience" defaultValue={snapshot.identity.audience ?? ""} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label>
          <div className="sm:col-span-2"><label className="text-[10px] text-ink-dim">Emotional backstory<textarea name="emotionalBackstory" defaultValue={snapshot.identity.emotionalBackstory ?? ""} rows={2} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label></div>
          <label className="text-[10px] text-ink-dim">Content pillars<input name="contentPillars" defaultValue={(snapshot.identity.contentPillars ?? []).join(", ")} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label>
          <label className="text-[10px] text-ink-dim">Hard boundaries<input name="boundaries" defaultValue={(snapshot.identity.boundaries ?? []).join(", ")} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label>
          <div className="sm:col-span-2"><label className="text-[10px] text-ink-dim">Prompt lock<textarea name="promptLock" required defaultValue={snapshot.visualSystem.promptLock ?? ""} rows={3} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label></div>
          <label className="text-[10px] text-ink-dim">Prompt style<input name="promptStyle" defaultValue={snapshot.visualSystem.promptStyle ?? ""} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label>
          <label className="text-[10px] text-ink-dim">LoRA trigger<input name="loraTrigger" defaultValue={snapshot.visualSystem.loraTrigger ?? ""} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label>
          <div className="sm:col-span-2"><label className="text-[10px] text-ink-dim">Reference notes<textarea name="referenceNotes" defaultValue={snapshot.visualSystem.referenceNotes ?? ""} rows={2} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none focus:border-scope" /></label></div>
          <div className="sm:col-span-2"><button type="submit" disabled={busy || !onSave} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:opacity-50">Save new future revision</button></div>
        </form>
        <div className="border-t border-line pt-4"><p className="text-[9px] font-semibold tracking-[0.14em] text-ink-faint uppercase">History</p>{history.length ? <ul className="mt-2 space-y-2">{history.map((revision) => <li key={revision.id} className="flex flex-wrap items-center justify-between gap-2 border border-line-2 bg-panel-2/50 px-3 py-2 text-[10px] text-ink-dim"><span>V{revision.revisionNumber} · {revision.status === "active" ? "Active" : "Superseded"}{revision.changeNote ? ` · ${revision.changeNote}` : ""}</span>{revision.status === "superseded" && onActivate && <button type="button" disabled={busy} onClick={() => onActivate(revision.id)} className="border border-scope/55 px-2 py-1 text-[9px] font-semibold text-scope hover:bg-scope hover:text-void disabled:opacity-50">Activate for future plans</button>}</li>)}</ul> : <p className="mt-2 text-[10px] text-ink-faint">No revision history is available yet.</p>}</div>
      </div>
    </section>
  );
}
