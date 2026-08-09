"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MediaTile } from "@/components/media-tile";
import { slideSrc, type Slide } from "@/lib/media";

type Source = "direct" | "fiverr";
type Tier = "basic" | "standard" | "premium";
type RenderKind = "draft" | "final";

type ProjectShot = {
  id?: string;
  kind?: string;
  beat?: string;
  imagePrompt?: string;
  imageUrl?: string;
  imageKey?: string;
  motion: string;
  audioCue?: string;
  seconds: number;
  onText?: string;
  cardTitle?: string;
  cardSub?: string;
};

type Narrative = {
  audience: string;
  objective: string;
  corePromise: string;
  insight: string;
  arc: Array<{ beat: string; purpose: string }>;
  voiceover?: string;
  cta: string;
};

type RenderPlan = {
  provider: "higgsfield";
  model: "seedance_2_0";
  creditSource: "higgsfield_subscription";
  aspectRatio: "9:16" | "16:9" | "1:1";
  durationSeconds: number;
  audioStrategy: string;
  referencePolicy: string;
  fallbackPolicy: "fail_closed";
  providerInstructions: string[];
};

type Project = {
  _id: string;
  buyer: string;
  title: string;
  brief: string;
  source?: Source;
  stage: string;
  intakeStatus?: "collecting" | "needs_reply" | "ready_to_plan" | "complete";
  intakeSummary?: string;
  missingFields?: string[];
  narrative?: Narrative;
  shots?: ProjectShot[];
  storyboardVersion?: number;
  approvedPlanVersion?: number;
  renderPlan?: RenderPlan;
  error?: string;
  createdAt: number;
  lastActivityAt?: number;
};

type Order = {
  _id: string;
  buyer: string;
  source: Source;
  tier: Tier;
  brief: string;
  productImageKey?: string;
  pricePence?: number;
  status: string;
};

type ProjectMessage = {
  _id: string;
  role: "buyer" | "operator" | "assistant" | "system";
  body: string;
  status: "received" | "draft" | "approved" | "sent";
  createdAt: number;
};

type RenderJob = {
  _id: string;
  kind: RenderKind;
  planVersion: number;
  provider: "higgsfield";
  model: "seedance_2_0";
  creditSource: "higgsfield_subscription";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  creditsUsed?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

type DeliveryPost = {
  _id: string;
  title?: string;
  slides?: Slide[];
};

type WorkspaceProject = {
  project: Project;
  order: Order | null;
  messages: ProjectMessage[];
  renderJobs: RenderJob[];
  draft: DeliveryPost | null;
  final: DeliveryPost | null;
};

type NewRequest = {
  buyer: string;
  title: string;
  source: Source;
  tier: Tier;
  price: string;
  brief: string;
};

const initialRequest: NewRequest = {
  buyer: "",
  title: "",
  source: "fiverr",
  tier: "standard",
  price: "",
  brief: "",
};

const STAGE_META: Record<string, { label: string; className: string }> = {
  scripting: { label: "Intake", className: "border-scope/60 text-scope" },
  script_ready: { label: "Plan review", className: "border-amber/60 text-amber" },
  drafting: { label: "Draft rendering", className: "border-scope/60 text-scope" },
  draft_ready: { label: "Draft review", className: "border-amber/60 text-amber" },
  rendering: { label: "Final rendering", className: "border-scope/60 text-scope" },
  final_ready: { label: "Ready to deliver", className: "border-signal/60 text-signal" },
  failed: { label: "Needs attention", className: "border-onair/60 text-onair" },
};

const MESSAGE_META: Record<ProjectMessage["role"], { label: string; className: string }> = {
  buyer: { label: "Buyer", className: "border-scope/50 text-scope" },
  operator: { label: "You", className: "border-signal/50 text-signal" },
  assistant: { label: "AI draft", className: "border-amber/50 text-amber" },
  system: { label: "System", className: "border-line-2 text-ink-faint" },
};

// This is deliberately flipped only when the authenticated production MCP
// manifest has been reviewed and a strict Seedance tool mapping is committed.
const RENDERING_ENABLED = false;
const RENDERING_DISABLED_REASON = "Rendering is paused while the production Seedance 2.0 MCP tool schema is verified. No subscription credits can be used yet.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    const message = stringValue(value.error) ?? stringValue(value.message);
    if (message) return message;
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

async function postWork(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/work", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(payload, `Request failed (${response.status})`));
  if (!isRecord(payload)) throw new Error("The workspace returned an invalid response.");
  return payload;
}

function formatMoney(pence?: number): string | null {
  if (typeof pence !== "number") return null;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function formatTime(value?: number): string {
  if (!value) return "Just now";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(value);
}

function firstPlayable(post: DeliveryPost | null): Slide | null {
  return post?.slides?.find((slide) => Boolean(slideSrc(slide))) ?? null;
}

function StageBadge({ stage }: { stage: string }) {
  const meta = STAGE_META[stage] ?? { label: stage.replaceAll("_", " "), className: "border-line-2 text-ink-dim" };
  return <span className={`shrink-0 border px-2 py-1 text-[10px] font-medium tracking-wide uppercase ${meta.className}`}>{meta.label}</span>;
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  kind = "secondary",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  kind?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "border-signal bg-signal text-void hover:brightness-110",
    secondary: "border-line-2 bg-panel-2 text-ink hover:border-scope hover:text-scope",
    danger: "border-onair/60 bg-transparent text-onair hover:bg-onair hover:text-void",
  }[kind];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`border px-3 py-2 text-[11px] font-semibold tracking-wide transition disabled:cursor-not-allowed disabled:opacity-45 ${styles}`}
    >
      {children}
    </button>
  );
}

