"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useMemo, useState } from "react";

const DAILY_CAP_FALLBACK = 500;

// Status palette (validated: adjacent CVD ΔE ≥ 12; gray relies on labels).
const STATUS_SERIES: { key: string; label: string; color: string }[] = [
  { key: "planned", label: "Planned", color: "#58d6ff" },
  { key: "ready", label: "Awaiting approval", color: "#ffb454" },
  { key: "published", label: "Published", color: "#d7ff3e" },
  { key: "failed", label: "Failed", color: "#ff4438" },
  { key: "rejected", label: "Rejected", color: "#565c66" },
];

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

function Tooltip({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap border border-line-2 bg-panel-2 px-2 py-1 text-[10px] text-ink z-10">
      {text}
    </div>
  );
}

export default function Analytics() {
  const days = useMemo(() => lastDays(14), []);
  const data = useQuery(api.analytics.overview, { days });
  const settings = useQuery(api.settings.all);
  const [hover, setHover] = useState<string | null>(null);

  if (data === undefined) {
    return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  }

  const cap = Number(settings?.dailyCapPence ?? DAILY_CAP_FALLBACK);
  const maxPosts = Math.max(1, ...days.map((d) => Object.values(data.postsPerDay[d] ?? {}).reduce((a, b) => a + b, 0)));
  const maxSpend = Math.max(cap, ...days.map((d) => data.spendPerDay[d] ?? 0));
  const maxStream = Math.max(1, ...data.perStream.map((s) => s.total));

  const H = 140;
  const BW = 100 / days.length;

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">ANALYTICS</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">
        REAL NUMBERS ONLY — {data.totals.posts} POSTS · £{(data.totals.spendPence / 100).toFixed(2)} TOTAL GENERATION SPEND
      </p>

      <section className="border border-line bg-panel p-5 mb-6 rise">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-[11px] tracking-[0.3em] text-signal">POSTS CREATED PER DAY — LAST 14 DAYS</h2>
          <div className="flex flex-wrap gap-3">
            {STATUS_SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[10px] text-ink-dim">
                <span className="size-2" style={{ background: s.color }} /> {s.label}
              </span>
            ))}
          </div>
        </div>
        <svg viewBox={`0 0 100 ${H / 2.4}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Stacked daily post counts by status">
          {days.map((d, i) => {
            const counts = data.postsPerDay[d] ?? {};
            let y = H / 2.4;
            return (
              <g key={d}>
                {STATUS_SERIES.map((s) => {
                  const v = counts[s.key] ?? 0;
                  if (!v) return null;
                  const h = (v / maxPosts) * (H / 2.4 - 6);
                  y -= h;
                  return (
                    <rect
                      key={s.key}
                      x={i * BW + BW * 0.18}
                      y={y + 0.4}
                      width={BW * 0.64}
                      height={Math.max(0.5, h - 0.8)}
                      fill={s.color}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        <div className="flex justify-between text-[9px] text-ink-faint mt-2">
          <span>{days[0].slice(5)}</span>
          <span>{days[6].slice(5)}</span>
          <span>{days[13].slice(5)} (today)</span>
        </div>
      </section>

      <section className="border border-line bg-panel p-5 mb-6 rise">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] tracking-[0.3em] text-signal">GENERATION SPEND PER DAY</h2>
          <span className="text-[10px] text-ink-dim">
            <span className="inline-block w-4 border-t border-dashed border-onair align-middle mr-1.5" />
            daily budget £{(cap / 100).toFixed(2)}
          </span>
        </div>
        <div className="relative">
          <svg viewBox={`0 0 100 ${H / 2.4}`} className="w-full" preserveAspectRatio="none" role="img" aria-label="Daily spend in pence vs budget cap">
            <line
              x1="0"
              x2="100"
              y1={H / 2.4 - (cap / maxSpend) * (H / 2.4 - 6)}
              y2={H / 2.4 - (cap / maxSpend) * (H / 2.4 - 6)}
              stroke="#ff4438"
              strokeWidth="0.4"
              strokeDasharray="1.6 1.2"
            />
            {days.map((d, i) => {
              const v = data.spendPerDay[d] ?? 0;
              const h = (v / maxSpend) * (H / 2.4 - 6);
              return (
                <rect
                  key={d}
                  x={i * BW + BW * 0.18}
                  y={H / 2.4 - h}
                  width={BW * 0.64}
                  height={Math.max(v > 0 ? 0.6 : 0, h)}
                  fill="#d7ff3e"
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </svg>
          {hover && (
            <div className="absolute top-1 right-1 border border-line-2 bg-panel-2 px-2 py-1 text-[10px] text-ink">
              {hover}: £{((data.spendPerDay[hover] ?? 0) / 100).toFixed(2)}
            </div>
          )}
        </div>
        <div className="flex justify-between text-[9px] text-ink-faint mt-2">
          <span>{days[0].slice(5)}</span>
          <span>{days[13].slice(5)} (today)</span>
        </div>
      </section>

      <section className="border border-line bg-panel p-5 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">OUTPUT PER STREAM</h2>
        <p className="text-ink-faint text-[11px] mb-4">Total posts each stream has produced (all time).</p>
        <div className="space-y-3">
          {data.perStream.map((s) => (
            <div key={s.slug} className="relative group">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-bold">{s.name}</span>
                <span className="text-ink-dim tabular-nums">
                  {s.total} total · {s.published} published · {s.ready} awaiting · {s.failed} failed
                </span>
              </div>
              <div className="h-3 bg-panel-2 border border-line">
                <div
                  className="h-full bg-signal vu-fill"
                  style={{ width: `${(s.total / maxStream) * 100}%` }}
                />
              </div>
              {hover === s.slug && <Tooltip text={`${s.name}: ${s.total} posts`} />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
