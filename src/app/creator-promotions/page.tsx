"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  CreatorPromotionWorkspace,
  CreatorAccountReadinessPanel,
  CreatorPerformanceLedger,
  CreatorFunnelControlPanel,
  CreatorReferenceImageLibrary,
  CreatorLoraTrainingPanel,
  CreatorMetaInstagramPublishPanel,
  CreatorPostizChannelPicker,
  CreatorPostizSchedulePanel,
  CreatorRenderQueue,
  type CreatorContentItem,
  type CreatorAttributionSnapshot,
  type CreatorFunnelCampaign,
  type CreatorFunnelDestination,
  type CreatorFunnelEvent,
  type CreatorFunnelEventType,
  type CreatorInboxDraftModelHealth,
  type CreatorInboxThread,
  type CreatorLoraModel,
  type CreatorLoraTrainingJob,
  type CreatorLoraTrainingRequest,
  type CreatorPartnerDestination,
  type CreatorPersonaRevision,
  type CreatorPersonaRevisionRequest,
  type CreatorPromotionPersona,
  type CreatorReferenceAsset,
  type CreatorRenderCandidate,
  type CreatorRenderJob,
  type CreatorSocialAccount,
  type FanvueDestination,
} from "@/components/creator-promotion";
import {
  getFanvueReadinessProfile,
  type FanvueReadinessCapability,
} from "@/lib/creator-promotion/fanvue-oauth-readiness";
import type { PostizDiscoveredChannel } from "@/lib/creator-promotion";

type ProviderHealth = {
  provider: "meta_instagram" | "fanvue" | "postiz";
  status: "ready" | "not_configured" | "misconfigured";
  canConnectAccounts: boolean;
  canDispatchApprovedActions: boolean;
  missing: string[];
  invalid: string[];
  notes: string[];
};

type RendererHealth = {
  provider: "novita" | "ltx" | "fal_z_image_turbo_lora";
  status: "ready" | "not_configured" | "misconfigured";
  canResolveServerCredentials: boolean;
  canResolveApprovedSourceAssets: boolean;
  canDispatchApprovedActions: boolean;
  missing: string[];
  invalid: string[];
  notes: string[];
};

type FanvueTrackingLinkAction = {
  id: string;
  destinationId: string;
  funnelId: string;
  creatorId: string;
  connectionId: string;
  name: string;
  externalSocialPlatform: "facebook" | "instagram" | "other" | "reddit" | "snapchat" | "tiktok" | "twitter" | "youtube";
  status: "admitted" | "queued" | "running" | "succeeded" | "failed" | "blocked" | "cancelled";
  approvalStatus: "pending" | "approved" | "rejected" | "missing";
  approvalDecidedAt?: number;
  trackingLinkId?: string;
  linkUrl?: string;
  failureReason?: string;
  createdAt: number;
  updatedAt: number;
};

type WorkspaceResponse = {
  personas: CreatorPromotionPersona[];
  accounts: CreatorSocialAccount[];
  content: CreatorContentItem[];
  destinations: FanvueDestination[];
  partnerDestinations: CreatorPartnerDestination[];
  inboxThreads: CreatorInboxThread[];
  personaRevisions: CreatorPersonaRevision[];
  referenceAssets: CreatorReferenceAsset[];
  renderJobs: CreatorRenderJob[];
  renderCandidates: CreatorRenderCandidate[];
  loraTrainingJobs: CreatorLoraTrainingJob[];
  loraModels: CreatorLoraModel[];
  funnelCampaigns: CreatorFunnelCampaign[];
  funnelEvents: CreatorFunnelEvent[];
  fanvueTrackingLinks: FanvueTrackingLinkAction[];
  attributionSnapshots: CreatorAttributionSnapshot[];
  providerHealth: Record<ProviderHealth["provider"], ProviderHealth>;
  rendererHealth: Record<RendererHealth["provider"], RendererHealth>;
  inboxDraftModelHealth?: CreatorInboxDraftModelHealth;
  fetchedAt?: number;
};

type ApiResponse = { error?: string; providerHealth?: WorkspaceResponse["providerHealth"]; rendererHealth?: WorkspaceResponse["rendererHealth"]; inboxDraftModelHealth?: CreatorInboxDraftModelHealth } & Partial<WorkspaceResponse>;

function title(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseInboxDraftModelHealth(value: unknown): CreatorInboxDraftModelHealth | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const status = raw.status;
  if ((status !== "ready" && status !== "paused" && status !== "unavailable") || typeof raw.canGenerate !== "boolean") {
    return undefined;
  }
  const boundedList = (items: unknown) => Array.isArray(items)
    ? items.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 300)).slice(0, 5)
    : [];
  return {
    status,
    canGenerate: raw.canGenerate,
    model: typeof raw.model === "string" ? raw.model.trim().slice(0, 160) : "Server draft model",
    authentication: raw.authentication === "openai_api" ? "openai_api" : "openai_api",
    missing: boundedList(raw.missing),
    notes: boundedList(raw.notes),
  };
}

function parsePostizDiscoveredChannels(value: unknown): PostizDiscoveredChannel[] {
  if (!Array.isArray(value)) return [];
  const supportedPlatforms = new Set(["instagram", "tiktok", "youtube", "pinterest", "x", "facebook", "threads", "linkedin", "bluesky"]);
  return value.flatMap((item): PostizDiscoveredChannel[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const provider = typeof raw.provider === "string" ? raw.provider.trim() : "";
    const displayLabel = typeof raw.displayLabel === "string" ? raw.displayLabel.trim() : "";
    const status = raw.status;
    const platform = typeof raw.platform === "string" && supportedPlatforms.has(raw.platform) ? raw.platform as NonNullable<PostizDiscoveredChannel["platform"]> : undefined;
    const handle = typeof raw.handle === "string" && raw.handle.trim() ? raw.handle.trim().slice(0, 128) : undefined;
    const capabilityHints: "schedule_content"[] = Array.isArray(raw.capabilityHints) && raw.capabilityHints.every((hint) => hint === "schedule_content") ? ["schedule_content"] : [];
    const canMap = raw.canMap === true && status === "available" && Boolean(platform);
    const mappingHint = typeof raw.mappingHint === "string" ? raw.mappingHint.trim() : "";
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) ||
      !provider || provider.length > 80 ||
      !displayLabel || displayLabel.length > 200 ||
      (status !== "available" && status !== "disabled" && status !== "unsupported") ||
      !mappingHint || mappingHint.length > 240
    ) return [];
    return [{ id, provider, platform, handle, displayLabel, status, capabilityHints, canMap, mappingHint }];
  });
}

function words(value: FormDataEntryValue | null): string[] {
  return typeof value === "string"
    ? value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 20)
    : [];
}

