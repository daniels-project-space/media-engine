"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useEffect, useState } from "react";

type ServiceStatus = { service: string; label: string; role: string; present: boolean; state?: "paused" };

export default function Settings() {
  const settings = useQuery(api.settings.all);
  const streams = useQuery(api.streams.list);
  const accounts = useQuery(api.accounts.list);
  const contacts = useQuery(api.email.contacts, {});
  const setSetting = useMutation(api.settings.set);
  const setAutonomy = useMutation(api.streams.setAutonomy);
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [capInput, setCapInput] = useState<string>("");

  useEffect(() => {
    fetch("/api/services")
      .then((r) => r.json())
      .then((d) => setServices(d.services))
      .catch(() => setServices([]));
  }, []);

  useEffect(() => {
    if (settings && capInput === "") {
      setCapInput(String(Number(settings.dailyCapPence ?? 500) / 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  if (settings === undefined || streams === undefined) {
    return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  }

  const adsEnabled = Boolean(settings.adsEnabled ?? false);
  const aiOn = settings.aiEnabled === true; // default OFF; only explicit true enables generation

  return (
    <div className="max-w-3xl">
      <h1 className="display font-extrabold text-4xl tracking-tight mb-2 rise">SETTINGS</h1>
      <p className="text-ink-dim text-xs tracking-wider mb-8 rise">AI · BUDGET · AUTONOMY · ADS · CONNECTED SERVICES</p>

      {(() => {
        const liveMode = Boolean(settings.liveMode);
        const provider = (settings.socialProvider as string) ?? "ayrshare";
        return (
          <section className={`border p-5 mb-6 rise ${liveMode ? "border-onair/50 bg-onair/5" : "border-line bg-panel"}`}>
            <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">AD AGENCY — LIVE MODE</h2>
            <p className="text-ink-faint text-[11px] mb-4">
              Master switch for the campaign engine&apos;s OUTWARD actions (posting, emailing, minting discounts,
              influencer sends). OFF = every send is SIMULATED (dry-run) and logged — safe to plan and preview.
              ON = real calls fire, but only where the matching API key is in the vault. Per-campaign free/paid mode
              and budget caps still apply on top of this.
            </p>
            <button
              onClick={() => setSetting({ key: "liveMode", value: !liveMode })}
              className={`px-4 py-2 border text-xs tracking-widest transition ${
                liveMode ? "border-onair text-onair hover:bg-onair hover:text-void" : "border-signal text-signal hover:bg-signal hover:text-void"
              }`}
            >
              {liveMode ? "LIVE — REAL SENDS FIRE" : "DRY-RUN — SENDS SIMULATED"}
            </button>
            <div className="mt-4">
              <div className="text-[10px] tracking-[0.25em] text-ink-faint uppercase mb-2">Social provider</div>
              <div className="flex gap-2">
                {["ayrshare", "postiz", "graph"].map((p) => (
                  <button
                    key={p}
                    onClick={() => setSetting({ key: "socialProvider", value: p })}
                    className={`px-3 py-1.5 border text-[10px] tracking-widest ${
                      provider === p ? "border-signal text-signal" : "border-line-2 text-ink-faint hover:text-ink"
                    }`}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-ink-faint mt-2">
                ayrshare = hosted (1 key) · postiz = self-host (POSTIZ_URL + key) · graph = native Instagram only
              </p>
            </div>
          </section>
        );
      })()}

      <section className={`border p-5 mb-6 rise ${aiOn ? "border-line bg-panel" : "border-onair/50 bg-onair/5"}`}>
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">AI / LLM (CODEX CLI SUBSCRIPTION)</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          Master kill switch for subscription-authenticated Codex CLI reasoning — script planning, caption
          variants, and drafting. Image generation is permanently paused until an approved equal-quality
          provider is configured; use approved source images for video renders.
        </p>
        <button
          onClick={() => setSetting({ key: "aiEnabled", value: !aiOn })}
          className={`px-4 py-2 border text-xs tracking-widest transition ${
            aiOn ? "border-signal text-signal hover:bg-signal hover:text-void" : "border-onair text-onair hover:bg-onair hover:text-void"
          }`}
        >
          {aiOn ? "AI: ON — SPENDING" : "AI: PAUSED — NO LLM SPEND"}
        </button>
      </section>

      <section className="border border-line bg-panel p-5 mb-6 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">DAILY GENERATION BUDGET</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          Hard cap for image/video generation per day. Jobs refuse to start once the cap is hit.
        </p>
        <div className="flex items-center gap-3">
          <span className="text-ink-dim text-sm">£</span>
          <input
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            className="bg-panel-2 border border-line-2 px-3 py-2 text-sm w-24 tabular-nums"
            inputMode="decimal"
          />
          <button
            onClick={() => {
              const pounds = parseFloat(capInput);
              if (!isNaN(pounds) && pounds > 0) {
                setSetting({ key: "dailyCapPence", value: Math.round(pounds * 100) });
              }
            }}
            className="px-4 py-2 bg-signal text-void display font-bold text-xs hover:brightness-110 transition"
          >
            SAVE
          </button>
          <span className="text-[10px] text-ink-faint">
            current: £{(Number(settings.dailyCapPence ?? 500) / 100).toFixed(2)}/day
          </span>
        </div>
      </section>

      <section className="border border-line bg-panel p-5 mb-6 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">PAID ADS</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          Master switch for paid ad features (ad creative variants, campaign exports). Off = organic
          only. Turning this on does not spend money by itself.
        </p>
        <button
          onClick={() => setSetting({ key: "adsEnabled", value: !adsEnabled })}
          className={`px-4 py-2 border text-xs tracking-widest transition ${
            adsEnabled
              ? "border-signal text-signal hover:bg-signal hover:text-void"
              : "border-line-2 text-ink-dim hover:border-ink-dim"
          }`}
        >
          {adsEnabled ? "ADS: ENABLED" : "ADS: DISABLED"}
        </button>
      </section>

      <section className="border border-line bg-panel p-5 mb-6 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">STREAM AUTONOMY</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          «Needs approval» = posts wait in the Approval Queue for you. «Fully automatic» = posts
          publish on schedule without review (once accounts are linked).
        </p>
        <div className="divide-y divide-line border border-line">
          {streams.map((s) => (
            <div key={s._id} className="flex items-center justify-between px-4 py-3 bg-panel-2/40">
              <div>
                <div className="text-xs font-bold">{s.name}</div>
                <div className="text-[10px] text-ink-faint">{s.goal}</div>
              </div>
              <button
                onClick={() => setAutonomy({ id: s._id, autonomy: s.autonomy === "auto" ? "approve" : "auto" })}
                className={`px-3 py-1.5 border text-[10px] tracking-widest transition shrink-0 ${
                  s.autonomy === "auto"
                    ? "border-signal text-signal"
                    : "border-amber text-amber"
                }`}
              >
                {s.autonomy === "auto" ? "FULLY AUTOMATIC" : "NEEDS APPROVAL"}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="border border-line bg-panel p-5 mb-6 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">SOCIAL ACCOUNTS</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          The engine publishes through these. To link Instagram: create the account (Business),
          create a Meta developer app, then the access token goes in the vault — I&apos;ll walk you
          through it once accounts exist. Until linked, posts stop at «approved».
        </p>
        <div className="divide-y divide-line border border-line">
          {(accounts ?? []).map((a) => (
            <div key={a._id} className="flex items-center justify-between px-4 py-2.5 bg-panel-2/40">
              <div>
                <span className="text-xs font-bold">{a.handle}</span>
                <span className="text-[10px] text-ink-faint ml-2 uppercase">{a.platform}</span>
              </div>
              <span
                className={`text-[10px] tracking-widest ${
                  a.status === "active" ? "text-signal" : a.status === "banned" ? "text-onair" : "text-amber"
                }`}
              >
                {a.tokenKey ? a.status.toUpperCase() : "NOT LINKED"}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-ink-faint mt-3">
          Email list: {contacts?.length ?? 0} subscribed contact{(contacts?.length ?? 0) === 1 ? "" : "s"} (captured
          via the public link-in-bio pages, e.g. /p/elaravoss).
        </p>
      </section>

      <section className="border border-line bg-panel p-5 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">CONNECTED SERVICES</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          Credentials live in the central vault — never in this app. Green = key present.
        </p>
        {services === null ? (
          <div className="text-ink-faint text-xs">Checking…</div>
        ) : (
          <div className="divide-y divide-line border border-line">
            {services.map((s) => (
              <div key={s.service} className="flex items-center justify-between px-4 py-2.5 bg-panel-2/40">
                <div>
                  <span className="text-xs font-bold">{s.label}</span>
                  <span className="text-[10px] text-ink-faint ml-2">{s.role}</span>
                </div>
                <span
                  className={`flex items-center gap-1.5 text-[10px] tracking-widest ${
                    s.state === "paused" ? "text-amber" : s.present ? "text-signal" : "text-onair"
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${s.state === "paused" ? "bg-amber" : s.present ? "bg-signal" : "bg-onair"}`} />
                  {s.state === "paused" ? "PAUSED" : s.present ? "CONNECTED" : "MISSING"}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-ink-faint mt-3">
          Instagram/TikTok/YouTube account linking lands here next — accounts must exist first.
        </p>
      </section>
    </div>
  );
}
