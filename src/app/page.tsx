"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Project = {
  _id: string;
  buyer: string;
  title: string;
  stage: string;
  storyboardVersion?: number;
  approvedPlanVersion?: number;
  error?: string;
  lastActivityAt?: number;
};

type RenderJob = {
  _id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  kind: "draft" | "final";
  updatedAt: number;
  error?: string;
};

type WorkspaceProject = {
  project: Project;
  renderJobs: RenderJob[];
};

type OperationsCounts = {
  needsApproval: number;
  activeRenders: number;
  readyDelivery: number;
  failed: number;
};

type FocusItem = {
  id: string;
  title: string;
  buyer: string;
  reason: string;
  tone: "approval" | "rendering" | "delivery" | "failed";
  timestamp?: number;
};

const CATEGORY_CARDS = [
  { href: "/work", label: "Client desk", description: "Requests, buyer messages, briefs, and delivery tracking." },
  { href: "/work", label: "Production", description: "Narrative plans, storyboard approval, and private client renders." },
  { href: "/settings", label: "Connections", description: "Higgsfield OAuth, renderer release gates, and safe service status." },
] as const;

const TONE_META: Record<FocusItem["tone"], { label: string; className: string }> = {
  approval: { label: "Approval", className: "border-amber/60 text-amber" },
  rendering: { label: "Rendering", className: "border-scope/60 text-scope" },
  delivery: { label: "Delivery", className: "border-signal/60 text-signal" },
  failed: { label: "Attention", className: "border-onair/60 text-onair" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    return stringValue(value.error) ?? stringValue(value.message) ?? fallback;
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new Error(body ? `Unexpected response: ${body.slice(0, 160)}` : `Request failed (${response.status})`);
  }
  return response.json();
}