function WorkflowSteps({ project }: { project: Project }) {
  const planReady = Boolean(project.narrative && project.shots?.length);
  const planApproved = project.approvedPlanVersion === project.storyboardVersion;
  const draftReady = project.stage === "draft_ready" || project.stage === "rendering" || project.stage === "final_ready";
  const finalReady = project.stage === "final_ready";
  const steps = [
    { label: "Intake", complete: project.intakeStatus === "ready_to_plan" || project.intakeStatus === "complete" },
    { label: "Plan", complete: planReady },
    { label: "Approval", complete: planApproved },
    { label: "Draft", complete: draftReady },
    { label: "Final", complete: finalReady },
  ];
  return (
    <ol className="grid grid-cols-5 gap-1 border-y border-line py-3">
      {steps.map((step, index) => (
        <li key={step.label} className="min-w-0">
          <div className={`mb-1 h-px ${step.complete ? "bg-signal" : index === 0 ? "bg-scope" : "bg-line-2"}`} />
          <div className={`text-[9px] tracking-wide uppercase ${step.complete ? "text-signal" : "text-ink-faint"}`}>{step.label}</div>
        </li>
      ))}
    </ol>
  );
}

export default function WorkPage() {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [request, setRequest] = useState<NewRequest>(initialRequest);
  const [productImageKey, setProductImageKey] = useState<string | null>(null);
  const [productFileName, setProductFileName] = useState<string | null>(null);
  const [buyerMessage, setBuyerMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorkspace = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/work", { credentials: "same-origin", cache: "no-store" });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, `Unable to load workspace (${response.status})`));
      if (!isRecord(payload) || !Array.isArray(payload.projects)) throw new Error("The workspace returned an invalid project list.");
      const nextProjects = payload.projects as WorkspaceProject[];
      setProjects(nextProjects);
      setSelectedId((current) => (current && nextProjects.some(({ project }) => project._id === current) ? current : nextProjects[0]?.project._id ?? null));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load the workspace.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer the initial network state transition so React can finish mounting
    // the workspace before the request updates local state.
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const hasActiveRender = useMemo(
    () => projects.some(({ renderJobs }) => renderJobs.some((job) => job.status === "queued" || job.status === "running")),
    [projects],
  );

  useEffect(() => {
    if (!hasActiveRender) return;
    const timer = window.setInterval(() => void loadWorkspace(true), 5000);
    return () => window.clearInterval(timer);
  }, [hasActiveRender, loadWorkspace]);

  const selected = useMemo(
    () => projects.find(({ project }) => project._id === selectedId) ?? projects[0] ?? null,
    [projects, selectedId],
  );

  const isBusy = busy !== null;

  async function runAction(key: string, body: Record<string, unknown>, successMessage: string): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await postWork(body);
      setNotice(stringValue(result.message) ?? successMessage);
      await loadWorkspace(true);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function uploadProductImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload", { method: "POST", credentials: "same-origin", body: formData });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(errorMessage(payload, `Upload failed (${response.status})`));
      if (!isRecord(payload) || !stringValue(payload.key)) throw new Error("The upload did not return an image reference.");
      setProductImageKey(stringValue(payload.key) ?? null);
      setProductFileName(file.name);
      setNotice("Product reference uploaded. It will be used as the Seedance input reference.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The product image could not be uploaded.");
    } finally {
      setBusy(null);
    }
  }

  async function attachReferenceImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected) return;
    const actionKey = `${selected.project._id}:reference`;
    setBusy(actionKey);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const upload = await fetch("/api/upload", { method: "POST", credentials: "same-origin", body: formData });
      const uploaded = await readJson(upload);
      if (!upload.ok) throw new Error(errorMessage(uploaded, `Upload failed (${upload.status})`));
      if (!isRecord(uploaded) || !stringValue(uploaded.key)) throw new Error("The upload did not return an image reference.");
      await postWork({ action: "attach-product-image", projectId: selected.project._id, productImageKey: stringValue(uploaded.key) });
      setNotice("Client reference attached. Reassess intake before generating the plan.");
      await loadWorkspace(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The product image could not be attached.");
    } finally {
      setBusy(null);
    }
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request.buyer.trim() || !request.brief.trim()) {
      setError("Add the buyer and a usable brief before creating the request.");
      return;
    }
    const price = request.price.trim() ? Number(request.price) : undefined;
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
      setError("Price must be a non-negative amount in pounds.");
      return;
    }
    const result = await runAction(
      "create-request",
      {
        action: "create-request",
        buyer: request.buyer.trim(),
        title: request.title.trim() || `${request.buyer.trim()} campaign`,
        source: request.source,
        tier: request.tier,
        brief: request.brief.trim(),
        productImageKey: productImageKey ?? undefined,
        pricePence: price === undefined ? undefined : Math.round(price * 100),
      },
      "Request created. Add the buyer’s details, then assess intake.",
    );
    const projectId = result ? stringValue(result.projectId) : undefined;
    if (projectId) setSelectedId(projectId);
    if (result) {
      setRequest(initialRequest);
      setProductImageKey(null);
      setProductFileName(null);
    }
  }

  async function addBuyerMessage() {
    if (!selected || !buyerMessage.trim()) {
      setError("Paste or write the buyer’s message first.");
      return;
    }
    const result = await runAction(
      `${selected.project._id}:buyer-message`,
      { action: "add-buyer-message", projectId: selected.project._id, message: buyerMessage.trim() },
      "Buyer message saved. You can now assess the intake.",
    );
    if (result) setBuyerMessage("");
  }

  function assessIntake() {
    if (!selected) return;
    void runAction(
      `${selected.project._id}:assess`,
      { action: "assess-intake", projectId: selected.project._id },
      "Intake assessed. The assistant has identified the next production detail to collect.",
    );
  }

  function draftReply() {
    if (!selected) return;
    void runAction(
      `${selected.project._id}:reply`,
      { action: "draft-reply", projectId: selected.project._id },
      "A reply draft is ready for your review. It has not been sent to the client.",
    );
  }

  function generatePlan() {
    if (!selected) return;
    void runAction(
      `${selected.project._id}:plan`,
      { action: "generate-plan", projectId: selected.project._id },
      "The narrative, storyboard, and Seedance render plan are being prepared.",
    );
  }

  function approvePlan() {
    if (!selected) return;
    void runAction(
      `${selected.project._id}:approve-plan`,
      { action: "approve-plan", projectId: selected.project._id },
      "Render plan approved. A draft can now be rendered with Higgsfield credits.",
    );
  }

  function render(kind: RenderKind) {
    if (!selected) return;
    if (!RENDERING_ENABLED) {
      setError(RENDERING_DISABLED_REASON);
      return;
    }
    const label = kind === "draft" ? "draft" : "final";
    void runAction(
      `${selected.project._id}:render-${kind}`,
      { action: "render", projectId: selected.project._id, kind },
      `${label[0]?.toUpperCase()}${label.slice(1)} render started. This page will refresh while it is running.`,
    );
  }

  function markDelivered() {
    if (!selected) return;
    if (!window.confirm("Confirm that you have manually delivered the final to the client. This records the status only; Media Engine will not send a message.")) return;
    void runAction(
      `${selected.project._id}:mark-delivered`,
      { action: "mark-delivered", projectId: selected.project._id },
      "Client order marked delivered. Media Engine did not send anything to the client.",
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[10px] font-semibold tracking-[0.18em] text-signal uppercase">Work · client production</p>
          <h1 className="display text-3xl font-extrabold tracking-tight sm:text-4xl">Client Desk</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
            Capture the brief, keep the client conversation human-approved, then turn an approved plan into a controlled video render.
          </p>
        </div>
        <div className="border border-signal/35 bg-signal/5 px-3 py-2 text-right text-[10px] leading-relaxed text-signal">
          <div className="font-semibold tracking-[0.12em] uppercase">Generation policy</div>
          <div>Higgsfield · Seedance 2.0 · subscription credits · fail closed</div>
        </div>
      </header>

      {(error || notice) && (
        <div className={`flex items-start justify-between gap-4 border p-3 text-sm ${error ? "border-onair/60 bg-onair/5 text-onair" : "border-signal/40 bg-signal/5 text-ink-dim"}`} role={error ? "alert" : "status"}>
          <p>{error ?? notice}</p>
          <button onClick={() => { setError(null); setNotice(null); }} className="shrink-0 text-lg leading-none opacity-70 hover:opacity-100" aria-label="Dismiss message">×</button>
        </div>
      )}

      <form onSubmit={createRequest} className="border border-line bg-panel p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="display text-lg font-bold">New request</h2>
            <p className="mt-1 text-xs text-ink-faint">Start a direct request or log a Fiverr order. Nothing is sent or rendered from this form.</p>
          </div>
          <span className="border border-line-2 px-2 py-1 text-[10px] tracking-wide text-ink-faint uppercase">Private workspace</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-ink-dim">Buyer / brand
            <input required value={request.buyer} onChange={(event) => setRequest((current) => ({ ...current, buyer: event.target.value }))} placeholder="e.g. Acme skincare" className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-scope" />
          </label>
          <label className="text-xs text-ink-dim">Project name <span className="text-ink-faint">(optional)</span>
            <input value={request.title} onChange={(event) => setRequest((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Summer launch" className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-scope" />
          </label>
          <label className="text-xs text-ink-dim">Source
            <select value={request.source} onChange={(event) => setRequest((current) => ({ ...current, source: event.target.value as Source }))} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-scope">
              <option value="fiverr">Fiverr (manual client reply)</option>
              <option value="direct">Direct client</option>
            </select>
          </label>
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <label className="text-xs text-ink-dim">Tier
              <select value={request.tier} onChange={(event) => setRequest((current) => ({ ...current, tier: event.target.value as Tier }))} className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-scope">
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </label>
            <label className="text-xs text-ink-dim">Price (£)
              <input value={request.price} onChange={(event) => setRequest((current) => ({ ...current, price: event.target.value }))} inputMode="decimal" placeholder="—" className="mt-1 w-full border border-line-2 bg-panel-2 px-3 py-2 text-sm text-ink outline-none focus:border-scope" />
            </label>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="text-xs text-ink-dim">Initial brief
            <textarea required rows={3} value={request.brief} onChange={(event) => setRequest((current) => ({ ...current, brief: event.target.value }))} placeholder="What is the product, who is it for, what result matters, and what should the viewer do next?" className="mt-1 w-full resize-y border border-line-2 bg-panel-2 px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-scope" />
          </label>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <label className={`cursor-pointer border px-3 py-2 text-[11px] font-semibold tracking-wide transition ${productImageKey ? "border-signal/60 text-signal" : "border-line-2 text-ink-dim hover:border-scope hover:text-scope"}`}>
              <span>{busy === "upload" ? "Uploading…" : productImageKey ? "Product image ready" : "Add product image"}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadProductImage} disabled={isBusy} className="sr-only" />
            </label>
            <ActionButton type="submit" kind="primary" disabled={isBusy}>{busy === "create-request" ? "Creating…" : "Create request"}</ActionButton>
          </div>
        </div>
        {productFileName && <p className="mt-2 text-[11px] text-signal">Reference: {productFileName}</p>}
      </form>

      <div className="grid gap-5 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <h2 className="display text-lg font-bold">Project queue</h2>
              <p className="text-[11px] text-ink-faint">{projects.length} active {projects.length === 1 ? "project" : "projects"}</p>
            </div>
            <button onClick={() => void loadWorkspace()} disabled={loading || isBusy} className="border border-line-2 px-2 py-1 text-[10px] tracking-wide text-ink-dim hover:border-scope hover:text-scope disabled:opacity-40">Refresh</button>
          </div>
          {loading && projects.length === 0 ? (
            <div className="p-5 text-sm text-ink-faint">Loading workspace…</div>
          ) : projects.length === 0 ? (
            <div className="p-5 text-sm leading-relaxed text-ink-faint">No requests yet. Create one above to start the client-to-render workflow.</div>
          ) : (
            <nav aria-label="Projects" className="max-h-[70vh] overflow-y-auto p-2">
              {projects.map((item) => {
                const active = item.project._id === selected?.project._id;
                const money = formatMoney(item.order?.pricePence);
                return (
                  <button key={item.project._id} onClick={() => setSelectedId(item.project._id)} className={`mb-1 w-full border p-3 text-left transition ${active ? "border-scope bg-scope/5" : "border-transparent hover:border-line-2 hover:bg-panel-2/40"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-semibold text-ink">{item.project.title}</span>
                      <StageBadge stage={item.project.stage} />
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-ink-dim">{item.project.buyer}</p>
                    <div className="mt-2 flex items-center justify-between text-[10px] tracking-wide text-ink-faint uppercase">
                      <span>{item.order?.source ?? item.project.source ?? "direct"} · {item.order?.tier ?? "custom"}</span>
                      {money && <span className="text-signal normal-case">{money}</span>}
                    </div>
                  </button>
                );
              })}
            </nav>
          )}
        </aside>

        <main className="min-w-0 space-y-5">
          {!selected ? (
            <div className="border border-dashed border-line-2 p-10 text-center text-sm text-ink-faint">Select a project to see its client conversation and production plan.</div>
          ) : (
            <ProjectWorkspace
              item={selected}
              buyerMessage={buyerMessage}
              onBuyerMessageChange={setBuyerMessage}
              onSaveBuyerMessage={addBuyerMessage}
              onAssessIntake={assessIntake}
              onDraftReply={draftReply}
              onAttachReferenceImage={attachReferenceImage}
              onGeneratePlan={generatePlan}
              onApprovePlan={approvePlan}
              onRender={render}
              onMarkDelivered={markDelivered}
              busy={busy}
              isBusy={isBusy}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function ProjectWorkspace({
  item,
  buyerMessage,
  onBuyerMessageChange,
  onSaveBuyerMessage,
  onAssessIntake,
  onDraftReply,
  onAttachReferenceImage,
  onGeneratePlan,
  onApprovePlan,
  onRender,
  onMarkDelivered,
  busy,
  isBusy,
}: {
  item: WorkspaceProject;
  buyerMessage: string;
  onBuyerMessageChange: (value: string) => void;
  onSaveBuyerMessage: () => void;
  onAssessIntake: () => void;
  onDraftReply: () => void;
  onAttachReferenceImage: (event: ChangeEvent<HTMLInputElement>) => void;
  onGeneratePlan: () => void;
  onApprovePlan: () => void;
  onRender: (kind: RenderKind) => void;
  onMarkDelivered: () => void;
  busy: string | null;
  isBusy: boolean;
}) {
  const { project, order, messages, renderJobs, draft, final } = item;
  const planReady = Boolean(project.narrative && project.shots?.length && project.renderPlan && project.storyboardVersion);
  const planApproved = planReady && project.approvedPlanVersion === project.storyboardVersion;
  const intakeReady = project.intakeStatus === "ready_to_plan" || project.intakeStatus === "complete";
  const draftReady = project.stage === "draft_ready" || project.stage === "rendering" || project.stage === "final_ready";
  const finalReady = project.stage === "final_ready";
  const readyForDelivery = finalReady && order?.status === "ready_for_delivery";
  const delivered = order?.status === "delivered";
  const retryKind = project.stage === "failed"
    ? [...renderJobs].find((job) => job.status === "failed")?.kind
    : undefined;
  const draftSlide = firstPlayable(draft);
  const finalSlide = firstPlayable(final);
  const projectBusy = (action: string) => busy === `${project._id}:${action}`;

  return (
    <>
      <section className="border border-line bg-panel p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StageBadge stage={project.stage} />
              <span className="text-[10px] tracking-wide text-ink-faint uppercase">{order?.source ?? project.source ?? "direct"} request</span>
              {order?.tier && <span className="text-[10px] tracking-wide text-ink-faint uppercase">{order.tier}</span>}
              {formatMoney(order?.pricePence) && <span className="text-xs text-signal">{formatMoney(order?.pricePence)}</span>}
            </div>
            <h2 className="display text-2xl font-extrabold tracking-tight">{project.title}</h2>
            <p className="mt-1 text-sm text-ink-dim">{project.buyer}</p>
          </div>
          <p className="max-w-sm text-xs leading-relaxed text-ink-faint">{project.brief}</p>
        </div>
        {project.error && <p className="mt-4 border border-onair/50 bg-onair/5 p-3 text-xs leading-relaxed text-onair">{project.error}</p>}
        <div className="mt-4"><WorkflowSteps project={project} /></div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)]">
        <div className="space-y-5">
          <article className="border border-line bg-panel">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
              <div>
                <h3 className="display text-lg font-bold">Client conversation</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">Log what the buyer says. AI drafts are review-only — they are never sent automatically.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className={`cursor-pointer border px-3 py-2 text-[11px] font-semibold tracking-wide transition ${order?.productImageKey ? "border-signal/45 text-signal" : "border-line-2 text-ink-dim hover:border-scope hover:text-scope"}`}>
                  {projectBusy("reference") ? "Uploading…" : order?.productImageKey ? "Replace reference" : "Attach reference"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isBusy} onChange={onAttachReferenceImage} />
                </label>
                <ActionButton onClick={onAssessIntake} disabled={isBusy}>
                  {projectBusy("assess") ? "Assessing…" : "Assess intake"}
                </ActionButton>
                <ActionButton onClick={onDraftReply} disabled={isBusy}>
                  {projectBusy("reply") ? "Drafting…" : "Draft client reply"}
                </ActionButton>
              </div>
            </div>
            <div className="max-h-[28rem] space-y-2 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="text-sm text-ink-faint">No messages logged yet.</p>
              ) : messages.map((message) => {
                const meta = MESSAGE_META[message.role];
                return (
                  <div key={message._id} className={`border p-3 ${message.role === "buyer" ? "border-scope/35 bg-scope/[0.03]" : message.role === "assistant" ? "border-amber/35 bg-amber/[0.03]" : "border-line-2 bg-panel-2/40"}`}>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className={`border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${meta.className}`}>{meta.label}</span>
                      <span className="text-[10px] text-ink-faint">{formatTime(message.createdAt)} · {message.status}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-dim">{message.body}</p>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-line p-4">
              <label className="text-xs text-ink-dim">Buyer message
                <textarea value={buyerMessage} onChange={(event) => onBuyerMessageChange(event.target.value)} rows={3} placeholder="Paste the latest Fiverr or direct-client message here…" className="mt-1 w-full resize-y border border-line-2 bg-panel-2 px-3 py-2 text-sm leading-relaxed text-ink outline-none focus:border-scope" />
              </label>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] leading-relaxed text-ink-faint">For Fiverr, copy the approved draft into Fiverr yourself to stay within platform rules.</span>
                <ActionButton onClick={onSaveBuyerMessage} disabled={isBusy || !buyerMessage.trim()} kind="primary">
                  {projectBusy("buyer-message") ? "Saving…" : "Save buyer message"}
                </ActionButton>
              </div>
            </div>
          </article>

          <article className="border border-line bg-panel">
            <div className="border-b border-line p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="display text-lg font-bold">Narrative & storyboard</h3>
                  <p className="mt-1 text-xs text-ink-faint">The plan is versioned. It cannot enter a paid render until you approve the current version.</p>
                </div>
                {planReady && <span className={`border px-2 py-1 text-[10px] tracking-wide uppercase ${planApproved ? "border-signal/60 text-signal" : "border-amber/60 text-amber"}`}>{planApproved ? `Plan v${project.storyboardVersion} approved` : `Plan v${project.storyboardVersion} needs approval`}</span>}
              </div>
              {!planReady && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ActionButton onClick={onGeneratePlan} disabled={isBusy || !intakeReady} kind="primary">
                    {projectBusy("plan") ? "Planning…" : "Generate render plan"}
                  </ActionButton>
                  {!intakeReady && <span className="text-xs text-ink-faint">Complete the intake first.</span>}
                </div>
              )}
              {planReady && !planApproved && <div className="mt-3"><ActionButton onClick={onApprovePlan} disabled={isBusy} kind="primary">{projectBusy("approve-plan") ? "Approving…" : `Approve plan v${project.storyboardVersion}`}</ActionButton></div>}
            </div>

            {project.intakeSummary && (
              <div className="border-b border-line p-4">
                <h4 className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Intake summary</h4>
                <p className="mt-2 text-sm leading-relaxed text-ink-dim">{project.intakeSummary}</p>
              </div>
            )}
            {!intakeReady && (project.missingFields?.length ?? 0) > 0 && (
              <div className="border-b border-line p-4">
                <h4 className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Still needed</h4>
                <div className="mt-2 flex flex-wrap gap-2">
                  {project.missingFields?.map((field) => <span key={field} className="border border-amber/45 bg-amber/5 px-2 py-1 text-[11px] text-amber">{field}</span>)}
                </div>
              </div>
            )}

            {planReady && project.narrative && project.renderPlan ? (
              <div className="space-y-4 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <PlanField label="Objective" value={project.narrative.objective} />
                  <PlanField label="Audience" value={project.narrative.audience} />
                  <PlanField label="Core promise" value={project.narrative.corePromise} />
                  <PlanField label="Call to action" value={project.narrative.cta} />
                </div>
                <PlanField label="Creative insight" value={project.narrative.insight} />
                {project.narrative.voiceover && <PlanField label="Voiceover" value={project.narrative.voiceover} />}
                <div>
                  <h4 className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">Storyboard · v{project.storyboardVersion}</h4>
                  <div className="space-y-2">
                    {project.shots?.map((shot, index) => <ShotCard key={shot.id ?? `${shot.beat ?? "shot"}-${index}`} shot={shot} index={index} />)}
                  </div>
                </div>
                <div className="border border-signal/30 bg-signal/[0.035] p-3">
                  <h4 className="text-[10px] font-semibold tracking-[0.14em] text-signal uppercase">Render policy</h4>
                  <div className="mt-2 grid gap-2 text-xs text-ink-dim sm:grid-cols-2">
                    <span>Provider: Higgsfield</span>
                    <span>Model: Seedance 2.0</span>
                    <span>Credits: subscription only</span>
                    <span>Fallback: fail closed</span>
                    <span>Format: {project.renderPlan.aspectRatio} · {project.renderPlan.durationSeconds}s</span>
                    <span>{project.renderPlan.audioStrategy}</span>
                  </div>
                  {project.renderPlan.providerInstructions.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs leading-relaxed text-ink-dim">{project.renderPlan.providerInstructions.map((instruction, index) => <li key={`${instruction}-${index}`}>{instruction}</li>)}</ul>}
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm leading-relaxed text-ink-faint">The approved client details will become a narrative, shot-by-shot storyboard, and provider-specific render plan here.</div>
            )}
          </article>
        </div>

        <aside className="space-y-5">
          <article className="border border-line bg-panel p-4">
            <h3 className="display text-lg font-bold">Production</h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-faint">Rendering only uses Higgsfield subscription credits. If the provider is unavailable, the job stops instead of moving to a paid fallback.</p>
            <div className="mt-4 space-y-2">
              <ActionButton onClick={() => onRender("draft")} disabled={!RENDERING_ENABLED || isBusy || !planApproved || project.stage !== "script_ready"} kind="primary">
                {projectBusy("render-draft") ? "Starting draft…" : "Render draft"}
              </ActionButton>
              <ActionButton onClick={() => onRender("final")} disabled={!RENDERING_ENABLED || isBusy || !planApproved || project.stage !== "draft_ready"} kind="primary">
                {projectBusy("render-final") ? "Starting final…" : "Render final"}
              </ActionButton>
              {retryKind && (
                <ActionButton onClick={() => onRender(retryKind)} disabled={!RENDERING_ENABLED || isBusy || !planApproved} kind="primary">
                  {projectBusy(`render-${retryKind}`) ? "Retrying…" : `Retry ${retryKind}`}
                </ActionButton>
              )}
            </div>
            {!planApproved && <p className="mt-3 text-xs text-amber">Approve the current plan before using render credits.</p>}
            {!RENDERING_ENABLED && <p className="mt-3 text-xs leading-relaxed text-amber">{RENDERING_DISABLED_REASON}</p>}
            {planApproved && !draftReady && project.stage !== "drafting" && <p className="mt-3 text-xs text-ink-faint">A draft is the next allowed production step.</p>}
            {draftReady && !finalReady && <p className="mt-3 text-xs text-ink-faint">Review the draft before starting the final.</p>}
            {readyForDelivery && (
              <div className="mt-4 border border-signal/35 bg-signal/[0.035] p-3">
                <h4 className="text-[10px] font-semibold tracking-[0.14em] text-signal uppercase">Final ready for delivery</h4>
                <p className="mt-1 text-xs leading-relaxed text-ink-dim">Deliver the final yourself through Fiverr or the direct-client channel, then record that manual delivery here. This app never sends the client message.</p>
                <div className="mt-3"><ActionButton onClick={onMarkDelivered} disabled={isBusy} kind="primary">{projectBusy("mark-delivered") ? "Marking delivered…" : "Mark delivered"}</ActionButton></div>
              </div>
            )}
            {finalReady && delivered && <p className="mt-3 border border-signal/35 bg-signal/[0.035] p-3 text-xs leading-relaxed text-signal">Marked delivered by an operator. Media Engine did not send a client or marketplace message.</p>}
          </article>

          <article className="border border-line bg-panel">
            <div className="border-b border-line p-4">
              <h3 className="display text-lg font-bold">Render history</h3>
              <p className="mt-1 text-xs text-ink-faint">Every render is tied to the approved plan version.</p>
            </div>
            {renderJobs.length === 0 ? <p className="p-4 text-sm text-ink-faint">No render jobs yet.</p> : (
              <div className="divide-y divide-line">
                {renderJobs.map((job) => <RenderJobRow key={job._id} job={job} />)}
              </div>
            )}
          </article>

          {(draftSlide || finalSlide) && (
            <article className="border border-line bg-panel p-4">
              <h3 className="display text-lg font-bold">Review media</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {draftSlide && <div><MediaTile slide={draftSlide} aspect="aspect-[9/16]" /><p className="mt-1 text-center text-[10px] tracking-wide text-ink-faint uppercase">Draft</p></div>}
                {finalSlide && <div><MediaTile slide={finalSlide} aspect="aspect-[9/16]" /><p className="mt-1 text-center text-[10px] tracking-wide text-signal uppercase">Final</p></div>}
              </div>
            </article>
          )}
        </aside>
      </section>
    </>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line-2 bg-panel-2/40 p-3">
      <h4 className="text-[10px] font-semibold tracking-[0.14em] text-ink-faint uppercase">{label}</h4>
      <p className="mt-1 text-sm leading-relaxed text-ink-dim">{value}</p>
    </div>
  );
}

function ShotCard({ shot, index }: { shot: ProjectShot; index: number }) {
  const label = shot.kind === "card" ? "End card" : `Shot ${index + 1}`;
  return (
    <div className="border border-line-2 bg-panel-2/35 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold tracking-wide text-signal uppercase">{label}</span>
        <span className="text-[10px] text-ink-faint">{shot.seconds}s</span>
        {shot.imageUrl && <span className="border border-scope/50 px-1.5 py-0.5 text-[9px] text-scope uppercase">Client reference</span>}
        {shot.beat && <span className="text-[10px] text-ink-faint">{shot.beat}</span>}
      </div>
      {shot.imagePrompt && <p className="mt-2 text-xs leading-relaxed text-ink-dim">{shot.imagePrompt}</p>}
      <p className="mt-2 text-xs leading-relaxed text-ink-faint"><span className="text-ink-dim">Motion:</span> {shot.motion}</p>
      {shot.onText && <p className="mt-1 text-xs text-amber">On-screen: “{shot.onText}”</p>}
      {shot.audioCue && <p className="mt-1 text-xs text-ink-faint">Audio: {shot.audioCue}</p>}
    </div>
  );
}

function RenderJobRow({ job }: { job: RenderJob }) {
  const statusClass = {
    queued: "text-amber border-amber/50",
    running: "text-scope border-scope/50",
    succeeded: "text-signal border-signal/50",
    failed: "text-onair border-onair/50",
    cancelled: "text-ink-faint border-line-2",
  }[job.status];
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold capitalize text-ink">{job.kind} · plan v{job.planVersion}</span>
        <span className={`border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase ${statusClass}`}>{job.status}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">Seedance 2.0 · Higgsfield subscription · {formatTime(job.updatedAt)}</p>
      {typeof job.creditsUsed === "number" && <p className="mt-1 text-xs text-signal">{job.creditsUsed} credits used</p>}
      {job.error && <p className="mt-2 text-xs leading-relaxed text-onair">{job.error}</p>}
    </div>
  );
}
