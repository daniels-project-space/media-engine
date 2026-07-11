"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";

export default function Campaigns() {
  const campaigns = useQuery(api.campaigns.list, {});

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-2 rise">
        <h1 className="display font-extrabold text-4xl tracking-tight">CAMPAIGNS</h1>
        <Link href="/launch" className="bg-signal text-void display font-extrabold text-xs px-4 py-2 hover:opacity-90">
          + NEW
        </Link>
      </div>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">EVERY PRODUCT THE ENGINE IS MARKETING</p>

      {campaigns === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NO CAMPAIGNS YET — HIT LAUNCH TO CREATE ONE
        </div>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((c, i) => (
            <Link
              key={c._id}
              href={`/campaigns/${c._id}`}
              className="border border-line bg-panel p-4 tile-hover rise flex items-center justify-between gap-4"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="min-w-0">
                <div className="display font-bold text-lg leading-none truncate">{c.productName ?? c.name}</div>
                <div className="text-xs text-ink-faint mt-1 truncate">{c.brief}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[10px] text-ink-faint tracking-widest">{c.mode.toUpperCase()}</span>
                {c.mode === "paid" && (
                  <span className="text-[10px] text-ink-dim tabular-nums">
                    £{(c.spentPence / 100).toFixed(0)}/{(c.budgetPence / 100).toFixed(0)}
                  </span>
                )}
                <span
                  className={`text-[10px] tracking-[0.2em] px-2 py-1 border ${
                    c.status === "live" || c.status === "done"
                      ? "border-signal text-signal"
                      : c.status === "failed"
                      ? "border-red-500/50 text-red-400"
                      : c.status === "awaiting_approval"
                      ? "border-amber-400/50 text-amber-400"
                      : "border-line-2 text-ink-faint"
                  }`}
                >
                  {c.status.replace(/_/g, " ").toUpperCase()}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
