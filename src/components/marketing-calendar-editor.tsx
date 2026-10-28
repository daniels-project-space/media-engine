"use client";

type Entry = {
  day: number;
  localTime?: string;
  channel: "instagram" | "x" | "reddit";
  format: string;
  rationale: string;
  caption: string;
  cta?: string;
  promotion?: string;
  hashtags: string[];
  videoScript: string;
  [key: string]: unknown;
};

// Keep unknown fields from existing plans so editing never silently discards
// metadata added by a newer planner. Free-text/invalid plans stay editable.
function parseEntries(value: string): Entry[] | null {
  if (!value.trim()) return [];
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows) || rows.length > 28) return null;
    if (!rows.every(row => row && typeof row === "object" && !Array.isArray(row) &&
      Number.isInteger(row.day) && row.day >= 1 && row.day <= 14 &&
      ["instagram", "x", "reddit"].includes(row.channel) &&
      typeof row.format === "string" && typeof row.rationale === "string" &&
      typeof row.caption === "string" && typeof row.videoScript === "string" &&
      (row.localTime === undefined || typeof row.localTime === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.localTime)) &&
      (row.cta === undefined || typeof row.cta === "string") &&
      (row.promotion === undefined || typeof row.promotion === "string") &&
      Array.isArray(row.hashtags) && row.hashtags.every((tag: unknown) => typeof tag === "string"))) return null;
    return rows as Entry[];
  } catch { return null; }
}

const inputClass = "w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink outline-none focus:border-signal";

export default function MarketingCalendarEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const entries = parseEntries(value);
  const save = (rows: Entry[]) => onChange(JSON.stringify(rows, null, 2));
  const edit = (index: number, change: Partial<Entry>) => {
    if (!entries) return;
    save(entries.map((row, i) => i === index ? { ...row, ...change } : row));
  };
  return <section className="grid gap-3">
    <div>
      <h4 className="text-sm font-bold">14-day content plan</h4>
      <p className="text-xs leading-5 text-ink-dim">Add or edit ideas here, then save the plan. Posts and render briefs remain drafts until you review them.</p>
    </div>
    {entries === null ? <p className="text-xs text-amber-600" role="status">This saved plan is free text or has an unsupported format. Edit it below; its contents have been preserved.</p> : <>
      {entries.length === 0 ? <p className="text-xs text-ink-dim">No calendar items yet.</p> : null}
      {entries.map((entry, index) => <details key={index} className="rounded-xl border border-line p-3" open={entries.length === 1 ? true : undefined}>
        <summary className="cursor-pointer text-xs font-bold">Day {entry.day} · {entry.localTime ?? "09:00"} · {entry.channel} · {entry.format || "New idea"}</summary>
        <div className="grid gap-3 pt-3">
          <label className="grid gap-1 text-xs text-ink-dim">Day for item {index + 1}
            <select className={inputClass} value={entry.day} onChange={event => edit(index, { day: Number(event.target.value) })}>
              {Array.from({ length: 14 }, (_, i) => <option className="bg-void" key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-dim">Proposed local posting time<input className={inputClass} type="time" value={entry.localTime ?? "09:00"} onChange={event => edit(index, { localTime: event.target.value })} /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Platform for item {index + 1}
            <select className={inputClass} value={entry.channel} onChange={event => edit(index, { channel: event.target.value as Entry["channel"] })}>
              <option className="bg-void" value="instagram">Instagram</option><option className="bg-void" value="x">X</option><option className="bg-void" value="reddit">Reddit</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs text-ink-dim">Format for item {index + 1}<input className={inputClass} maxLength={200} value={entry.format} onChange={event => edit(index, { format: event.target.value })} placeholder="e.g. product demo" /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Post copy for item {index + 1}<textarea className={inputClass} maxLength={2000} value={entry.caption} onChange={event => edit(index, { caption: event.target.value })} /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Call to action for item {index + 1}<input className={inputClass} maxLength={300} value={entry.cta ?? ""} onChange={event => edit(index, { cta: event.target.value })} placeholder="e.g. See how it works" /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Confirmed promotion for item {index + 1}<input className={inputClass} maxLength={500} value={entry.promotion ?? ""} onChange={event => edit(index, { promotion: event.target.value })} placeholder="Leave empty if there is no confirmed offer" /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Why this post for item {index + 1}<textarea className={inputClass} maxLength={2000} value={entry.rationale} onChange={event => edit(index, { rationale: event.target.value })} /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Hashtags for item {index + 1}<input className={inputClass} value={entry.hashtags.join(" ")} onChange={event => edit(index, { hashtags: event.target.value ? event.target.value.split(" ") : [] })} onBlur={() => edit(index, { hashtags: entry.hashtags.filter(Boolean) })} placeholder="#example #product" /></label>
          <label className="grid gap-1 text-xs text-ink-dim">Video script for item {index + 1}<textarea className={inputClass} maxLength={4000} value={entry.videoScript} onChange={event => edit(index, { videoScript: event.target.value })} placeholder="Hook, scenes, voiceover and call to action" /></label>
          {entry.hashtags.filter(Boolean).length > 8 ? <p className="text-xs text-amber-600" role="status">Use at most eight hashtags before creating a post draft.</p> : null}
          <button type="button" className="justify-self-start rounded-lg border border-line px-3 py-2 text-xs" onClick={() => save(entries.filter((_, i) => i !== index))}>Remove item {index + 1}</button>
        </div>
      </details>)}
      <button type="button" className="justify-self-start rounded-lg border border-line px-3 py-2 text-xs" disabled={entries.length >= 28} onClick={() => save([...entries, { day: 1, localTime: "09:00", channel: "instagram", format: "", rationale: "", caption: "", cta: "", promotion: "", hashtags: [], videoScript: "" }])}>Add calendar item</button>
    </>}
    <details open={entries === null ? true : undefined}>
      <summary className="cursor-pointer text-xs text-ink-dim">{entries === null ? "Edit existing plan text" : "Advanced plan text"}</summary>
      <label className="grid gap-1 pt-2 text-xs text-ink-dim">14-day content plan text<textarea className={inputClass} value={value} maxLength={20000} onChange={event => onChange(event.target.value)} /></label>
    </details>
    {value.length > 20000 ? <p className="text-xs text-amber-600" role="alert">The plan is over the 20,000-character limit; shorten it before saving.</p> : null}
  </section>;
}
