"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

// Model / LoRA registry — view existing trained looks and add new ones. A
// catalogue only: nothing is trained or rendered here.
export default function Models() {
  const models = useQuery(api.models.list, {});
  const create = useMutation(api.models.create);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "lora", provider: "fal", url: "", trigger: "", baseModel: "", tags: "" });

  async function add() {
    if (!form.name) return;
    await create({
      name: form.name,
      kind: form.kind as "lora" | "checkpoint" | "base",
      provider: form.provider as "fal" | "higgsfield" | "replicate" | "local" | "other",
      url: form.url || undefined,
      trigger: form.trigger || undefined,
      baseModel: form.baseModel || undefined,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()) : undefined,
    });
    setForm({ name: "", kind: "lora", provider: "fal", url: "", trigger: "", baseModel: "", tags: "" });
    setOpen(false);
  }

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-2 rise">
        <h1 className="display font-extrabold text-4xl tracking-tight">MODELS & LORAS</h1>
        <button onClick={() => setOpen(!open)} className="bg-signal text-void display font-extrabold text-xs px-4 py-2 hover:opacity-90">
          {open ? "CLOSE" : "+ ADD MODEL"}
        </button>
      </div>
      <p className="text-ink-dim text-xs tracking-wider mb-6 rise">
        THE VISUAL REGISTRY — WHICH TRAINED LOOKS THE STRATEGIST CAN REFERENCE FOR CONTENT
      </p>

      {open && (
        <div className="border border-line bg-panel p-4 mb-6 grid md:grid-cols-2 gap-3 rise">
          <Field label="NAME" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="TRIGGER WORD" value={form.trigger} onChange={(v) => setForm({ ...form, trigger: v })} />
          <Select label="KIND" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={["lora", "checkpoint", "base"]} />
          <Select label="PROVIDER" value={form.provider} onChange={(v) => setForm({ ...form, provider: v })} options={["fal", "higgsfield", "replicate", "local", "other"]} />
          <Field label="URL" value={form.url} onChange={(v) => setForm({ ...form, url: v })} />
          <Field label="BASE MODEL" value={form.baseModel} onChange={(v) => setForm({ ...form, baseModel: v })} />
          <Field label="TAGS (comma-sep)" value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} />
          <div className="flex items-end">
            <button onClick={add} className="bg-signal text-void display font-extrabold text-xs px-5 py-2 hover:opacity-90">SAVE MODEL</button>
          </div>
        </div>
      )}

      {models === undefined ? (
        <div className="text-ink-faint text-xs tracking-widest">Loading…</div>
      ) : models.length === 0 ? (
        <div className="border border-dashed border-line-2 p-12 text-center text-ink-faint text-xs tracking-[0.25em] rise">
          NO MODELS REGISTERED — ADD YOUR TRAINED LORAS
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {models.map((m, i) => (
            <div key={m._id} className="border border-line bg-panel p-4 rise" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <span className="display font-bold text-lg">{m.name}</span>
                <span className="text-[9px] tracking-widest px-2 py-0.5 border border-line-2 text-ink-faint">{m.kind.toUpperCase()}</span>
              </div>
              <div className="text-xs text-ink-dim mt-1">
                {m.provider}{m.trigger ? ` · trigger "${m.trigger}"` : ""}{m.baseModel ? ` · ${m.baseModel}` : ""}
              </div>
              {m.url && <div className="text-[10px] text-ink-faint mt-1 truncate">{m.url}</div>}
              {m.tags && m.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {m.tags.map((t) => (
                    <span key={t} className="text-[9px] text-ink-faint border border-line-2 px-1.5 py-0.5">{t}</span>
                  ))}
                </div>
              )}
              <div className="text-[9px] text-ink-faint mt-2 tracking-widest">{m.status.toUpperCase()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[9px] tracking-[0.25em] text-ink-faint uppercase">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-void border border-line-2 p-2 text-xs text-ink focus:border-signal outline-none mt-1" />
    </label>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block">
      <span className="text-[9px] tracking-[0.25em] text-ink-faint uppercase">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-void border border-line-2 p-2 text-xs text-ink focus:border-signal outline-none mt-1">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
