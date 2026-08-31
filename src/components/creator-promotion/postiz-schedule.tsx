"use client";

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
  CreatorContentItem,
  CreatorPostizSettings,
  CreatorPostizSchedule,
  CreatorPostizScheduleStatus,
  CreatorSocialAccount,
} from "./types";
import { EmptyState, SectionHeading, StatusPill, classNames, displayLabel, displayTime, toDate } from "./shared";

type ScheduleTone = "signal" | "scope" | "amber" | "onair" | "muted";

function scheduleTone(status: CreatorPostizScheduleStatus): ScheduleTone {
  if (status === "scheduled") return "signal";
  if (status === "approved" || status === "queued" || status === "running") return "scope";
  if (status === "pending_approval") return "amber";
  if (status === "failed" || status === "blocked") return "onair";
  return "muted";
}

function scheduleLabel(status: CreatorPostizScheduleStatus): string {
  if (status === "pending_approval") return "Awaiting schedule approval";
  if (status === "approved") return "Schedule approved";
  if (status === "queued") return "Queued for Postiz handoff";
  if (status === "running") return "Postiz handoff running";
  if (status === "scheduled") return "Scheduled in Postiz / awaiting network delivery";
  if (status === "failed") return "Postiz schedule failed";
  if (status === "blocked") return "Manual reconciliation required";
  return "No Postiz schedule request";
}

function fallbackScheduleState(content: CreatorContentItem): CreatorPostizSchedule {
  if (content.postizSchedule) return content.postizSchedule;
  // A calendar entry is not proof that Postiz has received this exact render.
  return { status: "not_requested" };
}

function safeFailure(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted URL]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 1_200) || undefined;
}

function safeIdentifier(value?: string): string | undefined {
  if (!value || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return undefined;
  return value.length <= 12 ? value : `${value.slice(0, 5)}…${value.slice(-4)}`;
}

function LifecycleTime({ label, value }: { label: string; value?: number | string }) {
  if (!value) return null;
  return <span>{label} {displayTime(value)}</span>;
}

function ExplicitPostizHandoff({
  contentId,
  status,
  busy,
  onDispatch,
}: {
  contentId: string;
  status: CreatorPostizScheduleStatus;
  busy: boolean;
  onDispatch: (contentId: string) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex max-w-xl items-start gap-2 text-[10px] leading-relaxed text-ink-dim">
        <input checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} type="checkbox" className="mt-0.5 accent-signal" />
        <span>I checked the selected render and future calendar time, and attest that this is the known channel authorised in Postiz. Send this approved schedule to Postiz.</span>
      </label>
      <button type="button" disabled={busy || !confirmed} onClick={() => { setConfirmed(false); onDispatch(contentId); }} className="border border-signal/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-signal transition hover:bg-signal hover:text-void disabled:opacity-50">
        {status === "queued" ? "Retry Postiz handoff" : "Send schedule to Postiz"}
      </button>
    </div>
  );
}

const POSTIZ_SCHEDULE_PLATFORMS = ["instagram", "tiktok", "x", "facebook", "threads", "pinterest", "youtube", "linkedin", "bluesky"] as const;
type PostizSchedulePlatform = (typeof POSTIZ_SCHEDULE_PLATFORMS)[number];

function postizSchedulePlatform(value?: CreatorSocialAccount["platform"]): PostizSchedulePlatform | undefined {
  return POSTIZ_SCHEDULE_PLATFORMS.includes(value as PostizSchedulePlatform) ? value as PostizSchedulePlatform : undefined;
}

