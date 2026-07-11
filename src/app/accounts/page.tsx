"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Link from "next/link";

// The client roster — the agency's accounts. Onboard a client (name + website)
// and the engine pulls a brand kit from its site; every campaign/store/persona
// then hangs off it and is planned strictly on-brand.
export default function Accounts() {
  const clients = useQuery(api.crm.list, {});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", website: "", brief: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onboard() {
    if (form.name.trim().length < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/client", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (j.error) setMsg(j.error);
      else setMsg(j.enriched ? "Client onboarded — brand kit pulled from the site." : "Client created (brand kit not enriched — add a website/brief, or it can be filled later).");
      setForm({ name: "", website: "", brief: "" });
      setOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-2 rise">
        <h1 className="display font-extrabold text-4xl tracking-tight">ACCOUNTS</h1>
        <button onClick={() => setOpen(!open)} className="bg-signal text-void display font-extrabold text-xs px-4 py-2 hover:opacity-90">
          {open ? "CLOSE" : "+ ONBOARD CLIENT"}
        </button>
      </div>
      <p className="text-ink-dim text-xs tracking-wider mb-6 rise">
        YOUR CLIENT ACCOUNTS — EACH IS A BRAND WITH ITS OWN BRAND KIT; EVERYTHING IS PLANNED ON-BRAND FOR IT
      </p>

      {open && (
        <div className="border border-line bg-panel p-5 mb-6 rise space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <Field label="CLIENT / BRAND NAME" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="WEBSITE (pulls the brand kit)" value={form.website} onChange={(v) => setForm({ ...form, website: v })} />
          </div>
          <label className="block">
            <span className="text-[9px] tracking-[0.25em] text-ink-faint uppercase">BRIEF (optional — what they do, goals)</span>
            <textarea value={form.brief} onChange={(e) => setForm({ ...form, brief: e.target.value })}
              className="w-full bg-void border border-line-2 p-2.5 text-xs text-ink focus:border-signal outline-none mt-1 min-h-16" />
          </label>
          <button onClick={onboard} disabled={busy || form.name.trim().length < 2}
            className="bg-signal text-void display font-extrabold text-xs px-5 py-2 disabled:opacity-40 hover:opacity-90">
            {busy ? "ONBOARDING…" : "ONBOARD →"}
          </button>
        </div>
      )}
      {msg && <div className="mb-4 border border-line-2 bg-panel-2/40 p-3 text-xs text-ink-dim">{msg}</div>}

      {clients === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NO CLIENTS YET — ONBOARD ONE (E.G. YOUR OWN BRANDS: SNUFFLOE, DB-CINEMA)
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {clients.map((c, i) => {
            const bk = (c.brandKit ?? {}) as { oneLiner?: string; voice?: string };
            return (
              <Link key={c._id} href={`/accounts/${c._id}`} className="border border-line bg-panel p-4 tile-hover rise" style={{ animationDelay: `${i * 50}ms` }}>
                <div className="flex items-center justify-between">
                  <span className="display font-bold text-lg">{c.name}</span>
                  <span className={`text-[9px] tracking-[0.2em] px-2 py-0.5 border ${c.status === "active" ? "border-signal text-signal" : "border-line-2 text-ink-faint"}`}>
                    {c.status.toUpperCase()}
                  </span>
                </div>
                {bk.oneLiner && <div className="text-xs text-ink-dim mt-1">{bk.oneLiner}</div>}
                <div className="text-[10px] text-ink-faint mt-2 flex gap-3">
                  {c.industry && <span>{c.industry}</span>}
                  {bk.voice && <span>voice: {bk.voice}</span>}
                  {!c.brandKit && <span className="text-amber-400">brand kit pending</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[9px] tracking-[0.25em] text-ink-faint uppercase">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-void border border-line-2 p-2.5 text-xs text-ink focus:border-signal outline-none mt-1" />
    </label>
  );
}
