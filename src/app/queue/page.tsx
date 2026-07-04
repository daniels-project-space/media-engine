"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { MediaTile } from "@/components/media-tile";
import type { Slide } from "@/lib/media";

const TABS = ["ready", "planned", "approved", "published", "rejected", "failed"] as const;
type Tab = (typeof TABS)[number];

export default function Queue() {
  const [tab, setTab] = useState<Tab>("ready");
  const [busy, setBusy] = useState<string | null>(null);
  const posts = useQuery(api.posts.byStatus, { status: tab });
  const approve = useMutation(api.posts.approve);
  const reject = useMutation(api.posts.reject);

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

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">APPROVAL QUEUE</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">
        EVERY POST'S LIFECYCLE: PLANNED → GENERATED → AWAITING YOUR APPROVAL → PUBLISHED
      </p>

      <div className="flex gap-px bg-line border border-line mb-8 w-fit rise">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[10px] tracking-[0.2em] uppercase transition-colors ${
              tab === t ? "bg-signal text-void font-bold" : "bg-panel text-ink-dim hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {posts === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">Loading…</div>
      ) : posts.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NOTHING IN «{tab.toUpperCase()}»
          {tab === "ready" && (
            <div className="mt-2 normal-case tracking-normal">
              Generated posts land here for your review. Plan posts from a persona&apos;s page.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((p, i) => (
            <div
              key={p._id}
              className="border border-line bg-panel p-5 flex flex-col md:flex-row md:items-center gap-4 rise"
              style={{ animationDelay: `${i * 50}ms` }}
            >
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
                <div className="flex items-center gap-3 text-[10px] tracking-[0.2em] text-ink-faint uppercase mb-1">
                  <span className="text-scope">{p.platform}</span>
                  <span>{p.kind}</span>
                  <span>{p.streamSlug}</span>
                </div>
                <div className="text-sm font-bold mb-1 truncate">{p.title ?? p.hook ?? "untitled"}</div>
                {p.caption && (
                  <p className="text-ink-dim text-xs leading-relaxed line-clamp-2">{p.caption}</p>
                )}
                {p.error && <p className="text-onair text-xs mt-1">{p.error}</p>}
              </div>
              {tab === "ready" && (
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => approve({ id: p._id })}
                    className="px-4 py-2 bg-signal text-void display font-bold text-xs hover:brightness-110 transition"
                  >
                    APPROVE
                  </button>
                  <button
                    onClick={() => reject({ id: p._id, reason: "manually rejected" })}
                    className="px-4 py-2 border border-onair text-onair text-xs hover:bg-onair hover:text-void transition"
                  >
                    KILL
                  </button>
                </div>
              )}
              {(tab === "ready" || tab === "approved" || tab === "published") && (p.slides ?? []).some((s) => (s as Slide).r2Key) && (
                <button
                  onClick={() => callAction("remix", p._id)}
                  disabled={busy !== null}
                  title="Fan this out into every format (Reel / Feed / Square) with fresh caption variants — one piece becomes many posts."
                  className="px-4 py-2 border border-scope text-scope text-xs tracking-widest hover:bg-scope hover:text-void transition disabled:opacity-50 shrink-0"
                >
                  {busy === p._id + "remix" ? "REMIXING…" : "REMIX ⤨"}
                </button>
              )}
              {tab === "approved" && (
                <button
                  onClick={() => callAction("publish", p._id)}
                  disabled={busy !== null}
                  title="Posts immediately via the linked account. Fails with a clear error if the account isn't connected yet."
                  className="px-4 py-2 bg-signal text-void display font-bold text-xs hover:brightness-110 transition disabled:opacity-50 shrink-0"
                >
                  {busy === p._id + "publish" ? "PUBLISHING…" : "PUBLISH NOW"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
