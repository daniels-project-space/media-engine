"use client";

type Strategy = {
  audience: string; positioning: string; objective: string;
  channels: Array<{ name: string; rationale: string; [key: string]: unknown }>;
  pillars: string[]; assumptions: string[]; missingInformation: string[];
  experiments: Array<{ hypothesis: string; measure: string; stopCondition: string; [key: string]: unknown }>;
  [key: string]: unknown;
};
function structured(value: string): Strategy | null {
  try {
    const row: unknown = JSON.parse(value);
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const s = row as Record<string, unknown>;
    if (![s.audience, s.positioning, s.objective].every(x => typeof x === "string") ||
      ![s.pillars, s.assumptions, s.missingInformation].every(x => Array.isArray(x) && x.every(item => typeof item === "string")) ||
      !Array.isArray(s.channels) || !s.channels.every(x => x && typeof x === "object" && typeof x.name === "string" && typeof x.rationale === "string") ||
      !Array.isArray(s.experiments) || !s.experiments.every(x => x && typeof x === "object" && typeof x.hypothesis === "string" && typeof x.measure === "string" && typeof x.stopCondition === "string")) return null;
    return s as Strategy;
  } catch { return null; }
}
const inputClass = "w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink outline-none focus:border-signal";
export default function MarketingStrategyEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const strategy = structured(value);
  const edit = (change: Partial<Strategy>) => { if (strategy) onChange(JSON.stringify({ ...strategy, ...change }, null, 2)); };
  if (!strategy) return <label className="grid gap-1 text-xs text-ink-dim">Strategy<textarea className={inputClass} value={value} maxLength={20000} onChange={event => onChange(event.target.value)} required /></label>;
  return <section className="grid gap-3">
    <h4 className="text-sm font-bold">Strategy</h4>
    {value.length > 20000 ? <p className="text-xs text-amber-600" role="alert">The strategy is over the 20,000-character limit; shorten it before saving.</p> : null}
    {([ ["audience", "Audience"], ["positioning", "Positioning"], ["objective", "Objective"] ] as const).map(([key, label]) =>
      <label key={key} className="grid gap-1 text-xs text-ink-dim">{label}<textarea className={inputClass} value={strategy[key]} maxLength={2000} onChange={event => edit({ [key]: event.target.value })} /></label>)}
    {([ ["pillars", "Content pillars"], ["assumptions", "Assumptions"], ["missingInformation", "Missing information"] ] as const).map(([key, label]) =>
      <label key={key} className="grid gap-1 text-xs text-ink-dim">{label} · one per line<textarea className={inputClass} value={strategy[key].join("\n")} onChange={event => edit({ [key]: event.target.value.split("\n") })} onBlur={() => edit({ [key]: strategy[key].filter(Boolean) })} /></label>)}
    {strategy.channels.map((channel, index) => <div key={index} className="grid gap-2 rounded-xl border border-line p-3">
      <label className="grid gap-1 text-xs text-ink-dim">Channel {index + 1}<input className={inputClass} value={channel.name} onChange={event => edit({ channels: strategy.channels.map((c, i) => i === index ? { ...c, name: event.target.value } : c) })} /></label>
      <label className="grid gap-1 text-xs text-ink-dim">Channel rationale {index + 1}<textarea className={inputClass} value={channel.rationale} onChange={event => edit({ channels: strategy.channels.map((c, i) => i === index ? { ...c, rationale: event.target.value } : c) })} /></label>
    </div>)}
    {strategy.experiments.map((experiment, index) => <div key={index} className="grid gap-2 rounded-xl border border-line p-3">
      {([ ["hypothesis", "Hypothesis"], ["measure", "Success measure"], ["stopCondition", "Stop condition"] ] as const).map(([key, label]) =>
        <label key={key} className="grid gap-1 text-xs text-ink-dim">{label} {index + 1}<textarea className={inputClass} value={experiment[key]} onChange={event => edit({ experiments: strategy.experiments.map((e, i) => i === index ? { ...e, [key]: event.target.value } : e) })} /></label>)}
    </div>)}
    <details><summary className="cursor-pointer text-xs text-ink-dim">Advanced strategy text</summary>
      <label className="grid gap-1 pt-2 text-xs text-ink-dim">Strategy text<textarea className={inputClass} value={value} maxLength={20000} onChange={event => onChange(event.target.value)} /></label>
    </details>
  </section>;
}
