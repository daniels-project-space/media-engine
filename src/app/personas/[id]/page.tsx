"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { use, useState } from "react";
import Link from "next/link";
import { slideSrc, isVideo, type Slide } from "@/lib/media";
import { InstagramPreview } from "@/components/instagram-preview";
import { MediaTile } from "@/components/media-tile";

type Tab = "feed" | "schedule" | "gallery";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  generating: "Generating…",
  ready: "Awaiting approval",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
  failed: "Failed",
};

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function PersonaProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const personaId = id as Id<"personas">;
  const persona = useQuery(api.personas.get, { id: personaId });
  const posts = useQuery(api.posts.forPersona, { personaId });
  const removePost = useMutation(api.posts.remove);
  const [tab, setTab] = useState<Tab>("feed");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function callTrigger(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setNotice(null);
    try {
      const r = await fetch("/api/trigger", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setNotice(r.ok ? "Job started — results appear here automatically." : "Error starting job.");
    } finally {
      setBusy(null);
    }
  }

  if (persona === undefined || posts === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  if (!persona) return <div className="text-ink-dim text-sm">Not found. <Link href="/personas" className="text-scope underline">Back</Link></div>;

  const withMedia = posts.filter((p) => (p.slides ?? []).some((s) => slideSrc(s as Slide)));
  const published = withMedia.filter((p) => p.status === "published" || p.status === "approved" || p.status === "ready");
  const planned = posts.filter((p) => p.status === "planned" && p.scheduledAt);
  const initials = persona.name.split(" ").map((w) => w[0]).join("");
  const igHandle = persona.handle.replace("@", "");
  const previewPost = preview ? posts.find((p) => p._id === preview) : null;

  const byDay = planned.reduce<Record<string, typeof planned>>((acc, p) => {
    const d = dayLabel(p.scheduledAt!);
    (acc[d] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto">
      <Link href="/personas" className="text-[10px] tracking-[0.25em] text-ink-faint hover:text-ink">← ALL PERSONAS</Link>

      {/* IG-authentic profile header */}
      <div className="flex items-center gap-6 md:gap-12 mt-4 mb-6 rise">
        <div className="size-20 md:size-28 shrink-0 rounded-full p-[3px] bg-gradient-to-tr from-[#f09433] via-[#dc2743] to-[#bc1888]">
          <div className="size-full rounded-full bg-panel-2 border-2 border-void grid place-items-center display font-extrabold text-2xl text-ink">
            {initials}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-xl font-semibold">{igHandle}</span>
            <span className="text-scope text-xs">✔</span>
            <span className={`text-[10px] tracking-[0.2em] px-2 py-1 border ${persona.stage === "monetized" ? "border-signal text-signal" : persona.stage === "brand_ready" ? "border-amber text-amber" : "border-line-2 text-ink-dim"}`}>
              {persona.stage.replace("_", " ").toUpperCase()}
            </span>
          </div>
          <div className="flex gap-6 text-sm mb-3">
            <span><b>{withMedia.length}</b> <span className="text-ink-dim">posts</span></span>
            <span><b>{planned.length}</b> <span className="text-ink-dim">scheduled</span></span>
            <span><b>{persona.accounts.length}</b> <span className="text-ink-dim">accounts</span></span>
          </div>
          <div className="text-sm">
            <div className="font-semibold">{persona.name}</div>
            {persona.bio && <div className="text-ink-dim text-xs mt-0.5 leading-relaxed">{persona.bio}</div>}
            {persona.niche && <div className="text-scope text-xs mt-0.5">{persona.niche}</div>}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6 rise">
        <button
          onClick={() => callTrigger({ action: "plan", personaId, days: 7, postsPerDay: 1 }, "plan")}
          disabled={busy !== null}
          className="bg-signal text-void display font-bold px-5 py-2 text-xs hover:brightness-110 transition disabled:opacity-50"
        >
          {busy === "plan" ? "PLANNING…" : "PLAN NEXT 7 DAYS"}
        </button>
        <a href={`/p/${igHandle}`} target="_blank" rel="noreferrer" className="border border-line-2 text-ink-dim px-4 py-2 text-xs tracking-wide hover:border-signal hover:text-signal transition">
          VIEW LINK-IN-BIO ↗
        </a>
      </div>
      {notice && <div className="border border-line bg-panel px-4 py-2.5 text-xs text-ink-dim mb-4">{notice}</div>}

      {/* tabs */}
      <div className="flex gap-px bg-line border-y border-line mb-5">
        {(["feed", "schedule", "gallery"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2.5 text-[10px] tracking-[0.25em] uppercase transition-colors ${tab === t ? "bg-panel-2 text-signal border-t-2 border-signal -mt-px" : "bg-panel text-ink-dim hover:text-ink"}`}
          >
            {t === "feed" ? "▦ Feed" : t === "schedule" ? "▤ Schedule" : "◫ Gallery"}
          </button>
        ))}
      </div>

      {/* FEED — IG 3-up grid, click for phone preview */}
      {tab === "feed" && (
        withMedia.length === 0 ? (
          <Empty text="No posts yet — hit PLAN NEXT 7 DAYS, then Generate from the Schedule tab." />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {withMedia.map((p) => {
              const cover = (p.slides ?? []).find((s) => slideSrc(s as Slide)) as Slide;
              const multi = (p.slides ?? []).filter((s) => slideSrc(s as Slide)).length > 1;
              const src = slideSrc(cover)!;
              return (
                <button key={p._id} onClick={() => setPreview(p._id)} className="relative aspect-square overflow-hidden bg-void group border border-line">
                  {isVideo(cover) ? (
                    <video src={src} muted loop playsInline className="size-full object-cover" onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt="" className="size-full object-cover" />
                  )}
                  <span className="absolute top-1.5 right-1.5 text-white text-xs drop-shadow">{isVideo(cover) ? "▶" : multi ? "⧉" : ""}</span>
                  <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition grid place-items-center">
                    <span className="opacity-0 group-hover:opacity-100 text-white text-[9px] tracking-widest">{STATUS_LABEL[p.status]?.toUpperCase()}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )
      )}

      {/* SCHEDULE — planned posts by day */}
      {tab === "schedule" && (
        planned.length === 0 ? (
          <Empty text="Nothing scheduled — hit PLAN NEXT 7 DAYS above." />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(byDay).map(([day, items]) => (
              <div key={day} className="border border-line bg-panel">
                <div className="px-4 py-2 border-b border-line text-[10px] tracking-[0.25em] text-ink-dim">{day.toUpperCase()}</div>
                {items.map((p) => (
                  <div key={p._id} className="p-4 border-b border-line last:border-b-0">
                    <div className="text-xs font-bold mb-1">{p.hook ?? p.title}</div>
                    <div className="text-[10px] text-ink-faint mb-3">{(p.slides ?? []).length} slides · {p.kind}</div>
                    <div className="flex gap-2">
                      <button onClick={() => callTrigger({ action: "generate", postId: p._id }, p._id)} disabled={busy !== null} className="px-3 py-1.5 border border-signal text-signal text-[10px] tracking-widest hover:bg-signal hover:text-void transition disabled:opacity-50">
                        {busy === p._id ? "STARTING…" : "GENERATE"}
                      </button>
                      <button onClick={() => removePost({ id: p._id })} className="px-3 py-1.5 border border-line-2 text-ink-faint text-[10px] tracking-widest hover:border-onair hover:text-onair transition">DROP</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {/* GALLERY — every generated frame, clickable */}
      {tab === "gallery" && (
        <GalleryGrid posts={withMedia} />
      )}

      {/* phone preview modal */}
      {previewPost && (
        <div onClick={() => setPreview(null)} className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm grid place-items-center p-4 overflow-y-auto rise">
          <div onClick={(e) => e.stopPropagation()} className="py-6">
            <InstagramPreview
              persona={{ name: persona.name, handle: persona.handle, bio: persona.bio }}
              slides={(previewPost.slides ?? []) as Slide[]}
              caption={previewPost.caption}
              hook={previewPost.hook}
            />
            <div className="text-center mt-3 text-[10px] tracking-widest text-ink-faint">
              {STATUS_LABEL[previewPost.status]?.toUpperCase()} · tap outside to close
            </div>
          </div>
          <button onClick={() => setPreview(null)} className="fixed top-5 right-6 text-ink-dim hover:text-ink text-2xl">×</button>
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="border border-dashed border-line-2 p-10 text-center text-ink-faint text-xs leading-relaxed">{text}</div>;
}

function GalleryGrid({ posts }: { posts: { _id: string; slides?: Slide[] }[] }) {
  const tiles = posts.flatMap((p) => (p.slides ?? []).filter((s) => slideSrc(s)).map((s, i) => ({ key: `${p._id}-${i}`, slide: s })));
  if (tiles.length === 0) return <Empty text="Nothing generated yet." />;
  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
      {tiles.map((t) => <MediaTile key={t.key} slide={t.slide} />)}
    </div>
  );
}
