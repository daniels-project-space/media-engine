"use client";

// Public link-in-bio page: /p/elaravoss — no engine chrome, safe to share.
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { use, useState } from "react";

export default function LinkInBio({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const personas = useQuery(api.personas.list);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  const persona = personas?.find(
    (p) => p.handle.replace("@", "").toLowerCase() === handle.toLowerCase(),
  );

  if (personas === undefined) return null;
  if (!persona) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-faint text-sm">Not found.</div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    try {
      const r = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, handle: persona!.handle }),
      });
      setState(r.ok ? "done" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="min-h-screen bg-void flex justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <div className="size-20 mx-auto mb-5 grid place-items-center bg-panel-2 border border-line-2 display font-extrabold text-2xl text-signal">
          {persona.name
            .split(" ")
            .map((w) => w[0])
            .join("")}
        </div>
        <h1 className="display font-extrabold text-3xl tracking-tight">{persona.name}</h1>
        <p className="text-scope text-sm mt-1">{persona.handle}</p>
        {persona.bio && <p className="text-ink-dim text-sm mt-4 leading-relaxed">{persona.bio}</p>}

        <div className="mt-8 space-y-3 text-left">
          <div className="border border-line bg-panel p-4">
            <div className="text-[10px] tracking-[0.25em] text-signal mb-2">JOIN THE LIST</div>
            <p className="text-ink-dim text-xs mb-3">New drops and favorites, straight to your inbox.</p>
            {state === "done" ? (
              <div className="text-signal text-sm">You&apos;re in. ✓</div>
            ) : (
              <form onSubmit={submit} className="flex gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com"
                  className="flex-1 bg-panel-2 border border-line-2 px-3 py-2 text-sm min-w-0"
                />
                <button
                  disabled={state === "busy"}
                  className="bg-signal text-void display font-bold px-4 py-2 text-xs shrink-0 disabled:opacity-50"
                >
                  {state === "busy" ? "…" : "JOIN"}
                </button>
              </form>
            )}
            {state === "error" && <div className="text-onair text-xs mt-2">That didn&apos;t work — try again.</div>}
          </div>

          {persona.stage !== "grow" && (
            <div className="border border-line bg-panel p-4">
              <div className="text-[10px] tracking-[0.25em] text-signal mb-2">WORK WITH {persona.name.split(" ")[0].toUpperCase()}</div>
              <p className="text-ink-dim text-xs">
                Brand collaborations and integrations: daniel.mabro@gmail.com
              </p>
            </div>
          )}
        </div>

        <p className="text-ink-faint text-[10px] mt-10 tracking-wider">AI-GENERATED PERSONA · {persona.handle}</p>
      </div>
    </div>
  );
}
