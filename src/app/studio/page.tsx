"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";
import { MediaTile } from "@/components/media-tile";
import { slideSrc, type Slide } from "@/lib/media";

type Shot = {
  kind?: string;
  imagePrompt?: string;
  imageUrl?: string;
  motion: string;
  seconds: number;
  onText?: string;
  cardTitle?: string;
  cardSub?: string;
};

const STAGE_META: Record<string, { label: string; cls: string }> = {
  scripting: { label: "WRITING SCRIPT…", cls: "text-scope border-scope" },
  script_ready: { label: "SCRIPT — REVIEW", cls: "text-amber border-amber" },
  drafting: { label: "RENDERING DRAFT…", cls: "text-scope border-scope" },
  draft_ready: { label: "DRAFT — REVIEW", cls: "text-amber border-amber" },
  rendering: { label: "RENDERING 4K…", cls: "text-scope border-scope" },
  final_ready: { label: "4K DELIVERED", cls: "text-signal border-signal" },
  failed: { label: "FAILED", cls: "text-onair border-onair" },
};

function firstPlayable(post: { slides?: Slide[] } | null): Slide | null {
  if (!post?.slides) return null;
  return post.slides.find((s) => slideSrc(s)) ?? null;
}

export default function Studio() {
  const projects = useQuery(api.studio.list);
  const create = useMutation(api.studio.create);
  const remove = useMutation(api.studio.remove);
  const [form, setForm] = useState({ buyer: "", title: "", brief: "", clips: "3", secs: "8" });
  const [imgKey, setImgKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(f: File) {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (d.key) setImgKey(d.key);
  }

  async function newProject() {
    if (!form.buyer || !form.brief) return;
    setBusy("new");
    try {
      const id = await create({ buyer: form.buyer, title: form.title || `${form.buyer} ad`, brief: form.brief });
      await fetch("/api/studio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "plan", projectId: id, productImageKey: imgKey, clipCount: Number(form.clips), secondsPerShot: Number(form.secs) }),
      });
      setForm({ buyer: "", title: "", brief: "", clips: "3", secs: "8" });
      setImgKey(null);
    } finally {
      setBusy(null);
    }
  }

  async function act(projectId: string, action: string) {
    setBusy(projectId + action);
    try {
      await fetch("/api/studio", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, projectId }) });
    } finally {
      setBusy(null);
    }
  }

  if (projects === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">AD STUDIO</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-1 rise">
        SCRIPT → APPROVE → CHEAP 480p DRAFT → APPROVE → 4K SEEDANCE + SFX
      </p>
      <p className="text-ink-faint text-[11px] mb-6 rise max-w-2xl leading-relaxed">
        Nothing hits 4K credits until you&apos;ve signed off the script and the cheap draft. The 4K cut
        reuses the exact frames you approved, so it&apos;s faithful — just sharper, with sound design.
      </p>

      {/* new project */}
      <div className="border border-line bg-panel p-5 mb-8 rise">
        <div className="text-[11px] tracking-[0.3em] text-signal mb-3">NEW AD PROJECT</div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} placeholder="Brand / buyer" className="bg-panel-2 border border-line-2 px-3 py-2 text-sm" />
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Project title (optional)" className="bg-panel-2 border border-line-2 px-3 py-2 text-sm" />
        </div>
        <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} placeholder="Brief — product, audience, vibe, key benefit, the hook angle" rows={3} className="w-full bg-panel-2 border border-line-2 px-3 py-2 text-sm mb-3" />
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-[11px] tracking-widest text-ink-faint">SHOTS
            <input value={form.clips} onChange={(e) => setForm({ ...form, clips: e.target.value })} inputMode="numeric" className="bg-panel-2 border border-line-2 px-2 py-1.5 text-sm w-14 ml-2" />
          </label>
          <label className="text-[11px] tracking-widest text-ink-faint">SEC/SHOT
            <input value={form.secs} onChange={(e) => setForm({ ...form, secs: e.target.value })} inputMode="numeric" className="bg-panel-2 border border-line-2 px-2 py-1.5 text-sm w-14 ml-2" />
          </label>
          <label className="text-[11px] tracking-widest text-ink-dim border border-line-2 px-3 py-2 cursor-pointer hover:border-signal">
            {imgKey ? "✓ PRODUCT IMAGE" : "+ PRODUCT IMAGE"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
          <button onClick={newProject} disabled={busy !== null} className="bg-signal text-void display font-bold px-5 py-2 text-xs hover:brightness-110 transition ml-auto disabled:opacity-50">
            {busy === "new" ? "CREATING…" : "GENERATE SCRIPT"}
          </button>
        </div>
      </div>

      {/* projects */}
      {projects.length === 0 ? (
        <div className="border border-dashed border-line-2 p-10 text-center text-ink-faint text-xs">No projects yet.</div>
      ) : (
        <div className="space-y-5">
          {projects.map((p) => {
            const meta = STAGE_META[p.stage];
            const draftSlide = firstPlayable(p.draft as { slides?: Slide[] } | null);
            const finalSlide = firstPlayable(p.final as { slides?: Slide[] } | null);
            return (
              <div key={p._id} className="border border-line bg-panel p-4 rise">
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <span className="font-bold text-sm">{p.title}</span>
                  <span className="text-[10px] tracking-widest text-ink-faint uppercase">{p.buyer}</span>
                  <span className={`text-[10px] tracking-widest px-2 py-0.5 border ${meta.cls}`}>{meta.label}</span>
                  <button onClick={() => remove({ id: p._id as Id<"adProjects"> })} className="ml-auto text-[10px] tracking-widest text-ink-faint hover:text-onair">DELETE</button>
                </div>
                {p.error && <p className="text-onair text-xs mb-2">{p.error}</p>}
                {p.hook && <p className="text-ink text-xs mb-2"><span className="text-signal">HOOK:</span> {p.hook}</p>}

                <div className="flex gap-4">
                  {/* script / shots */}
                  {p.shots && p.shots.length > 0 && (
                    <div className="flex-1 min-w-0 space-y-2">
                      {(p.shots as Shot[]).map((s, i) => (
                        <div key={i} className="border border-line-2 bg-panel-2/50 p-2 text-[11px]">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-signal font-bold">{s.kind === "card" ? "END CARD" : `SHOT ${i + 1}`}</span>
                            <span className="text-ink-faint">{s.seconds}s</span>
                            {s.imageUrl && <span className="text-scope text-[9px]">REAL PRODUCT</span>}
                            {s.onText && <span className="text-amber ml-auto">“{s.onText}”</span>}
                          </div>
                          {s.imagePrompt && <p className="text-ink-dim leading-snug line-clamp-2">{s.imagePrompt}</p>}
                          <p className="text-ink-faint leading-snug italic">↳ {s.motion}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* render previews */}
                  {(draftSlide || finalSlide) && (
                    <div className="flex gap-3 shrink-0">
                      {draftSlide && (
                        <div className="text-center"><MediaTile slide={draftSlide} aspect="aspect-[9/16] w-24" /><div className="text-[9px] text-ink-faint mt-1 tracking-widest">480p DRAFT</div></div>
                      )}
                      {finalSlide && (
                        <div className="text-center"><MediaTile slide={finalSlide} aspect="aspect-[9/16] w-24" /><div className="text-[9px] text-signal mt-1 tracking-widest">4K FINAL</div></div>
                      )}
                    </div>
                  )}
                </div>

                {/* stage actions */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {p.stage === "script_ready" && (
                    <button onClick={() => act(p._id, "render-draft")} disabled={busy !== null} className="px-3 py-1.5 bg-signal text-void display font-bold text-[10px] tracking-widest hover:brightness-110 disabled:opacity-50">
                      {busy === p._id + "render-draft" ? "STARTING…" : "APPROVE → RENDER 480p DRAFT"}
                    </button>
                  )}
                  {p.stage === "draft_ready" && (
                    <>
                      <button onClick={() => act(p._id, "render-final")} disabled={busy !== null} className="px-3 py-1.5 bg-signal text-void display font-bold text-[10px] tracking-widest hover:brightness-110 disabled:opacity-50">
                        {busy === p._id + "render-final" ? "STARTING…" : "APPROVE → RENDER 4K + SFX"}
                      </button>
                      <button onClick={() => act(p._id, "render-draft")} disabled={busy !== null} className="px-3 py-1.5 border border-line-2 text-ink-dim text-[10px] tracking-widest hover:border-scope">
                        REDO DRAFT
                      </button>
                    </>
                  )}
                  {(p.stage === "final_ready") && (
                    <button onClick={() => act(p._id, "render-final")} disabled={busy !== null} className="px-3 py-1.5 border border-line-2 text-ink-dim text-[10px] tracking-widest hover:border-scope">
                      RE-RENDER 4K
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
