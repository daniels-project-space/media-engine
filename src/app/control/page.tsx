"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type DashboardItem = {
  id: string;
  title: string;
  detail?: string;
  status: string;
  organizationId?: string;
  provider?: string;
  risk?: string;
  capabilities?: string[];
  createdAt?: number;
  updatedAt?: number;
  expiresAt?: number;
};

type Dashboard = {
  organizations: DashboardItem[];
  connections: DashboardItem[];
  approvals: DashboardItem[];
  actions: DashboardItem[];
  intakes: DashboardItem[];
  fetchedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isItem(value: unknown): value is DashboardItem {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.title === "string" && typeof value.status === "string";
}

function isDashboard(value: unknown): value is Dashboard {
  if (!isRecord(value) || typeof value.fetchedAt !== "string") return false;
  return ["organizations", "connections", "approvals", "actions", "intakes"].every((key) => Array.isArray(value[key]) && value[key].every(isItem));
}

function errorMessage(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function label(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function timeLabel(value?: number): string {
  if (!value) return "No timestamp";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function statusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (/(connected|ready|active|approved|completed|succeeded|received|reviewed)/.test(normalized)) return "border-signal/55 text-signal";
  if (/(pending|queued|running|review|draft|awaiting|processing)/.test(normalized)) return "border-amber/60 text-amber";
  if (/(failed|error|revoked|expired|disconnected|blocked|cancelled)/.test(normalized)) return "border-onair/60 text-onair";
  return "border-line-2 text-ink-faint";
}

function itemMeta(item: DashboardItem, organizations: Map<string, string>): string[] {
  const result: string[] = [];
  const organization = item.organizationId ? organizations.get(item.organizationId) : undefined;
  if (organization) result.push(organization);
  if (item.provider) result.push(label(item.provider));
  if (item.detail && item.detail !== item.provider) result.push(item.detail);
  return [...new Set(result)].slice(0, 2);
}

function DashboardList({
  title,
  description,
  items,
  organizations,
  timestamp = "updated",
}: {
  title: string;
  description: string;
  items: DashboardItem[];
  organizations: Map<string, string>;
  timestamp?: "created" | "updated";
}) {
  const visible = items.slice(0, 8);
  return (
    <section className="border border-line bg-panel">
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4 sm:px-5">
        <div>
          <h2 className="display text-xl font-bold tracking-tight">{title}</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{description}</p>
        </div>
        <span className="shrink-0 border border-line-2 px-2 py-1 text-[10px] tracking-widest text-ink-dim">{items.length} RECORDS</span>
      </div>
      {visible.length ? (
        <ul className="divide-y divide-line">
          {visible.map((item) => {
            const meta = itemMeta(item, organizations);
            const itemTime = timestamp === "created" ? item.createdAt : item.updatedAt ?? item.createdAt;
            return (
              <li key={item.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-ink">{item.title}</p>
                  {meta.length > 0 && <p className="mt-1 truncate text-[10px] text-ink-faint">{meta.join(" · ")}</p>}
                  {item.capabilities && <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{item.capabilities.map(label).join(" · ")}</p>}
                  {item.risk && <p className="mt-1 text-[10px] text-amber">Risk: {label(item.risk)}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                  <span className={`border px-2 py-1 text-[9px] tracking-widest ${statusClass(item.status)}`}>{label(item.status)}</span>
                  <span className="text-[10px] text-ink-faint">{timeLabel(itemTime)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-4 py-6 text-xs leading-relaxed text-ink-faint sm:px-5">No records received from the protected control-plane gateway.</p>
      )}
      {items.length > visible.length && <p className="border-t border-line px-4 py-2 text-[10px] text-ink-faint sm:px-5">Showing the most recent 8 of {items.length} records.</p>}
    </section>
  );
}

export default function ControlPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/control", { credentials: "same-origin", cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, `Unable to load Control Center (${response.status})`));
      if (!isDashboard(payload)) throw new Error("The protected control-plane gateway returned an invalid dashboard.");
      setDashboard(payload);
      setError(null);
    } catch (cause) {
      setDashboard(null);
      setError(cause instanceof Error ? cause.message : "Unable to load Control Center.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const organizations = useMemo(
    () => new Map((dashboard?.organizations ?? []).map((organization) => [organization.id, organization.title])),
    [dashboard?.organizations],
  );
  const openApprovals = useMemo(
    () => (dashboard?.approvals ?? []).filter((item) => !/(approved|rejected|cancelled|expired)/.test(item.status.toLowerCase())),
    [dashboard?.approvals],
  );
  const activeActions = useMemo(
    () => (dashboard?.actions ?? []).filter((item) => /(queued|running|pending|processing)/.test(item.status.toLowerCase())),
    [dashboard?.actions],
  );

  return (
    <div className="mx-auto max-w-[1360px] space-y-6">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-signal uppercase">Media Engine · governed operations</p>
          <h1 className="display text-3xl font-extrabold tracking-tight sm:text-4xl">Control Center</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">
            An open, live overview of connected organizations, received work, approval decisions, and the action ledger. It reports recorded state only—never inferred performance or simulated automation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dashboard && !error && <span className="text-[10px] text-ink-faint">Gateway read {new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" }).format(new Date(dashboard.fetchedAt))}</span>}
          <button onClick={() => void loadDashboard()} disabled={loading} className="border border-line-2 bg-panel px-3 py-2 text-[11px] font-semibold tracking-wide text-ink-dim transition hover:border-scope hover:text-scope disabled:opacity-45">
            {loading ? "Refreshing…" : "Refresh state"}
          </button>
          <Link href="/work" className="border border-signal/70 px-3 py-2 text-[11px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void">Open client desk</Link>
        </div>
      </header>

      {error ? (
        <section className="border border-onair/45 bg-onair/5 p-5" aria-live="polite">
          <p className="text-[11px] font-semibold tracking-[0.16em] text-onair uppercase">Live control state unavailable</p>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">{error}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">No fallback counts are shown while the server-only gateway is unavailable.</p>
        </section>
      ) : loading && !dashboard ? (
        <section className="border border-line bg-panel p-5 text-sm text-ink-faint" aria-live="polite">Reading the action ledger…</section>
      ) : dashboard ? (
        <>
          <section className="grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Organizations", value: dashboard.organizations.length, detail: "Registered operating scopes", tone: "text-signal" },
              { label: "Connections", value: dashboard.connections.length, detail: "Provider accounts and health", tone: "text-scope" },
              { label: "Open approvals", value: openApprovals.length, detail: "Human decisions still required", tone: "text-amber" },
              { label: "Actions in motion", value: activeActions.length, detail: "Queued or running ledger entries", tone: "text-ink" },
            ].map((stat) => (
              <div key={stat.label} className="bg-panel px-4 py-4 sm:px-5">
                <p className="text-[10px] tracking-[0.15em] text-ink-faint uppercase">{stat.label}</p>
                <p className={`display mt-2 text-3xl font-extrabold ${stat.tone}`}>{stat.value}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">{stat.detail}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <DashboardList title="Connection state" description="Connected provider accounts and the capabilities they have actually granted." items={dashboard.connections} organizations={organizations} />
            <DashboardList title="Approval queue" description="Every consequential send, spend, publish, or paid render waits here for an explicit decision." items={openApprovals} organizations={organizations} timestamp="created" />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <DashboardList title="Action ledger" description="A durable record of queued, running, completed, or failed side effects—not a promise that a channel has acted." items={dashboard.actions} organizations={organizations} />
            <DashboardList title="Incoming intake" description="Requests received from connected surfaces before they become client work or an approved action." items={dashboard.intakes} organizations={organizations} timestamp="created" />
          </section>

          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <DashboardList title="Operating scopes" description="Organizations keep the agency, portfolio, client, and partner work separated." items={dashboard.organizations} organizations={organizations} />
            <aside className="border border-amber/35 bg-panel p-5">
              <p className="text-[10px] font-semibold tracking-[0.17em] text-amber uppercase">Deliberate control boundary</p>
              <h2 className="display mt-2 text-2xl font-bold tracking-tight">Automation is proposed; authority is explicit.</h2>
              <div className="mt-4 space-y-3 text-xs leading-relaxed text-ink-dim">
                <p>New leads and channel events can be recorded automatically. Publishing, cold outreach, ad-spend changes, paid rendering, customer messages, and financial effects must each have a policy-backed approval before execution.</p>
                <p>That approval and the eventual provider receipt belong in the ledger. If a connection is missing, revoked, or outside its permitted capability, the action stays blocked rather than silently falling back.</p>
              </div>
            </aside>
          </section>
        </>
      ) : null}
    </div>
  );
}
