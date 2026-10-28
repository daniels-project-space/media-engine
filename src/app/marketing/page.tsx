"use client";

import Link from "next/link";
import Image from "next/image";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import MarketingOverview, {
  MarketingLibrary,
} from "@/components/marketing-overview";
import MarketingOnboarding from "@/components/marketing-onboarding";
import type { Doc } from "../../../convex/_generated/dataModel";

type Project = Omit<Doc<"marketingProjects">, "conversionTokenHash">;
type Workspace = {
  projects: Project[];
  selectedProjectId?: string;
  channels: Doc<"marketingChannels">[];
  items: Doc<"marketingItems">[];
  accounts: Doc<"marketingProviderAccounts">[];
  assets: Doc<"marketingAssets">[];
  renderImports: Doc<"marketingRenderImports">[];
  inventory: Doc<"marketingProviderInventory"> | null;
  results: Doc<"marketingResults"> | null;
  resultsMonth: string;
  allowances: Doc<"marketingAllowances">[];
  readiness: {
    qualified: boolean;
    publishingEnabled: boolean;
    advertisingEnabled: boolean;
    integrationLimitMinor: number;
    integrationCurrency: string;
  };
};
const inputClass =
  "w-full rounded-lg border border-line-2 bg-void px-3 py-2.5 text-sm text-ink outline-none focus:border-signal";
const buttonClass =
  "rounded-lg border border-line-2 px-4 py-2.5 text-sm font-bold transition hover:border-signal disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass = `${buttonClass} border-signal bg-signal text-void hover:bg-signal/90`;
const labels: Record<string, string> = {
  instagram: "Instagram",
  x: "X",
  reddit: "Reddit",
  googleads: "Google Ads",
  metaads: "Meta Ads",
};
const amount = (minor: number, currency = "USD") =>
  new Intl.NumberFormat("en", { style: "currency", currency }).format(
    minor / 100,
  );

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const labelId = useId();
  return (
    <label className="grid gap-2 text-xs text-ink-dim">
      <span id={labelId}>{label}</span>
      {isValidElement(children)
        ? cloneElement(
            children as ReactElement<{ "aria-labelledby"?: string }>,
            {
              "aria-labelledby": labelId,
            },
          )
        : children}
    </label>
  );
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.error === "string" ? body.error : "Marketing request failed",
    );
  return body;
}

function ProjectSettings({
  project,
  busy,
  action,
}: {
  project: Project;
  busy: boolean;
  action: (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
}) {
  const fields = [
    ["name", "Project name", project.name],
    ["website", "Website URL", project.website],
    ["offer", "Offer", project.offer],
    ["audience", "Audience", project.audience],
    ["tone", "Voice", project.tone],
    ["timezone", "Timezone", project.timezone],
  ];
  return (
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer text-sm font-semibold">
        Edit project brief & limits
      </summary>
      <form
        key={project.version}
        className="mt-5 grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          await action("update-project", {
            projectId: project._id,
            expectedVersion: project.version,
            ...Object.fromEntries(fields.map(([key]) => [key, data.get(key)])),
            facts: String(data.get("facts"))
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
            cadence: Number(data.get("cadence")),
            generationLimitMinor: Math.round(
              Number(data.get("generationLimit")) * 100,
            ),
            advertisingLimitMinor: Math.round(
              Number(data.get("advertisingLimit")) * 100,
            ),
          });
        }}
      >
        <p className="text-xs leading-5 text-ink-dim">
          Pause automation before editing. Saving retires pending drafts and
          approvals so your next week uses the updated brief. Currency and
          conversion goal stay fixed for consistent reporting.
        </p>
        {fields.map(([key, label, value]) => (
          <Field key={key} label={label}>
            <input
              name={key}
              type={key === "website" ? "url" : "text"}
              defaultValue={value}
              required
              className={inputClass}
            />
          </Field>
        ))}
        <Field label="Confirmed facts · one per line">
          <textarea
            name="facts"
            rows={3}
            required
            defaultValue={project.facts.join("\n")}
            className={inputClass}
          />
        </Field>
        <Field label="Posts per channel / week">
          <input
            name="cadence"
            type="number"
            min={1}
            max={7}
            required
            defaultValue={project.cadence}
            className={inputClass}
          />
        </Field>
        <Field label={`Generation / month (${project.currency})`}>
          <input
            name="generationLimit"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={project.generationLimitMinor / 100}
            className={inputClass}
          />
        </Field>
        <Field label={`Advertising / month (${project.currency})`}>
          <input
            name="advertisingLimit"
            type="number"
            min={0}
            step="0.01"
            required
            defaultValue={project.advertisingLimitMinor / 100}
            className={inputClass}
          />
        </Field>
        <label className="flex gap-2 text-xs leading-5 text-ink-dim">
          <input type="checkbox" required />I confirm the updated facts and
          understand that pending drafts will be retired.
        </label>
        <button
          className={buttonClass}
          disabled={busy || project.status === "active"}
        >
          Save project changes
        </button>
      </form>
    </details>
  );
}

