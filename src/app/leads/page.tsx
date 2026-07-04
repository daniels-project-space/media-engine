"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";

const STAGES = ["new", "qualifying", "sample", "quoted", "won", "lost"] as const;
const STAGE_CLS: Record<string, string> = {
  new: "border-scope text-scope",
  qualifying: "border-amber text-amber",
  sample: "border-amber text-amber",
  quoted: "border-scope text-scope",
  won: "border-signal text-signal",
  lost: "border-line-2 text-ink-faint",
};

export default function Leads() {
  const leads = useQuery(api.leads.list);
  const stats = useQuery(api.leads.stats);
  const update = useMutation(api.leads.update);
  const remove = useMutation(api.leads.remove);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function draft(id: string) {
    setBusy(id);
    try {
      await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "draft", leadId: id }) });
    } finally {
      setBusy(null);
    }
  }

  function copy(id: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  if (leads === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">LEADS</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-1 rise">INBOUND FROM LANDING PAGES & MARKETPLACES — QUALIFY, DRAFT, CONVERT</p>
      <p className="text-ink-faint text-[11px] mb-6 rise max-w-2xl leading-relaxed">
        On our own landing pages replies can auto-send. On marketplaces (Fiverr/Upwork) the AI drafts and
        YOU click send — auto-messaging buyers there gets accounts banned.
      </p>

      <div className="grid grid-cols-3 gap-px bg-line border border-line mb-6 rise">
        {[
          { label: "OPEN", value: stats?.open ?? 0, tone: "text-amber" },
          { label: "TOTAL", value: stats?.total ?? 0, tone: "text-ink" },
          { label: "WON", value: stats?.won ?? 0, tone: "text-signal" },
        ].map((s) => (
          <div key={s.label} className="bg-panel p-4">
            <div className={`display font-extrabold text-2xl ${s.tone}`}>{s.value}</div>
            <div className="text-[10px] text-ink-faint tracking-[0.2em] mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {leads.length === 0 ? (
        <div className="border border-dashed border-line-2 p-10 text-center text-ink-faint text-xs">
          No leads yet. They arrive from the /services landing pages and marketplace intake.
        </div>
      ) : (
        <div className="space-y-3">
          {leads.map((l) => (
            <div key={l._id} className="border border-line bg-panel p-4 rise">
              <div className="flex flex-wrap items-center gap-3 mb-1">
                <span className="font-bold text-sm">{l.name}</span>
                <span className="text-ink-dim text-xs">{l.email}</span>
                <span className="text-[10px] tracking-widest text-ink-faint uppercase">{l.source} · {l.service ?? "—"}</span>
                <span className={`text-[10px] tracking-widest px-2 py-0.5 border ${STAGE_CLS[l.stage]}`}>{l.stage.toUpperCase()}</span>
                {l.budget && <span className="text-[10px] text-signal">{l.budget}</span>}
              </div>
              {(l.brandLink || l.timeline || l.message) && (
                <p className="text-ink-dim text-xs leading-relaxed mb-2">
                  {l.brandLink && <span className="text-scope">{l.brandLink} · </span>}
                  {l.timeline && <span>{l.timeline} · </span>}
                  {l.message}
                </p>
              )}
              {l.draftReply && (
                <div className="border border-line-2 bg-void/60 p-3 text-[12px] text-ink-dim whitespace-pre-line mb-2 rounded-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-signal tracking-widest">DRAFTED REPLY</span>
                    <button onClick={() => copy(l._id, l.draftReply!)} className="text-[9px] tracking-widest text-ink-faint hover:text-signal">{copied === l._id ? "COPIED ✓" : "COPY"}</button>
                  </div>
                  {l.draftReply}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => draft(l._id)} disabled={busy !== null} className="px-3 py-1.5 border border-scope text-scope text-[10px] tracking-widest hover:bg-scope hover:text-void transition disabled:opacity-50">
                  {busy === l._id ? "DRAFTING…" : l.draftReply ? "REDRAFT" : "DRAFT REPLY"}
                </button>
                <select value={l.stage} onChange={(e) => update({ id: l._id as Id<"leads">, stage: e.target.value as (typeof STAGES)[number] })} className="bg-panel-2 border border-line-2 text-ink-dim text-[10px] tracking-widest px-2 py-1.5 uppercase">
                  {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => remove({ id: l._id as Id<"leads"> })} className="px-3 py-1.5 border border-line-2 text-ink-faint text-[10px] tracking-widest hover:border-onair hover:text-onair transition ml-auto">DELETE</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
