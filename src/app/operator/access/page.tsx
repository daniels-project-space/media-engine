"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Completes a short-lived owner access link. The code lives in the URL fragment
 * so browsers do not send it to the server in a request URL or Referer header.
 */
export default function OperatorAccessPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Connecting your private workspace…");

  useEffect(() => {
    const accessCode = new URLSearchParams(window.location.hash.slice(1)).get("code");
    window.history.replaceState(null, "", "/operator/access");
    if (!accessCode) {
      const timer = window.setTimeout(() => setMessage("This owner-access link is incomplete or has already been cleared."), 0);
      return () => window.clearTimeout(timer);
    }

    void (async () => {
      try {
        const response = await fetch("/api/operator/session", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessCode }),
        });
        if (!response.ok) {
          setMessage("This owner-access link has expired. Generate a fresh link from your trusted control surface.");
          return;
        }
        router.replace("/");
        router.refresh();
      } catch {
        setMessage("The private workspace could not be connected. Generate a fresh owner-access link and try again.");
      }
    })();
  }, [router]);

  return (
    <main className="grid min-h-screen place-items-center bg-void p-6">
      <section className="w-full max-w-md border border-line bg-panel p-6 text-center shadow-2xl">
        <div className="mx-auto grid size-10 place-items-center bg-signal text-xs font-extrabold text-void">ME</div>
        <p className="mt-5 text-[10px] font-semibold tracking-[0.2em] text-signal uppercase">Private workspace</p>
        <h1 className="display mt-2 text-3xl font-extrabold tracking-tight">Media Engine</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-dim">{message}</p>
      </section>
    </main>
  );
}
