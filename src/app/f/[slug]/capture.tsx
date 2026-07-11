"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";

// Funnel email capture + view/conversion tracking. Real Convex writes (owned
// list), so this works without any external key — deliverability providers are
// only needed to SEND, not to capture.
export default function FunnelCapture({ slug, ctaText, ctaUrl }: { slug: string; ctaText: string; ctaUrl: string }) {
  const subscribe = useMutation(api.email.subscribe);
  const track = useMutation(api.funnels.track);
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    track({ slug, event: "view" }).catch(() => {});
  }, [slug, track]);

  async function submit() {
    setErr(null);
    try {
      await subscribe({ email, source: `funnel:${slug}` });
      await track({ slug, event: "conversion" });
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "try again");
    }
  }

  if (done) {
    return (
      <div className="mt-6">
        <p className="text-signal text-sm">You&apos;re in. Check your inbox for the code and next steps.</p>
        {ctaUrl && ctaUrl !== "#" && (
          <a href={ctaUrl} className="inline-block mt-3 bg-signal text-void display font-extrabold px-6 py-3">{ctaText} →</a>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col sm:flex-row gap-2 max-w-md">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@email.com"
        className="flex-1 bg-void border border-line-2 p-3 text-sm text-ink focus:border-signal outline-none"
      />
      <button onClick={submit} className="bg-signal text-void display font-extrabold px-6 py-3 hover:opacity-90 whitespace-nowrap">
        {ctaText} →
      </button>
      {err && <span className="text-red-400 text-xs self-center">{err}</span>}
    </div>
  );
}
