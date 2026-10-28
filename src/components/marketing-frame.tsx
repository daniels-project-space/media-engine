"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import "./marketing.css";

export function MarketingIcon({
  name,
  size = 21,
}: {
  name: string;
  size?: number;
}) {
  const paths: Record<string, React.ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    external: (
      <>
        <path d="M7 17 17 7M7 7h10v10" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18M5 7h14M5 17h14" />
      </>
    ),
    home: (
      <>
        <path d="m3 10 9-8 9 8M5 8v13h5v-7h4v7h5V8" />
      </>
    ),
    folder: <path d="M3 7V4h6l3 3h9v14H3V7Z" />,
    content: <path d="M6 3h8l4 4v14H6V3Zm8 0v5h4" />,
    results: <path d="M5 21v-7m7 7V8m7 13V3" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V6a4 4 0 0 1 8 0v4" />
      </>
    ),
    sparkle: (
      <>
        <path d="m11 3 2.5 6.5L20 12l-6.5 2.5L11 21l-2.5-6.5L2 12l6.5-2.5L11 3ZM20 2v5m-2.5-2.5h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    close: <path d="m5 5 14 14M5 19 19 5" />,
  };
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.folder}
    </svg>
  );
}

export default function MarketingFrame({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("overview");
  useEffect(() => {
    const update = () => setView(location.hash.slice(1) || "overview");
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return (
    <div className="marketing-app">
      <div className="mk-mobile-bar">
        <Link className="mk-brand" href="/marketing">
          <span className="mk-mark">✱</span> MEDIA ENGINE
        </Link>
        <button
          className="mk-icon-button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          onClick={() => setOpen(!open)}
        >
          <MarketingIcon name={open ? "close" : "menu"} />
        </button>
      </div>
      {open && (
        <button
          className="mk-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`mk-sidebar ${open ? "is-open" : ""}`}>
        <Link className="mk-brand" href="/marketing">
          <span className="mk-mark">✱</span> MEDIA ENGINE
        </Link>
        <p className="mk-nav-label">WORKSPACE</p>
        {/* These are same-document views. Native anchors emit hashchange;
            router pushState updates the URL without notifying the view store. */}
        <nav aria-label="Main navigation">
          {[
            { id: "overview", name: "Overview", icon: "home" },
            { id: "projects", name: "Projects", icon: "folder" },
            { id: "content", name: "Content", icon: "content" },
            { id: "results", name: "Results", icon: "results" },
            { id: "library", name: "Media library", icon: "content" },
          ].map((item) => (
            <a
              key={item.id}
              href={`/marketing#${item.id}`}
              className={view === item.id ? "is-active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <MarketingIcon name={item.icon} />
              {item.name}
            </a>
          ))}
        </nav>
        <div className="mk-owner">
          <span className="mk-avatar">D</span>
          <span>Daniel’s workspace</span>
          <span aria-hidden>›</span>
        </div>
      </aside>
      <div className="mk-main">
        <div className="mk-topbar">
          <span>
            Projects <span className="mk-breadcrumb-slash">/</span>{" "}
            <span className="mk-breadcrumb-current">Marketing workspace</span>
          </span>
          <Link className="mk-button mk-desk-link" href="/work">
            Open creative desk <MarketingIcon name="external" size={18} />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
