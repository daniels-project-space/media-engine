"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { slideSrc, isVideo, type Slide } from "@/lib/media";
import { MediaTile } from "@/components/media-tile";

const STATUS: Record<string, string> = {
  planned: "Planned",
  generating: "Rendering…",
  ready: "Ready",
  approved: "Approved",
  published: "Delivered",
  failed: "Failed",
};

export default function AdsStudio() {
  // Pull ads across every relevant state so the portfolio shows all finished work.
  const ready = useQuery(api.posts.byStatus, { status: "ready" });
  const approved = useQuery(api.posts.byStatus, { status: "approved" });
  const published = useQuery(api.posts.byStatus, { status: "published" });

  if (ready === undefined || approved === undefined || published === undefined) {
    return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  }

  const ads = [...published, ...approved, ...ready]
    .filter((p) => p.streamSlug === "client-ads")
    .filter((p) => (p.slides ?? []).some((s) => slideSrc(s as Slide)));

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">CLIENT ADS STUDIO</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">
        AI VIDEO ADS — HIGGSFIELD-BILLED, ~£1–4 MODEL COST EACH · YOUR FIVERR PORTFOLIO & FULFILMENT
      </p>

      {ads.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs">
          No ads yet. Fire one from a recipe (docs/ad-recipes.md) and it lands here.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ads.map((p) => {
            const cover = (p.slides ?? []).find((s) => slideSrc(s as Slide)) as Slide;
            return (
              <div key={p._id} className="border border-line bg-panel tile-hover rise">
                <MediaTile slide={cover} aspect="aspect-[9/16]" className="rounded-none" />
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] tracking-[0.2em] text-signal uppercase">{isVideo(cover) ? "Video" : "Image"}</span>
                    <span className="text-[10px] tracking-widest text-ink-faint uppercase">{STATUS[p.status] ?? p.status}</span>
                  </div>
                  <div className="text-xs font-bold truncate">{p.title}</div>
                  {p.caption && <p className="text-ink-dim text-[11px] leading-snug line-clamp-2 mt-1">{p.caption}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