function localDateTime(value?: number | string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function mondayForCalendar(value = new Date()): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function providerLabel(provider: ProviderHealth["provider"]): string {
  return provider === "meta_instagram" ? "Meta / Instagram" : provider === "fanvue" ? "Fanvue" : "Postiz (optional)";
}

function ProviderReadiness({ health }: { health?: ProviderHealth }) {
  if (!health) return null;
  const tone = health.status === "ready" ? "border-signal/50 bg-signal/[0.05]" : health.status === "misconfigured" ? "border-onair/50 bg-onair/[0.05]" : "border-amber/50 bg-amber/[0.05]";
  const copy = health.provider === "postiz"
    ? health.status === "ready"
      ? "Optional self-hosted executor ready for individually approved future schedules on already-authorised channels."
      : health.status === "misconfigured"
        ? "Postiz configuration needs correction before this desk can hand an approved future schedule to it."
        : "Optional and not configured. Postiz channels can still be mapped here, but this desk remains planning- and draft-only."
    : health.status === "ready"
      ? "Configured for official account connection and individually approved dispatch."
      : health.status === "misconfigured"
        ? "Configuration needs correction before this provider can be connected."
        : "Not configured. This desk stays planning- and draft-only for this provider.";
  return (
    <article className={`border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.15em] text-ink-faint uppercase">Provider readiness</p>
          <h2 className="mt-1 text-sm font-semibold text-ink">{providerLabel(health.provider)}</h2>
        </div>
        <span className="border border-current/30 px-2 py-1 text-[9px] font-semibold tracking-[0.12em] text-ink-dim uppercase">{title(health.status)}</span>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">{copy}</p>
      {health.missing.length > 0 && <p className="mt-3 text-[10px] leading-relaxed text-amber">Needs: {health.missing.join(", ")}</p>}
      {health.invalid.length > 0 && <p className="mt-2 text-[10px] leading-relaxed text-onair">Fix: {health.invalid.join("; ")}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">{health.notes[0]}</p>
    </article>
  );
}

function RendererReadiness({ health }: { health?: RendererHealth }) {
  if (!health) return null;
  const tone = health.status === "ready" ? "border-signal/50 bg-signal/[0.05]" : health.status === "misconfigured" ? "border-onair/50 bg-onair/[0.05]" : "border-amber/50 bg-amber/[0.05]";
  const copy = health.status === "ready"
    ? "An approved server-only renderer is installed; approved jobs still require a separate dispatch decision."
    : health.status === "misconfigured"
      ? "Renderer configuration needs correction before an approved job can be dispatched."
      : "Render jobs may be queued, but no server-side credential resolver and dispatcher are installed.";
  return (
    <article className={`border p-4 ${tone}`}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[0.15em] text-ink-faint uppercase">Renderer readiness</p><h2 className="mt-1 text-sm font-semibold text-ink">{title(health.provider)}</h2></div><span className="border border-current/30 px-2 py-1 text-[9px] font-semibold tracking-[0.12em] text-ink-dim uppercase">{title(health.status)}</span></div>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">{copy}</p>
      {health.missing.length > 0 && <p className="mt-3 text-[10px] leading-relaxed text-amber">Needs: {health.missing.join(", ")}</p>}
      {health.invalid.length > 0 && <p className="mt-2 text-[10px] leading-relaxed text-onair">Fix: {health.invalid.join("; ")}</p>}
      <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">{health.notes[0]}</p>
    </article>
  );
}

function Panel({ eyebrow, title: panelTitle, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="border border-line bg-panel">
      <header className="border-b border-line px-4 py-4 sm:px-5">
        <p className="text-[10px] font-semibold tracking-[0.15em] text-signal uppercase">{eyebrow}</p>
        <h2 className="mt-1 text-sm font-semibold text-ink">{panelTitle}</h2>
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return <button type="submit" disabled={disabled} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-[10px] font-medium text-ink-dim"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

const inputClass = "w-full border border-line-2 bg-panel-2 px-3 py-2 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-scope";

const FUNNEL_STAGE_FIELDS = [
  { stage: "awareness", label: "Awareness", purpose: "Introduce a truthful, useful creator-led story.", cta: "Follow for the next part." },
  { stage: "trust", label: "Trust", purpose: "Show credible context, process, or values without unsupported claims.", cta: "Save this for later." },
  { stage: "consideration", label: "Consideration", purpose: "Explain the relevant offer or route with clear disclosure.", cta: "See the details in the profile." },
  { stage: "conversion", label: "Conversion", purpose: "Invite a fully disclosed, approved next step.", cta: "Use the approved link in profile." },
  { stage: "retention", label: "Retention", purpose: "Keep the audience informed and supported after conversion.", cta: "Stay connected for updates." },
] as const;

export default function CreatorPromotionsPage() {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | undefined>();
  const [selectedContentId, setSelectedContentId] = useState<string | undefined>();
  const [selectedPlanningAccountId, setSelectedPlanningAccountId] = useState<string | undefined>();
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [calendarWeekStartsOn, setCalendarWeekStartsOn] = useState<Date>(() => mondayForCalendar());
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<Date | undefined>();
  const [selectedDestinationId, setSelectedDestinationId] = useState<string | undefined>();
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | undefined>();
  const [selectedReferenceAssetIds, setSelectedReferenceAssetIds] = useState<string[]>([]);
  const [referenceUploadOpen, setReferenceUploadOpen] = useState(false);
  const [funnelDraftOpen, setFunnelDraftOpen] = useState(false);
  const [funnelPauseTarget, setFunnelPauseTarget] = useState<CreatorFunnelCampaign | null>(null);
  const [planPostCount, setPlanPostCount] = useState(5);
  const [cadenceProfile, setCadenceProfile] = useState<"balanced" | "growth" | "story_led" | "conversion">("balanced");
  const [defaultAttributionCapturedAt] = useState(() => localDateTime(Date.now()));
  const [defaultFunnelEventOccurredAt] = useState(() => localDateTime(Date.now()));
  const [providerHealth, setProviderHealth] = useState<WorkspaceResponse["providerHealth"] | undefined>();
  const [rendererHealth, setRendererHealth] = useState<WorkspaceResponse["rendererHealth"] | undefined>();
  const [inboxDraftModelHealth, setInboxDraftModelHealth] = useState<CreatorInboxDraftModelHealth | undefined>();
  const [postizChannels, setPostizChannels] = useState<PostizDiscoveredChannel[] | null>(null);
  const [postizChannelsRefreshing, setPostizChannelsRefreshing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/creator-promotions", { credentials: "same-origin", cache: "no-store" });
      const body = await response.json().catch(() => ({})) as ApiResponse;
      if (body.providerHealth) setProviderHealth(body.providerHealth);
      if (body.rendererHealth) setRendererHealth(body.rendererHealth);
      const parsedInboxDraftModelHealth = parseInboxDraftModelHealth(body.inboxDraftModelHealth);
      // Missing or malformed health is deliberately treated as unavailable so
      // an old successful workspace read can never keep Draft reply enabled.
      setInboxDraftModelHealth(parsedInboxDraftModelHealth);
      if (!response.ok) throw new Error(body.error ?? "Creator Promotion workspace is unavailable");
      const loaded: WorkspaceResponse = {
        personas: Array.isArray(body.personas) ? body.personas : [],
        accounts: Array.isArray(body.accounts) ? body.accounts : [],
        content: Array.isArray(body.content) ? body.content : [],
        destinations: Array.isArray(body.destinations) ? body.destinations : [],
        partnerDestinations: Array.isArray(body.partnerDestinations) ? body.partnerDestinations : [],
        inboxThreads: Array.isArray(body.inboxThreads) ? body.inboxThreads : [],
        personaRevisions: Array.isArray(body.personaRevisions) ? body.personaRevisions : [],
        referenceAssets: Array.isArray(body.referenceAssets) ? body.referenceAssets : [],
        renderJobs: Array.isArray(body.renderJobs) ? body.renderJobs : [],
        renderCandidates: Array.isArray(body.renderCandidates) ? body.renderCandidates : [],
        loraTrainingJobs: Array.isArray(body.loraTrainingJobs) ? body.loraTrainingJobs : [],
        loraModels: Array.isArray(body.loraModels) ? body.loraModels : [],
        funnelCampaigns: Array.isArray(body.funnelCampaigns) ? body.funnelCampaigns : [],
        funnelEvents: Array.isArray(body.funnelEvents) ? body.funnelEvents : [],
        fanvueTrackingLinks: Array.isArray(body.fanvueTrackingLinks) ? body.fanvueTrackingLinks : [],
        attributionSnapshots: Array.isArray(body.attributionSnapshots) ? body.attributionSnapshots : [],
        providerHealth: body.providerHealth ?? {} as WorkspaceResponse["providerHealth"],
        rendererHealth: body.rendererHealth ?? {} as WorkspaceResponse["rendererHealth"],
        inboxDraftModelHealth: parsedInboxDraftModelHealth,
        fetchedAt: typeof body.fetchedAt === "number" ? body.fetchedAt : undefined,
      };
      setWorkspace(loaded);
      setProviderHealth(loaded.providerHealth);
      setRendererHealth(loaded.rendererHealth);
      setInboxDraftModelHealth(loaded.inboxDraftModelHealth);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creator Promotion workspace is unavailable");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const runAction = useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    if (busy) return false;
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch("/api/creator-promotions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        result?: { created?: number; importedProfiles?: number; importedAccounts?: number; triggerRunId?: string; dispatchWarning?: string };
      };
      if (!response.ok) throw new Error(body.error ?? "Creator Promotion action failed");
      const result = body.result;
      if (action === "import-legacy-personas" && result) {
        setNotice(`Imported ${result.importedProfiles ?? 0} historical creator profile(s) and ${result.importedAccounts ?? 0} account metadata record(s).`);
      } else if (action === "generate-week" && result?.created) {
        setNotice(`Created ${result.created} planned calendar item(s). They are not rendered or published.`);
      } else if (action === "create-lora-training-draft") {
        setNotice("Native LoRA training draft recorded. It has not been sent to Fal.");
      } else if (action === "queue-lora-training") {
        setNotice(result?.triggerRunId
          ? "Approved native LoRA training was queued and handed to the controlled worker."
          : result?.dispatchWarning ?? "Approved native LoRA training is queued. Dispatch it explicitly once Trigger is available.");
      } else if (action === "dispatch-lora-training") {
        setNotice("Queued native LoRA training was handed to the controlled worker.");
      } else if (action === "create-funnel-campaign") {
        setNotice("Funnel draft saved. It cannot route content or perform an external action until review, approval, and activation are recorded.");
      } else if (action === "submit-funnel-review") {
        setNotice("Funnel sent for internal review. It remains inactive.");
      } else if (action === "approve-funnel-campaign") {
        setNotice("Funnel approval recorded. Activation remains a separate operator decision.");
      } else if (action === "activate-funnel-campaign") {
        setNotice("Funnel activated. New schedule drafts bind its governed destination and approved CTA stages.");
      } else if (action === "pause-funnel-campaign") {
        setNotice("Funnel paused. Its governed route is unavailable for new content planning until reviewed again.");
      } else if (action === "record-funnel-event") {
        setNotice("Aggregate funnel observation recorded. No visitor, message, redirect, payment, or provider action occurred.");
      } else if (action === "request-meta-instagram-publish") {
        setNotice("Separate Meta publish approval requested. Meta and the dispatch worker have not been contacted.");
      } else if (action === "approve-meta-instagram-publish") {
        setNotice("Frozen Meta publish approval recorded. The calendar will not publish it; return when due and dispatch it explicitly.");
      } else if (action === "dispatch-meta-instagram-publish") {
        setNotice(result?.triggerRunId
          ? "Approved Meta publish action was explicitly queued and handed to the official worker. Refresh for its recorded outcome."
          : result?.dispatchWarning ?? "Approved Meta publish action is queued. No scheduler will deliver it; explicitly retry the worker handoff once configuration is ready.");
      } else if (action === "request-meta-instagram-reply") {
        setNotice("Separate Meta reply approval requested for the frozen draft. Meta and the reply worker have not been contacted.");
      } else if (action === "approve-meta-instagram-reply") {
        setNotice("Frozen Meta reply approval recorded. It still cannot send until you explicitly queue one reply.");
      } else if (action === "dispatch-meta-instagram-reply") {
        setNotice(result?.triggerRunId
          ? "One approved Meta reply was explicitly queued and handed to the official worker. Refresh for its recorded receipt."
          : result?.dispatchWarning ?? "The approved reply is queued. Nothing retries or follows up automatically; explicitly retry this handoff only after configuration is repaired.");
      } else if (action === "link-postiz-integration") {
        setNotice("Known Postiz channel mapped as operator-attested. Its OAuth connection stays in Postiz; the controlled worker verifies the current integration before it schedules anything.");
      } else if (action === "request-postiz-schedule") {
        setNotice("Separate Postiz schedule approval requested. Postiz and the worker have not been contacted.");
      } else if (action === "approve-postiz-schedule") {
        setNotice("Frozen Postiz schedule approval recorded. The calendar will not send it; use the explicit Postiz handoff when ready.");
      } else if (action === "queue-postiz-schedule") {
        setNotice(result?.triggerRunId
          ? "Approved future schedule was explicitly handed to Postiz. Refresh for acknowledgement; network delivery remains separate."
          : result?.dispatchWarning ?? "Approved future schedule is queued. No calendar process will deliver it; explicitly retry the Postiz handoff once configuration is ready.");
      } else if (action === "request-fanvue-tracking-link") {
        setNotice("Exact Fanvue tracking-link approval requested. Fanvue and the worker have not been contacted.");
      } else if (action === "approve-fanvue-tracking-link") {
        setNotice("Frozen Fanvue tracking-link approval recorded. It still cannot create a provider link until you explicitly hand it to the server worker.");
      } else if (action === "queue-fanvue-tracking-link") {
        setNotice(result?.triggerRunId
          ? "One approved Fanvue tracking-link request was explicitly handed to the official worker. Refresh for its receipt; creation is not retried automatically."
          : result?.dispatchWarning ?? "The approved Fanvue tracking-link request is queued. Nothing retries automatically; explicitly repeat the worker handoff only after configuration is repaired.");
      } else {
        setNotice("Saved. No external provider action was performed by this step.");
      }
      await reload();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Creator Promotion action failed");
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, reload]);

  const refreshPostizChannels = useCallback(async () => {
    if (busy) return;
    setBusy("refresh-postiz-channels");
    setPostizChannelsRefreshing(true);
    setNotice(null);
    try {
      const response = await fetch("/api/creator-promotions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "refresh-postiz-channels" }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; result?: { channels?: unknown } };
      if (!response.ok) throw new Error(body.error ?? "Postiz channel discovery failed");
      const channels = parsePostizDiscoveredChannels(body.result?.channels);
      setPostizChannels(channels);
      setNotice(channels.length
        ? `Retrieved ${channels.length} current Postiz channel${channels.length === 1 ? "" : "s"}. Select one to record an operator-attested mapping.`
        : "Postiz returned no connected channels. No account was mapped or scheduled.");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Postiz channel discovery failed");
    } finally {
      setPostizChannelsRefreshing(false);
      setBusy(null);
    }
  }, [busy]);

  const activePersona = useMemo(
    () => workspace?.personas.find((persona) => persona.id === selectedPersonaId) ?? workspace?.personas[0],
    [selectedPersonaId, workspace?.personas],
  );
  const activeContent = useMemo(
    () => workspace?.content.find((item) => item.id === selectedContentId)
      ?? workspace?.content.find((item) => item.creatorId === activePersona?.id),
    [activePersona?.id, selectedContentId, workspace?.content],
  );
  const selectedInstagramAccount = useMemo(
    () => workspace?.accounts.find((account) => account.creatorId === activePersona?.id && account.platform === "instagram"),
    [activePersona?.id, workspace?.accounts],
  );
  const selectedPlanningAccount = useMemo(
    () => workspace?.accounts.find((account) => account.id === selectedPlanningAccountId && account.creatorId === activePersona?.id)
      ?? selectedInstagramAccount
      ?? workspace?.accounts.find((account) => account.creatorId === activePersona?.id),
    [activePersona?.id, selectedPlanningAccountId, selectedInstagramAccount, workspace?.accounts],
  );
  const activeContentAccount = useMemo(
    () => activeContent?.accountId ? workspace?.accounts.find((account) => account.id === activeContent.accountId) : undefined,
    [activeContent, workspace?.accounts],
  );
  const activeDestination = useMemo(
    () => {
      const destinations = [...(workspace?.destinations ?? []), ...(workspace?.partnerDestinations ?? [])];
      return destinations.find((destination) => destination.id === selectedDestinationId && destination.creatorId === activePersona?.id)
        ?? destinations.find((destination) => destination.creatorId === activePersona?.id);
    },
    [activePersona?.id, selectedDestinationId, workspace?.destinations, workspace?.partnerDestinations],
  );
  const funnelDestinations = useMemo<CreatorFunnelDestination[]>(
    () => [
      ...(workspace?.destinations ?? []).map((destination) => ({
        id: destination.id,
        creatorId: destination.creatorId,
        label: destination.label,
        kind: "fanvue" as const,
        provider: "fanvue" as const,
        connectionStatus: destination.connectionStatus,
        complianceStatus: destination.complianceStatus,
        approvalStatus: destination.approvalStatus,
        ageGateStatus: destination.ageGateStatus,
        disclosure: destination.disclosure,
      })),
      ...(workspace?.partnerDestinations ?? []).map((destination) => ({
        id: destination.id,
        creatorId: destination.creatorId,
        label: destination.label,
        kind: destination.kind,
        connectionStatus: destination.connectionStatus,
        complianceStatus: destination.complianceStatus,
        approvalStatus: destination.approvalStatus,
        disclosure: destination.disclosure,
      })),
    ],
    [workspace?.destinations, workspace?.partnerDestinations],
  );
  const activeFunnel = useMemo(
    () => workspace?.funnelCampaigns.find((funnel) => funnel.id === selectedFunnelId && funnel.creatorId === activePersona?.id && funnel.status === "active")
      ?? workspace?.funnelCampaigns.find((funnel) => funnel.creatorId === activePersona?.id && funnel.status === "active"),
    [activePersona?.id, selectedFunnelId, workspace?.funnelCampaigns],
  );
  const activeCreatorFunnels = useMemo(
    () => workspace?.funnelCampaigns.filter((funnel) => funnel.creatorId === activePersona?.id && funnel.status === "active") ?? [],
    [activePersona?.id, workspace?.funnelCampaigns],
  );
  const activeFanvueDestinations = useMemo(
    () => workspace?.destinations.filter((destination) => destination.creatorId === activePersona?.id && destination.connectionStatus === "connected" && destination.complianceStatus === "approved" && destination.ageGateStatus === "confirmed") ?? [],
    [activePersona?.id, workspace?.destinations],
  );
  const activeFanvueTrackingLinks = useMemo(
    () => workspace?.fanvueTrackingLinks.filter((link) => link.creatorId === activePersona?.id) ?? [],
    [activePersona?.id, workspace?.fanvueTrackingLinks],
  );
  const activeReferenceAssets = useMemo(
    () => workspace?.referenceAssets.filter((asset) => asset.creatorId === activePersona?.id) ?? [],
    [activePersona?.id, workspace?.referenceAssets],
  );
  const activeNativeLoraModel = useMemo(
    () => workspace?.loraModels.find((model) => model.creatorId === activePersona?.id && model.compatibility === "native" && model.status === "active"),
    [activePersona?.id, workspace?.loraModels],
  );
  const defaultLoraTriggerWord = useMemo(
    () => (activePersona?.handle ?? "creator")
      .replace(/^@+/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "")
      .slice(0, 48) || "creator",
    [activePersona?.handle],
  );
  const canUseActiveLoraForPlan = Boolean(activeNativeLoraModel && selectedReferenceAssetIds.length === 0);

  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("create-profile", {
      name: form.get("name"),
      handle: form.get("handle"),
      archetype: form.get("archetype"),
      timezone: form.get("timezone"),
      identitySummary: form.get("identitySummary"),
      emotionalBackstory: form.get("emotionalBackstory"),
      voiceGuide: form.get("voiceGuide"),
      audience: form.get("audience"),
      contentPillars: words(form.get("contentPillars")),
      boundaries: words(form.get("boundaries")),
      promptLock: form.get("promptLock"),
      promptStyle: form.get("promptStyle"),
      primaryGoal: form.get("primaryGoal"),
      inboxPolicy: "draft_only",
    });
    event.currentTarget.reset();
  };

  const submitProfileRevision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("update-profile", {
      creatorId: form.get("creatorId"),
      stage: form.get("stage"),
      timezone: form.get("timezone"),
      identitySummary: form.get("identitySummary"),
      emotionalBackstory: form.get("emotionalBackstory"),
      voiceGuide: form.get("voiceGuide"),
      audience: form.get("audience"),
      contentPillars: words(form.get("contentPillars")),
      boundaries: words(form.get("boundaries")),
      promptLock: form.get("promptLock"),
      promptStyle: form.get("promptStyle"),
      loraTrigger: form.get("loraTrigger"),
      referenceNotes: form.get("referenceNotes"),
      primaryGoal: form.get("primaryGoal"),
      inboxPolicy: form.get("inboxPolicy"),
    });
  };

  const submitAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optionalNumber = (name: string) => {
      const raw = form.get(name);
      return typeof raw === "string" && raw.trim() ? Number(raw) : undefined;
    };
    const formatTargets = Object.fromEntries(
      ["image", "carousel", "reel", "story", "short", "text"].flatMap((format) => {
        const target = optionalNumber(`formatTarget${title(format)}`);
        return target === undefined ? [] : [[format, target]];
      }),
    );
    await runAction("register-account", {
      creatorId: form.get("creatorId"),
      platform: form.get("platform"),
      handle: form.get("handle"),
      displayName: form.get("displayName"),
      ownershipStatus: form.get("ownershipStatus"),
      dailyPostLimit: optionalNumber("dailyPostLimit"),
      weeklyTarget: optionalNumber("weeklyTarget"),
      maxGapDays: optionalNumber("maxGapDays"),
      formatTargets: Object.keys(formatTargets).length ? formatTargets : undefined,
      notes: form.get("notes"),
    });
    event.currentTarget.reset();
  };

  const submitDestination = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = form.get("kind");
    const isFanvue = kind === "fanvue";
    await runAction("create-destination", {
      creatorId: form.get("creatorId"),
      kind,
      label: form.get("label"),
      url: form.get("url"),
      disclosureText: form.get("disclosureText"),
      ageGateRequired: isFanvue,
      manualKycStatus: isFanvue ? "pending" : "not_applicable",
    });
    event.currentTarget.reset();
  };

  const submitFunnelCampaign = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = (name: string) => typeof form.get(name) === "string" ? String(form.get(name)).trim() : "";
    const disclosureRequired = form.get("disclosureRequired") === "on";
    const ageGateRequired = form.get("ageGateRequired") === "on";
    const disclosureText = value("disclosureText");
    const ageGateEvidenceReference = value("ageGateEvidenceReference");
    const attestationStatement = value("operatorAttestationStatement");
    if (form.get("operatorAttestationConfirmed") !== "on") {
      setError("Confirm the operator attestation before saving this funnel draft.");
      return;
    }
    if (!attestationStatement) {
      setError("Write the operator attestation statement before saving this funnel draft.");
      return;
    }
    if (disclosureRequired && !disclosureText) {
      setError("Provide the required disclosure copy before saving this funnel draft.");
      return;
    }
    if (ageGateRequired && !ageGateEvidenceReference) {
      setError("Record the age-gate evidence reference before saving this funnel draft.");
      return;
    }
    const stages = FUNNEL_STAGE_FIELDS.map(({ stage }) => ({
      stage,
      label: value(`${stage}Label`),
      purpose: value(`${stage}Purpose`),
      ctaText: value(`${stage}Cta`),
    }));
    if (stages.some((stage) => !stage.label || !stage.purpose || !stage.ctaText)) {
      setError("Complete the label, purpose, and approved CTA for every funnel stage.");
      return;
    }
    const saved = await runAction("create-funnel-campaign", {
      creatorId: form.get("creatorId"),
      destinationId: form.get("destinationId"),
      campaignLabel: value("campaignLabel"),
      objective: form.get("objective"),
      stages,
      compliance: {
        disclosureRequired,
        disclosureText: disclosureText || undefined,
        ageGateRequired,
        ageGateEvidenceReference: ageGateEvidenceReference || undefined,
        operatorAttestation: {
          statement: attestationStatement,
          confirmed: true,
        },
      },
      linkPolicy: {
        utmSource: value("utmSource"),
        utmMedium: value("utmMedium"),
        utmCampaign: value("utmCampaign"),
        utmContentPrefix: value("utmContentPrefix") || undefined,
      },
    });
    if (saved) {
      formElement.reset();
      setFunnelDraftOpen(false);
    }
  };

  const submitFunnelEvent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const occurredAtValue = form.get("occurredAt");
    const occurredAt = typeof occurredAtValue === "string" && occurredAtValue ? new Date(occurredAtValue).getTime() : NaN;
    const count = Number(form.get("count"));
    const revenueRaw = form.get("revenueMinor");
    const revenueMinor = typeof revenueRaw === "string" && revenueRaw.trim() ? Number(revenueRaw) : undefined;
    if (!Number.isFinite(occurredAt) || occurredAt > Date.now() + 60_000) {
      setError("Choose a valid time for the aggregate funnel observation.");
      return;
    }
    if (!Number.isSafeInteger(count) || count < 1) {
      setError("Aggregate funnel count must be a positive whole number.");
      return;
    }
    if (revenueMinor !== undefined && (!Number.isSafeInteger(revenueMinor) || revenueMinor < 0)) {
      setError("Observed revenue must be a non-negative whole number in minor units.");
      return;
    }
    const saved = await runAction("record-funnel-event", {
      creatorId: form.get("creatorId"),
      funnelId: form.get("funnelId"),
      contentId: form.get("contentId") || undefined,
      eventType: form.get("eventType") as CreatorFunnelEventType,
      count,
      revenueMinor,
      currency: form.get("currency"),
      note: form.get("note"),
      occurredAt,
    });
    if (saved) formElement.reset();
  };

  const submitFunnelPause = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!funnelPauseTarget) return;
    const form = new FormData(event.currentTarget);
    const reason = typeof form.get("reason") === "string" ? String(form.get("reason")).trim() : "";
    if (!reason) {
      setError("Provide a reason before pausing this funnel.");
      return;
    }
    const paused = await runAction("pause-funnel-campaign", { funnelId: funnelPauseTarget.id, reason });
    if (paused) setFunnelPauseTarget(null);
  };

  const submitInboxIntake = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const responseWindow = form.get("responseWindowEndsAt");
    const responseWindowEndsAt = typeof responseWindow === "string" && responseWindow
      ? new Date(responseWindow).getTime()
      : undefined;
    if (responseWindowEndsAt !== undefined && Number.isNaN(responseWindowEndsAt)) {
      setError("Choose a valid review deadline or leave it blank.");
      return;
    }
    await runAction("create-inbox-thread", {
      creatorId: form.get("creatorId"),
      accountId: form.get("accountId") || undefined,
      platform: form.get("platform"),
      participantLabel: form.get("participantLabel"),
      intent: form.get("intent"),
      summary: form.get("summary"),
      responseWindowEndsAt,
      requiresDisclosure: form.get("requiresDisclosure") === "on",
      safetyFlags: words(form.get("safetyFlags")),
    });
    event.currentTarget.reset();
  };

  const submitAttribution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const numberField = (name: string) => {
      const raw = form.get(name);
      if (typeof raw !== "string" || !raw.trim()) return undefined;
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${title(name)} must be a non-negative whole number.`);
      return value;
    };
    try {
      const captured = form.get("capturedAt");
      const capturedAt = typeof captured === "string" && captured ? new Date(captured).getTime() : NaN;
      if (!Number.isFinite(capturedAt)) throw new Error("Choose when the provider metric was captured.");
      await runAction("record-attribution", {
        creatorId: form.get("creatorId"),
        accountId: form.get("accountId") || undefined,
        contentId: form.get("contentId") || undefined,
        destinationId: form.get("destinationId") || undefined,
        capturedAt,
        impressions: numberField("impressions"),
        reach: numberField("reach"),
        linkClicks: numberField("linkClicks"),
        followers: numberField("followers"),
        subscribers: numberField("subscribers"),
        grossRevenueMinor: numberField("grossRevenueMinor"),
        currency: form.get("currency"),
      });
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Performance observation could not be recorded.");
    }
  };

  const submitReferenceUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activePersona || busy) return;
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a JPEG, PNG, or WebP reference image first.");
      return;
    }
    setBusy("upload-reference-asset");
    setNotice(null);
    try {
      const upload = new FormData();
      upload.set("purpose", "creator-reference");
      upload.set("creatorId", activePersona.id);
      upload.set("file", file);
      const response = await fetch("/api/upload", { method: "POST", credentials: "same-origin", body: upload });
      const body = await response.json().catch(() => ({})) as { error?: string; key?: string };
      if (!response.ok || !body.key) throw new Error(body.error ?? "Reference image upload failed");
      const registration = await fetch("/api/creator-promotions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "register-reference-asset",
          creatorId: activePersona.id,
          storageKey: body.key,
          displayName: form.get("displayName") || file.name,
          rightsStatus: form.get("rightsStatus"),
          useType: form.get("useType"),
          source: "operator_uploaded",
          consentRecordReference: form.get("consentRecordReference"),
          licenseReference: form.get("licenseReference"),
        }),
      });
      const registered = await registration.json().catch(() => ({})) as { error?: string };
      if (!registration.ok) throw new Error(registered.error ?? "Reference image registration failed");
      setNotice("Reference image uploaded and registered. It is now available for prompt lineage.");
      await reload();
      setReferenceUploadOpen(false);
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reference image upload failed");
    } finally {
      setBusy(null);
    }
  };

  const requestFanvueReadiness = async (
    requestedCapabilities: readonly FanvueReadinessCapability[] = getFanvueReadinessProfile().requestedCapabilities,
  ) => {
    if (!activePersona) return setError("Select a creator before recording Fanvue onboarding readiness.");
    await runAction("request-fanvue-readiness", {
      creatorId: activePersona.id,
      displayName: `${activePersona.name} Fanvue readiness`,
      requestedCapabilities: [...requestedCapabilities],
    });
  };

  const requestFanvueTrackingLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runAction("request-fanvue-tracking-link", {
      destinationId: form.get("destinationId"),
      funnelId: form.get("funnelId"),
      name: form.get("name"),
      externalSocialPlatform: form.get("externalSocialPlatform"),
    });
  };

  const approveFanvueTrackingLink = async (actionId: string) => {
    await runAction("approve-fanvue-tracking-link", { actionId });
  };

  const queueFanvueTrackingLink = async (actionId: string) => {
    await runAction("queue-fanvue-tracking-link", { actionId });
  };

  const requestDraft = async (threadId: string) => {
    await runAction("draft-inbox-reply", { threadId });
  };

  const saveInboxDraft = async (threadId: string, draftReply: string, rationale?: string) => {
    await runAction("revise-inbox-draft", { threadId, draftReply, rationale });
  };

  const approveInboxDraft = async (threadId: string) => {
    await runAction("approve-inbox-draft", { threadId });
  };

  const requestMetaInstagramReplyApproval = async (threadId: string) => {
    await runAction("request-meta-instagram-reply", { threadId });
  };

  const approveMetaInstagramReply = async (threadId: string) => {
    await runAction("approve-meta-instagram-reply", { threadId });
  };

  const dispatchMetaInstagramReply = async (threadId: string) => {
    await runAction("dispatch-meta-instagram-reply", { threadId });
  };

  const requestHandoff = async (threadId: string) => {
    await runAction("handoff-inbox-thread", { threadId, reason: "Operator review requested from the Creator Promotion desk." });
  };

  const createPersonaRevision = async (request: CreatorPersonaRevisionRequest) => {
    await runAction("create-persona-revision", request);
  };

  const activatePersonaRevision = async (revisionId: string) => {
    await runAction("activate-persona-revision", { revisionId });
  };

  const selectRenderCandidate = async (candidateId: string) => {
    await runAction("select-render-candidate", { candidateId });
  };

  const rejectRenderCandidate = async (candidateId: string, reason: string) => {
    await runAction("reject-render-candidate", { candidateId, reason });
  };

  const retryRenderJob = async (jobId: string) => {
    await runAction("retry-render-job", { jobId });
  };

  const dispatchRenderJob = async (jobId: string) => {
    await runAction("dispatch-render-job", { jobId });
  };

  const requestLoraTraining = async (request: CreatorLoraTrainingRequest) => {
    await runAction("create-lora-training-draft", request);
  };

  const submitLoraTrainingForReview = async (jobId: string) => {
    await runAction("submit-lora-training-review", { jobId });
  };

  const approveLoraTraining = async (jobId: string) => {
    await runAction("approve-lora-training", { jobId });
  };

  const queueLoraTraining = async (jobId: string) => {
    await runAction("queue-lora-training", { jobId });
  };

  const dispatchLoraTraining = async (jobId: string) => {
    await runAction("dispatch-lora-training", { jobId });
  };

  const activateLoraModel = async (modelId: string) => {
    await runAction("activate-lora-model", { modelId });
  };

  const submitFunnelForReview = async (funnel: CreatorFunnelCampaign) => {
    setSelectedFunnelId(funnel.id);
    await runAction("submit-funnel-review", { funnelId: funnel.id });
  };

  const approveFunnelCampaign = async (funnel: CreatorFunnelCampaign) => {
    setSelectedFunnelId(funnel.id);
    await runAction("approve-funnel-campaign", { funnelId: funnel.id });
  };

  const activateFunnelCampaign = async (funnel: CreatorFunnelCampaign) => {
    setSelectedFunnelId(funnel.id);
    await runAction("activate-funnel-campaign", { funnelId: funnel.id });
  };

  const submitSchedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeContent) return;
    const schedule = new FormData(event.currentTarget).get("scheduledAt");
    if (typeof schedule !== "string" || !schedule) return;
    const scheduledAt = new Date(schedule).getTime();
    await runAction("reschedule-content", { contentId: activeContent.id, scheduledAt });
  };

  const health = workspace?.providerHealth ?? providerHealth;
  const renderHealth = workspace?.rendererHealth ?? rendererHealth;
  const inboxModelHealth = inboxDraftModelHealth;
  const isBusy = Boolean(busy);

  return (
    <div className="space-y-5">
      {notice && <div role="status" className="border border-signal/45 bg-signal/[0.06] px-4 py-3 text-xs text-signal">{notice}</div>}
      {error && <div role="alert" className="border border-onair/45 bg-onair/[0.06] px-4 py-3 text-xs leading-relaxed text-onair">{error}</div>}

      {workspace ? (
        <>
          <CreatorPromotionWorkspace
            personas={workspace.personas}
            accounts={workspace.accounts}
            content={workspace.content}
            destinations={workspace.destinations}
            partnerDestinations={workspace.partnerDestinations}
            inboxThreads={workspace.inboxThreads}
            personaRevisions={workspace.personaRevisions}
            selectedPersonaId={activePersona?.id}
            selectedContentId={activeContent?.id}
            selectedThreadId={selectedThreadId}
            calendarTimezone={activePersona?.timezone}
            weekStartsOn={calendarWeekStartsOn}
            selectedCalendarDay={selectedCalendarDay}
            lastReadAt={workspace.fetchedAt}
            onSelectPersona={(personaId) => { setSelectedPersonaId(personaId); setSelectedContentId(undefined); setSelectedPlanningAccountId(undefined); setSelectedThreadId(undefined); setSelectedDestinationId(undefined); setSelectedFunnelId(undefined); setFunnelDraftOpen(false); setFunnelPauseTarget(null); setSelectedReferenceAssetIds([]); setSelectedCalendarDay(undefined); setCalendarWeekStartsOn(mondayForCalendar()); }}
            onSelectContent={setSelectedContentId}
            onSelectCalendarDay={setSelectedCalendarDay}
            onWeekStartsOnChange={setCalendarWeekStartsOn}
            onSelectThread={setSelectedThreadId}
            onRequestFanvueConnectionReview={(capabilities) => { void requestFanvueReadiness(capabilities); }}
            onRequestInboxDraft={(threadId) => { void requestDraft(threadId); }}
            onSaveInboxDraft={(threadId, draftReply, rationale) => { void saveInboxDraft(threadId, draftReply, rationale); }}
            onApproveInboxDraft={(threadId) => { void approveInboxDraft(threadId); }}
            onRequestInboxHandoff={(threadId) => { void requestHandoff(threadId); }}
            onCreatePersonaRevision={(request) => { void createPersonaRevision(request); }}
            onActivatePersonaRevision={(revisionId) => { void activatePersonaRevision(revisionId); }}
            inboxDraftModelHealth={inboxModelHealth}
            canDispatchMetaInstagramReplies={Boolean(health?.meta_instagram?.canDispatchApprovedActions)}
            inboxBusy={isBusy}
            onRequestMetaInstagramReplyApproval={(threadId) => { void requestMetaInstagramReplyApproval(threadId); }}
            onApproveMetaInstagramReply={(threadId) => { void approveMetaInstagramReply(threadId); }}
            onDispatchMetaInstagramReply={(threadId) => { void dispatchMetaInstagramReply(threadId); }}
            headerActions={
              <>
                <button type="button" disabled={isBusy} onClick={() => { void runAction("import-legacy-personas"); }} className="border border-line-2 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-dim transition hover:border-scope hover:text-scope disabled:opacity-50">Import historical metadata</button>
                <select aria-label="Schedule account" value={selectedPlanningAccount?.id ?? ""} onChange={(event) => setSelectedPlanningAccountId(event.target.value || undefined)} className="max-w-48 border border-line-2 bg-panel-2 px-2 py-2 text-[10px] text-ink-dim outline-none focus:border-scope"><option value="" disabled>Select schedule account</option>{workspace.accounts.filter((account) => account.creatorId === activePersona?.id).map((account) => <option key={account.id} value={account.id}>{title(account.platform)} · {account.handle}{account.publisher === "postiz" ? " · Postiz" : ""}</option>)}</select>
                <label className="flex items-center gap-1.5 border border-line-2 bg-panel-2 px-2 py-1 text-[9px] text-ink-dim"><span className="sr-only">Posts per week</span><input aria-label="Posts per week" value={planPostCount} onChange={(event) => setPlanPostCount(Math.max(3, Math.min(7, Number(event.target.value) || 3)))} type="number" min="3" max="7" className="w-7 bg-transparent text-center text-[10px] text-ink outline-none" /><span>/ week</span></label>
                <select aria-label="Editorial cadence" value={cadenceProfile} onChange={(event) => setCadenceProfile(event.target.value as "balanced" | "growth" | "story_led" | "conversion")} className="border border-line-2 bg-panel-2 px-2 py-2 text-[10px] text-ink-dim outline-none focus:border-scope"><option value="balanced">Balanced mix</option><option value="growth">Growth / reels</option><option value="story_led">Story-led</option><option value="conversion">Conversion-aware</option></select>
                {activeNativeLoraModel && <span className={`border px-2 py-1 text-[9px] font-semibold tracking-[0.1em] uppercase ${canUseActiveLoraForPlan ? "border-scope/45 text-scope" : "border-amber/45 text-amber"}`}>{canUseActiveLoraForPlan ? "Native LoRA selected" : "Post references override LoRA"}</span>}
                {activeFunnel && <span className="border border-signal/45 px-2 py-1 text-[9px] font-semibold tracking-[0.1em] text-signal uppercase">Active funnel · {activeFunnel.campaignLabel}</span>}
                <button type="button" disabled={isBusy || !activePersona} onClick={() => { if (activePersona) void runAction("generate-week", { creatorId: activePersona.id, accountId: selectedPlanningAccount?.id, destinationId: activeFunnel?.destinationId ?? activeDestination?.id, ...(activeFunnel ? { funnelId: activeFunnel.id } : {}), referenceAssetIds: selectedReferenceAssetIds, postCount: planPostCount, cadenceProfile, ...(canUseActiveLoraForPlan ? { renderProvider: "fal_z_image_turbo_lora", loraModelId: activeNativeLoraModel?.id } : {}) }); }} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:opacity-50">Generate schedule</button>
                <button type="button" disabled={isBusy} onClick={() => { void reload(); }} className="border border-line-2 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-dim transition hover:border-scope hover:text-scope disabled:opacity-50">Refresh</button>
              </>
            }
          />
          <CreatorAccountReadinessPanel
            personas={workspace.personas}
            accounts={workspace.accounts}
            providerHealth={health}
            rendererHealth={renderHealth}
          />
          <CreatorLoraTrainingPanel
            jobs={workspace.loraTrainingJobs}
            models={workspace.loraModels}
            referenceAssets={workspace.referenceAssets}
            selectedCreatorId={activePersona?.id}
            defaultTriggerWord={defaultLoraTriggerWord}
            defaultCaption={`${defaultLoraTriggerWord}, creator identity reference`}
            onRequestStartTraining={(request) => { void requestLoraTraining(request); }}
            onSubmitForReview={(jobId) => { void submitLoraTrainingForReview(jobId); }}
            onApproveTraining={(jobId) => { void approveLoraTraining(jobId); }}
            onQueueTraining={(jobId) => { void queueLoraTraining(jobId); }}
            onDispatchTraining={(jobId) => { void dispatchLoraTraining(jobId); }}
            onActivateModel={(modelId) => { void activateLoraModel(modelId); }}
            busy={isBusy}
          />
          <CreatorRenderQueue jobs={workspace.renderJobs} candidates={workspace.renderCandidates} content={workspace.content} selectedCreatorId={activePersona?.id} onSelectCandidate={(candidateId) => { void selectRenderCandidate(candidateId); }} onRejectCandidate={(candidateId, reason) => { void rejectRenderCandidate(candidateId, reason); }} onRetryJob={(jobId) => { void retryRenderJob(jobId); }} onDispatchJob={(jobId) => { void dispatchRenderJob(jobId); }} busy={isBusy} />
          <CreatorPerformanceLedger snapshots={workspace.attributionSnapshots} content={workspace.content} selectedCreatorId={activePersona?.id} />
          <CreatorFunnelControlPanel
            funnels={workspace.funnelCampaigns}
            destinations={funnelDestinations}
            events={workspace.funnelEvents}
            selectedCreatorId={activePersona?.id}
            onCreate={(creatorId) => {
              setSelectedPersonaId(creatorId);
              setSelectedFunnelId(undefined);
              setFunnelPauseTarget(null);
              setFunnelDraftOpen(true);
            }}
            onSubmit={(funnel) => { void submitFunnelForReview(funnel); }}
            onApprove={(funnel) => { void approveFunnelCampaign(funnel); }}
            onActivate={(funnel) => { void activateFunnelCampaign(funnel); }}
            onPause={(funnel) => { setSelectedFunnelId(funnel.id); setFunnelPauseTarget(funnel); }}
            busy={isBusy}
          />
          <Panel eyebrow="Fanvue conversion infrastructure" title="Individually approved tracking links">
            <p className="text-[11px] leading-relaxed text-ink-dim">Create one named attribution link only after the destination and funnel are active. This does not create a Fanvue account, publish a post, message anyone, process payments, or infer a conversion. The link request, approval, and provider handoff are separate deliberate steps.</p>
            {activeFanvueDestinations.length > 0 && activeCreatorFunnels.some((funnel) => activeFanvueDestinations.some((destination) => destination.id === funnel.destinationId)) ? (
              <form onSubmit={requestFanvueTrackingLink} className="mt-4 grid gap-3 border-y border-line py-4 sm:grid-cols-2">
                <Field label="Verified Fanvue destination">
                  <select required name="destinationId" defaultValue={activeFunnel?.destinationId ?? activeFanvueDestinations[0]?.id ?? ""} className={inputClass}>
                    {activeFanvueDestinations.map((destination) => <option key={destination.id} value={destination.id}>{destination.label}</option>)}
                  </select>
                </Field>
                <Field label="Active approved funnel">
                  <select required name="funnelId" defaultValue={activeFunnel?.id ?? ""} className={inputClass}>
                    {activeCreatorFunnels.filter((funnel) => activeFanvueDestinations.some((destination) => destination.id === funnel.destinationId)).map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.campaignLabel} · v{funnel.version}</option>)}
                  </select>
                </Field>
                <Field label="Tracking-link name"><input required name="name" maxLength={120} className={inputClass} placeholder="e.g. Kira Instagram conversion · Aug 2026" /></Field>
                <Field label="Promotion platform">
                  <select required name="externalSocialPlatform" defaultValue="instagram" className={inputClass}>
                    <option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="twitter">X / Twitter</option><option value="youtube">YouTube</option><option value="facebook">Facebook</option><option value="reddit">Reddit</option><option value="snapchat">Snapchat</option><option value="other">Other reviewed source</option>
                  </select>
                </Field>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                  <SubmitButton disabled={isBusy}>Request link approval</SubmitButton>
                  <p className="text-[10px] leading-relaxed text-ink-faint">Fanvue must have granted <span className="font-mono text-ink-dim">write:tracking_links</span> for this creator before the approved request can be handed off.</p>
                </div>
              </form>
            ) : (
              <p className="mt-4 border border-amber/35 bg-amber/[0.035] p-3 text-[10px] leading-relaxed text-amber">Tracking-link creation stays unavailable until this creator has an active Fanvue destination with recorded KYC, age-gate and disclosure evidence, plus an active approved funnel.</p>
            )}
            {activeFanvueTrackingLinks.length > 0 && (
              <ul className="mt-4 divide-y divide-line border border-line">
                {activeFanvueTrackingLinks.map((link) => {
                  const readyToApprove = link.status === "admitted" && link.approvalStatus === "pending";
                  const readyToQueue = link.status === "admitted" && link.approvalStatus === "approved";
                  const completed = link.status === "succeeded" && Boolean(link.linkUrl);
                  return (
                    <li key={link.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="border border-scope/45 px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-scope uppercase">{title(link.status)}</span>
                          <span className="text-[10px] font-semibold text-ink">{link.name}</span>
                          <span className="text-[9px] text-ink-faint">{title(link.externalSocialPlatform)}</span>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">Approval: {title(link.approvalStatus)}{link.approvalDecidedAt ? ` · ${new Date(link.approvalDecidedAt).toLocaleString()}` : ""}</p>
                        {completed && link.linkUrl ? <a href={link.linkUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block max-w-full truncate text-[10px] text-scope hover:underline">{link.linkUrl} ↗</a> : null}
                        {link.status === "queued" && <p className="mt-1 text-[10px] leading-relaxed text-amber">Queued for one explicit official handoff. It will not retry itself.</p>}
                        {link.status === "running" && <p className="mt-1 text-[10px] leading-relaxed text-amber">Provider request is in progress. Do not queue another request; reconcile the receipt if the worker is interrupted.</p>}
                        {link.failureReason && <p className="mt-1 text-[10px] leading-relaxed text-onair">{link.failureReason}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {readyToApprove && <button type="button" disabled={isBusy} onClick={() => { void approveFanvueTrackingLink(link.id); }} className="border border-scope/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-wide text-scope hover:bg-scope hover:text-void disabled:opacity-50">Approve exact link</button>}
                        {readyToQueue && <button type="button" disabled={isBusy || !health?.fanvue?.canDispatchApprovedActions} onClick={() => { void queueFanvueTrackingLink(link.id); }} className="border border-signal/55 px-2.5 py-1.5 text-[9px] font-semibold tracking-wide text-signal hover:bg-signal hover:text-void disabled:opacity-50">Create once with Fanvue</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {!health?.fanvue?.canDispatchApprovedActions && <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">The final Fanvue handoff is disabled until the official OAuth token resolver, server-only dispatcher, and explicit production gate are configured. Requests can still be reviewed safely.</p>}
          </Panel>
          {funnelDraftOpen && (
            <Panel eyebrow="Governed funnel draft" title={`Map ${activePersona?.name ?? "this creator"}'s approved route`}>
              {funnelDestinations.some((destination) => destination.creatorId === activePersona?.id) ? (
                <form key={activePersona?.id} onSubmit={submitFunnelCampaign} className="grid gap-4">
                  <input type="hidden" name="creatorId" value={activePersona?.id ?? ""} />
                  <p className="text-[11px] leading-relaxed text-ink-dim">This records a draft campaign only. It creates no public link, provider account, message, payment, redirect, post, or subscription action. A human must review, approve, and activate it separately.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Governed destination"><select required name="destinationId" defaultValue={activeDestination?.id ?? ""} className={inputClass}><option value="" disabled>Select a saved destination</option>{funnelDestinations.filter((destination) => destination.creatorId === activePersona?.id).map((destination) => <option key={destination.id} value={destination.id}>{destination.label} · {title(destination.connectionStatus)}</option>)}</select></Field>
                    <Field label="Objective"><select required name="objective" defaultValue={activePersona?.primaryGoal === "fanvue_conversion" ? "subscription_conversion" : activePersona?.primaryGoal === "brand_partnerships" ? "brand_partnerships" : "lead_capture"} className={inputClass}><option value="brand_partnerships">Brand partnerships</option><option value="subscription_conversion">Subscription conversion</option><option value="website_conversion">Website conversion</option><option value="lead_capture">Lead capture</option><option value="other">Other reviewed objective</option></select></Field>
                    <div className="sm:col-span-2"><Field label="Campaign label"><input required name="campaignLabel" className={inputClass} placeholder="e.g. Autumn brand partnership path" /></Field></div>
                  </div>

                  <div className="border-y border-line py-4">
                    <p className="text-[10px] font-semibold tracking-[0.13em] text-ink-faint uppercase">Stage map and approved CTA copy</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">Each upcoming schedule item uses only these recorded stages and exact CTA copy when this funnel is active.</p>
                    <div className="mt-3 grid gap-3 lg:grid-cols-5">
                      {FUNNEL_STAGE_FIELDS.map((stage, index) => (
                        <div key={stage.stage} className="border border-line bg-panel-2/35 p-3">
                          <p className="text-[9px] font-semibold tracking-[0.11em] text-scope uppercase">{index + 1}. {stage.label}</p>
                          <div className="mt-3 space-y-2">
                            <Field label="Label"><input required name={`${stage.stage}Label`} defaultValue={stage.label} className={inputClass} /></Field>
                            <Field label="Purpose"><textarea required name={`${stage.stage}Purpose`} defaultValue={stage.purpose} rows={3} className={inputClass} /></Field>
                            <Field label="CTA"><textarea required name={`${stage.stage}Cta`} defaultValue={stage.cta} rows={2} className={inputClass} /></Field>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-dim"><input name="disclosureRequired" type="checkbox" defaultChecked className="mt-0.5 accent-signal" /><span>Require a truthful commercial / AI-assistance disclosure before this route is used.</span></label>
                    <label className="flex items-start gap-2 text-[10px] leading-relaxed text-ink-dim"><input name="ageGateRequired" type="checkbox" className="mt-0.5 accent-signal" /><span>This route requires age-gating. An evidence reference is mandatory below.</span></label>
                    <div className="sm:col-span-2"><Field label="Disclosure copy (required when disclosure is checked)"><textarea name="disclosureText" rows={2} className={inputClass} placeholder="Truthful copy shown with or before the CTA." /></Field></div>
                    <div className="sm:col-span-2"><Field label="Age-gate evidence reference (required when age-gating is checked)"><input name="ageGateEvidenceReference" className={inputClass} placeholder="Internal review / compliance record ID; never a password or token" /></Field></div>
                  </div>

                  <div className="grid gap-3 border-y border-line py-4 sm:grid-cols-2">
                    <Field label="UTM source"><input required name="utmSource" defaultValue="instagram" className={inputClass} /></Field>
                    <Field label="UTM medium"><input required name="utmMedium" defaultValue="organic" className={inputClass} /></Field>
                    <Field label="UTM campaign"><input required name="utmCampaign" className={inputClass} placeholder="creator_campaign" /></Field>
                    <Field label="UTM content prefix (optional)"><input name="utmContentPrefix" className={inputClass} placeholder="post" /></Field>
                  </div>

                  <div className="border border-amber/35 bg-amber/[0.035] p-4">
                    <p className="text-[10px] font-semibold tracking-[0.13em] text-amber uppercase">Explicit operator attestation</p>
                    <p className="mt-2 text-[10px] leading-relaxed text-ink-dim">Write a specific attestation. Confirm only facts you have personally checked: the route is truthful, the required disclosure and age-gating are recorded, and the CTAs do not misrepresent a provider, brand, or creator.</p>
                    <div className="mt-3"><Field label="Your attestation statement"><textarea required name="operatorAttestationStatement" rows={3} className={inputClass} placeholder="I confirm that …" /></Field></div>
                    <label className="mt-3 flex items-start gap-2 text-[10px] leading-relaxed text-ink"><input required name="operatorAttestationConfirmed" type="checkbox" className="mt-0.5 accent-signal" /><span>I explicitly confirm this attestation and understand that this only saves a governed draft.</span></label>
                  </div>
                  <div className="flex flex-wrap gap-2"><SubmitButton disabled={isBusy}>Save funnel draft</SubmitButton><button type="button" disabled={isBusy} onClick={() => setFunnelDraftOpen(false)} className="border border-line-2 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-dim disabled:opacity-50">Cancel</button></div>
                </form>
              ) : <p className="text-[11px] leading-relaxed text-amber">Save a truthful, governed destination for this creator before mapping a funnel. The funnel itself never creates a public route or provider resource.</p>}
            </Panel>
          )}
          {activeCreatorFunnels.length > 0 && (
            <Panel eyebrow="Manual aggregate observation" title="Record a verified funnel outcome">
              <p className="text-[11px] leading-relaxed text-ink-dim">Use figures copied from an authorised analytics or finance surface. Record aggregates only; do not enter visitor identities, messages, payment details, tracking IDs, or provider credentials.</p>
              <form onSubmit={submitFunnelEvent} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="creatorId" value={activePersona?.id ?? ""} />
                <Field label="Active funnel"><select required name="funnelId" value={activeFunnel?.id ?? ""} onChange={(event) => setSelectedFunnelId(event.target.value || undefined)} className={inputClass}>{activeCreatorFunnels.map((funnel) => <option key={funnel.id} value={funnel.id}>{funnel.campaignLabel} · v{funnel.version}</option>)}</select></Field>
                <Field label="Observed at"><input required name="occurredAt" type="datetime-local" defaultValue={defaultFunnelEventOccurredAt} className={inputClass} /></Field>
                <Field label="Event type"><select required name="eventType" defaultValue="link_click" className={inputClass}><option value="link_click">Link clicks</option><option value="lead">Leads</option><option value="brand_inquiry">Brand inquiries</option><option value="signup">Signups</option><option value="subscription">Subscriptions</option><option value="revenue_observed">Revenue observation</option><option value="other">Other aggregate event</option></select></Field>
                <Field label="Aggregate count"><input required name="count" type="number" min="1" step="1" defaultValue="1" className={inputClass} /></Field>
                <Field label="Content item (optional)"><select name="contentId" defaultValue="" className={inputClass}><option value="">Not tied to one post</option>{workspace.content.filter((content) => content.creatorId === activePersona?.id).map((content) => <option key={content.id} value={content.id}>{content.title}</option>)}</select></Field>
                <Field label="Observed revenue (minor units, optional)"><input name="revenueMinor" type="number" min="0" step="1" className={inputClass} placeholder="e.g. 1299" /></Field>
                <Field label="Revenue currency (optional)"><input name="currency" maxLength={3} className={inputClass} placeholder="USD" /></Field>
                <div className="sm:col-span-2"><Field label="Operator note (optional, non-sensitive)"><textarea name="note" rows={2} className={inputClass} placeholder="Short evidence context; do not include personal data, messages, payment details, or links." /></Field></div>
                <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Record aggregate observation</SubmitButton></div>
              </form>
            </Panel>
          )}
          {funnelPauseTarget && (
            <Panel eyebrow="Pause governed route" title={`Pause ${funnelPauseTarget.campaignLabel}`}>
              <p className="text-[11px] leading-relaxed text-ink-dim">Pausing stops this funnel from being used for new planned content. It does not publish, unpublish, contact anyone, or change a provider-side resource.</p>
              <form onSubmit={submitFunnelPause} className="mt-4 space-y-3"><Field label="Reason"><textarea required name="reason" rows={3} className={inputClass} placeholder="Why should this route stop being used?" /></Field><div className="flex flex-wrap gap-2"><button type="submit" disabled={isBusy} className="border border-onair/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-onair hover:bg-onair hover:text-void disabled:opacity-50">Pause funnel</button><button type="button" disabled={isBusy} onClick={() => setFunnelPauseTarget(null)} className="border border-line-2 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-dim disabled:opacity-50">Cancel</button></div></form>
            </Panel>
          )}
        </>
      ) : (
        <section className="border border-line bg-panel px-5 py-10 text-center">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-signal uppercase">Creator promotion</p>
          <h1 className="display mt-2 text-2xl font-extrabold text-ink">Operator workspace is waiting for its connection</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-ink-dim">The workspace remains private and fails closed when its Media Engine service credential is absent. Provider configuration below explains the separate official OAuth prerequisites.</p>
          <button type="button" disabled={isBusy} onClick={() => { void reload(); }} className="mt-5 border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal hover:bg-signal hover:text-void disabled:opacity-50">Retry workspace</button>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <ProviderReadiness health={health?.meta_instagram} />
        <ProviderReadiness health={health?.fanvue} />
        <ProviderReadiness health={health?.postiz} />
        <RendererReadiness health={renderHealth?.novita} />
        <RendererReadiness health={renderHealth?.ltx} />
        <RendererReadiness health={renderHealth?.fal_z_image_turbo_lora} />
      </section>

      {workspace && (
        <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-5">
            <Panel eyebrow="Creator onboarding" title="Create a persona with a usable creative bible">
              <form onSubmit={submitProfile} className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><input required name="name" className={inputClass} placeholder="Creator name" /></Field>
                <Field label="Handle"><input required name="handle" className={inputClass} placeholder="@creator_handle" /></Field>
                <Field label="Archetype"><select name="archetype" defaultValue="lifestyle" className={inputClass}><option value="lifestyle">Lifestyle</option><option value="flagship">Flagship</option><option value="creator">Creator</option><option value="faceless">Faceless</option></select></Field>
                <Field label="Timezone"><input required name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"} className={inputClass} /></Field>
                <div className="sm:col-span-2"><Field label="Identity summary"><textarea required name="identitySummary" className={inputClass} rows={2} placeholder="Who the character is publicly and what makes them credible." /></Field></div>
                <div className="sm:col-span-2"><Field label="Emotional backstory"><textarea name="emotionalBackstory" className={inputClass} rows={2} placeholder="Private story that informs motivation and voice; not automatically published." /></Field></div>
                <Field label="Voice guide"><input name="voiceGuide" className={inputClass} placeholder="Warm, observant, concise…" /></Field>
                <Field label="Audience"><input name="audience" className={inputClass} placeholder="Who this creator is for" /></Field>
                <div className="sm:col-span-2"><Field label="Content pillars (comma separated)"><input name="contentPillars" className={inputClass} placeholder="Street style, routines, travel" /></Field></div>
                <div className="sm:col-span-2"><Field label="Content boundaries (comma separated)"><input name="boundaries" className={inputClass} placeholder="No false claims, no undisclosed ads, no adult public content" /></Field></div>
                <div className="sm:col-span-2"><Field label="Versioned visual prompt lock"><textarea required name="promptLock" className={inputClass} rows={3} placeholder="Stable character identity, camera language, wardrobe, lighting, negative constraints…" /></Field></div>
                <Field label="Prompt style"><input name="promptStyle" className={inputClass} placeholder="Editorial daylight photography…" /></Field>
                <Field label="Primary goal"><select name="primaryGoal" defaultValue="audience_growth" className={inputClass}><option value="audience_growth">Audience growth</option><option value="brand_partnerships">Brand partnerships</option><option value="fanvue_conversion">Fanvue conversion</option></select></Field>
                <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Save persona bible</SubmitButton></div>
              </form>
            </Panel>

            {activePersona && (
              <Panel eyebrow="Persona revision" title={`Revise ${activePersona.name}'s creative bible`}>
                <p className="text-[11px] leading-relaxed text-ink-dim">Changes apply to future plans only. Existing approved content keeps its immutable prompt and reference snapshot; changing the visual system advances its version.</p>
                <form key={activePersona.id} onSubmit={submitProfileRevision} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="creatorId" value={activePersona.id} />
                  <Field label="Lifecycle stage"><select required name="stage" defaultValue={activePersona.lifecycleStage ?? "setup"} className={inputClass}><option value="setup">Setup</option><option value="growth">Growth</option><option value="brand_ready">Brand-ready</option><option value="monetized">Monetized</option><option value="paused">Paused</option></select></Field>
                  <Field label="Timezone"><input required name="timezone" defaultValue={activePersona.timezone ?? "UTC"} className={inputClass} /></Field>
                  <div className="sm:col-span-2"><Field label="Identity summary"><textarea name="identitySummary" defaultValue={activePersona.identity?.identitySummary ?? ""} className={inputClass} rows={2} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Emotional backstory"><textarea name="emotionalBackstory" defaultValue={activePersona.identity?.emotionalBackstory ?? ""} className={inputClass} rows={2} /></Field></div>
                  <Field label="Voice guide"><input name="voiceGuide" defaultValue={activePersona.identity?.voiceGuide ?? ""} className={inputClass} /></Field>
                  <Field label="Audience"><input name="audience" defaultValue={activePersona.identity?.audience ?? ""} className={inputClass} /></Field>
                  <div className="sm:col-span-2"><Field label="Content pillars (comma separated)"><input name="contentPillars" defaultValue={(activePersona.identity?.contentPillars ?? []).join(", ")} className={inputClass} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Content boundaries (comma separated)"><input name="boundaries" defaultValue={(activePersona.identity?.boundaries ?? []).join(", ")} className={inputClass} /></Field></div>
                  <div className="sm:col-span-2"><Field label="Versioned visual prompt lock"><textarea required name="promptLock" defaultValue={activePersona.visualSystem?.promptLock ?? ""} className={inputClass} rows={3} /></Field></div>
                  <Field label="Prompt style"><input name="promptStyle" defaultValue={activePersona.visualSystem?.promptStyle ?? ""} className={inputClass} /></Field>
                  <Field label="LoRA trigger"><input name="loraTrigger" defaultValue={activePersona.visualSystem?.loraTrigger ?? ""} className={inputClass} /></Field>
                  <div className="sm:col-span-2"><Field label="Reference notes"><input name="referenceNotes" defaultValue={activePersona.visualSystem?.referenceNotes ?? ""} className={inputClass} /></Field></div>
                  <Field label="Primary goal"><select required name="primaryGoal" defaultValue={activePersona.primaryGoal ?? "audience_growth"} className={inputClass}><option value="audience_growth">Audience growth</option><option value="brand_partnerships">Brand partnerships</option><option value="fanvue_conversion">Fanvue conversion</option></select></Field>
                  <Field label="Inbox policy"><select required name="inboxPolicy" defaultValue={activePersona.inboxPolicy ?? "draft_only"} className={inputClass}><option value="draft_only">Draft only</option><option value="human_handoff">Human handoff</option></select></Field>
                  <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Save persona revision</SubmitButton></div>
                </form>
              </Panel>
            )}

            <Panel eyebrow="Owned account registry" title="Register an existing, authorised account">
              <form onSubmit={submitAccount} className="grid gap-3 sm:grid-cols-2">
                <Field label="Creator"><select required name="creatorId" defaultValue={activePersona?.id ?? ""} className={inputClass}><option value="" disabled>Select creator</option>{workspace.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {persona.handle}</option>)}</select></Field>
                <Field label="Platform"><select name="platform" defaultValue="instagram" className={inputClass}><option value="instagram">Instagram</option><option value="fanvue">Fanvue</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="other">Other / manual</option></select></Field>
                <Field label="Account handle"><input required name="handle" className={inputClass} placeholder="@owned_account" /></Field>
                <Field label="Display name"><input name="displayName" className={inputClass} placeholder="Optional label" /></Field>
                <Field label="Ownership"><select name="ownershipStatus" defaultValue="attested_owned" className={inputClass}><option value="attested_owned">I attest it is owned</option><option value="client_authorized">Client-authorised</option></select></Field>
                <Field label="Daily planned post limit"><input required name="dailyPostLimit" type="number" min="1" max="8" defaultValue="1" className={inputClass} /></Field>
                <Field label="Weekly editorial target (optional)"><input name="weeklyTarget" type="number" min="1" max="56" className={inputClass} placeholder="e.g. 5" /></Field>
                <Field label="Maximum gap between posts (optional)"><input name="maxGapDays" type="number" min="1" max="31" className={inputClass} placeholder="e.g. 3 days" /></Field>
                <div className="sm:col-span-2 border border-line bg-panel-2/35 p-3">
                  <p className="text-[9px] font-semibold tracking-[0.12em] text-ink-faint uppercase">Optional weekly content mix</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">These are planning targets used by the calendar to flag an unbalanced week. They do not authorise publishing.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <Field label="Images"><input name="formatTargetImage" type="number" min="0" max="56" className={inputClass} placeholder="0" /></Field>
                    <Field label="Carousels"><input name="formatTargetCarousel" type="number" min="0" max="56" className={inputClass} placeholder="0" /></Field>
                    <Field label="Reels"><input name="formatTargetReel" type="number" min="0" max="56" className={inputClass} placeholder="0" /></Field>
                    <Field label="Stories"><input name="formatTargetStory" type="number" min="0" max="56" className={inputClass} placeholder="0" /></Field>
                    <Field label="Shorts"><input name="formatTargetShort" type="number" min="0" max="56" className={inputClass} placeholder="0" /></Field>
                    <Field label="Text posts"><input name="formatTargetText" type="number" min="0" max="56" className={inputClass} placeholder="0" /></Field>
                  </div>
                </div>
                <div className="sm:col-span-2"><Field label="Operator notes"><input name="notes" className={inputClass} placeholder="No passwords, access tokens, OTPs, or proxy details." /></Field></div>
                <div className="sm:col-span-2"><p className="text-[10px] leading-relaxed text-ink-faint">This creates a metadata record only. Account signup, OTP verification, device farms, passwords, proxies, and browser automation are intentionally not part of Media Engine.</p></div>
                <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Register account record</SubmitButton></div>
              </form>
              <CreatorPostizChannelPicker
                creators={workspace.personas.map((persona) => ({ id: persona.id, name: persona.name, handle: persona.handle }))}
                initialCreatorId={activePersona?.id}
                channels={postizChannels}
                refreshing={postizChannelsRefreshing}
                busy={Boolean(isBusy)}
                onRefresh={() => { void refreshPostizChannels(); }}
                onMap={(channel) => runAction("link-postiz-integration", channel)}
              />
            </Panel>

            <CreatorReferenceImageLibrary
              assets={activeReferenceAssets}
              selectedAssetIds={selectedReferenceAssetIds}
              onSelectionChange={setSelectedReferenceAssetIds}
              onRequestUpload={() => {
                if (!activePersona) setError("Select a creator before uploading a reference image.");
                else setReferenceUploadOpen((open) => !open);
              }}
            />
            {referenceUploadOpen && (
              <Panel eyebrow="Rights-cleared upload" title={`Add a reference for ${activePersona?.name ?? "this creator"}`}>
                <form onSubmit={submitReferenceUpload} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Image file"><input required name="file" type="file" accept="image/jpeg,image/png,image/webp" className={inputClass} /></Field>
                  <Field label="Reference label"><input required name="displayName" className={inputClass} placeholder="e.g. consented portrait, summer wardrobe" /></Field>
                  <Field label="Rights basis"><select name="rightsStatus" defaultValue="consented" className={inputClass}><option value="owned">Creator-owned</option><option value="consented">Consent verified</option><option value="licensed">Licensed</option></select></Field>
                  <Field label="How this image may guide generation"><select name="useType" defaultValue="style" className={inputClass}><option value="style">Style direction</option><option value="wardrobe">Wardrobe</option><option value="location">Location</option><option value="product">Product</option><option value="composition">Composition</option><option value="creator_likeness">Creator likeness (only owned/consented)</option></select></Field>
                  <Field label="Consent / release reference"><input name="consentRecordReference" className={inputClass} placeholder="Internal release or consent record ID" /></Field>
                  <Field label="License reference (required if licensed)"><input name="licenseReference" className={inputClass} placeholder="License ID or internal record" /></Field>
                  <div className="sm:col-span-2"><p className="text-[10px] leading-relaxed text-amber">By saving, you attest that this image is creator-owned, properly licensed, or explicitly consented. Do not upload scraped public-profile images or unconsented likeness material.</p></div>
                  <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Upload and register reference</SubmitButton></div>
                </form>
              </Panel>
            )}
          </div>

          <div className="space-y-5">
            <Panel eyebrow="Fanvue funnel" title="Official OAuth / KYC readiness">
              <p className="text-[11px] leading-relaxed text-ink-dim">Fanvue is the supported subscription destination because it has an official API. The default intent is deliberately read-only; use the destination panel to request a narrower purpose when inbox or post workflows are actually needed. Recording an intent does not open OAuth, create a creator account, or grant a permission—creator KYC and provider onboarding still happen outside this desk.</p>
              <button type="button" disabled={isBusy || !activePersona} onClick={() => { void requestFanvueReadiness(); }} className="mt-4 border border-amber/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-amber transition hover:bg-amber hover:text-void disabled:opacity-50">Record read-only Fanvue intent</button>
              {activePersona && [...workspace.destinations, ...workspace.partnerDestinations].some((destination) => destination.creatorId === activePersona.id) && <div className="mt-5 border-t border-line pt-5"><Field label="Funnel destination used by the next AI plan"><select value={activeDestination?.id ?? ""} onChange={(event) => setSelectedDestinationId(event.target.value || undefined)} className={inputClass}>{[...workspace.destinations, ...workspace.partnerDestinations].filter((destination) => destination.creatorId === activePersona.id).map((destination) => <option key={destination.id} value={destination.id}>{destination.label} · {title(destination.connectionStatus)}</option>)}</select></Field><p className="mt-2 text-[10px] leading-relaxed text-ink-faint">The calendar attaches this destination as governed metadata. Subscription CTAs require official OAuth, KYC, disclosure, and age-gate checks; brand and partner routes must remain truthful and approved.</p></div>}
              <form onSubmit={submitDestination} className="mt-5 grid gap-3 border-t border-line pt-5">
                <input type="hidden" name="kind" value="fanvue" />
                <Field label="Creator"><select required name="creatorId" defaultValue={activePersona?.id ?? ""} className={inputClass}><option value="" disabled>Select creator</option>{workspace.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}</select></Field>
                <Field label="Destination label"><input required name="label" className={inputClass} placeholder="Fanvue profile / tracking link" /></Field>
                <Field label="HTTPS destination URL"><input required type="url" name="url" className={inputClass} placeholder="https://…" /></Field>
                <Field label="Disclosure and age-gate copy"><textarea required name="disclosureText" rows={3} className={inputClass} placeholder="Truthful AI-assistance and 18+ disclosure shown before conversion." /></Field>
                <SubmitButton disabled={isBusy}>Save Fanvue destination</SubmitButton>
              </form>
            </Panel>

            <Panel eyebrow="Brand pathway" title="Create a truthful brand or partner destination">
              <p className="text-[11px] leading-relaxed text-ink-dim">This is the public path for lifestyle creators seeking genuine brand inquiries, partnerships, or a portfolio route. It creates a governed destination record only—never automated outreach, fake endorsements, or a contract claim.</p>
              <form onSubmit={submitDestination} className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Creator"><select required name="creatorId" defaultValue={activePersona?.id ?? ""} className={inputClass}><option value="" disabled>Select creator</option>{workspace.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {persona.handle}</option>)}</select></Field>
                <Field label="Destination type"><select required name="kind" defaultValue="brand_inquiry" className={inputClass}><option value="brand_inquiry">Brand inquiry</option><option value="link_in_bio">Link in bio</option><option value="website">Website / portfolio</option><option value="other">Other reviewed route</option></select></Field>
                <Field label="Destination label"><input required name="label" className={inputClass} placeholder="Creator media kit / brand inquiry" /></Field>
                <Field label="HTTPS destination URL"><input required type="url" name="url" className={inputClass} placeholder="https://…" /></Field>
                <div className="sm:col-span-2"><Field label="Commercial disclosure / route note"><textarea required name="disclosureText" rows={3} className={inputClass} placeholder="Truthful statement of the creator’s offering, sponsorship disclosure, and intended inquiry route." /></Field></div>
                <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Save partner destination</SubmitButton></div>
              </form>
            </Panel>

            <Panel eyebrow="Performance input" title="Record verified provider metrics">
              <p className="text-[11px] leading-relaxed text-ink-dim">Copy actual figures from an authorised provider analytics surface. Do not estimate reach, clicks, subscribers, or revenue. These observations inform future planning without pretending that a provider connection exists.</p>
              <form onSubmit={submitAttribution} className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Creator"><select required name="creatorId" defaultValue={activePersona?.id ?? ""} className={inputClass}><option value="" disabled>Select creator</option>{workspace.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {persona.handle}</option>)}</select></Field>
                <Field label="Captured at"><input required name="capturedAt" type="datetime-local" defaultValue={defaultAttributionCapturedAt} className={inputClass} /></Field>
                <Field label="Account (optional)"><select name="accountId" defaultValue="" className={inputClass}><option value="">Creator-level metric</option>{workspace.accounts.filter((account) => account.creatorId === activePersona?.id).map((account) => <option key={account.id} value={account.id}>{title(account.platform)} · {account.handle}</option>)}</select></Field>
                <Field label="Content item (optional)"><select name="contentId" defaultValue="" className={inputClass}><option value="">Not specific to a post</option>{workspace.content.filter((item) => item.creatorId === activePersona?.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
                <Field label="Destination (optional)"><select name="destinationId" defaultValue="" className={inputClass}><option value="">Not specific to a destination</option>{[...workspace.destinations, ...workspace.partnerDestinations].filter((destination) => destination.creatorId === activePersona?.id).map((destination) => <option key={destination.id} value={destination.id}>{destination.label}</option>)}</select></Field>
                <Field label="Impressions"><input name="impressions" type="number" min="0" step="1" className={inputClass} placeholder="0" /></Field>
                <Field label="Reach"><input name="reach" type="number" min="0" step="1" className={inputClass} placeholder="0" /></Field>
                <Field label="Link clicks"><input name="linkClicks" type="number" min="0" step="1" className={inputClass} placeholder="0" /></Field>
                <Field label="Followers gained"><input name="followers" type="number" min="0" step="1" className={inputClass} placeholder="0" /></Field>
                <Field label="Subscribers gained"><input name="subscribers" type="number" min="0" step="1" className={inputClass} placeholder="0" /></Field>
                <Field label="Gross revenue (minor units)"><input name="grossRevenueMinor" type="number" min="0" step="1" className={inputClass} placeholder="e.g. 1299" /></Field>
                <Field label="Currency for revenue"><input name="currency" maxLength={3} className={inputClass} placeholder="USD" /></Field>
                <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Record verified observation</SubmitButton></div>
              </form>
            </Panel>

            <Panel eyebrow="Inbox intake" title="Log a permitted inbound summary">
              <p className="text-[11px] leading-relaxed text-ink-dim">Use this when an operator has reviewed an inbound conversation in an authorised provider inbox but a webhook is not connected yet. Store a short, non-sensitive summary only—not raw messages, contact details, or media. The assistant can draft a reply after this record is created; it cannot send one.</p>
              <form onSubmit={submitInboxIntake} className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Creator"><select required name="creatorId" defaultValue={activePersona?.id ?? ""} className={inputClass}><option value="" disabled>Select creator</option>{workspace.personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {persona.handle}</option>)}</select></Field>
                <Field label="Linked account (optional)"><select name="accountId" defaultValue="" className={inputClass}><option value="">No linked account</option>{workspace.accounts.filter((account) => account.creatorId === activePersona?.id).map((account) => <option key={account.id} value={account.id}>{title(account.platform)} · {account.handle}</option>)}</select></Field>
                <Field label="Inbox platform"><select name="platform" defaultValue="instagram" className={inputClass}><option value="instagram">Instagram</option><option value="fanvue">Fanvue</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="other">Other / manual</option></select></Field>
                <Field label="Conversation intent"><select name="intent" defaultValue="general" className={inputClass}><option value="general">General question</option><option value="brand_inquiry">Brand inquiry</option><option value="support">Support</option><option value="fanvue_interest">Fanvue interest</option><option value="safety_review">Safety review</option><option value="other">Other / needs review</option></select></Field>
                <Field label="Participant label (optional)"><input name="participantLabel" className={inputClass} placeholder="Use a minimal label; avoid contact details" /></Field>
                <Field label="Review deadline (optional)"><input name="responseWindowEndsAt" type="datetime-local" className={inputClass} /></Field>
                <div className="sm:col-span-2"><Field label="Conversation summary"><textarea required name="summary" rows={3} className={inputClass} placeholder="Briefly describe the request, any relevant context, and what an operator needs to decide." /></Field></div>
                <div className="sm:col-span-2"><Field label="Safety flags (comma separated)"><input name="safetyFlags" className={inputClass} placeholder="e.g. commercial claim, unclear age, payment question" /></Field></div>
                <label className="sm:col-span-2 flex items-start gap-2 text-[10px] leading-relaxed text-ink-dim"><input name="requiresDisclosure" type="checkbox" defaultChecked className="mt-0.5 accent-signal" /><span>Require a plain AI-assistance disclosure in any proposed reply.</span></label>
                <div className="sm:col-span-2"><SubmitButton disabled={isBusy}>Record inbound summary</SubmitButton></div>
              </form>
            </Panel>

            <Panel eyebrow="Selected calendar item" title={activeContent ? activeContent.title : "Choose a planned post"}>
              {activeContent ? (
                <div className="space-y-4">
                  <p className="text-[11px] leading-relaxed text-ink-dim">{activeContent.whyNow ?? "No editorial rationale recorded."}</p>
                  <form key={activeContent.id} onSubmit={submitSchedule} className="flex flex-wrap items-end gap-2">
                    <Field label="Reschedule (browser timezone)"><input required type="datetime-local" name="scheduledAt" defaultValue={localDateTime(activeContent.scheduledAt)} className={inputClass} /></Field>
                    <button type="submit" disabled={isBusy || activeContent.approvalStatus !== "not_requested"} className="border border-line-2 px-3 py-2 text-[10px] font-semibold tracking-wide text-ink-dim hover:border-scope hover:text-scope disabled:cursor-not-allowed disabled:opacity-50">Reschedule</button>
                  </form>
                  <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                    {activeContent.approvalStatus === "not_requested" && <button type="button" disabled={isBusy} onClick={() => { void runAction("submit-content-review", { contentId: activeContent.id }); }} className="border border-amber/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-amber hover:bg-amber hover:text-void disabled:opacity-50">Request approval</button>}
                    {activeContent.approvalStatus === "pending" && <><button type="button" disabled={isBusy} onClick={() => { void runAction("approve-content-plan", { contentId: activeContent.id }); }} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal hover:bg-signal hover:text-void disabled:opacity-50">Approve plan</button><button type="button" disabled={isBusy} onClick={() => { void runAction("reject-content-plan", { contentId: activeContent.id, reason: "Creative revision required before render or publication." }); }} className="border border-onair/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-onair hover:bg-onair hover:text-void disabled:opacity-50">Reject for revision</button></>}
                    {activeContent.approvalStatus === "approved" && <p className="text-[10px] leading-relaxed text-signal">Plan approved. Select a reviewed render, then request a separate Meta publish approval when the assigned official account is eligible. A calendar time never dispatches it.</p>}
                    {activeContent.approvalStatus === "rejected" && <p className="text-[10px] leading-relaxed text-onair">Rejected plan is retained as an auditable decision; make a revised calendar entry rather than silently mutating it.</p>}
                  </div>
                </div>
              ) : <p className="text-[11px] leading-relaxed text-ink-faint">Generate or select a scheduled content item to review its publishing controls.</p>}
            </Panel>
            <CreatorMetaInstagramPublishPanel
              content={activeContent}
              account={activeContentAccount}
              now={workspace?.fetchedAt}
              canDispatchApprovedActions={Boolean(health?.meta_instagram?.canDispatchApprovedActions)}
              busy={isBusy}
              onRequestApproval={(contentId) => { void runAction("request-meta-instagram-publish", { contentId }); }}
              onApprove={(contentId) => { void runAction("approve-meta-instagram-publish", { contentId }); }}
              onDispatch={(contentId) => { void runAction("dispatch-meta-instagram-publish", { contentId }); }}
            />
            <CreatorPostizSchedulePanel
              content={activeContent}
              account={activeContentAccount}
              now={workspace?.fetchedAt}
              canDispatchApprovedActions={Boolean(health?.postiz?.canDispatchApprovedActions)}
              busy={isBusy}
              onRequestApproval={(contentId, postizSettings) => { void runAction("request-postiz-schedule", { contentId, postizSettings }); }}
              onApprove={(contentId) => { void runAction("approve-postiz-schedule", { contentId }); }}
              onDispatch={(contentId) => { void runAction("queue-postiz-schedule", { contentId }); }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
