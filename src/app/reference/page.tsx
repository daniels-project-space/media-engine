"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { MediaTile } from "@/components/media-tile";
import type { Slide } from "@/lib/media";

type Ref = { title: string; r2Key: string; source: string; note?: string };

// Private benchmark board: external showcase clips we study to match quality.
// NOT the sellable portfolio — that's /ads. Labeled + attributed accordingly.
export default function Reference() {
  const settings = useQuery(api.settings.all);
  if (settings === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  const refs = (settings.referenceClips ?? []) as Ref[];

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">REFERENCE BOARD</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-2 rise">
        THE QUALITY BAR WE MATCH — EXTERNAL SHOWCASE CLIPS, FOR BENCHMARKING ONLY
      </p>
      <p className="text-ink-faint text-[11px] mb-8 rise max-w-2xl leading-relaxed">
        Private study material. These are third-party marketing showcases (attributed below), kept
        here to calibrate the engine against — separate from your own sellable work in Ads Studio.
      </p>

      {refs.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs">No reference clips.</div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {refs.map((r) => (
            <div key={r.r2Key} className="border border-line bg-panel rise">
              <MediaTile slide={{ r2Key: r.r2Key, prompt: r.title, role: "video" } as Slide} aspect="aspect-video" className="rounded-none" />
              <div className="p-3">
                <div className="text-xs font-bold">{r.title}</div>
                {r.note && <p className="text-ink-dim text-[11px] leading-snug mt-1">{r.note}</p>}
                <div className="text-[10px] text-ink-faint tracking-wide mt-2 uppercase">↗ {r.source}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
