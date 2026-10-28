"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Doc } from "../../convex/_generated/dataModel";
import { MarketingIcon } from "./marketing-frame";

type Card = {
  id: string;
  name: string;
  website: string;
  status: string;
  currency: string;
  goal: string;
  stats: Doc<"marketingProjects">["stats"] | null;
  openItems: number;
  activeCampaigns: number;
  unconfirmedCampaigns?: number;
  enabledChannels: number;
  needsAttention: boolean;
  updatedAt: number;
};
type Overview = {
  projects: Card[];
  costs: Doc<"marketingCostTotals">[];
  provider: Doc<"marketingProviderInventory"> | null;
  capturedAt: number;
};
type LibraryRow = {
  _id: string;
  projectId?: string;
  projectName?: string;
  title?: string;
  label?: string;
  content?: string;
  reference?: string;
  kind?: "ad" | "post";
  contentType?: string;
  bytes?: number;
  amountMinor?: number;
  currency?: string;
  voidedAt?: number;
  category?: string;
  status?: string;
  scheduledAt?: number;
  occurredAt?: number;
  createdAt?: number;
  publicationUrl?: string;
};
const cash = (value: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    value / 100,
  );
const date = (value: number) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load workspace");
  return body;
}

export function MarketingLibrary({
  onOpenProject,
  initialKind = "uploads",
  refreshKey = 0,
}: {
  onOpenProject: (id: string) => void;
  initialKind?: "uploads" | "content" | "costs";
  refreshKey?: number;
}) {
  const [kind, setKind] = useState(initialKind),
    [rows, setRows] = useState<LibraryRow[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [done, setDone] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [voiding, setVoiding] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const reset = window.setTimeout(() => {
      setBusy(true);
      setRows([]);
      setCursor(null);
      setError("");
    }, 0);
    fetch(`/api/marketing?view=table&kind=${kind}`, {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(json)
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data.page);
          setCursor(data.continueCursor);
          setDone(data.isDone);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load content",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => {
      controller.abort();
      window.clearTimeout(reset);
    };
  }, [kind, refreshKey, revision]);
  async function more() {
    setBusy(true);
    setError("");
    try {
      const data = await json(
        await fetch(
          `/api/marketing?view=table&kind=${kind}&cursor=${encodeURIComponent(cursor || "")}`,
          { credentials: "same-origin", cache: "no-store" },
        ),
      );
      setRows((previous) => [...previous, ...data.page]);
      setCursor(data.continueCursor);
      setDone(data.isDone);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load content",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mk-library mk-card">
      <div className="mk-library-heading">
        <div>
          <h2>Your content, in one place.</h2>
          <p>
            Uploaded media, posts and recorded charges across your projects.
          </p>
        </div>
        <div className="mk-segment" aria-label="Library type">
          {(["uploads", "content", "costs"] as const).map((value) => (
            <button
              key={value}
              className={kind === value ? "is-selected" : ""}
              disabled={busy}
              onClick={() => {
                setKind(value);
                setVoiding("");
              }}
              aria-pressed={kind === value}
            >
              {value === "uploads"
                ? "Uploads"
                : value === "content"
                  ? "Content"
                  : "Charges"}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="mk-feedback mk-error">
          {error}
        </p>
      )}
      {voiding && (
        <div className="mk-feedback">
          <p>
            Void this recorded charge? Its audit record will remain, and it will
            be removed from spending totals.
          </p>
          <button
            className="mk-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await json(
                  await fetch("/api/marketing", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      action: "void-cost",
                      payload: { costId: voiding },
                    }),
                  }),
                );
                setVoiding("");
                setRevision((value) => value + 1);
                window.dispatchEvent(new Event("marketing-cost-changed"));
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Could not void charge",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Void charge
          </button>{" "}
          <button className="mk-button" onClick={() => setVoiding("")}>
            Keep charge
          </button>
        </div>
      )}
      <div className="mk-table-wrap">
        <table>
          <thead>
            <tr>
              <th>{kind === "costs" ? "Charge" : "Content"}</th>
              <th>Project</th>
              <th>{kind === "costs" ? "Amount" : "Type"}</th>
              <th>Status</th>
              <th>{kind === "content" ? "Scheduled" : "Date"}</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id}>
                <td>
                  <strong>
                    {row.title ||
                      row.label ||
                      `${row.contentType?.startsWith("video") ? "Video" : "Image"} upload`}
                  </strong>
                  {row.content && (
                    <span>
                      {row.content.slice(0, 95)}
                      {row.content.length > 95 ? "…" : ""}
                    </span>
                  )}
                  {row.reference && <span>{row.reference}</span>}
                </td>
                <td>
                  {row.projectId ? (
                    <button
                      className="mk-text-link"
                      onClick={() => onOpenProject(row.projectId!)}
                    >
                      {row.projectName || "Open project"}
                    </button>
                  ) : (
                    "Workspace"
                  )}
                </td>
                <td>
                  {kind === "costs"
                    ? cash(row.amountMinor ?? 0, row.currency || "USD")
                    : row.kind === "ad"
                      ? "Ad"
                      : row.kind === "post"
                        ? "Post"
                        : `${row.contentType?.split("/")[1]?.toUpperCase() || "Media"}${row.bytes ? ` · ${(row.bytes / 1_000_000).toFixed(1)} MB` : ""}`}
                </td>
                <td>
                  <span
                    className={`mk-status ${row.voidedAt ? "is-muted" : ""}`}
                  >
                    {row.voidedAt
                      ? "Voided"
                      : kind === "costs"
                        ? row.category
                        : row.status?.replaceAll("_", " ") || "Verified upload"}
                  </span>
                </td>
                <td>
                  {date(
                    (kind === "content"
                      ? row.scheduledAt
                      : row.occurredAt || row.createdAt) || 0,
                  )}
                </td>
                <td>
                  {kind === "uploads" && row.projectId ? (
                    <a
                      className="mk-text-link"
                      href={`/api/marketing/media?projectId=${row.projectId}&assetId=${row._id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View <MarketingIcon name="external" size={15} />
                    </a>
                  ) : row.publicationUrl ? (
                    <a
                      className="mk-text-link"
                      href={row.publicationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Published <MarketingIcon name="external" size={15} />
                    </a>
                  ) : kind === "costs" && !row.voidedAt ? (
                    <button
                      className="mk-text-link"
                      onClick={() => setVoiding(row._id)}
                    >
                      Void
                    </button>
                  ) : row.projectId ? (
                    <button
                      className="mk-text-link"
                      onClick={() => onOpenProject(row.projectId!)}
                    >
                      Open →
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <div className="mk-empty-state">
          <MarketingIcon name="content" size={30} />
          <h3>
            {busy
              ? "Loading your library…"
              : kind === "uploads"
                ? "Your media library starts here."
                : kind === "content"
                  ? "Your content will appear here."
                  : "No charges recorded yet."}
          </h3>
          <p>
            {kind === "uploads"
              ? "Open a project to upload an image or reuse an approved video."
              : kind === "content"
                ? "Prepare a project’s first week to see its drafts and schedule."
                : "Record actual subscription, generation or hosting charges to include them in your totals."}
          </p>
        </div>
      )}
      {!done && (
        <div className="mk-load-more">
          <button
            className="mk-button"
            disabled={busy}
            onClick={() => void more()}
          >
            {busy ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}

function CostForm({
  projects,
  onSaved,
}: {
  projects: Card[];
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    const form = event.currentTarget,
      values = new FormData(form);
    try {
      await json(
        await fetch("/api/marketing", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "record-cost",
            payload: {
              label: values.get("label"),
              category: values.get("category"),
              reference: values.get("reference"),
              amountMinor: Math.round(Number(values.get("amount")) * 100),
              currency: values.get("currency"),
              occurredAt: Date.parse(`${values.get("date")}T12:00:00Z`),
              ...(values.get("projectId")
                ? { projectId: values.get("projectId") }
                : {}),
            },
          }),
        }),
      );
      form.reset();
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not record charge",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mk-cost-form">
      <summary>+ Record a subscription or other charge</summary>
      <form onSubmit={submit}>
        <p className="mk-inline-note">
          Record a charge you actually incurred. Ad spend is tracked separately
          from campaign reports; avoid adding it again. This records costs only
          and makes no payment.
        </p>
        <div className="mk-form-grid">
          <label className="mk-field">
            <span>Charge name</span>
            <input
              name="label"
              required
              maxLength={120}
              placeholder="e.g. Zernio — October"
            />
          </label>
          <label className="mk-field">
            <span>Category</span>
            <select name="category" aria-label="Charge category">
              <option value="subscription">Subscription / provider fees</option>
              <option value="generation">Content generation</option>
              <option value="hosting">Hosting / storage</option>
            </select>
          </label>
          <label className="mk-field">
            <span>Amount paid</span>
            <input
              name="amount"
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
            />
          </label>
          <label className="mk-field">
            <span>Currency</span>
            <select name="currency" aria-label="Charge currency">
              {["USD", "GBP", "EUR", "CHF"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="mk-field">
            <span>Charge date</span>
            <input
              name="date"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              max={new Date().toISOString().slice(0, 10)}
            />
          </label>
          <label className="mk-field">
            <span>Invoice / receipt reference</span>
            <input
              name="reference"
              maxLength={160}
              required
              placeholder="Unique reference prevents duplicates"
            />
          </label>
          <label className="mk-field">
            <span>Assign to project</span>
            <select name="projectId" aria-label="Charge project">
              <option value="">Workspace / shared subscription</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="mk-feedback mk-error">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="mk-feedback">
            Charge recorded in your spending totals.
          </p>
        )}
        <button disabled={busy} className="mk-button mk-primary">
          {busy ? "Saving…" : "Record charge"}
        </button>
      </form>
    </details>
  );
}

export default function MarketingOverview({
  onOpenProject,
  onAddProject,
}: {
  onOpenProject: (id: string) => void;
  onAddProject: () => void;
}) {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const body = await json(
      await fetch("/api/marketing?view=overview", {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      }),
    );
    if (!signal?.aborted) {
      setData(body);
      setError("");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => {
      void load(controller.signal).catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load overview",
          );
      });
    }, 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        void load(controller.signal).catch(() =>
          setError("Could not refresh. Showing the last received snapshot."),
        );
    }, 60_000);
    const refresh = () => {
      setRevision((value) => value + 1);
      void load(controller.signal).catch(() => undefined);
    };
    window.addEventListener("marketing-cost-changed", refresh);
    return () => {
      controller.abort();
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("marketing-cost-changed", refresh);
    };
  }, [load]);
  if (!data)
    return (
      <div className="mk-empty-state" role="status">
        {error || "Loading your overview…"}
      </div>
    );
  const currencies = [
    ...new Set([
      ...data.projects.map((project) => project.currency),
      ...data.costs.map((cost) => cost.currency),
    ]),
  ];
  const totals = currencies.map((currency) => {
    const cost = data.costs.find((cost) => cost.currency === currency),
      ads = data.projects
        .filter((project) => project.currency === currency)
        .reduce(
          (sum, project) => sum + (project.stats?.advertisingMinor ?? 0),
          0,
        );
    return {
      currency,
      ads,
      subscriptions: cost?.subscription ?? 0,
      generation: cost?.generation ?? 0,
      hosting: cost?.hosting ?? 0,
      total:
        ads +
        (cost?.subscription ?? 0) +
        (cost?.generation ?? 0) +
        (cost?.hosting ?? 0),
    };
  });
  return (
    <div className="mk-overview">
      {error && (
        <p className="mk-feedback mk-error" role="alert">
          {error}
        </p>
      )}
      <div className="mk-overview-stats">
        <div className="mk-card">
          <span>Projects</span>
          <strong>{data.projects.length}</strong>
          <small>
            {
              data.projects.filter((project) => project.status === "active")
                .length
            }{" "}
            with automation enabled
          </small>
        </div>
        <div className="mk-card">
          <span>Active campaigns</span>
          <strong>
            {data.projects.reduce(
              (sum, project) => sum + project.activeCampaigns,
              0,
            )}
          </strong>
          <small>Based on the last confirmed status</small>
        </div>
        <div className="mk-card">
          <span>Verified conversions</span>
          <strong>
            {data.projects.reduce(
              (sum, project) => sum + (project.stats?.conversions ?? 0),
              0,
            )}
          </strong>
          <small>Authenticated first-party events</small>
        </div>
        <div className="mk-card">
          <span>Recorded spend so far</span>
          <strong className="mk-spend-amount">
            {totals.length
              ? totals.map((total) => (
                  <span key={total.currency}>
                    {cash(total.total, total.currency)}
                  </span>
                ))
              : "$0.00"}
          </strong>
          <small>Reported ads + recorded charges</small>
        </div>
      </div>
      <section className="mk-card mk-spending">
        <div className="mk-section-heading">
          <div>
            <h2>Every cost, accounted for.</h2>
            <p>
              Actual recorded charges and reported advertising spend, kept in
              their original currencies.
            </p>
          </div>
          <span className="mk-status">Tracking from project creation</span>
        </div>
        {totals.map((total) => (
          <div className="mk-cost-breakdown" key={total.currency}>
            <div>
              <span>Advertising</span>
              <strong>{cash(total.ads, total.currency)}</strong>
            </div>
            <div>
              <span>Subscriptions & fees</span>
              <strong>{cash(total.subscriptions, total.currency)}</strong>
            </div>
            <div>
              <span>Generation</span>
              <strong>{cash(total.generation, total.currency)}</strong>
            </div>
            <div>
              <span>Hosting & storage</span>
              <strong>{cash(total.hosting, total.currency)}</strong>
            </div>
          </div>
        ))}
        <p className="mk-inline-note">
          Subscription invoices, generation and hosting bills are not imported
          automatically. Record those charges below to include them. Provider
          reserves, estimated base fees and unknown historical costs are
          excluded.
        </p>
        {data.provider?.periodSpendMinor !== undefined && (
          <p className="mk-inline-note">
            Zernio reports {cash(data.provider.periodSpendMinor, "USD")} for its
            current billing period, checked {date(data.provider.checkedAt)}.
            Reconcile this with the actual charge you record; it is not added a
            second time.
          </p>
        )}
        <CostForm
          projects={data.projects}
          onSaved={() => {
            setRevision((value) => value + 1);
            void load().catch(() => undefined);
          }}
        />
      </section>
      <section>
        <div className="mk-section-heading">
          <div>
            <h2>All your projects</h2>
            <p>
              Individual performance, active work and anything needing
              attention.
            </p>
          </div>
          <span className="mk-update-label">Refreshes every minute</span>
        </div>
        {!data.projects.length && (
          <div className="mk-card mk-empty-state">
            <MarketingIcon name="folder" size={30} />
            <h3>Your first project starts here.</h3>
            <p>
              Add a website, confirm the basics, and choose how you want to
              market it.
            </p>
            <button className="mk-button mk-primary" onClick={onAddProject}>
              Add your first project
              <MarketingIcon name="arrow" size={18} />
            </button>
          </div>
        )}
        <div className="mk-project-widgets">
          {data.projects.map((project) => (
            <article className="mk-card mk-project-widget" key={project.id}>
              <div className="mk-widget-top">
                <span className="mk-project-monogram">
                  {project.name.slice(0, 2).toUpperCase()}
                </span>
                <span
                  className={`mk-status ${project.status === "active" ? "is-active" : ""}`}
                >
                  {project.status === "active"
                    ? "Automation on"
                    : project.status === "paused"
                      ? "Paused"
                      : "Draft"}
                </span>
              </div>
              <h3>{project.name}</h3>
              <p className="mk-project-domain">
                {new URL(project.website).hostname}
              </p>
              <div className="mk-widget-metrics">
                <div>
                  <span>Clicks</span>
                  <strong>
                    {project.stats?.metricsAt
                      ? project.stats.clicks.toLocaleString()
                      : "—"}
                  </strong>
                </div>
                <div>
                  <span>Conversions</span>
                  <strong>{project.stats?.conversions ?? "—"}</strong>
                </div>
                <div>
                  <span>Ad spend</span>
                  <strong>
                    {project.stats
                      ? cash(project.stats.advertisingMinor, project.currency)
                      : "—"}
                  </strong>
                </div>
              </div>
              <div className="mk-widget-activity">
                <span>
                  {project.enabledChannels} channels · {project.openItems} in
                  queue
                </span>
                <span>{project.activeCampaigns} active campaigns</span>
                {project.stats && (
                  <span>
                    {project.stats.published} published · since{" "}
                    {date(project.stats.since)}
                  </span>
                )}
                {project.needsAttention && (
                  <span className="mk-attention">Needs attention</span>
                )}
              </div>
              <button
                className="mk-widget-open"
                onClick={() => onOpenProject(project.id)}
              >
                Open project
                <MarketingIcon name="arrow" size={18} />
              </button>
            </article>
          ))}
        </div>
      </section>
      <MarketingLibrary onOpenProject={onOpenProject} refreshKey={revision} />
    </div>
  );
}
