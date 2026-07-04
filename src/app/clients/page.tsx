"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";
import { MediaTile } from "@/components/media-tile";
import { slideSrc, type Slide } from "@/lib/media";

const TIERS = ["basic", "standard", "premium"] as const;
const STATUSES = ["new", "in_progress", "delivered", "revision", "complete", "cancelled"] as const;
const STATUS_CLS: Record<string, string> = {
  new: "border-scope text-scope",
  in_progress: "border-amber text-amber",
  delivered: "border-signal text-signal",
  revision: "border-amber text-amber",
  complete: "border-signal text-signal",
  cancelled: "border-line-2 text-ink-faint",
};

function gbp(pence?: number): string {
  return `£${((pence ?? 0) / 100).toFixed(2)}`;
}

export default function Clients() {
  const orders = useQuery(api.clients.list);
  const stats = useQuery(api.clients.stats);
  const create = useMutation(api.clients.create);
  const update = useMutation(api.clients.update);
  const remove = useMutation(api.clients.remove);
  const [form, setForm] = useState({ buyer: "", source: "fiverr", tier: "standard", brief: "", price: "" });
  const [imgKey, setImgKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);

  async function uploadImg(f: File) {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const d = await r.json();
    if (d.key) setImgKey(d.key);
  }

  async function addOrder() {
    if (!form.buyer || !form.brief) return;
    await create({
      buyer: form.buyer,
      source: form.source,
      tier: form.tier as (typeof TIERS)[number],
      brief: form.brief,
      productImageKey: imgKey ?? undefined,
      pricePence: form.price ? Math.round(parseFloat(form.price) * 100) : undefined,
    });
    setForm({ buyer: "", source: "fiverr", tier: "standard", brief: "", price: "" });
    setImgKey(null);
  }

  async function generate(o: { _id: string; brief: string; tier: string; buyer: string; productImageKey?: string }) {
    setBusy(o._id + "gen");
    try {
      await update({ id: o._id as Id<"clientOrders">, status: "in_progress" });
      await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate", orderId: o._id, brief: o.brief, tier: o.tier, productImageKey: o.productImageKey, buyer: o.buyer }),
      });
    } finally {
      setBusy(null);
    }
  }

  async function draftReply(id: string, buyer: string) {
    setBusy(id + "reply");
    try {
      const msg = window.prompt("Paste the buyer's message to draft a reply:");
      if (!msg) return;
      const r = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "draft-reply", buyerMessage: msg, buyer }),
      });
      const d = await r.json();
      if (d.draft) setDraft({ id, text: d.draft });
    } finally {
      setBusy(null);
    }
  }

  if (orders === undefined) return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  const margin = (stats?.revenuePence ?? 0) - (stats?.costPence ?? 0);

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">CLIENT ORDERS</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-2 rise">
        FIVERR AI-ADS AGENCY — LOG ORDERS, GENERATE IN 4K SEEDANCE, DELIVER
      </p>
      <p className="text-ink-faint text-[11px] mb-6 rise max-w-2xl leading-relaxed">
        Fiverr has no seller API, so orders are logged here and fulfilled with the engine. Buyer
        replies are AI-drafted for you to send yourself (auto-messaging buyers breaks Fiverr rules).
      </p>

      {/* stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line mb-6 rise">
        {[
          { label: "OPEN ORDERS", value: String(stats?.open ?? 0), tone: "text-amber" },
          { label: "TOTAL", value: String(stats?.total ?? 0), tone: "text-ink" },
          { label: "REVENUE", value: gbp(stats?.revenuePence), tone: "text-signal" },
          { label: "MARGIN", value: gbp(margin), tone: margin >= 0 ? "text-signal" : "text-onair" },
        ].map((s) => (
          <div key={s.label} className="bg-panel p-4">
            <div className={`display font-extrabold text-2xl ${s.tone}`}>{s.value}</div>
            <div className="text-[10px] text-ink-faint tracking-[0.2em] mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* new order */}
      <div className="border border-line bg-panel p-5 mb-8 rise">
        <div className="text-[11px] tracking-[0.3em] text-signal mb-3">NEW ORDER</div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} placeholder="Buyer name / handle" className="bg-panel-2 border border-line-2 px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} className="bg-panel-2 border border-line-2 px-3 py-2 text-sm flex-1 uppercase text-[11px] tracking-widest">
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="£ price" inputMode="decimal" className="bg-panel-2 border border-line-2 px-3 py-2 text-sm w-24" />
          </div>
        </div>
        <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })} placeholder="Brief — what does the buyer want? (product, vibe, hook, target audience)" rows={3} className="w-full bg-panel-2 border border-line-2 px-3 py-2 text-sm mb-3" />
        <div className="flex items-center gap-3">
          <label className="text-[11px] tracking-widest text-ink-dim border border-line-2 px-3 py-2 cursor-pointer hover:border-signal">
            {imgKey ? "✓ PRODUCT IMAGE" : "+ PRODUCT IMAGE"}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImg(e.target.files[0])} />
          </label>
          <button onClick={addOrder} className="bg-signal text-void display font-bold px-5 py-2 text-xs hover:brightness-110 transition ml-auto">
            ADD ORDER
          </button>
        </div>
      </div>

      {/* orders */}
      {orders.length === 0 ? (
        <div className="border border-dashed border-line-2 p-10 text-center text-ink-faint text-xs">No orders yet.</div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <div key={o._id} className="border border-line bg-panel p-4 flex flex-col md:flex-row gap-4 rise">
              {o.delivery && (o.delivery.slides ?? []).some((s) => slideSrc(s as Slide)) ? (
                <div className="shrink-0"><MediaTile slide={(o.delivery.slides ?? []).find((s) => slideSrc(s as Slide)) as Slide} aspect="aspect-[9/16] w-28" /></div>
              ) : (
                <div className="shrink-0 aspect-[9/16] w-28 border border-line-2 bg-panel-2 grid place-items-center text-[9px] text-ink-faint text-center px-2">
                  {o.status === "in_progress" ? "RENDERING…" : "NO DELIVERY"}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3 mb-1">
                  <span className="font-bold text-sm">{o.buyer}</span>
                  <span className="text-[10px] tracking-widest text-ink-faint uppercase">{o.source} · {o.tier}</span>
                  <span className={`text-[10px] tracking-widest px-2 py-0.5 border ${STATUS_CLS[o.status]}`}>{o.status.replace("_", " ").toUpperCase()}</span>
                  {o.pricePence ? <span className="text-[10px] text-signal">{gbp(o.pricePence)}</span> : null}
                </div>
                <p className="text-ink-dim text-xs leading-relaxed line-clamp-2 mb-2">{o.brief}</p>
                {draft?.id === o._id && (
                  <div className="border border-line-2 bg-void/60 p-3 text-[11px] text-ink-dim whitespace-pre-line mb-2">
                    <div className="text-[9px] text-signal tracking-widest mb-1">DRAFTED REPLY — COPY & SEND ON FIVERR</div>
                    {draft.text}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => generate(o)} disabled={busy !== null} className="px-3 py-1.5 bg-signal text-void display font-bold text-[10px] tracking-widest hover:brightness-110 transition disabled:opacity-50">
                    {busy === o._id + "gen" ? "STARTING…" : "GENERATE 4K AD"}
                  </button>
                  <button onClick={() => draftReply(o._id, o.buyer)} disabled={busy !== null} className="px-3 py-1.5 border border-scope text-scope text-[10px] tracking-widest hover:bg-scope hover:text-void transition disabled:opacity-50">
                    {busy === o._id + "reply" ? "…" : "DRAFT REPLY"}
                  </button>
                  <select value={o.status} onChange={(e) => update({ id: o._id as Id<"clientOrders">, status: e.target.value as (typeof STATUSES)[number] })} className="bg-panel-2 border border-line-2 text-ink-dim text-[10px] tracking-widest px-2 py-1.5 uppercase">
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                  <button onClick={() => remove({ id: o._id as Id<"clientOrders"> })} className="px-3 py-1.5 border border-line-2 text-ink-faint text-[10px] tracking-widest hover:border-onair hover:text-onair transition ml-auto">
                    DELETE
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
