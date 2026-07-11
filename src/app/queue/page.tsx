"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { MediaTile } from "@/components/media-tile";
import type { Slide } from "@/lib/media";
import type { Id } from "../../../convex/_generated/dataModel";

const TABS = ["ready", "planned", "approved", "published", "rejected", "failed"] as const;
type Tab = (typeof TABS)[number];

export default function Queue() {
  const [tab, setTab] = useState<Tab>("ready");
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ title: string; hook: string; caption: string }>({ title: "", hook: "", caption: "" });

  const posts = useQuery(api.posts.byStatus, { status: tab });
  const approve = useMutation(api.posts.approve);
  const reject = useMutation(api.posts.reject);
  const bulk = useMutation(api.posts.bulkSetStatus);
  const edit = useMutation(api.posts.edit);

  const selectable = tab === "ready" || tab === "planned" || tab === "approved";

  async function callAction(action: string, postId: string) {
    setBusy(postId + action);
    try {
      await fetch("/api/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, postId }),
      });
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function bulkTo(status: "approved" | "rejected") {
    if (!selected.size) return;
    await bulk({ ids: [...selected].map((x) => x as Id<"posts">), status, reason: status === "rejected" ? "bulk rejected" : undefined });
    setSelected(new Set());
  }

  function startEdit(p: { _id: string; title?: string; hook?: string; caption?: string }) {
    setEditing(p._id);
    setForm({ title: p.title ?? "", hook: p.hook ?? "", caption: p.caption ?? "" });
  }
  async function saveEdit(id: string) {
    await edit({ id: id as Id<"posts">, title: form.title, hook: form.hook, caption: form.caption });
    setEditing(null);
  }

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">APPROVAL QUEUE</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-6 rise">
        EVERY POST&apos;S LIFECYCLE: PLANNED → GENERATED → AWAITING YOUR APPROVAL → PUBLISHED
      </p>

      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="flex gap-px bg-line border border-line w-fit rise">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setSelected(new Set()); setEditing(null); }}
              className={`px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
                tab === t ? "bg-signal text-void font-bold" : "bg-panel text-ink-dim hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {selectable && posts && posts.length > 0 && (
          <button
            onClick={() => setSelected((s) => (s.size === posts.length ? new Set() : new Set(posts.map((p) => p._id))))}
            className="text-[10px] tracking-widest text-ink-faint hover:text-ink border border-line-2 px-3 py-1.5"
          >
            {selected.size === (posts?.length ?? 0) ? "CLEAR" : "SELECT ALL"}
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 border border-signal bg-panel-2 p-3 mb-4 flex items-center gap-3 rise">
          <span className="text-xs text-signal tracking-widest">{selected.size} SELECTED</span>
          <button onClick={() => bulkTo("approved")} className="bg-signal text-void display font-bold text-xs px-4 py-1.5 hover:brightness-110">
            APPROVE ALL
          </button>
          <button onClick={() => bulkTo("rejected")} className="border border-onair text-onair text-xs px-4 py-1.5 hover:bg-onair hover:text-void">
            KILL ALL
          </button>
          <button onClick={() => setSelected(new Set())} className="text-ink-faint text-xs ml-auto hover:text-ink">clear</button>
        </div>
      )}

      {posts === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NOTHING IN «{tab.toUpperCase()}»
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((p, i) => (
            <div
              key={p._id}
              className={`border bg-panel p-5 flex flex-col md:flex-row md:items-start gap-4 rise ${selected.has(p._id) ? "border-signal" : "border-line"}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {selectable && (
                <input
                  type="checkbox"
                  checked={selected.has(p._id)}
                  onChange={() => toggle(p._id)}
                  className="mt-1 accent-signal shrink-0"
                />
              )}
              <div className="flex gap-2 shrink-0">
                {(p.slides ?? []).slice(0, 4).map((s, j) => (
                  <MediaTile key={j} slide={s as Slide} aspect="size-16" className="shrink-0" />
                ))}
                {(p.slides ?? []).length === 0 && (
                  <div className="size-16 border border-line-2 bg-panel-2 grid place-items-center text-[9px] text-ink-faint">
                    {p.kind.toUpperCase()}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-3 text-[10px] tracking-[0.2em] text-ink-faint uppercase mb-1">
                  <span className="text-scope">{p.platform}</span>
                  <span>{p.kind}</span>
                  <span>{p.streamSlug}</span>
                  {p.scheduledAt && <span className="normal-case tracking-normal">{new Date(p.scheduledAt).toLocaleDateString()}</span>}
                  {typeof p.qcScore === "number" && (
                    <span className={p.qcScore >= 70 ? "text-signal" : p.qcScore >= 50 ? "text-amber" : "text-onair"}>Q{p.qcScore}</span>
                  )}
                </div>

                {editing === p._id ? (
                  <div className="space-y-2 mt-1">
                    <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="title"
                      className="w-full bg-void border border-line-2 p-2 text-xs text-ink focus:border-signal outline-none" />
                    <input value={form.hook} onChange={(e) => setForm({ ...form, hook: e.target.value })} placeholder="hook"
                      className="w-full bg-void border border-line-2 p-2 text-xs text-ink focus:border-signal outline-none" />
                    <textarea value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} placeholder="caption"
                      className="w-full bg-void border border-line-2 p-2 text-xs text-ink focus:border-signal outline-none min-h-16" />
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(p._id)} className="bg-signal text-void text-xs font-bold px-3 py-1">SAVE</button>
                      <button onClick={() => setEditing(null)} className="text-ink-faint text-xs px-3 py-1">cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="text-sm font-bold mb-1 truncate">{p.title ?? p.hook ?? "untitled"}</div>
                    {p.hook && p.hook !== p.title && <div className="text-scope text-xs mb-1">{p.hook}</div>}
                    {p.caption && <p className="text-ink-dim text-xs leading-relaxed line-clamp-2">{p.caption}</p>}
                    {p.error && <p className="text-onair text-xs mt-1">{p.error}</p>}
                    <button onClick={() => startEdit(p)} className="text-[10px] text-ink-faint hover:text-signal mt-1 tracking-widest">EDIT COPY</button>
                  </>
                )}
              </div>

              <div className="flex md:flex-col gap-2 shrink-0">
                {tab === "ready" && (
                  <>
                    <button onClick={() => approve({ id: p._id })} className="px-4 py-2 bg-signal text-void display font-bold text-xs hover:brightness-110 transition">APPROVE</button>
                    <button onClick={() => reject({ id: p._id, reason: "manually rejected" })} className="px-4 py-2 border border-onair text-onair text-xs hover:bg-onair hover:text-void transition">KILL</button>
                  </>
                )}
                {(tab === "ready" || tab === "approved" || tab === "published") && (p.slides ?? []).some((s) => (s as Slide).r2Key) && (
                  <button onClick={() => callAction("remix", p._id)} disabled={busy !== null}
                    className="px-4 py-2 border border-scope text-scope text-xs tracking-widest hover:bg-scope hover:text-void transition disabled:opacity-50">
                    {busy === p._id + "remix" ? "REMIXING…" : "REMIX ⤨"}
                  </button>
                )}
                {tab === "approved" && (
                  <button onClick={() => callAction("publish", p._id)} disabled={busy !== null}
                    className="px-4 py-2 bg-signal text-void display font-bold text-xs hover:brightness-110 transition disabled:opacity-50">
                    {busy === p._id + "publish" ? "PUBLISHING…" : "PUBLISH NOW"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
