"use client";

import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useState } from "react";

const BUDGETS = ["Under £50", "£50–150", "£150–500", "£500+ / monthly"];

export function IntakeForm({ service, cta }: { service: string; cta: string }) {
  const create = useMutation(api.leads.create);
  const [form, setForm] = useState({ name: "", email: "", brandLink: "", budget: "", timeline: "", message: "" });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.email) return;
    setBusy(true);
    try {
      const id = await create({ service, ...form });
      // Kick off the auto-draft reply (fire-and-forget).
      fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "draft", leadId: id }) }).catch(() => {});
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="border border-signal/40 bg-signal/5 p-8 text-center rounded-sm">
        <div className="text-signal text-3xl mb-2">✓</div>
        <div className="font-bold text-lg mb-1">Got it — you&apos;ll hear from us fast.</div>
        <p className="text-ink-dim text-sm">We reply within minutes, not days. Check your inbox shortly.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Your name" className="bg-panel-2 border border-line-2 px-4 py-3 text-sm rounded-sm focus:border-signal outline-none" />
        <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" className="bg-panel-2 border border-line-2 px-4 py-3 text-sm rounded-sm focus:border-signal outline-none" />
      </div>
      <input value={form.brandLink} onChange={(e) => setForm({ ...form, brandLink: e.target.value })} placeholder="Your product / brand link" className="w-full bg-panel-2 border border-line-2 px-4 py-3 text-sm rounded-sm focus:border-signal outline-none" />
      <div className="grid sm:grid-cols-2 gap-3">
        <select value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className="bg-panel-2 border border-line-2 px-4 py-3 text-sm rounded-sm focus:border-signal outline-none text-ink-dim">
          <option value="">Budget</option>
          {BUDGETS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <input value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} placeholder="Timeline (e.g. this week)" className="bg-panel-2 border border-line-2 px-4 py-3 text-sm rounded-sm focus:border-signal outline-none" />
      </div>
      <textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What do you need? (product, vibe, goal)" rows={2} className="w-full bg-panel-2 border border-line-2 px-4 py-3 text-sm rounded-sm focus:border-signal outline-none" />
      <button disabled={busy} className="w-full bg-signal text-void display font-bold py-4 text-sm tracking-wide rounded-sm hover:brightness-110 transition disabled:opacity-50">
        {busy ? "SENDING…" : cta}
      </button>
      <p className="text-ink-faint text-[11px] text-center">Free sample concept available · No lock-in · Reply in minutes</p>
    </form>
  );
}
