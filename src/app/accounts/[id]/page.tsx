"use client";

import { use } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import Link from "next/link";

const STATUSES = ["prospect", "active", "paused", "churned"] as const;

export default function AccountWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cid = id as Id<"clients">;
  const ws = useQuery(api.crm.workspace, { id: cid });
  const patch = useMutation(api.crm.patch);

  if (ws === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  if (ws === null) return <div className="text-ink-faint text-xs">Not found. <Link href="/accounts" className="text-signal">← accounts</Link></div>;

  const { client, campaigns, stores, personas } = ws;
  const bk = (client.brandKit ?? {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(bk[k]) ? (bk[k] as string[]) : []);

  return (
    <div className="max-w-5xl">
      <Link href="/accounts" className="text-xs text-ink-faint hover:text-ink">← accounts</Link>
      <div className="flex items-center gap-3 mt-2 mb-1 rise">
        <h1 className="display font-extrabold text-3xl tracking-tight">{client.name}</h1>
        <span className="text-[10px] tracking-[0.2em] px-2 py-1 border border-line-2 text-ink-faint">{client.status.toUpperCase()}</span>
      </div>
      {client.website && <a href={client.website} target="_blank" rel="noreferrer" className="text-xs text-signal hover:underline">{client.website}</a>}

      <div className="flex gap-2 mt-3 mb-6">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => patch({ id: cid, status: s })}
            className={`text-[10px] tracking-widest px-3 py-1.5 border ${client.status === s ? "border-signal text-signal" : "border-line-2 text-ink-faint hover:text-ink"}`}>
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <Panel title="BRAND KIT">
        {!client.brandKit ? (
          <div className="text-ink-faint text-xs">Not enriched yet — re-onboard with a website, or it fills on the next campaign.</div>
        ) : (
          <div className="space-y-2 text-xs">
            {typeof bk.oneLiner === "string" && <div className="text-ink text-sm">{bk.oneLiner}</div>}
            <KV k="Voice / tone" v={String(bk.voice ?? "")} />
            <KV k="Audience" v={String(bk.audience ?? "")} />
            <Chips k="Value props" items={arr("valueProps")} />
            <Chips k="Differentiators" items={arr("differentiators")} />
            <Chips k="Competitors" items={arr("competitors")} />
            <Chips k="Keywords" items={arr("keywords")} />
            {arr("colors").length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-ink-faint w-28 shrink-0">Palette</span>
                <div className="flex gap-1">
                  {arr("colors").map((c) => <span key={c} className="size-4 border border-line-2" style={{ background: c }} title={c} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="grid md:grid-cols-3 gap-4">
        <Panel title={`CAMPAIGNS — ${campaigns.length}`}>
          {campaigns.length === 0 ? <Empty /> : campaigns.map((c) => (
            <Link key={c._id} href={`/campaigns/${c._id}`} className="block text-xs text-ink-dim hover:text-signal py-0.5 truncate">{c.productName ?? c.name} <span className="text-ink-faint">· {c.status}</span></Link>
          ))}
        </Panel>
        <Panel title={`STORES — ${stores.length}`}>
          {stores.length === 0 ? <Empty /> : stores.map((s) => (
            <div key={s._id} className="text-xs text-ink-dim py-0.5 truncate">{s.name ?? s.domain}</div>
          ))}
        </Panel>
        <Panel title={`PERSONAS — ${personas.length}`}>
          {personas.length === 0 ? <Empty /> : personas.map((p) => (
            <Link key={p._id} href={`/personas/${p._id}`} className="block text-xs text-ink-dim hover:text-signal py-0.5 truncate">{p.name} <span className="text-ink-faint">{p.handle}</span></Link>
          ))}
        </Panel>
      </div>
      {client.goals && <Panel title="GOALS"><p className="text-xs text-ink-dim">{client.goals}</p></Panel>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-line bg-panel p-4 mb-4 rise">
      <div className="text-[9px] tracking-[0.25em] text-ink-faint uppercase mb-2">{title}</div>
      {children}
    </div>
  );
}
function KV({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return <div className="flex gap-2"><span className="text-ink-faint w-28 shrink-0">{k}</span><span className="text-ink">{v}</span></div>;
}
function Chips({ k, items }: { k: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="flex gap-2">
      <span className="text-ink-faint w-28 shrink-0">{k}</span>
      <div className="flex flex-wrap gap-1">{items.map((it) => <span key={it} className="text-[10px] text-ink-dim border border-line-2 px-1.5 py-0.5">{it}</span>)}</div>
    </div>
  );
}
function Empty() {
  return <div className="text-ink-faint text-[11px]">none yet</div>;
}