function timeLabel(timestamp?: number): string {
  if (!timestamp) return "No activity timestamp";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

function operationsFrom(projects: WorkspaceProject[]): { counts: OperationsCounts; focus: FocusItem[] } {
  const focus: FocusItem[] = [];
  let needsApproval = 0;
  let activeRenders = 0;
  let readyDelivery = 0;
  let failed = 0;

  for (const item of projects) {
    const { project, renderJobs } = item;
    const hasFailedJob = renderJobs.some((job) => job.status === "failed");
    const hasActiveJob = renderJobs.some((job) => job.status === "queued" || job.status === "running");
    const planNeedsApproval = project.stage === "script_ready" && project.storyboardVersion !== project.approvedPlanVersion;
    const draftNeedsReview = project.stage === "draft_ready";

    if (project.stage === "failed" || hasFailedJob) {
      failed += 1;
      focus.push({
        id: project._id,
        title: project.title,
        buyer: project.buyer,
        reason: project.error ?? renderJobs.find((job) => job.status === "failed")?.error ?? "A render needs investigation before it can continue.",
        tone: "failed",
        timestamp: project.lastActivityAt ?? renderJobs[0]?.updatedAt,
      });
      continue;
    }

    if (hasActiveJob || project.stage === "drafting" || project.stage === "rendering") {
      activeRenders += 1;
      const job = renderJobs.find((entry) => entry.status === "running" || entry.status === "queued");
      focus.push({
        id: project._id,
        title: project.title,
        buyer: project.buyer,
        reason: job ? `${job.kind === "draft" ? "Draft" : "Final"} render is ${job.status}.` : "A render is in progress.",
        tone: "rendering",
        timestamp: job?.updatedAt ?? project.lastActivityAt,
      });
      continue;
    }

    if (planNeedsApproval || draftNeedsReview) {
      needsApproval += 1;
      focus.push({
        id: project._id,
        title: project.title,
        buyer: project.buyer,
        reason: planNeedsApproval ? `Plan v${project.storyboardVersion} needs approval before any render uses credits.` : "Review the draft before beginning the final render.",
        tone: "approval",
        timestamp: project.lastActivityAt,
      });
      continue;
    }

    if (project.stage === "final_ready") {
      readyDelivery += 1;
      focus.push({
        id: project._id,
        title: project.title,
        buyer: project.buyer,
        reason: "Final render is ready for client delivery.",
        tone: "delivery",
        timestamp: project.lastActivityAt,
      });
    }
  }

  const priority: Record<FocusItem["tone"], number> = { failed: 0, approval: 1, rendering: 2, delivery: 3 };
  focus.sort((left, right) => priority[left.tone] - priority[right.tone] || (right.timestamp ?? 0) - (left.timestamp ?? 0));
  return { counts: { needsApproval, activeRenders, readyDelivery, failed }, focus };
}

export default function OperationsOverview() {
  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const loadOperations = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/work", { credentials: "same-origin", cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, `Unable to load operations (${response.status})`));
      if (!isRecord(payload) || !Array.isArray(payload.projects)) throw new Error("The workspace returned an invalid operations response.");
      setProjects(payload.projects as WorkspaceProject[]);
      setLastUpdated(Date.now());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load current operations.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOperations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOperations]);

  const overview = useMemo(() => operationsFrom(projects ?? []), [projects]);
  const shouldPoll = overview.counts.activeRenders > 0;

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => void loadOperations(true), 5000);
    return () => window.clearInterval(timer);
  }, [loadOperations, shouldPoll]);

  const summaryCards = [
    { label: "Needs approval", value: overview.counts.needsApproval, href: "/work", tone: "text-amber", description: "Plans and drafts waiting for your decision" },
    { label: "Active renders", value: overview.counts.activeRenders, href: "/work", tone: "text-scope", description: "Queued or running approved jobs" },
    { label: "Ready to deliver", value: overview.counts.readyDelivery, href: "/work", tone: "text-signal", description: "Final client work ready to hand over" },
    { label: "Failed", value: overview.counts.failed, href: "/work", tone: overview.counts.failed > 0 ? "text-onair" : "text-ink-faint", description: "Jobs that need a real fix before retrying" },
  ];

  return (
    <div className="mx-auto max-w-[1360px] space-y-7">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-signal uppercase">Home · operations overview</p>
          <h1 className="display text-3xl font-extrabold tracking-tight sm:text-4xl">What needs your attention</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">A short, factual view of client work. Public visitors see live, redacted operating status; private client detail stays inside the client desk.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && !error && <span className="text-xs text-ink-faint">Data refreshed {timeLabel(lastUpdated).replace("Updated ", "")}</span>}
          <button onClick={() => void loadOperations()} disabled={loading} className="border border-line-2 bg-panel px-3 py-2 text-[11px] font-semibold tracking-wide text-ink-dim transition hover:border-scope hover:text-scope disabled:opacity-45">{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
      </header>

      {error && (
        <section className="border border-onair/60 bg-onair/5 p-4" role="alert">
          <p className="text-sm font-semibold text-onair">Operations data is unavailable</p>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-ink-dim">{error}</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">Check the Media Engine service configuration. This page will not claim the system is healthy until the server returns real data.</p>
        </section>
      )}

      <section aria-label="Client work status">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="display text-xl font-bold">Client work</h2>
          {loading && projects === null && <span className="text-xs text-ink-faint">Loading live workspace status…</span>}
        </div>
        <div className="grid gap-px border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <Link key={card.label} href={card.href} className="bg-panel p-5 transition hover:bg-panel-2">
              <div className={`display text-3xl font-extrabold tabular-nums ${projects === null ? "text-ink-faint" : card.tone}`}>{projects === null ? "—" : card.value}</div>
              <h3 className="mt-2 text-sm font-semibold text-ink">{card.label}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">{card.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <article className="border border-line bg-panel">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-5">
            <div>
              <h2 className="display text-xl font-bold">Focus list</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-faint">Failed work is shown first, then approvals, active renders, and ready deliveries.</p>
            </div>
            <Link href="/work" className="border border-signal/60 px-3 py-2 text-[11px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void">Open client work</Link>
          </div>
          {projects === null && !error ? (
            <div className="p-5 text-sm text-ink-faint">Loading focus items…</div>
          ) : overview.focus.length === 0 ? (
            <div className="p-5 text-sm leading-relaxed text-ink-faint">No client work currently needs an action. New requests will appear here as they enter the governed work pipeline.</div>
          ) : (
            <div className="divide-y divide-line">
              {overview.focus.slice(0, 8).map((item) => {
                const meta = TONE_META[item.tone];
                return (
                  <Link key={item.id} href="/work" className="block p-4 transition hover:bg-panel-2/70 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-ink">{item.title}</h3>
                          <span className={`border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${meta.className}`}>{meta.label}</span>
                        </div>
                        <p className="mt-1 text-xs text-ink-dim">{item.buyer}</p>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">{item.reason}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-ink-faint">{timeLabel(item.timestamp)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </article>

        <aside className="border border-line bg-panel p-4 sm:p-5">
          <h2 className="display text-xl font-bold">Generation policy</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">Client renders require an approved plan and use the project-owned Render Engine hosted budget.</p>
          <dl className="mt-4 space-y-3 border-t border-line pt-4 text-xs">
            <div className="flex items-start justify-between gap-4"><dt className="text-ink-faint">Provider</dt><dd className="text-right text-ink">Render Engine</dd></div>
            <div className="flex items-start justify-between gap-4"><dt className="text-ink-faint">Model</dt><dd className="text-right text-ink">Seedance 2.5 I2V</dd></div>
            <div className="flex items-start justify-between gap-4"><dt className="text-ink-faint">Budget</dt><dd className="text-right text-ink">Project hosted budget</dd></div>
            <div className="flex items-start justify-between gap-4"><dt className="text-ink-faint">Fallback</dt><dd className="text-right text-amber">Fail closed</dd></div>
          </dl>
          <Link href="/settings" className="mt-5 inline-block text-xs font-semibold text-signal hover:underline">Review connections and safeguards →</Link>
        </aside>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="display text-xl font-bold">Go to</h2>
          <p className="mt-1 text-xs text-ink-faint">The rest of the engine is grouped by the job you are doing, not by its underlying implementation.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {CATEGORY_CARDS.map((card) => (
            <Link key={card.href} href={card.href} className="border border-line bg-panel p-4 transition hover:border-scope hover:bg-panel-2">
              <h3 className="display text-lg font-bold text-ink">{card.label}</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">{card.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
