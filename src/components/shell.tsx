"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type NavigationItem = { href: string; label: string; detail: string };
type NavigationSection = { label: string; items: NavigationItem[] };

// Navigation is intentionally centred on the client-production workflow. The
// retired distribution/control-plane routes are not exposed as operator work.
const NAVIGATION: NavigationSection[] = [
  { label: "Home", items: [{ href: "/", label: "Overview", detail: "Work needing attention" }] },
  {
    label: "Client desk",
    items: [
      { href: "/work", label: "Requests & delivery", detail: "Intake, plans, renders, handoff" },
    ],
  },
  {
    label: "Production",
    items: [
      { href: "/work", label: "Storyboard & render", detail: "Approved client creative only" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Connections & safety", detail: "Higgsfield, policy, service status" },
    ],
  },
];

type HealthState = "checking" | "ready" | "attention" | "unavailable";

function Status({ state }: { state: HealthState }) {
  const content = {
    checking: { label: "Checking system", dot: "bg-amber" },
    ready: { label: "System ready", dot: "bg-signal" },
    attention: { label: "Needs attention", dot: "bg-onair" },
    unavailable: { label: "Status unavailable", dot: "bg-ink-faint" },
  }[state];
  return (
    <span className="flex items-center gap-2 text-xs text-ink-dim">
      <span className={`size-2 rounded-full ${content.dot}`} aria-hidden />
      {content.label}
    </span>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [health, setHealth] = useState<HealthState>("checking");
  const publicPage = path === "/login" || path.startsWith("/p/") || path.startsWith("/services") || path.startsWith("/f/");

  useEffect(() => {
    if (publicPage) return;
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/health", { credentials: "same-origin", cache: "no-store" });
        const data = (await response.json().catch(() => ({}))) as { ok?: boolean };
        if (!cancelled) setHealth(response.ok && data.ok ? "ready" : response.status === 401 || response.status === 503 ? "unavailable" : "attention");
      } catch {
        if (!cancelled) setHealth("unavailable");
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [publicPage]);

  if (publicPage) return <>{children}</>;

  return (
    <div className="min-h-screen bg-void md:flex">
      {navOpen && <button aria-label="Close navigation" onClick={() => setNavOpen(false)} className="fixed inset-0 z-30 bg-black/60 md:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-panel shadow-2xl transition-transform md:static md:translate-x-0 md:shadow-none ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          <Link href="/" className="flex items-center gap-3" onClick={() => setNavOpen(false)}>
            <span className="grid size-8 place-items-center rounded-sm bg-signal text-xs font-extrabold text-void">ME</span>
            <span>
              <span className="display block text-sm font-extrabold tracking-tight">Media Engine</span>
              <span className="block text-[10px] text-ink-faint">Client production desk</span>
            </span>
          </Link>
          <button onClick={() => setNavOpen(false)} className="p-2 text-ink-dim hover:text-ink md:hidden" aria-label="Close navigation">×</button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main navigation">
          {NAVIGATION.map((section) => (
            <section key={section.label} className="mb-5">
              <h2 className="px-2 pb-1 text-[10px] font-semibold tracking-[0.13em] text-ink-faint uppercase">{section.label}</h2>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = item.href === "/" ? path === "/" : path === item.href || path.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setNavOpen(false)}
                      className={`block rounded-sm px-3 py-2.5 transition ${active ? "bg-signal/10 text-signal" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}
                    >
                      <span className="block text-sm font-medium">{item.label}</span>
                      <span className={`mt-0.5 block text-[11px] ${active ? "text-signal/75" : "text-ink-faint"}`}>{item.detail}</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t border-line px-5 py-4">
          <p className="text-[11px] leading-relaxed text-ink-faint">Private actions require an operator session. Paid renders remain approval-gated.</p>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-panel/70 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setNavOpen(true)} className="rounded-sm border border-line-2 px-2.5 py-1.5 text-xs text-ink-dim hover:border-scope hover:text-scope md:hidden" aria-label="Open navigation">Menu</button>
            <Status state={health} />
          </div>
          <Link href="/work" className="rounded-sm border border-signal/60 px-3 py-1.5 text-xs font-semibold text-signal transition hover:bg-signal hover:text-void">New client work</Link>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
