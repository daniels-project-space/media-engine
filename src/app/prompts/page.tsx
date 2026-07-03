"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";

const CATEGORY_ORDER = [
  "global_lock",
  "realism_suffix",
  "base_model",
  "environment",
  "niche_slide",
  "cta_slide",
  "motion",
  "storyboard",
  "caption",
];

const CATEGORY_LABEL: Record<string, string> = {
  global_lock: "GLOBAL LOCKS",
  realism_suffix: "REALISM SUFFIX",
  base_model: "BASE MODELS",
  environment: "ENVIRONMENTS",
  niche_slide: "NICHE SLIDES",
  cta_slide: "CTA SLIDES",
  motion: "MOTION",
  storyboard: "STORYBOARDS",
  caption: "CAPTION RULES",
};

export default function Prompts() {
  const prompts = useQuery(api.prompts.list);
  const [open, setOpen] = useState<string | null>(null);

  const grouped = (prompts ?? []).reduce<Record<string, NonNullable<typeof prompts>>>((acc, p) => {
    (acc[p.category] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">PROMPT LIBRARY</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">
        {prompts?.length ?? 0} TEMPLATES — MAXFUSION VAULT · PERSONA LOCKS · STORYBOARDS
      </p>

      {prompts === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">TUNING…</div>
      ) : (
        <div className="space-y-8">
          {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
            <section key={cat} className="rise">
              <h2 className="text-[11px] tracking-[0.3em] text-signal mb-3">
                {CATEGORY_LABEL[cat] ?? cat.toUpperCase()}
                <span className="text-ink-faint ml-2">({grouped[cat].length})</span>
              </h2>
              <div className="border border-line divide-y divide-line">
                {grouped[cat].map((p) => {
                  const expanded = open === p._id;
                  return (
                    <div key={p._id} className="bg-panel">
                      <button
                        onClick={() => setOpen(expanded ? null : p._id)}
                        className="w-full flex items-center justify-between gap-4 px-4 py-3 text-left hover:bg-panel-2 transition-colors"
                      >
                        <span className="text-xs font-bold truncate">{p.name}</span>
                        <span className="flex items-center gap-3 shrink-0 text-[9px] tracking-[0.2em] text-ink-faint uppercase">
                          {p.niche && <span>{p.niche}</span>}
                          {p.source && <span className="hidden md:inline">{p.source}</span>}
                          <span className="text-scope">{expanded ? "−" : "+"}</span>
                        </span>
                      </button>
                      {expanded && (
                        <pre className="px-4 pb-4 text-[11px] leading-relaxed text-ink-dim whitespace-pre-wrap font-mono border-t border-line pt-3 bg-void/40">
                          {p.body}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
