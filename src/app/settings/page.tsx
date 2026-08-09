"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useEffect, useState } from "react";

type ServiceStatus = {
  service: string;
  label: string;
  role: string;
  present: boolean;
  status: "configured" | "missing" | "disabled";
};

export default function Settings() {
  const settings = useQuery(api.settings.all);
  const streams = useQuery(api.streams.list);
  const accounts = useQuery(api.accounts.list);
  const contacts = useQuery(api.email.contacts, {});
  const setSetting = useMutation(api.settings.set);
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [servicesError, setServicesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const checkServices = async () => {
      try {
        const response = await fetch("/api/services", { credentials: "same-origin", cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { services?: ServiceStatus[]; error?: string } | null;
        if (!response.ok || !Array.isArray(data?.services)) {
          throw new Error(data?.error ?? "The private service-status API is unavailable.");
        }
        if (!cancelled) {
          setServices(data.services);
          setServicesError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setServices(null);
          setServicesError(error instanceof Error ? error.message : "The private service-status API is unavailable.");
        }
      }
    };
    const timer = window.setTimeout(() => void checkServices(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  if (settings === undefined || streams === undefined) {
    return <div className="text-ink-faint text-xs tracking-widest">Loading…</div>;
  }

  const adsEnabled = Boolean(settings.adsEnabled ?? false);
  const aiOn = settings.aiEnabled !== false; // default ON
  const higgsfield = services?.find((service) => service.service === "higgsfield");
  const otherServices = services?.filter((service) => service.service !== "higgsfield") ?? [];

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
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">AI / LLM (CLAUDE SUBSCRIPTION)</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          Master kill switch for all Claude LLM calls (via your subscription) — script planning, caption
          variants, vision QC, and lead/client reply drafting. Off = no LLM calls (renders and drafts fall
          back or pause). Turning it back on resumes normal operation.
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
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">GENERATION POLICY</h2>
        <p className="text-ink-faint text-[11px] leading-relaxed">
          Social image/video jobs are paused. OpenAI, fal.ai, ElevenLabs, and generic social Seedance jobs cannot consume credits.
          The only billable media path is an approved client render in Work, using Higgsfield Seedance 2.0 subscription credits.
        </p>
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
          Social automation is paused. Existing planning, posts, and account data remain visible for review,
          but this app will not automatically render, approve, or publish social posts.
        </p>
        <div className="divide-y divide-line border border-line">
          {streams.map((s) => (
            <div key={s._id} className="flex items-center justify-between px-4 py-3 bg-panel-2/40">
              <div>
                <div className="text-xs font-bold">{s.name}</div>
                <div className="text-[10px] text-ink-faint">{s.goal}</div>
              </div>
              <span className="px-3 py-1.5 border border-line-2 text-[10px] tracking-widest text-ink-faint shrink-0">
                AUTOMATION PAUSED
              </span>
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

      <section className="border border-signal/35 bg-panel p-5 mb-6 rise">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">HIGGSFIELD · SEEDANCE 2.0</h2>
            <p className="text-ink-faint text-[11px] leading-relaxed max-w-2xl">
              The only approved client-render path: Higgsfield subscription credits, Seedance 2.0, and no paid fallback.
            </p>
          </div>
          <span
            className={`border px-2 py-1 text-[10px] tracking-widest ${
              services === null
                ? "border-line-2 text-ink-faint"
                : higgsfield?.status === "configured"
                  ? "border-signal/60 text-signal"
                  : "border-onair/60 text-onair"
            }`}
          >
            {services === null
              ? "CHECKING VAULT STATUS"
              : higgsfield?.status === "configured"
                ? "PRODUCTION TOKEN PAIR CONFIGURED"
                : "PRODUCTION TOKEN PAIR MISSING"}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border border-line bg-panel-2/40 p-4">
            <h3 className="text-[10px] tracking-[0.18em] text-ink-dim mb-2">CODEX DESKTOP MCP AUTH</h3>
            <ol className="list-decimal pl-4 space-y-2 text-[11px] leading-relaxed text-ink-dim">
              <li>Open Codex Desktop <span className="text-ink">Settings → MCP servers → Higgsfield</span>.</li>
              <li>Select <span className="text-ink">Authenticate</span> and approve the Higgsfield browser flow.</li>
              <li>Use the official setup page if you need to return to the provider&apos;s MCP instructions.</li>
            </ol>
            <a href="https://higgsfield.ai/mcp" target="_blank" rel="noreferrer" className="inline-block mt-3 text-xs font-semibold text-signal hover:underline">
              Open official Higgsfield MCP setup →
            </a>
            <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
              This OAuth grant belongs to this Codex Desktop installation. Codex maintains it after approval; authenticate again only if Higgsfield revokes or invalidates the grant.
            </p>
          </div>

          <div className="border border-line bg-panel-2/40 p-4">
            <h3 className="text-[10px] tracking-[0.18em] text-ink-dim mb-2">PRODUCTION RENDER CONNECTION</h3>
            <p className="text-[11px] leading-relaxed text-ink-dim">
              The deployed media engine cannot reuse Desktop OAuth. It uses a separate secure <span className="text-ink">higgsfield</span> vault entry containing <span className="text-ink">HIGGSFIELD_ACCESS_TOKEN</span> and <span className="text-ink">HIGGSFIELD_REFRESH_TOKEN</span>.
            </p>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
              The access token expires and the server rotates the refresh token. This status confirms that both required vault values are configured; it does not run a billable render or expose either credential.
            </p>
            {servicesError && <p className="mt-3 text-[10px] leading-relaxed text-onair">Status unavailable: {servicesError}</p>}
          </div>
        </div>
      </section>

      <section className="border border-line bg-panel p-5 rise">
        <h2 className="text-[11px] tracking-[0.3em] text-signal mb-1">OTHER SERVICE STATUS</h2>
        <p className="text-ink-faint text-[11px] mb-4">
          Credential values remain in the central vault. Green means the required vault values are configured, not that a live provider call was made.
        </p>
        {services === null ? (
          <div className="text-ink-faint text-xs">{servicesError ? "Status unavailable — check operator access and service configuration." : "Checking private service status…"}</div>
        ) : (
          <div className="divide-y divide-line border border-line">
            {otherServices.map((s) => (
              <div key={s.service} className="flex items-center justify-between px-4 py-2.5 bg-panel-2/40">
                <div>
                  <span className="text-xs font-bold">{s.label}</span>
                  <span className="text-[10px] text-ink-faint ml-2">{s.role}</span>
                </div>
                <span
                  className={`flex items-center gap-1.5 text-[10px] tracking-widest ${
                    s.status === "configured" ? "text-signal" : s.status === "disabled" ? "text-amber" : "text-onair"
                  }`}
                >
                  <span className={`size-1.5 rounded-full ${s.status === "configured" ? "bg-signal" : s.status === "disabled" ? "bg-amber" : "bg-onair"}`} />
                  {s.status === "configured" ? "CONFIGURED" : s.status === "disabled" ? "DISABLED BY POLICY" : "MISSING"}
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
