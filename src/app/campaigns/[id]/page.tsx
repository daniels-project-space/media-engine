"use client";

import { use } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cid = id as Id<"campaigns">;
  const campaign = useQuery(api.campaigns.get, { id: cid });
  const steps = useQuery(api.campaigns.steps, { campaignId: cid });
  const intel = useQuery(api.intel.forCampaign, { campaignId: cid });
  const engagement = useQuery(api.engagement.campaignSummary, { campaignId: cid });
  const patch = useMutation(api.campaigns.patch);
  const remove = useMutation(api.campaigns.remove);
  const router = useRouter();

  if (campaign === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  if (campaign === null) return <div className="text-ink-faint text-xs">Not found. <Link href="/campaigns" className="text-signal">← back</Link></div>;

  const plan = campaign.plan as PlanShape | undefined;
  const pct = campaign.budgetPence > 0 ? Math.min(100, (campaign.spentPence / campaign.budgetPence) * 100) : 0;

  return (
    <div className="max-w-5xl">
      <Link href="/campaigns" className="text-xs text-ink-faint hover:text-ink">← campaigns</Link>
      <div className="flex items-center gap-3 mt-2 mb-6 rise">
        <h1 className="display font-extrabold text-3xl tracking-tight">{campaign.productName ?? campaign.name}</h1>
        <span className="text-[10px] tracking-[0.2em] px-2 py-1 border border-line-2 text-ink-faint">
          {campaign.status.replace(/_/g, " ").toUpperCase()}
        </span>
      </div>

      <div className="grid md:grid-cols-4 gap-3 mb-6">
        <Stat label="MODE" value={campaign.mode.toUpperCase()} />
        <Stat label="AUTONOMY" value={campaign.autonomy.toUpperCase()} />
        <Stat label="SPEND" value={`£${(campaign.spentPence / 100).toFixed(2)}${campaign.budgetPence ? ` / £${(campaign.budgetPence / 100).toFixed(0)}` : ""}`} sub={campaign.budgetPence ? `${pct.toFixed(0)}% of cap` : "free mode"} />
        <Stat label="ENGAGEMENT" value={engagement ? `${engagement.impressions} impr` : "—"} sub={engagement ? `${engagement.likes} likes · ${engagement.clicks} clicks` : "no data yet"} />
      </div>

      {plan && (
        <Panel title="STRATEGY">
          <p className="text-sm text-ink">{plan.objective}</p>
          <p className="text-xs text-ink-dim mt-1">{plan.summary}</p>
          {campaign.funnelSlug && (
            <Link href={`/f/${campaign.funnelSlug}`} className="inline-block mt-2 text-xs text-signal hover:underline">
              funnel → /f/{campaign.funnelSlug}
            </Link>
          )}
        </Panel>
      )}

      <Panel title={`STEPS — ${(steps ?? []).length}`}>
        <div className="space-y-1">
          {(steps ?? []).map((s) => (
            <div key={s._id} className="text-xs flex items-center gap-3 border-b border-line/40 py-1">
              <span className="text-ink-faint w-6">{s.order}</span>
              <span className="text-ink w-40">{s.kind}{s.channel ? `/${s.channel}` : ""}</span>
              <span
                className={`text-[9px] tracking-[0.15em] px-1.5 py-0.5 border ${
                  s.status === "done" ? "border-signal text-signal"
                  : s.status === "failed" || s.status === "blocked" ? "border-red-500/50 text-red-400"
                  : s.status === "running" ? "border-amber-400/50 text-amber-400"
                  : "border-line-2 text-ink-faint"
                }`}
              >
                {s.status.toUpperCase()}
              </span>
              {s.dryRun && <span className="text-[9px] text-ink-faint">dry-run</span>}
              <span className="text-ink-faint truncate flex-1">{s.error ?? (s.result ? JSON.stringify(s.result).slice(0, 80) : "")}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`INTEL — ${(intel ?? []).length} reports`}>
        <div className="space-y-1">
          {(intel ?? []).map((r) => (
            <div key={r._id} className="text-xs text-ink-dim">
              <span className="text-signal">{r.kind}</span> · {r.query} <span className="text-ink-faint">({r.source})</span>
            </div>
          ))}
          {(intel ?? []).length === 0 && <div className="text-ink-faint text-xs">No intel gathered.</div>}
        </div>
      </Panel>

      <div className="flex gap-3 mt-4">
        {campaign.status === "awaiting_approval" && (
          <button onClick={() => patch({ id: cid, status: "live" })} className="bg-signal text-void display font-extrabold text-xs px-5 py-2 hover:opacity-90">
            APPROVE & GO LIVE →
          </button>
        )}
        {campaign.status === "live" && (
          <button onClick={() => patch({ id: cid, status: "paused" })} className="border border-line-2 text-ink-dim text-xs px-5 py-2 hover:text-ink">
            PAUSE
          </button>
        )}
        {campaign.status === "paused" && (
          <button onClick={() => patch({ id: cid, status: "live" })} className="bg-signal text-void display font-extrabold text-xs px-5 py-2 hover:opacity-90">
            RESUME
          </button>
        )}
        <button
          onClick={async () => { await remove({ id: cid }); router.push("/campaigns"); }}
          className="border border-red-500/40 text-red-400/80 text-xs px-5 py-2 hover:bg-red-500/10 ml-auto"
        >
          DELETE
        </button>
      </div>
      {campaign.error && <div className="mt-4 border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-400">{campaign.error}</div>}
    </div>
  );
}

type PlanShape = { objective?: string; summary?: string };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-line bg-panel p-3">
      <div className="text-[9px] tracking-[0.25em] text-ink-faint uppercase">{label}</div>
      <div className="display font-bold text-lg mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-panel p-4 mb-4">
      <div className="text-[9px] tracking-[0.25em] text-ink-faint uppercase mb-2">{title}</div>
      {children}
    </div>
  );
}
