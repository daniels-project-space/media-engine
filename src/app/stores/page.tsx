"use client";

import { useEffect, useState } from "react";

// Connect a Shopify store → the engine pulls its real products and computes
// per-product channel plans, so campaigns targeting the store are product-aware.

type Store = { _id: string; domain: string; name?: string; products: number; lastSyncedAt?: number };

export default function Stores() {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/store");
    const j = await r.json();
    setStores(j.stores ?? []);
  }
  useEffect(() => {
    load();
  }, []);

  async function connect() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/store", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(domain ? { domain } : {}),
      });
      const j = await r.json();
      if (j.error) setMsg(j.error);
      else setMsg(`Synced ${j.products ?? 0} products${j.topChannels ? ` · top channels: ${j.topChannels.join(", ")}` : ""}${j.note ? ` (${j.note})` : ""}`);
      setDomain("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">STORES</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-6 rise">
        CONNECT A SHOPIFY STORE — PRODUCTS + PER-PRODUCT CHANNEL PLANS FEED THE STRATEGIST
      </p>

      <div className="border border-line bg-panel p-4 mb-6 rise flex flex-col sm:flex-row gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="store.myshopify.com (blank = vault SHOPIFY_STORE_DOMAIN)"
          className="flex-1 bg-void border border-line-2 p-2.5 text-xs text-ink focus:border-signal outline-none"
        />
        <button onClick={connect} disabled={busy} className="bg-signal text-void display font-extrabold text-xs px-5 py-2 disabled:opacity-40 hover:opacity-90">
          {busy ? "SYNCING…" : "CONNECT + SYNC"}
        </button>
      </div>
      {msg && <div className="mb-4 border border-line-2 bg-panel-2/40 p-3 text-xs text-ink-dim">{msg}</div>}

      {stores === undefined || stores === null ? (
        <div className="text-ink-faint text-xs tracking-widest">Loading…</div>
      ) : stores.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NO STORES — ADD SHOPIFY CREDS TO VAULT &apos;shopify&apos; THEN CONNECT
        </div>
      ) : (
        <div className="grid gap-3">
          {stores.map((s) => (
            <div key={s._id} className="border border-line bg-panel p-4 flex items-center justify-between rise">
              <div>
                <div className="display font-bold text-lg">{s.name ?? s.domain}</div>
                <div className="text-xs text-ink-faint">{s.domain}</div>
              </div>
              <div className="text-xs text-ink-dim tabular-nums">{s.products} products</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