export default function Marketing() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<
    "overview" | "projects" | "content" | "results" | "library"
  >("overview");
  const [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [conversionToken, setConversionToken] = useState("");
  const requestNumber = useRef(0);

  const load = useCallback(async (selected: string, signal?: AbortSignal) => {
    const sequence = ++requestNumber.current;
    const response = await fetch(
      `/api/marketing${selected ? `?projectId=${encodeURIComponent(selected)}` : ""}`,
      { cache: "no-store", credentials: "same-origin", signal },
    );
    const data = (await responseJson(response)) as unknown as Workspace;
    if (sequence !== requestNumber.current) return;
    setWorkspace(data);
    if (!selected && data.projects.length) setProjectId(data.projects[0]._id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++requestNumber.current;
    fetch(
      `/api/marketing${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      },
    )
      .then(responseJson)
      .then((value) => {
        if (controller.signal.aborted || sequence !== requestNumber.current)
          return;
        const data = value as unknown as Workspace;
        setWorkspace(data);
        setError("");
        if (!projectId && data.projects.length)
          setProjectId(data.projects[0]._id);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Could not load marketing",
          );
      });
    return () => controller.abort();
  }, [projectId]);

  const project = workspace?.projects.find((row) => row._id === projectId);
  const selected = workspace?.selectedProjectId === projectId;
  const items = selected ? workspace.items : [],
    channels = selected ? workspace.channels : [],
    assets = selected ? workspace.assets : [];
  const accountById = new Map(
    workspace?.accounts.map((account) => [account._id, account]),
  );

  const hasPending = items.some((item) =>
    [
      "dispatching",
      "scheduled",
      "active",
      "cancel_pending",
      "uncertain",
    ].includes(item.status),
  );
  useEffect(() => {
    if (!projectId || !workspace?.readiness.qualified || !hasPending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void load(projectId).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(timer);
  }, [projectId, workspace?.readiness.qualified, hasPending, load]);

  async function action(name: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await responseJson(
        await fetch("/api/marketing", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: name, payload }),
        }),
      );
      if (name === "create-project") {
        setProjectId(String(result.projectId));
        setConversionToken(String(result.conversionToken));
        setCreating(false);
        setTab("projects");
        await load(String(result.projectId));
      } else await load(projectId);
      setNotice(
        name === "generate-week"
          ? "Brand-template queue prepared. Review the drafts before starting automation."
          : name === "generate-plan"
            ? "AI planning request submitted. Check the run status below."
          : "Saved.",
      );
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      form.set("projectId", projectId);
      form.set("rightsConfirmed", "true");
      await responseJson(
        await fetch("/api/marketing/assets", {
          method: "POST",
          credentials: "same-origin",
          body: form,
        }),
      );
      await load(projectId);
      setNotice("Original image stored with a verified R2 receipt.");
      event.currentTarget?.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  }

  const onboarding =
    creating ||
    (!!workspace && workspace.projects.length === 0 && tab === "projects");
  useEffect(() => {
    const update = () => {
      const value = location.hash.slice(1);
      if (
        value === "overview" ||
        value === "projects" ||
        value === "content" ||
        value === "results" ||
        value === "library"
      ) {
        setTab(value);
        if (value !== "projects") setCreating(false);
      }
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  if (onboarding && workspace)
    return (
      <MarketingOnboarding
        accounts={workspace.accounts}
        onRefresh={async () => {
          const response = await fetch("/api/marketing", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "refresh-accounts", payload: {} }),
          });
          await responseJson(response);
          await load(projectId);
        }}
        onComplete={async (id, token) => {
          setProjectId(id);
          setConversionToken(token);
          setCreating(false);
          setTab("projects");
          window.location.hash = "projects";
          await load(id);
          setNotice(
            "Project created. Add owned media and prepare your first week when your channels are ready.",
          );
        }}
        onCancel={
          workspace.projects.length ? () => setCreating(false) : undefined
        }
      />
    );

  function startProject() {
    setCreating(true);
    setTab("projects");
    window.location.hash = "projects";
  }
  function openProject(id: string) {
    setProjectId(id);
    setCreating(false);
    setTab("projects");
    window.location.hash = "projects";
  }
  return (
    <main className="mk-workspace min-w-0 w-full space-y-7 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mk-workspace-title">Your marketing workspace</p>
          <h1 className="display mt-3 text-4xl font-extrabold">
            {tab === "overview"
              ? "A clear view of everything."
              : tab === "library"
                ? "Your media. All organised."
                : "Your projects. Ready to grow."}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-dim">
            Everything you need to plan content, manage channels and see what’s
            working.
          </p>
        </div>
        <button className={primaryClass} disabled={busy} onClick={startProject}>
          Add project
        </button>
      </header>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-onair/40 bg-onair/5 p-4 text-sm"
        >
          <p>{error}</p>
          {error.includes("session") ? (
            <Link
              href="https://project-hub-olive-pi.vercel.app/media-engine"
              className="mt-2 inline-block underline"
            >
              Unlock through Project Hub
            </Link>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-signal/30 p-4 text-sm text-signal"
        >
          {notice}
        </p>
      ) : null}
      {conversionToken ? (
        <section className="rounded-xl border border-amber/40 p-5">
          <h2 className="font-bold">Save the server conversion token</h2>
          <p className="mt-2 text-xs leading-5 text-ink-dim">
            Shown once for the newly created project. Store it in that website’s
            server secrets, never its browser code.
          </p>
          <code className="mt-3 block break-all rounded bg-void p-3 text-xs">
            {conversionToken}
          </code>
          <button
            className={`${buttonClass} mt-3`}
            onClick={() => setConversionToken("")}
          >
            I have saved it
          </button>
        </section>
      ) : null}
      {workspace ? (
        <>
          {tab === "overview" ? (
            <MarketingOverview
              onOpenProject={openProject}
              onAddProject={startProject}
            />
          ) : tab === "library" ? (
            <MarketingLibrary onOpenProject={openProject} />
          ) : (
            <>
              <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-panel p-4">
                <Field label="Current project">
                  <select
                    aria-label="Current project"
                    className={`${inputClass} min-w-60`}
                    value={projectId}
                    disabled={busy}
                    onChange={(event) => {
                      setProjectId(event.target.value);
                      setConversionToken("");
                      setNotice("");
                    }}
                  >
                    {workspace.projects.length ? (
                      workspace.projects.map((row) => (
                        <option key={row._id} value={row._id}>
                          {row.name}
                        </option>
                      ))
                    ) : (
                      <option value="">Add your first project</option>
                    )}
                  </select>
                </Field>
                <div className="text-right text-xs leading-6 text-ink-dim">
                  <p>
                    Integration target:{" "}
                    <strong className="text-ink">$30/month</strong>
                  </p>
                  <p>
                    {workspace.inventory
                      ? `${workspace.inventory.accountCount} provider accounts · ${amount(workspace.inventory.baseMinor)} estimated base + metered X usage`
                      : "Account inventory has not been verified"}
                  </p>
                  {workspace.inventory?.periodSpendMinor !== undefined ? (
                    <p>
                      {amount(workspace.inventory.periodSpendMinor)} reported
                      this provider billing period · X cap{" "}
                      {workspace.inventory.xSpendLimitMinor === null
                        ? "unset"
                        : amount(workspace.inventory.xSpendLimitMinor ?? 0)}
                      . Tax and ad-platform spend are separate.
                    </p>
                  ) : null}
                </div>
              </section>
              <nav
                aria-label="Marketing views"
                className="flex flex-wrap gap-2 border-b border-line pb-3"
              >
                {(["projects", "content", "results"] as const).map((value) => (
                  <button
                    key={value}
                    className={`${buttonClass} capitalize ${tab === value ? "border-signal text-signal" : "text-ink-dim"}`}
                    aria-current={tab === value ? "page" : undefined}
                    onClick={() => {
                      setTab(value);
                      window.location.hash = value;
                    }}
                  >
                    {value === "content"
                      ? "Content & calendar"
                      : value === "projects"
                        ? "Projects"
                        : "Results"}
                  </button>
                ))}
                <button
                  className={`${buttonClass} ml-auto`}
                  disabled={busy}
                  onClick={() =>
                    void load(projectId).catch((cause) =>
                      setError(String(cause)),
                    )
                  }
                >
                  Refresh
                </button>
              </nav>
              {!workspace.readiness.qualified ||
              !workspace.readiness.publishingEnabled ? (
                <aside className="rounded-xl border border-amber/30 bg-amber/5 p-4 text-xs leading-6 text-ink-dim">
                  Draft mode is ready. Publishing and paid campaigns will stay
                  off until your selected accounts are verified and activated.
                </aside>
              ) : null}
              {workspace.inventory?.error ? (
                <p
                  role="alert"
                  className="rounded-xl border border-amber/30 p-4 text-xs text-amber"
                >
                  Account refresh needs attention: {workspace.inventory.error}
                </p>
              ) : null}
              {project?.planningError ? (
                <p
                  role="alert"
                  className="rounded-xl border border-amber/30 p-4 text-xs text-amber"
                >
                  Planning stopped: {project.planningError}. Correct the project
                  setup, then prepare the week again.
                </p>
              ) : null}
              {project && tab === "projects" ? (
                <section className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
                  <div className="space-y-5 rounded-2xl border border-line bg-panel p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="display text-2xl font-bold">
                        {project.name}
                      </h2>
                      <span className="rounded-full border border-line-2 px-3 py-1 text-xs capitalize">
                        {project.status}
                      </span>
                    </div>
                    <a
                      href={project.website}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-xs text-scope underline"
                    >
                      {project.website}
                    </a>
                    <p className="text-sm leading-6">{project.offer}</p>
                    <p className="text-xs leading-6 text-ink-dim">
                      Audience: {project.audience}
                      <br />
                      Goal: {project.goal} · {project.cadence}{" "}
                      posts/week/channel
                      <br />
                      Generation:{" "}
                      {amount(project.generationLimitMinor, project.currency)}
                      /month · Advertising:{" "}
                      {amount(project.advertisingLimitMinor, project.currency)}
                      /month
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={busy}
                        className={primaryClass}
                        onClick={() =>
                          void action("set-project-status", {
                            projectId,
                            status: "active",
                          })
                        }
                      >
                        Start project automation
                      </button>
                      <button
                        disabled={busy}
                        className={buttonClass}
                        onClick={() =>
                          void action("set-project-status", {
                            projectId,
                            status: "paused",
                          })
                        }
                      >
                        Pause & cancel queue
                      </button>
                    </div>
                    <p className="text-xs leading-5 text-ink-dim">
                      Remote cancellations remain visible until the publisher
                      confirms them.
                    </p>
                    <ProjectSettings
                      project={project}
                      busy={busy}
                      action={action}
                    />
                    <ProjectPlan key={project._id} project={project} busy={busy} action={action} />
                    <form
                      onSubmit={upload}
                      className="grid gap-3 border-t border-line pt-5"
                    >
                      <h3 className="text-sm font-bold">Project media</h3>
                      <input
                        name="file"
                        aria-label="Project image"
                        type="file"
                        required
                        accept="image/jpeg,image/png,image/webp"
                        className="max-w-full text-xs"
                      />
                      <label className="flex gap-2 text-xs leading-5 text-ink-dim">
                        <input type="checkbox" required />I own or have
                        permission to advertise with this image.
                      </label>
                      <button disabled={busy} className={buttonClass}>
                        Upload original image
                      </button>
                      <p className="text-xs text-ink-dim">
                        {assets.length} verified assets · Images up to 4 MB
                      </p>
                    </form>
                    <RenderReuse
                      key={projectId}
                      projectId={projectId}
                      imports={selected ? workspace.renderImports : []}
                      busy={busy}
                      action={action}
                    />
                  </div>
                  <div className="rounded-2xl border border-line bg-panel p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="display text-2xl font-bold">Channels</h2>
                      <button
                        className={buttonClass}
                        disabled={busy}
                        onClick={() => void action("refresh-accounts")}
                      >
                        Refresh accounts
                      </button>
                    </div>
                    <p className="mt-3 text-xs leading-6 text-ink-dim">
                      Connect owned accounts in{" "}
                      <a
                        className="text-scope underline"
                        href="https://zernio.com/dashboard"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Zernio
                      </a>
                      , then map them here. Dedicated social and ad accounts
                      each count toward the software fee.
                    </p>
                    <div
                      role="list"
                      aria-label="Configured channels"
                      className="mt-5 space-y-3"
                    >
                      {channels.map((channel) => {
                        const account = accountById.get(channel.accountId);
                        return (
                          <div
                            role="listitem"
                            key={channel._id}
                            className="flex justify-between gap-3 rounded-lg border border-line p-3 text-xs"
                          >
                            <span>
                              {labels[account?.platform ?? ""]} ·{" "}
                              {account?.label ?? "Refresh account"}
                            </span>
                            <span
                              className={
                                channel.mode === "automatic"
                                  ? "text-signal"
                                  : "text-ink-dim"
                              }
                            >
                              {channel.mode}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <form
                      key={projectId}
                      className="mt-6 grid gap-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        const selectedMode = String(form.get("mode"));
                        await action("save-channel", {
                          projectId,
                          accountId: form.get("accountId"),
                          mode: selectedMode,
                          communityApproved:
                            form.get("communityApproved") === "on",
                          ...(form.get("subreddit")
                            ? { subreddit: form.get("subreddit") }
                            : {}),
                          ...(form.get("adAccountId")
                            ? { adAccountId: form.get("adAccountId") }
                            : {}),
                          ...(form.get("pageId")
                            ? { pageId: form.get("pageId") }
                            : {}),
                          ...(selectedMode === "automatic"
                            ? {
                                authorisedUntil:
                                  Date.now() + 30 * 86_400_000 - 60_000,
                              }
                            : {}),
                        });
                      }}
                    >
                      <Field label="Connected account">
                        <select
                          required
                          name="accountId"
                          className={inputClass}
                        >
                          <option value="">Select an account</option>
                          {workspace.accounts
                            .filter((account) => account.connected)
                            .map((account) => (
                              <option key={account._id} value={account._id}>
                                {labels[account.platform]} · {account.label}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <Field label="Channel mode">
                        <select name="mode" className={inputClass}>
                          <option value="draft">Draft only</option>
                          <option value="automatic">
                            Automatic for 30 days
                          </option>
                          <option value="off">Off</option>
                        </select>
                      </Field>
                      <Field label="Reddit community, when applicable">
                        <input
                          name="subreddit"
                          placeholder="community_name"
                          className={inputClass}
                        />
                      </Field>
                      <label className="flex gap-2 text-xs leading-5 text-ink-dim">
                        <input name="communityApproved" type="checkbox" />
                        For Reddit: this account and community permit these
                        promotional posts.
                      </label>
                      <Field label="Verified ad account ID, for Google/Meta">
                        <input name="adAccountId" className={inputClass} />
                      </Field>
                      <Field label="Verified Facebook Page ID, for Meta">
                        <input name="pageId" className={inputClass} />
                      </Field>
                      <label className="flex gap-2 text-xs leading-5 text-ink-dim">
                        <input type="checkbox" required />I authorise this
                        account’s selected mode and project cadence. Ad launches
                        still require individual review and an advertising
                        allowance.
                      </label>
                      <button disabled={busy} className={buttonClass}>
                        Save channel policy
                      </button>
                    </form>
                  </div>
                </section>
              ) : null}
              {project && tab === "content" ? (
                <section className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="display text-2xl font-bold">
                        The next week
                      </h2>
                      <p className="mt-2 text-xs text-ink-dim">
                        Brand templates · confirmed facts · no AI charge
                      </p>
                    </div>
                    <button
                      disabled={busy}
                      className={primaryClass}
                      onClick={() =>
                        void action("generate-week", { projectId })
                      }
                    >
                      Prepare first / next week
                    </button>
                  </div>
                  {!items.length ? (
                    <div className="rounded-2xl border border-dashed border-line-2 p-10 text-sm text-ink-dim">
                      Add channels and owned media, then prepare the first week.
                    </div>
                  ) : null}
                  <div className="grid gap-4 md:grid-cols-2">
                    {items.map((item) => {
                      const channel = channels.find(
                          (row) => row._id === item.channelId,
                        ),
                        account = channel
                          ? accountById.get(channel.accountId)
                          : undefined;
                      const asset = assets.find(
                        (asset) => asset._id === item.assetId,
                      );
                      const previewUrl = asset
                        ? `/api/marketing/media?projectId=${projectId}&assetId=${asset._id}`
                        : "";
                      return (
                        <article
                          key={item._id}
                          className="min-w-0 rounded-xl border border-line bg-panel p-5"
                        >
                          <div className="flex flex-wrap justify-between gap-2 text-xs">
                            <span className="text-scope">
                              {labels[account?.platform ?? ""]} ·{" "}
                              {item.kind === "ad"
                                ? "Paid campaign"
                                : "Organic post"}
                            </span>
                            <span className="capitalize text-ink-dim">
                              {item.status.replaceAll("_", " ")}
                            </span>
                          </div>
                          <h3 className="mt-4 font-bold">{item.title}</h3>
                          <p className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-ink-dim">
                            {item.content}
                          </p>
                          {asset ? (
                            <div className="mt-4 rounded-lg border border-line bg-void p-2">
                              {asset.contentType === "video/mp4" ? (
                                <video
                                  controls
                                  playsInline
                                  preload="none"
                                  className="max-h-96 w-full"
                                  src={previewUrl}
                                />
                              ) : (
                                <Image
                                  unoptimized
                                  width={640}
                                  height={640}
                                  className="max-h-96 w-full object-contain"
                                  alt={`Approved media for ${item.title}`}
                                  src={previewUrl}
                                />
                              )}
                            </div>
                          ) : null}
                          {item.ad ? (
                            <dl className="mt-4 grid gap-2 rounded-lg border border-line p-3 text-xs leading-5">
                              <div>
                                <dt className="text-ink-faint">Headline</dt>
                                <dd>{item.ad.headline}</dd>
                              </div>
                              <div>
                                <dt className="text-ink-faint">
                                  Destination and account
                                </dt>
                                <dd className="break-all">
                                  {project.website} · {account?.label} ·{" "}
                                  {channel?.adAccountId}
                                  {channel?.pageId
                                    ? ` · Page ${channel.pageId}`
                                    : ""}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-ink-faint">Targeting</dt>
                                <dd>
                                  {item.ad.countries.join(", ")}
                                  {item.ad.keywords.length
                                    ? ` · ${item.ad.keywords.join(", ")}`
                                    : ""}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-ink-faint">
                                  Budget and duration
                                </dt>
                                <dd>
                                  {amount(
                                    item.ad.dailyBudgetMinor,
                                    project.currency,
                                  )}
                                  /day reference · {item.ad.durationDays} days ·{" "}
                                  {amount(
                                    item.ad.maxSpendMinor,
                                    project.currency,
                                  )}{" "}
                                  maximum admitted exposure.{" "}
                                  {account?.platform === "googleads"
                                    ? "Google can overdeliver daily; the reserved exposure includes this."
                                    : "Meta uses the displayed total as a lifetime budget."}
                                </dd>
                              </div>
                            </dl>
                          ) : null}
                          <p className="mt-4 text-xs text-ink-faint">
                            {new Date(item.scheduledAt).toLocaleString(
                              "en-GB",
                              {
                                timeZone: project.timezone,
                              },
                            )}{" "}
                            · {project.timezone}
                          </p>
                          {item.error ? (
                            <p className="mt-3 text-xs leading-5 text-amber">
                              {item.error}
                            </p>
                          ) : null}
                          {item.metrics ? (
                            <p className="mt-3 text-xs text-ink-faint">
                              Provider metrics received{" "}
                              {new Date(item.metrics.capturedAt).toLocaleString(
                                "en-GB",
                                { timeZone: project.timezone },
                              )}
                              . {item.metrics.clicks} clicks ·{" "}
                              {amount(
                                item.metrics.spendMinor,
                                item.metrics.currency,
                              )}{" "}
                              reported spend.
                            </p>
                          ) : null}
                          {item.status === "draft" && item.kind === "post" ? (
                            <DraftEditor
                              key={`${item._id}:${item.version}`}
                              item={item}
                              busy={busy}
                              save={(payload) =>
                                action("edit-draft", { projectId, ...payload })
                              }
                            />
                          ) : null}
                          {item.kind === "ad" && item.status === "paused" ? (
                            <AdBillingReceipt
                              item={item}
                              currency={project.currency}
                              busy={busy}
                              action={(name, payload) =>
                                action(name, { projectId, ...payload })
                              }
                            />
                          ) : null}
                          <div className="mt-4 flex flex-wrap gap-2">
                            {[
                              "blocked",
                              "uncertain",
                              "cancel_pending",
                            ].includes(item.status) ? (
                              <button
                                disabled={busy}
                                className={buttonClass}
                                onClick={() =>
                                  void action("recheck-item", {
                                    projectId,
                                    itemId: item._id,
                                  })
                                }
                              >
                                {item.reservationMonth
                                  ? "Recheck original request"
                                  : "Return to draft review"}
                              </button>
                            ) : null}
                            {item.status === "draft" ? (
                              <button
                                disabled={busy || channel?.mode !== "automatic"}
                                className={buttonClass}
                                onClick={() =>
                                  void action("approve-item", {
                                    projectId,
                                    itemId: item._id,
                                  })
                                }
                              >
                                Approve exact version
                              </button>
                            ) : null}
                            {item.publicationUrl ? (
                              <a
                                className={`${buttonClass} text-signal`}
                                href={item.publicationUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View published post
                              </a>
                            ) : null}
                          </div>
                          {item.status === "draft" &&
                          channel?.mode !== "automatic" ? (
                            <p className="mt-3 text-xs text-ink-faint">
                              Channel is draft-only. Change its policy before
                              approving publication.
                            </p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                  <AdTemplate
                    project={project}
                    channels={channels}
                    accounts={workspace.accounts}
                    assets={assets}
                    busy={busy}
                    onSave={(payload) => action("create-item", payload)}
                  />
                </section>
              ) : null}
              {project && tab === "results" ? (
                <section className="space-y-5">
                  <h2 className="display text-2xl font-bold">
                    Results with receipts
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-3">
                    {[
                      [
                        "Verified conversions this month",
                        String(workspace.results?.conversions ?? 0),
                      ],
                      [
                        "Reported spend — shown campaigns",
                        items.some((item) => item.kind === "ad" && item.metrics)
                          ? amount(
                              items.reduce(
                                (sum, item) =>
                                  sum + (item.metrics?.spendMinor ?? 0),
                                0,
                              ),
                              project.currency,
                            )
                          : "Not measured",
                      ],
                      [
                        "Reported clicks — shown content",
                        items.some((item) => item.metrics)
                          ? String(
                              items.reduce(
                                (sum, item) =>
                                  sum + (item.metrics?.clicks ?? 0),
                                0,
                              ),
                            )
                          : "Not measured",
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-xl border border-line bg-panel p-5"
                      >
                        <p className="text-xs leading-5 text-ink-dim">
                          {label}
                        </p>
                        <p className="display mt-3 text-3xl font-bold">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-6 text-ink-dim">
                    Conversion month: {workspace.resultsMonth}. Content totals
                    cover the latest 200 items and only metrics the provider
                    returned. Missing metrics are unverified; these figures are
                    not invoices or a cross-platform revenue attribution claim.
                    X insights refresh weekly to bound metered reads; other
                    organic insights refresh daily. Running ads reconcile every
                    five minutes, subject to provider reporting delays.
                  </p>
                  <div className="rounded-xl border border-line p-5">
                    <h3 className="font-bold">
                      Connect your website’s server events
                    </h3>
                    <p className="mt-3 text-xs leading-6 text-ink-dim">
                      After a real {project.goal}, POST its unique event ID to{" "}
                      <code>/api/marketing/conversions</code> with this project
                      ID and the server-only conversion token. Repeat deliveries
                      are deduplicated. Do not send names, email addresses or
                      browser credentials.
                    </p>
                    <pre className="mt-4 min-w-0 max-w-full overflow-auto whitespace-pre-wrap break-all rounded bg-void p-4 text-xs leading-6">
                      {JSON.stringify(
                        {
                          projectId,
                          eventId: "your-real-event-id",
                          event: project.goal,
                          valueMinor: 0,
                          currency: project.currency,
                          occurredAt: "Unix time in milliseconds",
                          itemId: "optional original marketing item ID",
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                  {workspace.allowances.map((allowance) => (
                    <div
                      key={allowance._id}
                      className="flex flex-wrap justify-between gap-3 rounded-lg border border-line p-4 text-xs"
                    >
                      <span>
                        {allowance.scope.startsWith("advertising")
                          ? "Advertising admission allowance"
                          : allowance.scope}{" "}
                        · {allowance.month}
                      </span>
                      <span>
                        {amount(allowance.spentMinor, allowance.currency)}{" "}
                        accounted ·{" "}
                        {amount(allowance.heldMinor, allowance.currency)} held /{" "}
                        {amount(allowance.limitMinor, allowance.currency)}
                      </span>
                    </div>
                  ))}
                </section>
              ) : null}
            </>
          )}
        </>
      ) : !error ? (
        <p className="py-12 text-sm text-ink-dim" role="status">
          Loading your marketing workspace…
        </p>
      ) : null}
    </main>
  );
}

function AdBillingReceipt({
  item,
  currency,
  busy,
  action,
}: {
  item: Doc<"marketingItems">;
  currency: string;
  busy: boolean;
  action: (name: string, payload: Record<string, unknown>) => Promise<unknown>;
}) {
  if (item.billingSettlement)
    return (
      <p className="mt-4 text-xs leading-5 text-ink-dim">
        Operator-confirmed final invoice: {item.billingSettlement.reference} ·{" "}
        {amount(item.billingSettlement.finalSpendMinor, currency)}.
        Provider-reported metrics remain separate.
      </p>
    );
  return (
    <details className="mt-4 rounded-lg border border-line p-3 text-xs">
      <summary className="cursor-pointer font-bold">
        Reconcile final advertising billing
      </summary>
      <p className="mt-3 break-all leading-5 text-ink-dim">
        Campaign {item.providerCampaignId} · provider receipt {item.providerId}.
        Unused exposure stays held until you confirm the final platform invoice
        for this exact campaign.
      </p>
      <button
        disabled={busy}
        className={`${buttonClass} mt-3`}
        onClick={() => void action("recheck-item", { itemId: item._id })}
      >
        Refresh native stopped status
      </button>
      <form
        className="mt-4 grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await action("settle-ad-billing", {
            itemId: item._id,
            expectedProviderId: item.providerId,
            expectedCampaignId: item.providerCampaignId,
            reference: form.get("reference"),
            finalSpendMinor: Math.round(Number(form.get("finalSpend")) * 100),
            confirmed: form.get("confirmed") === "on",
          });
        }}
      >
        <Field label="Final platform invoice reference">
          <input
            name="reference"
            required
            maxLength={160}
            className={inputClass}
          />
        </Field>
        <Field label={`Final invoiced campaign spend (${currency})`}>
          <input
            name="finalSpend"
            required
            type="number"
            min={(item.metrics?.spendMinor ?? 0) / 100}
            step="0.01"
            defaultValue={(item.metrics?.spendMinor ?? 0) / 100}
            className={inputClass}
          />
        </Field>
        <label className="flex gap-2 leading-5 text-ink-dim">
          <input required type="checkbox" name="confirmed" />I reviewed the
          final platform invoice for this exact stopped campaign and confirm
          that no further charges remain.
        </label>
        <button disabled={busy} className={buttonClass}>
          Record final invoice and release unused hold
        </button>
      </form>
    </details>
  );
}

function DraftEditor({
  item,
  busy,
  save,
}: {
  item: Doc<"marketingItems">;
  busy: boolean;
  save: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  return (
    <details className="mt-4 rounded-lg border border-line p-3 text-xs">
      <summary className="cursor-pointer font-bold text-scope">
        Edit draft
      </summary>
      <form
        className="mt-4 grid gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          await save({
            itemId: item._id,
            expectedVersion: item.version,
            title: form.get("title"),
            content: form.get("content"),
            scheduledAt: Date.parse(`${form.get("scheduledAt")}Z`),
          });
        }}
      >
        <Field label="Draft title">
          <input
            name="title"
            required
            maxLength={200}
            defaultValue={item.title}
            className={inputClass}
          />
        </Field>
        <Field label="Draft content">
          <textarea
            name="content"
            required
            rows={6}
            defaultValue={item.content}
            className={inputClass}
          />
        </Field>
        <Field label="Publication time in UTC">
          <input
            name="scheduledAt"
            type="datetime-local"
            required
            defaultValue={new Date(item.scheduledAt).toISOString().slice(0, 16)}
            className={inputClass}
          />
        </Field>
        <p className="leading-5 text-ink-dim">
          Saving creates the next draft version. Only the exact reviewed version
          can be approved.
        </p>
        <button disabled={busy} className={buttonClass}>
          Save draft version
        </button>
      </form>
    </details>
  );
}

function ProjectPlan({ project, busy, action }: {
  project: Project;
  busy: boolean;
  action: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}) {
  const [strategy, setStrategy] = useState("");
  const [calendar, setCalendar] = useState("");
  const [sources, setSources] = useState("");
  const [revision, setRevision] = useState(0);
  const [origin, setOrigin] = useState("owner");
  const [run, setRun] = useState<null | { status: string; requestKey: string; error?: string; recoverable?: boolean }>(null);
  const [reload, setReload] = useState(0);
  const [planProjectVersion, setPlanProjectVersion] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/marketing?view=plan&projectId=${encodeURIComponent(project._id)}`, {
      cache: "no-store", signal: controller.signal,
    }).then(responseJson).then((body) => {
      const plan = body.plan as null | { strategy: string; calendar: string; sources: string; revision: number; projectVersion: number; origin: string };
      if (plan) {
        setStrategy(plan.strategy); setCalendar(plan.calendar); setSources(plan.sources);
        setRevision(plan.revision); setPlanProjectVersion(plan.projectVersion); setOrigin(plan.origin);
      }
      setRun(body.run as null | { status: string; requestKey: string; error?: string; recoverable?: boolean });
      setLoadState("ready");
    }).catch(() => { if (!controller.signal.aborted) setLoadState("error"); });
    return () => controller.abort();
  }, [project._id, reload]);
  const runStatus = run?.status;
  useEffect(() => {
    if (!runStatus || !["queued", "running"].includes(runStatus)) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetch(`/api/marketing?view=plan&projectId=${encodeURIComponent(project._id)}`, { cache: "no-store", signal: controller.signal })
        .then(responseJson).then((body) => setRun(body.run as null | { status: string; requestKey: string; error?: string; recoverable?: boolean }))
        .catch(() => {});
    }, 5000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [project._id, runStatus]);
  return <form className="grid gap-3 border-t border-line pt-5" onSubmit={async (event) => {
    event.preventDefault();
    const result = await action("save-plan", {
      projectId: project._id, expectedProjectVersion: project.version,
      expectedRevision: revision, strategy, calendar, sources,
    });
    if (result) {
      setRevision(revision + 1);
      setPlanProjectVersion(project.version);
      setOrigin("owner");
    }
  }}>
    <h3 className="text-sm font-bold">Strategy and content plan</h3>
    <p className="text-xs leading-5 text-ink-dim">Save or edit this project’s strategy and two-week content plan. AI drafts use the confirmed brief; they do not yet include independent market research.</p>
    <button type="button" className={buttonClass} disabled={busy || loadState !== "ready" || (run?.status === "running" && !run.recoverable)} onClick={async () => {
      const requestKey = run?.status === "queued" ? run.requestKey : crypto.randomUUID();
      const result = await action("generate-plan", { projectId: project._id, requestKey });
      if (result) setRun({ requestKey, status: "queued" });
      else setRun({ requestKey, status: "queued", error: "Dispatch could not be confirmed. Retry this request." });
    }}>{run?.status === "queued" ? "Retry planning request" : run?.recoverable ? "Retry timed-out planning" : "Generate AI plan"}</button>
    {run ? <p className="text-xs text-ink-dim" role="status">AI planning: {run.status}{run.error ? ` · ${run.error}` : ""}</p> : null}
    {run?.status === "completed" ? <button type="button" className={buttonClass} onClick={() => setReload(value => value + 1)}>Load generated revision</button> : null}
    {loadState === "error" ? <p role="alert">Could not load the saved plan. Refresh to try again.</p> : null}
    {planProjectVersion !== null && planProjectVersion !== project.version ? <p role="alert" className="text-xs text-amber-600">The project brief changed since this plan was saved. Review it against the current brief before saving.</p> : null}
    <Field label="Strategy"><textarea className={inputClass} value={strategy} maxLength={20000} onChange={(event) => setStrategy(event.target.value)} required /></Field>
    <Field label="14-day content plan"><textarea className={inputClass} value={calendar} maxLength={20000} onChange={(event) => setCalendar(event.target.value)} /></Field>
    <Field label="Research sources and assumptions"><textarea className={inputClass} value={sources} maxLength={10000} onChange={(event) => setSources(event.target.value)} /></Field>
    <button className={buttonClass} disabled={busy || loadState !== "ready"}>Save plan revision</button>
    {revision > 0 ? <p className="text-xs text-ink-dim">Saved revision {revision} · {origin === "ai" ? "AI-generated draft" : "owner-authored"}</p> : null}
  </form>;
}

function RenderReuse({
  projectId,
  imports,
  busy,
  action,
}: {
  projectId: string;
  imports: Doc<"marketingRenderImports">[];
  busy: boolean;
  action: (
    name: string,
    payload: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
}) {
  const [renders, setRenders] = useState<
    Array<{ jobId: string; title: string }>
  >([]);
  const [renderStatus, setRenderStatus] = useState<string>(
    "Checking the new rendering service…",
  );
  const [connectionStatus, setConnectionStatus] = useState("");
  const [hyperJobId, setHyperJobId] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/marketing/render-readiness", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<{
          models: Array<{ nativeQualified: boolean }>;
          hardware: { initial: string; future: string };
        }>;
      })
      .then((result) => {
        const qualified = result.models.filter((model) => model.nativeQualified).length;
        setRenderStatus(
          `${qualified} of ${result.models.length} model routes have native qualification. ` +
            `Hardware: ${result.hardware.initial.toUpperCase()} initially; ${result.hardware.future.toUpperCase()} planned. ` +
            "Project connection, available capacity, output delivery and permission to spend still require verification.",
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setRenderStatus("The new rendering service status is unavailable. No render can be launched here.");
      });
    return () => controller.abort();
  }, []);
  return (
    <div className="grid gap-3 border-t border-line pt-5">
      <h3 className="text-sm font-bold">New GPU rendering service</h3>
      <p className="text-xs leading-5 text-ink-dim" role="status">{renderStatus}</p>
      <p className="text-xs leading-5 text-ink-dim">
        Marketing video and image generation will use the new service once the project connection and render workflow are qualified. No GPU job is submitted by this status check.
      </p>
      <div className="grid gap-2">
        <label className="text-xs text-ink-dim" htmlFor="hyper-job-id">Optional existing new-service job ID</label>
        <input id="hyper-job-id" className={inputClass} value={hyperJobId} onChange={(event) => setHyperJobId(event.target.value)} placeholder="Job ID" />
        <button type="button" className={buttonClass} disabled={busy} onClick={async () => {
          setConnectionStatus("Checking project connection…");
          try {
            const params = new URLSearchParams({ projectId });
            if (hyperJobId.trim()) params.set("jobId", hyperJobId.trim());
            const data = await responseJson(await fetch(`/api/marketing/hyper-project?${params}`, { cache: "no-store" }));
            if (!data.connected) { setConnectionStatus("This project has no configured new-service connection."); return; }
            const job = data.job as null | { state: string; modelId: string; receipt: null | { available: boolean } };
            setConnectionStatus(job ? `Job ${job.state} · ${job.modelId}. ${job.receipt ? "A project-scoped receipt exists; Media Engine has not independently verified its object hash." : "No output receipt yet."}` : "Project credential and storage scope verified. Render submission remains disabled.");
          } catch { setConnectionStatus("Could not verify the project connection or job. Check its setup and try again."); }
        }}>Check new-service connection</button>
        {connectionStatus ? <p className="text-xs leading-5 text-ink-dim" role="status">{connectionStatus}</p> : null}
      </div>
      <h3 className="text-sm font-bold">Reuse an approved final video</h3>
      <p className="text-xs leading-5 text-ink-dim">
        Import a previously approved video from the existing library. This preserves the completed original, verifies its R2 hash, and selects it for future posts. No render is launched here.
      </p>
      <button
        className={buttonClass}
        disabled={busy}
        onClick={async () => {
          const result = await action("available-renders", { projectId });
          if (result && Array.isArray(result.result))
            setRenders(result.result as typeof renders);
        }}
      >
        Load approved videos
      </button>
      {renders.length ? (
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await action("import-render", {
              projectId,
              renderJobId: form.get("renderJobId"),
              rightsConfirmed: form.get("rightsConfirmed") === "on",
            });
          }}
        >
          <Field label="Approved final video">
            <select required name="renderJobId" className={inputClass}>
              <option value="">Select a verified final render</option>
              {renders.map((render) => (
                <option key={render.jobId} value={render.jobId}>
                  {render.title}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex gap-2 text-xs leading-5 text-ink-dim">
            <input required type="checkbox" name="rightsConfirmed" />I have
            permission to reuse this completed video for this project’s
            marketing.
          </label>
          <button className={buttonClass} disabled={busy}>
            Import and use for new posts
          </button>
        </form>
      ) : null}
      {imports.map((item) => (
        <p className="break-all text-xs leading-5 text-ink-dim" key={item._id}>
          Video import: {item.status} · attempt {item.attempt}
          {item.error ? ` · ${item.error}` : ""}
        </p>
      ))}
    </div>
  );
}

