"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Link from "next/link";

const DAILY_CAP_PENCE = 500;

const KIND_META: Record<string, { ch: string; accent: string }> = {
  persona_growth: { ch: "CH 01", accent: "text-signal" },
  product_ads: { ch: "CH 02", accent: "text-amber" },
  shorts: { ch: "CH 03", accent: "text-scope" },
  email: { ch: "CH 04", accent: "text-onair" },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function VuMeter({ pence }: { pence: number }) {
  const segments = 24;
  const lit = Math.min(segments, Math.round((pence / DAILY_CAP_PENCE) * segments));
  return (
    <div className="flex gap-[3px] items-end">
      {Array.from({ length: segments }, (_, i) => {
        const hot = i >= segments - 5;
        const on = i < lit;
        return (
          <div
            key={i}
            className={`w-[7px] vu-fill ${on ? (hot ? "bg-onair" : "bg-signal") : "bg-line"}`}
            style={{ height: `${10 + i * 1.1}px`, animationDelay: `${i * 25}ms` }}
          />
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const streams = useQuery(api.streams.list);
  const counts = useQuery(api.posts.counts);
  const spend = useQuery(api.spend.forDay, { day: today() });
  const seed = useMutation(api.seed.run);
  const setStatus = useMutation(api.streams.setStatus);
  const setAutonomy = useMutation(api.streams.setAutonomy);

  if (streams === undefined) {
    return <div className="text-ink-faint text-xs tracking-widest">TUNING…</div>;
  }

  if (streams.length === 0) {
    return (
      <div className="max-w-md mx-auto mt-24 text-center rise">
        <div className="display font-extrabold text-3xl mb-3">NO SIGNAL</div>
        <p className="text-ink-dim text-sm mb-6 leading-relaxed">
          Engine database is empty. Seed the four launch streams, the Elara + Kira personas and
          the prompt library.
        </p>
        <button
          onClick={() => seed({})}
          className="bg-signal text-void display font-bold px-6 py-3 text-sm hover:brightness-110 transition"
        >
          INITIALIZE ENGINE
        </button>
      </div>
    );
  }

  const ready = counts?.byStatus?.ready ?? 0;
  const published = counts?.byStatus?.published ?? 0;
  const failed = counts?.byStatus?.failed ?? 0;
  const pence = spend?.totalPence ?? 0;

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-6 mb-10 rise">
        <div>
          <h1 className="display font-extrabold text-4xl tracking-tight leading-none">
            MASTER CONTROL
          </h1>
          <p className="text-ink-dim text-xs mt-2 tracking-wider">
            {streams.length} STREAMS · {counts?.total ?? 0} POSTS TOTAL
          </p>
        </div>
        <div className="flex items-end gap-10">
          <div>
            <div className="text-[10px] text-ink-faint tracking-[0.25em] mb-2">
              GEN SPEND TODAY — £{(pence / 100).toFixed(2)} / £{DAILY_CAP_PENCE / 100}
            </div>
            <VuMeter pence={pence} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-line border border-line mb-10 rise" style={{ animationDelay: "80ms" }}>
        {[
          { label: "AWAITING APPROVAL", value: ready, href: "/queue", tone: "text-amber" },
          { label: "PUBLISHED", value: published, href: "/queue", tone: "text-signal" },
          { label: "FAILED", value: failed, href: "/queue", tone: failed > 0 ? "text-onair" : "text-ink-faint" },
        ].map((s) => (
          <Link key={s.label} href={s.href} className="bg-panel p-5 hover:bg-panel-2 transition-colors">
            <div className={`display font-extrabold text-3xl tabular-nums ${s.tone}`}>{s.value}</div>
            <div className="text-[10px] text-ink-faint tracking-[0.2em] mt-1">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {streams.map((s, i) => {
          const meta = KIND_META[s.kind] ?? KIND_META.persona_growth;
          const live = s.status === "active";
          return (
            <div
              key={s._id}
              className="border border-line bg-panel p-5 tile-hover rise"
              style={{ animationDelay: `${120 + i * 70}ms` }}
            >
              <div className="flex items-center justify-between mb-4">
                <span className={`text-[10px] tracking-[0.3em] ${meta.accent}`}>{meta.ch}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${
                      live ? "bg-onair led-live" : s.status === "paused" ? "bg-amber" : "bg-line-2"
                    }`}
                  />
                  <span className="text-[10px] tracking-[0.25em] text-ink-dim uppercase">
                    {live ? "ON AIR" : s.status}
                  </span>
                </span>
              </div>
              <h2 className="display font-bold text-xl mb-1">{s.name}</h2>
              <p className="text-ink-dim text-xs leading-relaxed mb-4">{s.goal}</p>
              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-[10px] text-ink-faint tracking-wider">
                  {counts?.byStream?.[s.slug] ?? 0} posts ·{" "}
                  <button
                    onClick={() =>
                      setAutonomy({ id: s._id, autonomy: s.autonomy === "auto" ? "approve" : "auto" })
                    }
                    className={`uppercase tracking-widest hover:underline ${
                      s.autonomy === "auto" ? "text-signal" : "text-amber"
                    }`}
                  >
                    {s.autonomy === "auto" ? "AUTO" : "APPROVE-GATED"}
                  </button>
                </span>
                <button
                  onClick={() => setStatus({ id: s._id, status: live ? "paused" : "active" })}
                  className={`text-[10px] tracking-[0.2em] px-3 py-1.5 border transition ${
                    live
                      ? "border-onair text-onair hover:bg-onair hover:text-void"
                      : "border-line-2 text-ink-dim hover:border-signal hover:text-signal"
                  }`}
                >
                  {live ? "TAKE OFF AIR" : "PUT ON AIR"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
