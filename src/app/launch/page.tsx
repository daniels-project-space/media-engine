"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import Link from "next/link";

// The Jarvis search bar. Type "promote my new app X, free, £50 cap" → the engine
// creates a campaign and runs understand → research → strategise. The plan
// streams in reactively from Convex. Nothing is rendered; every send is gated.

type Mode = "free" | "paid";
type Autonomy = "manual" | "assist" | "auto";

export default function Launch() {
  const [brief, setBrief] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<Mode>("free");
  const [budget, setBudget] = useState(50);
  const [autonomy, setAutonomy] = useState<Autonomy>("assist");
  const [busy, setBusy] = useState(false);
  const [campaignId, setCampaignId] = useState<Id<"campaigns"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const campaign = useQuery(api.campaigns.get, campaignId ? { id: campaignId } : "skip");
  const steps = useQuery(api.campaigns.steps, campaignId ? { campaignId } : "skip");
  const patch = useMutation(api.campaigns.patch);

  async function launch() {
    if (brief.trim().length < 4) return;
    setBusy(true);
    setError(null);
    setCampaignId(null);
    try {
      const r = await fetch("/api/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brief,
          productUrl: url || undefined,
          mode,
          budgetPence: mode === "paid" ? Math.round(budget * 100) : 0,
          autonomy,
        }),
      });
      const j = await r.json();
      if (j.campaignId) setCampaignId(j.campaignId as Id<"campaigns">);
      if (j.error) setError(j.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const plan = campaign?.plan as PlanShape | undefined;
  const working = campaign && ["draft", "researching"].includes(campaign.status);

  return (
    <div className="max-w-4xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">LAUNCH</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-6 rise">
        DESCRIBE WHAT YOU WANT TO PROMOTE — THE ENGINE RESEARCHES, PLANS AND STAGES THE WHOLE CAMPAIGN
      </p>

      <div className="border border-line bg-panel p-5 rise">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Promote my new app Snuffloe — calm-dog enrichment shop. Target UK dog owners, playful tone. Build a funnel with a launch discount and schedule 2 weeks of content."
          className="w-full bg-void border border-line-2 p-3 text-sm text-ink min-h-24 focus:border-signal outline-none"
        />
        <div className="grid md:grid-cols-2 gap-3 mt-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Product URL (optional — pulls brand stills & copy)"
            className="bg-void border border-line-2 p-2.5 text-xs text-ink focus:border-signal outline-none"
          />
          <div className="flex gap-2">
            <Toggle value={mode === "free"} on={() => setMode("free")} label="FREE" />
            <Toggle value={mode === "paid"} on={() => setMode("paid")} label="PAID" />
            {mode === "paid" && (
              <div className="flex items-center gap-1 text-xs text-ink-dim">
                £
                <input
                  type="number"
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="w-16 bg-void border border-line-2 p-1.5 text-xs text-ink focus:border-signal outline-none"
                />
                <span className="text-ink-faint">cap</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
          <div className="flex gap-2">
            {(["manual", "assist", "auto"] as Autonomy[]).map((a) => (
              <Toggle key={a} value={autonomy === a} on={() => setAutonomy(a)} label={a.toUpperCase()} />
            ))}
          </div>
          <button
            onClick={launch}
            disabled={busy || brief.trim().length < 4}
            className="bg-signal text-void display font-extrabold text-sm px-6 py-2.5 disabled:opacity-40 hover:opacity-90"
          >
            {busy ? "LAUNCHING…" : "LAUNCH CAMPAIGN →"}
          </button>
        </div>
        <p className="text-[10px] text-ink-faint mt-3 tracking-wide">
          DRY-RUN by default — posting/emailing/discounts are SIMULATED until Live Mode is enabled in Settings and the
          relevant API key is in the vault. No assets are rendered here.
        </p>
      </div>

      {error && <div className="mt-4 border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400">{error}</div>}

      {campaign && (
        <div className="mt-6 rise">
          <div className="flex items-center gap-3 mb-4">
            <span className="display font-bold text-xl">{campaign.productName ?? campaign.name}</span>
            <StatusPill status={campaign.status} />
            {working && <span className="text-[10px] text-ink-faint tracking-widest animate-pulse">REASONING…</span>}
          </div>

          {plan ? (
            <div className="space-y-4">
              <Panel title="STRATEGY">
                <p className="text-sm text-ink">{plan.objective}</p>
                <p className="text-xs text-ink-dim mt-1">{plan.summary}</p>
              </Panel>

              <div className="grid md:grid-cols-2 gap-4">
                <Panel title="CHANNEL MIX">
                  <ul className="space-y-1">
                    {(plan.channelMix ?? []).map((c, i) => (
                      <li key={i} className="text-xs flex justify-between">
                        <span className="text-ink">{c.channel}</span>
                        <span className="text-ink-faint">{c.role}{c.paid ? " · paid" : " · free"}</span>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <Panel title="FUNNEL">
                  <div className="text-sm text-ink font-semibold">{plan.funnel?.headline}</div>
                  <div className="text-xs text-ink-dim">{plan.funnel?.subhead}</div>
                  {plan.discount?.code && (
                    <div className="mt-2 inline-block border border-signal text-signal text-xs px-2 py-1">
                      {plan.discount.code} — {plan.discount.percentOff ?? 0}% off
                    </div>
                  )}
                  {campaign.funnelSlug && (
                    <Link href={`/f/${campaign.funnelSlug}`} className="block mt-2 text-xs text-signal hover:underline">
                      preview funnel → /f/{campaign.funnelSlug}
                    </Link>
                  )}
                </Panel>
              </div>

              <Panel title={`CONTENT CALENDAR — ${(plan.contentCalendar ?? []).length} items`}>
                <div className="grid gap-1 max-h-64 overflow-y-auto">
                  {(plan.contentCalendar ?? []).map((c, i) => (
                    <div key={i} className="text-xs flex gap-3 border-b border-line/50 py-1">
                      <span className="text-ink-faint w-12 shrink-0">D{c.day}</span>
                      <span className="text-signal w-20 shrink-0">{c.channel}</span>
                      <span className="text-ink-dim w-16 shrink-0">{c.format}</span>
                      <span className="text-ink truncate">{c.hook}</span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title={`STEP PLAN — ${(steps ?? []).length} steps`}>
                <div className="space-y-1">
                  {(steps ?? []).map((s) => (
                    <div key={s._id} className="text-xs flex items-center gap-3">
                      <span className="text-ink-faint w-6">{s.order}</span>
                      <span className="text-ink w-32">{s.kind}{s.channel ? `/${s.channel}` : ""}</span>
                      <StatusPill status={s.status} small />
                      {s.paid && <span className="text-amber-400 text-[10px]">paid</span>}
                    </div>
                  ))}
                </div>
              </Panel>

              {campaign.status === "awaiting_approval" && (
                <button
                  onClick={() => patch({ id: campaign._id, status: "live" })}
                  className="bg-signal text-void display font-extrabold text-sm px-6 py-2.5 hover:opacity-90"
                >
                  APPROVE & GO LIVE →
                </button>
              )}
              {campaign.status === "live" && (
                <div className="text-xs text-signal tracking-widest">● LIVE — steps advance on the campaign tick (every 15 min)</div>
              )}
            </div>
          ) : (
            <div className="text-ink-faint text-xs tracking-widest py-8">Gathering intel and drafting the plan…</div>
          )}
        </div>
      )}
    </div>
  );
}

type PlanShape = {
  objective?: string;
  summary?: string;
  channelMix?: { channel: string; role: string; paid: boolean }[];
  contentCalendar?: { day: number; channel: string; format: string; hook: string }[];
  funnel?: { headline?: string; subhead?: string };
  discount?: { code?: string; percentOff?: number };
};

function Toggle({ value, on, label }: { value: boolean; on: () => void; label: string }) {
  return (
    <button
      onClick={on}
      className={`text-[10px] tracking-widest px-3 py-1.5 border ${value ? "border-signal text-signal" : "border-line-2 text-ink-faint hover:text-ink"}`}
    >
      {label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-panel p-4">
      <div className="text-[9px] tracking-[0.25em] text-ink-faint uppercase mb-2">{title}</div>
      {children}
    </div>
  );
}

function StatusPill({ status, small }: { status: string; small?: boolean }) {
  const color =
    status === "live" || status === "done" ? "border-signal text-signal"
    : status === "failed" || status === "blocked" ? "border-red-500/50 text-red-400"
    : status === "awaiting_approval" ? "border-amber-400/50 text-amber-400"
    : "border-line-2 text-ink-faint";
  return (
    <span className={`${small ? "text-[9px] px-1.5 py-0.5" : "text-[10px] px-2 py-1"} tracking-[0.2em] border ${color}`}>
      {status.replace(/_/g, " ").toUpperCase()}
    </span>
  );
}
