"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(result.error ?? "Could not sign in");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Connection failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-void p-6">
      <form onSubmit={submit} className="w-full max-w-sm border border-line bg-panel p-6 shadow-2xl">
        <div className="size-10 bg-signal text-void display font-extrabold grid place-items-center mb-6">ME</div>
        <p className="text-[10px] tracking-[0.22em] text-signal uppercase mb-2">Private workspace</p>
        <h1 className="display text-3xl font-extrabold tracking-tight">Media Engine</h1>
        <p className="text-sm leading-relaxed text-ink-dim mt-3 mb-6">
          Sign in to review client work, authorise plans, and dispatch subscription-credit renders.
        </p>
        <label className="block text-[10px] tracking-[0.18em] text-ink-faint uppercase mb-2" htmlFor="operator-password">
          Operator password
        </label>
        <input
          id="operator-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full border border-line-2 bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-signal"
          required
        />
        {error && <p role="alert" className="mt-3 text-xs text-onair">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-5 w-full bg-signal px-4 py-3 text-void display text-xs font-bold tracking-wide disabled:opacity-50"
        >
          {busy ? "SIGNING IN…" : "OPEN WORKSPACE"}
        </button>
      </form>
    </main>
  );
}

