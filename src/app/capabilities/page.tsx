"use client";

import { useEffect, useState } from "react";

// What the media engine can do — reads the live capability manifest so the
// interface (and Jarvis) can see every agent, tool, workflow and channel.

type Manifest = {
  engine: string;
  model: string;
  provider: string;
  agents: { id: string; name: string; role: string; tools: string[] }[];
  tools: { id: string; category: string; description: string }[];
  workflows: { id: string; description: string }[];
  capabilities: { area: string; items: string[] }[];
  channels: string[];
};

export default function Capabilities() {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then(setM)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="text-red-400 text-xs">{err}</div>;
  if (!m) return <div className="text-ink-faint text-xs tracking-widest">Loading capabilities…</div>;

  return (
    <div className="max-w-5xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">CAPABILITIES</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-6 rise">
        WHAT THIS ENGINE CAN DO — {m.model} · {m.provider}
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        {m.capabilities.map((c) => (
          <div key={c.area} className="border border-line bg-panel p-4 rise">
            <div className="text-[9px] tracking-[0.25em] text-signal uppercase mb-2">{c.area}</div>
            <ul className="space-y-1">
              {c.items.map((it) => (
                <li key={it} className="text-xs text-ink-dim">• {it}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <Panel title={`AGENTS — ${m.agents.length} (Codex CLI)`}>
        <div className="grid md:grid-cols-2 gap-3">
          {m.agents.map((a) => (
            <div key={a.id} className="border border-line-2 p-3">
              <div className="display font-bold text-sm">{a.name}</div>
              <div className="text-[11px] text-ink-dim mt-1">{a.role}</div>
              <div className="flex flex-wrap gap-1 mt-2">
                {a.tools.map((t) => (
                  <span key={t} className="text-[9px] text-ink-faint border border-line-2 px-1.5 py-0.5">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title={`TOOLS — ${m.tools.length}`}>
        <div className="grid md:grid-cols-2 gap-1">
          {m.tools.map((t) => (
            <div key={t.id} className="text-xs flex gap-2 border-b border-line/40 py-1">
              <span className="text-signal w-40 shrink-0">{t.id}</span>
              <span className="text-ink-faint truncate">{t.description}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <Panel title={`WORKFLOWS — ${m.workflows.length}`}>
          {m.workflows.map((w) => (
            <div key={w.id} className="text-xs mb-1">
              <span className="text-signal">{w.id}</span> <span className="text-ink-dim">{w.description}</span>
            </div>
          ))}
        </Panel>
        <Panel title={`CHANNELS — ${m.channels.length}`}>
          <div className="flex flex-wrap gap-1">
            {m.channels.map((c) => (
              <span key={c} className="text-[10px] text-ink-dim border border-line-2 px-2 py-0.5">{c}</span>
            ))}
          </div>
        </Panel>
      </div>
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
