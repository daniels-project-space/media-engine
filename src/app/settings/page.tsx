"use client";

import { useEffect, useState } from "react";

type ServiceStatus = {
  service: string;
  label: string;
  role: string;
  present: boolean;
  status: "configured" | "missing" | "disabled";
};

export default function Settings() {
  const [services, setServices] = useState<ServiceStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/services", { credentials: "same-origin", cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { services?: ServiceStatus[]; error?: string } | null;
        if (!response.ok || !Array.isArray(data?.services)) {
          throw new Error(data?.error ?? "The private service-status API is unavailable.");
        }
        if (!cancelled) {
          setServices(data.services);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setServices(null);
          setError(cause instanceof Error ? cause.message : "The private service-status API is unavailable.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const higgsfield = services?.find((service) => service.service === "higgsfield");
  const otherServices = services?.filter((service) => service.service !== "higgsfield") ?? [];
  const linked = higgsfield?.status === "configured";

  return (
    <div className="max-w-3xl">
      <h1 className="display mb-2 text-4xl font-extrabold tracking-tight rise">CONNECTIONS &amp; SAFETY</h1>
      <p className="mb-8 text-xs tracking-wider text-ink-dim rise">PRODUCTION RENDERER · OPERATOR CONTROLS · SERVICE STATUS</p>

      <section className="mb-6 border border-signal/35 bg-panel p-5 rise">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="mb-1 text-[11px] tracking-[0.3em] text-signal">HIGGSFIELD · SEEDANCE 2.0</h2>
            <p className="max-w-2xl text-[11px] leading-relaxed text-ink-faint">
              This is the only approved render connection: a separate cloud OAuth session, Higgsfield subscription credits,
              Seedance 2.0, and no paid fallback provider.
            </p>
          </div>
          <span className={`border px-2 py-1 text-[10px] tracking-widest ${services === null ? "border-line-2 text-ink-faint" : linked ? "border-signal/60 text-signal" : "border-onair/60 text-onair"}`}>
            {services === null ? "CHECKING" : linked ? "MCP SESSION LINKED" : "MCP SESSION NOT LINKED"}
          </span>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="border border-line bg-panel-2/40 p-4">
            <h3 className="mb-2 text-[10px] tracking-[0.18em] text-ink-dim">CONNECT PRODUCTION RENDERER</h3>
            <p className="text-[11px] leading-relaxed text-ink-dim">
              Your desktop MCP login is never copied here. This link creates the cloud renderer&apos;s own rotating Vault session.
            </p>
            <a href="/api/auth/higgsfield/start" className="mt-3 inline-block text-xs font-semibold text-signal hover:underline">
              Connect Higgsfield to this production app →
            </a>
          </div>
          <div className="border border-line bg-panel-2/40 p-4">
            <h3 className="mb-2 text-[10px] tracking-[0.18em] text-ink-dim">RENDER RELEASE GATE</h3>
            <p className="text-[11px] leading-relaxed text-ink-dim">
              Rendering remains disabled until the authenticated MCP tool manifest is inspected and the exact Seedance 2.0 schema is allowlisted.
              Listing the manifest is non-billable.
            </p>
            {linked && (
              <a href="/api/auth/higgsfield/tools" className="mt-3 inline-block text-xs font-semibold text-signal hover:underline">
                Inspect non-billable MCP tool manifest →
              </a>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-[10px] leading-relaxed text-onair">Status unavailable: {error}</p>}
      </section>

      <section className="mb-6 border border-line bg-panel p-5 rise">
        <h2 className="mb-1 text-[11px] tracking-[0.3em] text-signal">OPERATING POLICY</h2>
        <div className="mt-4 grid gap-3 text-[11px] leading-relaxed text-ink-dim sm:grid-cols-3">
          <div className="border border-line bg-panel-2/40 p-3"><span className="block text-signal">CLIENT PRODUCTION</span>Requests, approval, storyboard, and delivery live in Client Work.</div>
          <div className="border border-line bg-panel-2/40 p-3"><span className="block text-amber">AI REASONING PAUSED</span>Cloud client-reply and plan reasoning waits for a dedicated hosted runtime.</div>
          <div className="border border-line bg-panel-2/40 p-3"><span className="block text-onair">DISTRIBUTION RETIRED</span>Legacy social, email, campaigns, and direct-send tasks cannot run.</div>
        </div>
      </section>

      <section className="border border-line bg-panel p-5 rise">
        <h2 className="mb-1 text-[11px] tracking-[0.3em] text-signal">SERVICE STATUS</h2>
        <p className="mb-4 text-[11px] text-ink-faint">Values remain in the central Vault. This page only reports safe configuration status.</p>
        {services === null ? (
          <div className="text-xs text-ink-faint">{error ? "Status unavailable — check service configuration." : "Checking service status…"}</div>
        ) : (
          <div className="divide-y divide-line border border-line">
            {otherServices.map((service) => (
              <div key={service.service} className="flex items-center justify-between gap-4 bg-panel-2/40 px-4 py-3">
                <div>
                  <span className="text-xs font-bold">{service.label}</span>
                  <span className="ml-2 text-[10px] text-ink-faint">{service.role}</span>
                </div>
                <span className={`shrink-0 text-[10px] tracking-widest ${service.status === "configured" ? "text-signal" : service.status === "disabled" ? "text-amber" : "text-onair"}`}>
                  {service.status === "configured" ? "CONFIGURED" : service.status === "disabled" ? "DISABLED" : "MISSING"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
