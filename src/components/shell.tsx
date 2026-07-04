"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_GROUPS: { section: string; items: { href: string; code: string; label: string; hint: string }[] }[] = [
  {
    section: "Overview",
    items: [{ href: "/", code: "MC", label: "Dashboard", hint: "streams & spend" }],
  },
  {
    section: "Instagram Girls",
    items: [
      { href: "/personas", code: "IG", label: "Personas", hint: "AI models & feeds" },
      { href: "/queue", code: "AQ", label: "Review & Publish", hint: "approve posts" },
    ],
  },
  {
    section: "Ads Studio",
    items: [{ href: "/ads", code: "AD", label: "Client Ads", hint: "Fiverr fulfilment" }],
  },
  {
    section: "System",
    items: [
      { href: "/analytics", code: "AN", label: "Analytics", hint: "output & costs" },
      { href: "/prompts", code: "PL", label: "Prompt Library", hint: "templates" },
      { href: "/settings", code: "ST", label: "Settings", hint: "budget & services" },
    ],
  },
];

function Timecode() {
  const [tc, setTc] = useState("--:--:--:--");
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      const ff = String(Math.floor((d.getMilliseconds() / 1000) * 24)).padStart(2, "0");
      setTc(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(
          d.getSeconds(),
        ).padStart(2, "0")}:${ff}`,
      );
    }, 120);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums text-ink-dim text-xs tracking-widest">{tc}</span>;
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // Public pages (link-in-bio) render without the engine chrome.
  if (path.startsWith("/p/")) return <>{children}</>;
  return (
    <div className="flex min-h-screen">
      <aside className="w-16 md:w-56 shrink-0 border-r border-line bg-panel/60 flex flex-col">
        <div className="h-16 flex items-center gap-3 px-4 border-b border-line">
          <div className="size-8 shrink-0 bg-signal text-void display font-extrabold grid place-items-center text-sm">
            ME
          </div>
          <div className="hidden md:block leading-none">
            <div className="display font-extrabold tracking-tight text-sm">MEDIA ENGINE</div>
            <div className="text-[10px] text-ink-faint tracking-[0.25em] mt-1">MASTER CONTROL</div>
          </div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.section} className="mb-2">
              <div className="hidden md:block px-4 pt-3 pb-1 text-[9px] tracking-[0.25em] text-ink-faint uppercase">
                {group.section}
              </div>
              {group.items.map((n) => {
                const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`flex items-center gap-3 px-4 py-2.5 text-xs tracking-wide border-l-2 transition-colors ${
                      active
                        ? "border-signal text-ink bg-panel-2"
                        : "border-transparent text-ink-dim hover:text-ink hover:bg-panel-2/50"
                    }`}
                  >
                    <span
                      className={`size-7 shrink-0 grid place-items-center border text-[10px] font-bold ${
                        active ? "border-signal text-signal" : "border-line-2 text-ink-faint"
                      }`}
                    >
                      {n.code}
                    </span>
                    <span className="hidden md:block leading-tight">
                      {n.label}
                      <span className="block text-[9px] text-ink-faint normal-case tracking-normal">
                        {n.hint}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="hidden md:block px-4 py-4 border-t border-line text-[10px] text-ink-faint leading-relaxed">
          CH-04 · daniels-project-space
          <br />
          convex · vercel · trigger · r2
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 shrink-0 border-b border-line bg-panel/40 flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-signal led-live" />
            <span className="text-[11px] tracking-[0.3em] text-ink-dim">ENGINE ONLINE</span>
            <span className="hidden lg:inline text-[10px] text-ink-faint">
              — generates content, you approve, it publishes
            </span>
          </div>
          <Timecode />
        </header>
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