function requiredChoice(form: FormData, name: string, label: string): string {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} needs an explicit selection.`);
  return value;
}

function choice<T extends readonly string[]>(form: FormData, name: string, label: string, options: T): T[number] {
  const value = requiredChoice(form, name, label);
  if (!(options as readonly string[]).includes(value)) throw new Error(`${label} is invalid.`);
  return value as T[number];
}

function explicitBoolean(form: FormData, name: string, label: string): boolean {
  return choice(form, name, label, ["true", "false"] as const) === "true";
}

function postizSettingsFromForm(platform: PostizSchedulePlatform, form: FormData): CreatorPostizSettings {
  if (form.get("postizSettingsConfirmed") !== "on") {
    throw new Error("Confirm the per-schedule delivery policy before requesting approval.");
  }
  switch (platform) {
    case "instagram":
      return {
        __type: choice(form, "instagramSubtype", "Instagram connection type", ["instagram", "instagram-standalone"] as const),
      };
    case "x":
      return {
        __type: "x",
        replyAudience: choice(form, "replyAudience", "X reply audience", ["everyone", "following", "mentionedUsers", "subscribers", "verified"] as const),
        madeWithAi: explicitBoolean(form, "madeWithAi", "X AI disclosure"),
        paidPartnership: explicitBoolean(form, "paidPartnership", "X paid-partnership disclosure"),
      };
    case "tiktok":
      return {
        __type: "tiktok",
        privacyLevel: choice(form, "privacyLevel", "TikTok visibility", ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const),
        duet: explicitBoolean(form, "duet", "TikTok Duet setting"),
        stitch: explicitBoolean(form, "stitch", "TikTok Stitch setting"),
        comments: explicitBoolean(form, "comments", "TikTok comments setting"),
        autoAddMusic: choice(form, "autoAddMusic", "TikTok auto-add music", ["yes", "no"] as const),
        brandContent: explicitBoolean(form, "brandContent", "TikTok brand-content disclosure"),
        brandOrganic: explicitBoolean(form, "brandOrganic", "TikTok brand-organic disclosure"),
        contentPostingMethod: choice(form, "contentPostingMethod", "TikTok delivery method", ["DIRECT_POST"] as const),
        videoMadeWithAi: explicitBoolean(form, "videoMadeWithAi", "TikTok AI-video disclosure"),
      };
    case "youtube":
      return {
        __type: "youtube",
        visibility: choice(form, "visibility", "YouTube visibility", ["public", "unlisted", "private"] as const),
        madeForKids: choice(form, "madeForKids", "YouTube made-for-kids setting", ["yes", "no"] as const),
      };
    case "pinterest":
      return { __type: "pinterest", board: requiredChoice(form, "board", "Pinterest board").slice(0, 300) };
    case "facebook":
    case "threads":
    case "linkedin":
    case "bluesky":
      return { __type: platform };
  }
}

const policyInputClass = "mt-1 w-full border border-line-2 bg-panel-2 px-2 py-2 text-[10px] text-ink-dim outline-none focus:border-scope";

function PolicySelect({ label, name, hint, children }: { label: string; name: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold tracking-wide text-ink-dim">
      <span>{label}</span>
      <select required name={name} defaultValue="" className={policyInputClass}>
        <option value="" disabled>Choose explicitly</option>
        {children}
      </select>
      {hint && <span className="mt-1 block text-[9px] font-normal leading-relaxed text-ink-faint">{hint}</span>}
    </label>
  );
}

function PolicyBooleanSelect({ label, name, hint, conservativeNo = false }: { label: string; name: string; hint?: string; conservativeNo?: boolean }) {
  return (
    <PolicySelect label={label} name={name} hint={hint}>
      <option value="false">No{conservativeNo ? " — conservative" : ""}</option>
      <option value="true">Yes</option>
    </PolicySelect>
  );
}

function postizSettingsSummary(settings?: CreatorPostizSettings): string | undefined {
  if (!settings) return undefined;
  if (settings.__type === "x") return `X · replies ${settings.replyAudience}; AI ${settings.madeWithAi ? "disclosed" : "not disclosed"}; partnership ${settings.paidPartnership ? "declared" : "not declared"}`;
  if (settings.__type === "tiktok") return `TikTok · ${settings.privacyLevel.replace(/_/g, " ").toLowerCase()}; direct post; interactions explicitly set`;
  if (settings.__type === "youtube") return `YouTube · ${settings.visibility}; made for kids ${settings.madeForKids}`;
  if (settings.__type === "pinterest") return "Pinterest · board selected";
  if (settings.__type === "instagram" || settings.__type === "instagram-standalone") return `Instagram · ${settings.__type === "instagram" ? "standard" : "standalone"} connection`;
  if (settings.__type === "facebook") return "Facebook · policy confirmed";
  if (settings.__type === "threads") return "Threads · policy confirmed";
  if (settings.__type === "linkedin") return "LinkedIn · policy confirmed";
  return "Bluesky · policy confirmed";
}

function PostizPolicyRequest({
  contentId,
  format,
  platform,
  busy,
  onRequestApproval,
}: {
  contentId: string;
  format: CreatorContentItem["format"];
  platform: PostizSchedulePlatform;
  busy: boolean;
  onRequestApproval: (contentId: string, settings: CreatorPostizSettings) => void;
}) {
  const [policyError, setPolicyError] = useState<string>();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setPolicyError(undefined);
      onRequestApproval(contentId, postizSettingsFromForm(platform, new FormData(event.currentTarget)));
    } catch (error) {
      setPolicyError(error instanceof Error ? error.message : "The per-schedule policy is incomplete.");
    }
  };

  return (
    <form key={`${contentId}:${platform}`} onSubmit={submit} className="w-full border border-amber/45 bg-amber/[0.03] p-3">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-amber uppercase">Per-schedule Postiz policy</p>
      <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">No account-level default is inferred. These explicit choices are frozen into this one approval request and cannot be silently reused for another calendar item.</p>

      {platform === "instagram" && (
        <div className="mt-3 space-y-2">
          <PolicySelect label="Postiz Instagram connection type" name="instagramSubtype" hint="Choose the subtype that matches the already-authorised Postiz channel; this is not an OAuth step.">
            <option value="instagram">Instagram</option>
            <option value="instagram-standalone">Instagram standalone</option>
          </PolicySelect>
          <p className="border-l border-line-2 pl-2 text-[9px] leading-relaxed text-ink-faint">
            {format === "story"
              ? "This approved story maps to a Postiz Story."
              : format === "carousel"
                ? "Carousel needs a reviewed multi-asset Instagram route and is blocked here; a single selected render cannot be scheduled as a carousel."
                : `This approved ${displayLabel(format)} maps to a Postiz feed post.`}
          </p>
        </div>
      )}

      {platform === "x" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <PolicySelect label="Who can reply" name="replyAudience" hint="Select the audience deliberately for this post.">
            <option value="everyone">Everyone</option>
            <option value="following">Accounts followed</option>
            <option value="mentionedUsers">Mentioned users</option>
            <option value="subscribers">Subscribers</option>
            <option value="verified">Verified accounts</option>
          </PolicySelect>
          <PolicyBooleanSelect label="Made with AI" name="madeWithAi" hint="Record the disclosure decision." />
          <PolicyBooleanSelect label="Paid partnership" name="paidPartnership" hint="Record the commercial disclosure decision." />
        </div>
      )}

      {platform === "tiktok" && (
        <div className="mt-3 space-y-3">
          <p className="text-[9px] leading-relaxed text-ink-faint">Use the conservative choices if appropriate, but select each value yourself. This path only supports direct post; the linked TikTok channel must already be approved and audited for direct posting in Postiz.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <PolicySelect label="Visibility" name="privacyLevel" hint="Only me is the conservative choice.">
              <option value="SELF_ONLY">Only me — conservative</option>
              <option value="FOLLOWER_OF_CREATOR">Followers</option>
              <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
              <option value="PUBLIC_TO_EVERYONE">Everyone</option>
            </PolicySelect>
            <PolicySelect label="Posting method" name="contentPostingMethod" hint="Upload drafts are not a governed scheduled-publication path.">
              <option value="DIRECT_POST">Direct post to TikTok</option>
            </PolicySelect>
            <PolicySelect label="Auto-add music" name="autoAddMusic" hint="No is the conservative choice.">
              <option value="no">No — conservative</option>
              <option value="yes">Yes</option>
            </PolicySelect>
            <PolicyBooleanSelect label="Allow Duet" name="duet" conservativeNo />
            <PolicyBooleanSelect label="Allow Stitch" name="stitch" conservativeNo />
            <PolicyBooleanSelect label="Allow comments" name="comments" conservativeNo />
            <PolicyBooleanSelect label="Brand content disclosure" name="brandContent" />
            <PolicyBooleanSelect label="Brand organic disclosure" name="brandOrganic" />
            <PolicyBooleanSelect label="Video made with AI" name="videoMadeWithAi" />
          </div>
          <p className="text-[9px] leading-relaxed text-ink-faint">The approved content title is frozen separately. The worker still rejects a format or selected medium TikTok cannot accept.</p>
        </div>
      )}

      {platform === "youtube" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PolicySelect label="Visibility" name="visibility" hint="Private is the conservative choice.">
            <option value="private">Private — conservative</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </PolicySelect>
          <PolicySelect label="Made for kids" name="madeForKids" hint="This declaration is required for this scheduled item.">
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </PolicySelect>
          <p className="sm:col-span-2 text-[9px] leading-relaxed text-ink-faint">The approved content title is frozen separately. The worker rejects a non-video selected render or a missing title.</p>
        </div>
      )}

      {platform === "pinterest" && (
        <div className="mt-3">
          <label className="block text-[10px] font-semibold tracking-wide text-ink-dim">
            <span>Pinterest board</span>
            <input required name="board" maxLength={300} className={policyInputClass} placeholder="Exact already-authorised Postiz board" />
          </label>
          <p className="mt-1 text-[9px] leading-relaxed text-ink-faint">The board is frozen for this schedule; the title remains the approved content title.</p>
        </div>
      )}

      {(platform === "facebook" || platform === "threads" || platform === "linkedin" || platform === "bluesky") && (
        <p className="mt-3 text-[10px] leading-relaxed text-ink-dim">This channel has no additional per-schedule fields in the governed contract. The worker still verifies its mapped Postiz integration before it creates a schedule.</p>
      )}

      <label className="mt-4 flex items-start gap-2 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-dim">
        <input required name="postizSettingsConfirmed" type="checkbox" className="mt-0.5 accent-amber" />
        <span>I reviewed and explicitly selected this schedule’s delivery policy. I understand this requests approval only; it does not contact Postiz or publish on the social network.</span>
      </label>
      {policyError && <p className="mt-3 border-l border-onair/55 bg-onair/[0.04] px-3 py-2 text-[10px] leading-relaxed text-onair">{policyError}</p>}
      <button type="submit" disabled={busy} className="mt-3 border border-amber/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-amber transition hover:bg-amber hover:text-void disabled:opacity-50">Request schedule approval</button>
    </form>
  );
}

/**
 * Presentation-only control for an individually approved future Postiz
 * schedule. The parent owns the action callbacks; this component never calls
 * Postiz, starts an OAuth flow, or turns a calendar timer into a dispatcher.
 */
export function CreatorPostizSchedulePanel({
  content,
  account,
  now = 0,
  canDispatchApprovedActions = false,
  busy = false,
  onRequestApproval,
  onApprove,
  onDispatch,
  className,
}: {
  content?: CreatorContentItem;
  account?: CreatorSocialAccount;
  /** Snapshot time from the workspace read. Refreshing remains intentional. */
  now?: number;
  /** Server-projected configuration health only; it gates the handoff. */
  canDispatchApprovedActions?: boolean;
  busy?: boolean;
  onRequestApproval?: (contentId: string, postizSettings: CreatorPostizSettings) => void;
  onApprove?: (contentId: string) => void;
  onDispatch?: (contentId: string) => void;
  className?: string;
}) {
  const lifecycle = content ? fallbackScheduleState(content) : undefined;

  if (!content || !lifecycle) {
    return (
      <section className={classNames("border border-line bg-panel", className)} aria-label="Postiz scheduling">
        <SectionHeading eyebrow="Cross-platform scheduling" title="Postiz schedule" description="An optional self-hosted executor for a known operator-attested channel. Every future schedule needs its own approval and explicit handoff." />
        <EmptyState title="Choose a rendered calendar item" detail="This control is available only for an approved selected render, an operator-mapped Postiz account with schedule permission, and a future calendar time." />
      </section>
    );
  }

  const scheduledAt = toDate(content.scheduledAt);
  const hasWorkspaceClock = Number.isFinite(now) && now > 0;
  const isFutureSchedule = Boolean(scheduledAt && hasWorkspaceClock && scheduledAt.getTime() > now);
  const hasSelectedRender = Boolean(content.selectedRenderCandidateId && content.renderState === "ready" && content.previewMedia?.length);
  const editoriallyApproved = content.approvalStatus === "approved";
  const isPostizBound = account?.publisher === "postiz" && account.status === "connected" && Boolean(account.integrationConnectionId);
  const hasScheduleCapability = Boolean(account?.capabilities?.includes("schedule_content"));
  const platform = postizSchedulePlatform(account?.platform);
  const instagramCarousel = platform === "instagram" && content.format === "carousel";
  const eligibleForRequest = hasSelectedRender && editoriallyApproved && isPostizBound && hasScheduleCapability && isFutureSchedule && Boolean(platform) && !instagramCarousel;
  const canRequest = eligibleForRequest && lifecycle.status === "not_requested";
  const canApprove = eligibleForRequest && lifecycle.status === "pending_approval";
  const canDispatch = eligibleForRequest
    && canDispatchApprovedActions
    && (lifecycle.status === "approved" || lifecycle.status === "queued");
  const blockerMessages = [
    !content.selectedRenderCandidateId ? "Select one reviewed render candidate before requesting a Postiz schedule." : undefined,
    content.selectedRenderCandidateId && content.renderState !== "ready" ? "The selected render is not in a ready state." : undefined,
    content.selectedRenderCandidateId && content.renderState === "ready" && !content.previewMedia?.length ? "The selected render has no controlled preview media to hand off." : undefined,
    !editoriallyApproved ? "The immutable editorial plan must be approved before a schedule request can be created." : undefined,
    !account ? "Assign this content to a Postiz-bound account before scheduling it." : undefined,
    account && account.publisher !== "postiz" ? "The assigned account is not linked to Postiz." : undefined,
    account && account.publisher === "postiz" && account.status !== "connected" ? "The assigned Postiz account is not connected." : undefined,
    account && account.publisher === "postiz" && account.status === "connected" && !account.integrationConnectionId ? "The assigned Postiz account is missing its account-bound integration mapping." : undefined,
    isPostizBound && !hasScheduleCapability ? "The assigned Postiz account lacks the recorded schedule_content capability." : undefined,
    isPostizBound && hasScheduleCapability && !platform ? "The assigned Postiz channel uses an unsupported or legacy platform value. Relink it with a named Postiz platform before scheduling." : undefined,
    instagramCarousel ? "Instagram carousel scheduling is blocked until a reviewed multi-asset route is available; a single selected render cannot be sent as a carousel." : undefined,
    !scheduledAt ? "Choose a future calendar time before requesting a Postiz schedule." : undefined,
    scheduledAt && !hasWorkspaceClock ? "Refresh the workspace to verify this is still a future calendar time before requesting a Postiz schedule." : undefined,
    scheduledAt && hasWorkspaceClock && !isFutureSchedule ? "Postiz scheduling is future-only. Reschedule this content to a later time before requesting approval." : undefined,
  ].filter((message): message is string => Boolean(message));
  const receipt = lifecycle.receipt;
  const failure = safeFailure(lifecycle.failureReason);

  return (
    <section className={classNames("border border-line bg-panel", className)} aria-label="Postiz scheduling">
      <SectionHeading
        eyebrow="Cross-platform scheduling"
        title="Postiz schedule"
        description="Postiz is an optional self-hosted execution layer. It can create a future schedule for an operator-mapped channel after worker-side verification; it does not make this content published on the social network."
        action={<StatusPill label={scheduleLabel(lifecycle.status)} tone={scheduleTone(lifecycle.status)} />}
      />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink-faint">
          <span className="border border-line-2 bg-panel-2 px-2 py-1">{displayLabel(content.format)} · selected render required</span>
          <span className="border border-line-2 bg-panel-2 px-2 py-1">{account ? `Channel · ${account.handle}` : "No assigned channel"}</span>
          {content.scheduledAt && <span className="border border-line-2 bg-panel-2 px-2 py-1">Calendar · {displayTime(content.scheduledAt)}</span>}
        </div>

        <p className="text-[11px] leading-relaxed text-ink-dim">
          {lifecycle.status === "pending_approval" && "The selected render and future time are frozen into an individual schedule request. Approving it does not contact Postiz."}
          {lifecycle.status === "approved" && "The frozen schedule request is approved. It still waits for your explicit Postiz handoff; the calendar will not send it automatically."}
          {lifecycle.status === "queued" && "The individual schedule is queued. No calendar process will deliver it; use the explicit handoff control only if the previous handoff did not begin."}
          {lifecycle.status === "running" && "The controlled worker has claimed this approved schedule. Do not create a second request while the handoff outcome is pending."}
          {lifecycle.status === "scheduled" && "Postiz acknowledged a future schedule. This is not evidence of a live social-network post; delivery remains subject to the connected network."}
          {lifecycle.status === "failed" && "The worker recorded a terminal result. Reconcile the Postiz/network outcome before making a newly reviewed content revision; do not retry this action here."}
          {lifecycle.status === "blocked" && "This action needs manual reconciliation or a newly reviewed content revision. It cannot be re-dispatched from this panel."}
          {lifecycle.status === "not_requested" && "A future calendar time never schedules content by itself. Request a separate approval for the selected render and linked Postiz channel."}
        </p>

        {lifecycle.postizSettings && <p className="border-l border-scope/55 bg-scope/[0.04] px-3 py-2 text-[10px] leading-relaxed text-ink-dim">Frozen delivery policy · {postizSettingsSummary(lifecycle.postizSettings)}</p>}

        {lifecycle.status === "not_requested" && isPostizBound && hasScheduleCapability && platform && (
          <p className="border-l border-amber/55 bg-amber/[0.04] px-3 py-3 text-[10px] leading-relaxed text-amber">This mapped account has no reusable delivery policy. Scheduling stays blocked until you explicitly choose the platform-specific policy for this individual calendar item below.</p>
        )}

        {blockerMessages.length > 0 && lifecycle.status !== "scheduled" && lifecycle.status !== "failed" && lifecycle.status !== "blocked" && (
          <ul className="space-y-2 border-l border-amber/55 bg-amber/[0.04] px-3 py-3 text-[10px] leading-relaxed text-amber">
            {blockerMessages.map((message) => <li key={message}>{message}</li>)}
          </ul>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] leading-relaxed text-ink-faint">
          <LifecycleTime label="Requested" value={lifecycle.requestedAt} />
          <LifecycleTime label="Approved" value={lifecycle.approvedAt} />
          <LifecycleTime label="Queued" value={lifecycle.queuedAt} />
          <LifecycleTime label="Started" value={lifecycle.startedAt} />
          <LifecycleTime label="Acknowledged" value={lifecycle.completedAt} />
          <LifecycleTime label="Updated" value={lifecycle.updatedAt} />
        </div>

        {receipt && (
          <div className="border border-signal/35 bg-signal/[0.04] p-3 text-[10px] leading-relaxed text-ink-dim">
            <p className="font-semibold tracking-[0.12em] text-signal uppercase">Postiz schedule acknowledgement</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-faint">
              <span>Executor · Postiz</span>
              {safeIdentifier(receipt.scheduleId) && <span>Schedule · {safeIdentifier(receipt.scheduleId)}</span>}
              <span>Network delivery remains pending.</span>
            </div>
          </div>
        )}

        {failure && <p className="border-l border-onair/55 bg-onair/[0.04] px-3 py-3 text-[10px] leading-relaxed text-onair">Worker result: {failure}</p>}

        {(lifecycle.status === "approved" || lifecycle.status === "queued") && !canDispatchApprovedActions && (
          <p className="border-l border-amber/55 bg-amber/[0.04] px-3 py-3 text-[10px] leading-relaxed text-amber">The server-side Postiz dispatcher is not ready, so this approved future schedule cannot be handed to the worker yet.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          {canRequest && onRequestApproval && platform && <PostizPolicyRequest contentId={content.id} format={content.format} platform={platform} busy={busy} onRequestApproval={onRequestApproval} />}
          {canApprove && onApprove && <button type="button" disabled={busy} onClick={() => onApprove(content.id)} className="border border-scope/60 px-3 py-2 text-[10px] font-semibold tracking-wide text-scope transition hover:bg-scope hover:text-void disabled:opacity-50">Approve schedule</button>}
          {canDispatch && onDispatch && <ExplicitPostizHandoff key={`${content.id}:${lifecycle.status}`} contentId={content.id} status={lifecycle.status} busy={busy} onDispatch={onDispatch} />}
        </div>
      </div>
    </section>
  );
}