function AdTemplate({
  project,
  channels,
  accounts,
  assets,
  busy,
  onSave,
}: {
  project: Project;
  channels: Doc<"marketingChannels">[];
  accounts: Doc<"marketingProviderAccounts">[];
  assets: Doc<"marketingAssets">[];
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const available = channels.filter((channel) =>
    accounts.some(
      (account) =>
        account._id === channel.accountId &&
        ["googleads", "metaads"].includes(account.platform),
    ),
  );
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      channelId = String(form.get("channelId")),
      channel = available.find((row) => row._id === channelId),
      account = accounts.find((row) => row._id === channel?.accountId);
    const daily = Math.round(Number(form.get("daily")) * 100),
      days = Number(form.get("days"));
    await onSave({
      projectId: project._id,
      channelId,
      kind: "ad",
      title: `${project.name} · ${labels[account?.platform ?? ""]}`,
      content: form.get("description"),
      scheduledAt:
        Math.round(performance.timeOrigin + event.timeStamp) + 15 * 60_000,
      idempotencyKey: `ad:${crypto.randomUUID()}`,
      ...(form.get("assetId") ? { assetId: form.get("assetId") } : {}),
      ad: {
        headline: form.get("headline"),
        description: form.get("description"),
        countries: String(form.get("countries"))
          .split(",")
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean),
        keywords: String(form.get("keywords"))
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        dailyBudgetMinor: daily,
        durationDays: days,
        maxSpendMinor:
          account?.platform === "googleads"
            ? daily * (days + 1) * 2
            : daily * days,
      },
    });
  }
  if (!available.length) return null;
  return (
    <details className="rounded-xl border border-line bg-panel p-5">
      <summary className="cursor-pointer font-bold">
        Prepare a Google Search or Meta website campaign
      </summary>
      <p className="mt-3 text-xs leading-6 text-ink-dim">
        Creates a local proposal. Advertising allowance and an exact-version
        approval are required before any provider activation.
      </p>
      <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
        <Field label="Advertising channel">
          <select name="channelId" required className={inputClass}>
            {available.map((channel) => (
              <option key={channel._id} value={channel._id}>
                {
                  labels[
                    accounts.find(
                      (account) => account._id === channel.accountId,
                    )?.platform ?? ""
                  ]
                }
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owned creative — required for Meta">
          <select name="assetId" className={inputClass}>
            <option value="">No media — Google Search</option>
            {assets.map((asset) => (
              <option key={asset._id} value={asset._id}>
                {asset.contentType} · {asset.sha256.slice(0, 10)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Headline — maximum 30 characters for Search">
          <input
            name="headline"
            required
            maxLength={30}
            className={inputClass}
          />
        </Field>
        <Field label="Description — maximum 90 characters for Search">
          <input
            name="description"
            required
            maxLength={90}
            className={inputClass}
          />
        </Field>
        <Field label="Google keywords — comma separated">
          <input name="keywords" className={inputClass} />
        </Field>
        <Field label="Target countries — country codes, comma separated">
          <input
            name="countries"
            required
            placeholder="GB, CH"
            className={inputClass}
          />
        </Field>
        <Field label={`Daily budget (${project.currency})`}>
          <input
            name="daily"
            type="number"
            required
            min="0.01"
            step="0.01"
            className={inputClass}
          />
        </Field>
        <Field label="Duration in days">
          <input
            name="days"
            type="number"
            required
            min={1}
            max={7}
            defaultValue={3}
            className={inputClass}
          />
        </Field>
        <p className="text-xs leading-5 text-ink-dim md:col-span-2">
          Google reserves a conservative overdelivery allowance; Meta uses a
          bounded lifetime budget. Provider minimums, review and billing rules
          still apply.
        </p>
        <button disabled={busy} className={buttonClass}>
          Save campaign proposal
        </button>
      </form>
    </details>
  );
}
