"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const STAGES = ["grow", "brand_ready", "monetized"] as const;

const STAGE_LABEL: Record<string, string> = {
  grow: "GROWING",
  brand_ready: "BRAND READY",
  monetized: "MONETIZED",
};

const PLATFORM_CODE: Record<string, string> = {
  instagram: "IG",
  tiktok: "TT",
  youtube: "YT",
  fanvue: "FV",
  pinterest: "PN",
  email: "EM",
};

export default function Personas() {
  const personas = useQuery(api.personas.list);
  const setStage = useMutation(api.personas.setStage);

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">PERSONAS</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">
        GLOBAL LOCK IN EVERY GENERATION — IDENTITY DRIFT IS FAILURE MODE #1
      </p>

      {personas === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">TUNING…</div>
      ) : personas.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NO PERSONAS — INITIALIZE THE ENGINE FROM MASTER CONTROL
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {personas.map((p, i) => (
            <div
              key={p._id}
              className="border border-line bg-panel tile-hover rise"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div className="p-5 border-b border-line flex items-start justify-between gap-4">
                <div>
                  <div className="display font-bold text-2xl leading-none">{p.name}</div>
                  <div className="text-scope text-xs mt-1">{p.handle}</div>
                </div>
                <span
                  className={`text-[10px] tracking-[0.2em] px-2 py-1 border shrink-0 ${
                    p.stage === "monetized"
                      ? "border-signal text-signal"
                      : p.stage === "brand_ready"
                        ? "border-amber text-amber"
                        : "border-line-2 text-ink-dim"
                  }`}
                >
                  {STAGE_LABEL[p.stage]}
                </span>
              </div>
              <div className="p-5 space-y-3">
                <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] text-ink-faint uppercase">
                  <span className="border border-line-2 px-2 py-0.5">{p.archetype}</span>
                  {p.niche && <span className="border border-line-2 px-2 py-0.5">{p.niche}</span>}
                  {p.loraTrigger && (
                    <span className="border border-signal/40 text-signal px-2 py-0.5">
                      LoRA · {p.loraTrigger}
                    </span>
                  )}
                </div>
                {p.identitySummary && (
                  <p className="text-ink-dim text-xs leading-relaxed">{p.identitySummary}</p>
                )}
                <div className="border border-line bg-void/60 p-3 text-[11px] leading-relaxed text-ink-dim max-h-28 overflow-y-auto">
                  <span className="text-ink-faint tracking-[0.2em] text-[9px] block mb-1">
                    GLOBAL LOCK
                  </span>
                  {p.globalLock}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex gap-1.5">
                    {p.accounts.map((a) => (
                      <span
                        key={a._id}
                        title={`${a.platform}: ${a.status}`}
                        className={`size-7 grid place-items-center border text-[9px] font-bold ${
                          a.status === "active"
                            ? "border-signal text-signal"
                            : a.status === "banned"
                              ? "border-onair text-onair"
                              : "border-line-2 text-ink-faint"
                        }`}
                      >
                        {PLATFORM_CODE[a.platform] ?? "?"}
                      </span>
                    ))}
                  </div>
                  <select
                    value={p.stage}
                    onChange={(e) =>
                      setStage({ id: p._id, stage: e.target.value as (typeof STAGES)[number] })
                    }
                    className="bg-panel-2 border border-line-2 text-ink-dim text-[10px] tracking-widest px-2 py-1.5 uppercase"
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
