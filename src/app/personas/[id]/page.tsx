"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { use, useState } from "react";
import Link from "next/link";

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  planned: { text: "Planned", cls: "border-scope text-scope" },
  generating: { text: "Generating…", cls: "border-amber text-amber" },
  ready: { text: "Awaiting approval", cls: "border-amber text-amber" },
  approved: { text: "Approved", cls: "border-signal text-signal" },
  published: { text: "Published", cls: "border-signal text-signal" },
  rejected: { text: "Rejected", cls: "border-line-2 text-ink-faint" },
  failed: { text: "Failed", cls: "border-onair text-onair" },
};

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export default function PersonaDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const personaId = id as Id<"personas">;
  const personas = useQuery(api.personas.list);
  const posts = useQuery(api.posts.forPersona, { personaId });
  const removePost = useMutation(api.posts.remove);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const persona = personas?.find((p) => p._id === personaId);

  async function callTrigger(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setNotice(null);
    try {
      const r = await fetch("/api/trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      setNotice(r.ok ? `Job started (${label}). Results appear here automatically.` : `Error: ${JSON.stringify(data.error).slice(0, 160)}`);
    } catch (e) {
      setNotice(`Error: ${String(e).slice(0, 160)}`);
    } finally {
      setBusy(null);
    }
  }

  if (personas === undefined || posts === undefined) {
    return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  }
  if (!persona) {
    return (
      <div className="text-ink-dim text-sm">
        Persona not found. <Link href="/personas" className="text-scope underline">Back to personas</Link>
      </div>
    );
  }

  const gallery = posts.filter((p) => (p.slides ?? []).some((s) => s.url));
  const planned = posts.filter((p) => p.status === "planned" && p.scheduledAt);
  const byDay = planned.reduce<Record<string, typeof planned>>((acc, p) => {
    const d = dayLabel(p.scheduledAt!);
    (acc[d] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="max-w-6xl">
      <Link href="/personas" className="text-[10px] tracking-[0.25em] text-ink-faint hover:text-ink">
        ← ALL PERSONAS
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-4 mt-2 mb-8 rise">
        <div>
          <h1 className="display font-extrabold text-4xl tracking-tight leading-none">{persona.name}</h1>
          <p className="text-scope text-xs mt-2">{persona.handle} · {persona.niche}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => callTrigger({ action: "plan", personaId, days: 7, postsPerDay: 1 }, "plan week")}
            disabled={busy !== null}
            className="bg-signal text-void display font-bold px-5 py-2.5 text-xs hover:brightness-110 transition disabled:opacity-50"
            title="AI plans 7 days of posts (scenes, hooks, captions). Nothing is generated or published yet — plans land in the calendar below."
          >
            {busy === "plan week" ? "PLANNING…" : "PLAN NEXT 7 DAYS"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="border border-line bg-panel px-4 py-3 text-xs text-ink-dim mb-6">{notice}</div>
      )}

      <section className="mb-10 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">CONTENT CALENDAR</h2>
        <p className="text-ink-faint text-[11px] mb-3">
          Planned posts by day. «Generate» creates the images (needs approval after). Posting to
          Instagram activates once the account is linked in Settings.
        </p>
        {planned.length === 0 ? (
          <div className="border border-dashed border-line-2 p-8 text-center text-ink-faint text-xs">
            No planned posts yet — hit «PLAN NEXT 7 DAYS» above.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(byDay).map(([day, items]) => (
              <div key={day} className="border border-line bg-panel">
                <div className="px-4 py-2 border-b border-line text-[10px] tracking-[0.25em] text-ink-dim">
                  {day.toUpperCase()}
                </div>
                {items.map((p) => (
                  <div key={p._id} className="p-4 border-b border-line last:border-b-0">
                    <div className="text-xs font-bold mb-1">{p.hook ?? p.title}</div>
                    <div className="text-[10px] text-ink-faint mb-3">
                      {(p.slides ?? []).length} slides · {p.kind}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => callTrigger({ action: "generate", postId: p._id }, p._id)}
                        disabled={busy !== null}
                        className="px-3 py-1.5 border border-signal text-signal text-[10px] tracking-widest hover:bg-signal hover:text-void transition disabled:opacity-50"
                      >
                        {busy === p._id ? "STARTING…" : "GENERATE"}
                      </button>
                      <button
                        onClick={() => removePost({ id: p._id })}
                        className="px-3 py-1.5 border border-line-2 text-ink-faint text-[10px] tracking-widest hover:border-onair hover:text-onair transition"
                      >
                        DROP
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">GALLERY</h2>
        <p className="text-ink-faint text-[11px] mb-3">Every image generated for {persona.name}.</p>
        {gallery.length === 0 ? (
          <div className="border border-dashed border-line-2 p-8 text-center text-ink-faint text-xs">
            Nothing generated yet.
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-2">
            {gallery.flatMap((p) =>
              (p.slides ?? [])
                .filter((s) => s.url)
                .map((s, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${p._id}-${i}`}
                    src={s.url}
                    alt={s.prompt.slice(0, 60)}
                    title={`${STATUS_LABEL[p.status]?.text ?? p.status} — ${s.prompt.slice(0, 120)}`}
                    className="aspect-[2/3] w-full object-cover border border-line-2"
                  />
                )),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
