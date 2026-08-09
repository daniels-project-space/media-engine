import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { chat, parseJson } from "../lib/llm";
import { creativeServiceToken } from "../lib/creative-service";
import { presignedGet } from "../lib/storage";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";

type Payload = {
  projectId: string;
  /** How many image-to-video footage beats to plan (default 3). */
  clipCount?: number;
  /** Seedance clip length for each footage beat (4–12 seconds, default 5). */
  secondsPerShot?: number;
  /** Append a deterministic end card; it never needs an image-generation provider. */
  card?: boolean;
};

type PlanResponse = {
  narrative?: {
    audience?: unknown;
    objective?: unknown;
    corePromise?: unknown;
    insight?: unknown;
    arc?: unknown;
    voiceover?: unknown;
    cta?: unknown;
  };
  storyboard?: unknown;
  /** Accepted for models which retain the legacy field name. */
  shots?: unknown;
  audioStrategy?: unknown;
};

type PlannedFootageBeat = {
  beat?: unknown;
  imagePrompt?: unknown;
  visual?: unknown;
  motion?: unknown;
  audioCue?: unknown;
  onText?: unknown;
};

type Narrative = {
  audience: string;
  objective: string;
  corePromise: string;
  insight: string;
  arc: { beat: string; purpose: string }[];
  voiceover?: string;
  cta: string;
};

type Shot = {
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

type RenderPlan = {
  provider: "higgsfield";
  model: "seedance_2_0";
  creditSource: "higgsfield_subscription";
  aspectRatio: "9:16";
  durationSeconds: number;
  audioStrategy: string;
  referencePolicy: string;
  fallbackPolicy: "fail_closed";
  providerInstructions: string[];
};

type PlanningContext = {
  project: {
    _id: Id<"adProjects">;
    buyer: string;
    title: string;
    brief: string;
    stage: string;
    intakeStatus?: string;
  };
  order: { productImageKey?: string } | null;
  messages: { role: string; body: string }[];
};

function isPlanningContext(value: unknown): value is PlanningContext {
  if (!value || typeof value !== "object") return false;
  const context = value as { project?: unknown; order?: unknown; messages?: unknown };
  if (!context.project || typeof context.project !== "object" || !Array.isArray(context.messages)) return false;
  const project = context.project as Record<string, unknown>;
  return (
    typeof project._id === "string" &&
    typeof project.buyer === "string" &&
    typeof project.title === "string" &&
    typeof project.brief === "string" &&
    typeof project.stage === "string" &&
    context.messages.every(
      (message) =>
        Boolean(message) &&
        typeof message === "object" &&
        typeof (message as Record<string, unknown>).role === "string" &&
        typeof (message as Record<string, unknown>).body === "string",
    )
  );
}

function requiredText(value: unknown, field: string, max = 700): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`creative plan is missing ${field}`);
  }
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function optionalText(value: unknown, max = 700): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function defaultBeat(index: number, count: number): string {
  if (index === 0) return "Hook";
  if (index === count - 1) return "Payoff";
  return "Demo";
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.floor(candidate)));
}

function normalizeNarrative(raw: PlanResponse["narrative"], storyboard: PlannedFootageBeat[]): Narrative {
  if (!raw || typeof raw !== "object") throw new Error("creative plan is missing narrative");
  const n = raw as NonNullable<PlanResponse["narrative"]>;
  const sourceArc = Array.isArray(n.arc) ? n.arc : [];
  const arc = storyboard.map((storyboardBeat, index) => {
    const item = sourceArc[index] && typeof sourceArc[index] === "object" ? (sourceArc[index] as { beat?: unknown; purpose?: unknown }) : {};
    return {
      beat: optionalText(item.beat, 100) ?? optionalText(storyboardBeat.beat, 100) ?? defaultBeat(index, storyboard.length),
      purpose:
        optionalText(item.purpose, 300) ??
        requiredText(storyboardBeat.imagePrompt ?? storyboardBeat.visual, `storyboard[${index}].imagePrompt`, 300),
    };
  });

  return {
    audience: requiredText(n.audience, "narrative.audience", 320),
    objective: requiredText(n.objective, "narrative.objective", 320),
    corePromise: requiredText(n.corePromise, "narrative.corePromise", 320),
    insight: requiredText(n.insight, "narrative.insight", 420),
    arc,
    voiceover: optionalText(n.voiceover, 700),
    cta: requiredText(n.cta, "narrative.cta", 220),
  };
}

function normalizeStoryboard(
  raw: PlanResponse,
  count: number,
  seconds: number,
  referenceUrl: string,
  referenceKey?: string,
): { source: PlannedFootageBeat[]; shots: Shot[] } {
  const candidates = Array.isArray(raw.storyboard) ? raw.storyboard : raw.shots;
  if (!Array.isArray(candidates) || candidates.length < count) {
    throw new Error(`creative plan must contain ${count} storyboard footage beats`);
  }
  const source = candidates.slice(0, count).map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`storyboard beat ${index + 1} is invalid`);
    return entry as PlannedFootageBeat;
  });
  const shots = source.map((beat, index) => ({
    id: `shot-${index + 1}`,
    kind: "reference_video",
    beat: optionalText(beat.beat, 100) ?? defaultBeat(index, source.length),
    // This remains a precise I2V direction, never an image-generation prompt.
    imagePrompt: requiredText(beat.imagePrompt ?? beat.visual, `storyboard[${index}].imagePrompt`, 600),
    imageUrl: referenceUrl,
    ...(referenceKey ? { imageKey: referenceKey } : {}),
    motion: requiredText(beat.motion, `storyboard[${index}].motion`, 420),
    audioCue: optionalText(beat.audioCue, 240),
    onText: optionalText(beat.onText, 120),
    seconds,
  }));
  return { source, shots };
}

function clientTranscript(messages: { role: string; body: string }[]): string {
  return messages
    .slice(-20)
    .map((message) => `${message.role.toUpperCase()}: ${message.body.trim().slice(0, 1_000)}`)
    .join("\n")
    .slice(0, 12_000);
}

// Produces the reviewable narrative/storyboard boundary. Rendering only starts after
// an operator approves the persisted plan, and that later job is fail-closed to the
// Higgsfield subscription-backed Seedance 2.0 provider.
export const planAdScript = task({
  id: "plan-ad-script",
  maxDuration: 120,
  run: async (payload: Payload) => {
    const projectId = payload.projectId as Id<"adProjects">;
    const convex = new ConvexHttpClient(CONVEX_URL);
    const serviceToken = await creativeServiceToken();
    const response = await convex.action(api.creativeGateway.getProjectForPlanning, {
      serviceToken,
      payload: { projectId },
    });
    if (response === null) throw new AbortTaskRunError(`project ${payload.projectId} not found`);
    if (!isPlanningContext(response)) {
      throw new AbortTaskRunError("Creative planning context was malformed. No model call was made.");
    }
    const context = response;

    // The task receives only a project ID. It re-signs the durable key saved by
    // the private workspace, rather than trusting an arbitrary URL supplied in
    // a Trigger payload.
    const referenceKey = typeof context.order?.productImageKey === "string"
      ? context.order.productImageKey
      : null;
    if (!referenceKey) {
      throw new AbortTaskRunError(
        "A client-approved product or reference image is required before planning. The subscription-only Seedance 2.0 workflow never creates replacement images.",
      );
    }
    const referenceUrl = await presignedGet(referenceKey, 60 * 60 * 24);

    const project = context.project;
    if (project.intakeStatus !== "ready_to_plan" && project.intakeStatus !== "complete") {
      throw new AbortTaskRunError("The client intake is incomplete; collect the remaining details before generating a storyboard.");
    }
    if (!["scripting", "script_ready", "failed"].includes(project.stage)) {
      throw new AbortTaskRunError(`Project is currently ${project.stage}; no new plan can replace an active or delivered render.`);
    }

    const clipCount = boundedInteger(payload.clipCount, 3, 2, 5);
    const secondsPerShot = boundedInteger(payload.secondsPerShot, 5, 4, 12);
    const brief = project.brief.trim().slice(0, 8_000);
    if (!brief) throw new AbortTaskRunError("The project has no usable brief. Add the client brief before planning.");

    const system = `You are the creative director for a premium direct-response marketing video. Create a reviewable ${clipCount}-beat vertical 9:16 storyboard that turns a verified client brief into a specific, persuasive narrative.

The workflow is subscription-only image-to-video. A client-approved product/reference photograph will be attached to EVERY footage beat by the system. Do not propose generated replacement images, synthetic product variants, logos, invented claims, unsupported transformations, FAL, OpenAI image generation, or a provider/model alternative. Your visual directions must describe how to animate the supplied reference truthfully.

Creative quality: make each beat visually distinct and cinematic, but maintain factual product continuity. Use a strong hook, evidence-led demonstration, payoff, and a clear CTA. Camera/motion directions must be physically filmable and concise. On-screen text must be short and never make a claim absent from the brief.

Return JSON only, with exactly this shape:
{
  "narrative": {
    "audience": "...",
    "objective": "...",
    "corePromise": "...",
    "insight": "...",
    "arc": [{"beat": "Hook", "purpose": "..."}],
    "voiceover": "optional concise VO",
    "cta": "..."
  },
  "storyboard": [
    {"beat": "Hook|Demo|Payoff", "imagePrompt": "specific image-to-video visual direction using the supplied reference", "motion": "camera/subject motion", "audioCue": "optional", "onText": "optional max six words"}
  ],
  "audioStrategy": "short audio and mix direction"
}

The storyboard array must contain exactly ${clipCount} footage beats. Do not include an end card: the system adds it deterministically after your footage beats.`;

    const raw = await chat({
      system,
      user: `PROJECT\nBuyer: ${project.buyer}\nTitle: ${project.title}\nBrief: ${brief}\n\nCLIENT CONVERSATION\n${clientTranscript(context.messages) || "No additional messages."}\n\nREFERENCE\nA verified client-owned product/reference image is available. Plan image-to-video movement around that exact reference; do not invent what is not stated in the brief.` ,
      maxTokens: 2_000,
    });

    let plan: PlanResponse;
    try {
      plan = parseJson<PlanResponse>(raw);
    } catch (error) {
      logger.error("creative planning model returned invalid JSON", {
        projectId: payload.projectId,
        error: error instanceof Error ? error.message : String(error),
        responsePreview: raw.slice(0, 500),
      });
      throw new Error("The creative planning model returned an invalid storyboard. No plan was saved; retry after checking the client brief.");
    }

    let narrative: Narrative;
    let footage: Shot[];
    try {
      const normalized = normalizeStoryboard(plan, clipCount, secondsPerShot, referenceUrl, referenceKey);
      narrative = normalizeNarrative(plan.narrative, normalized.source);
      footage = normalized.shots;
    } catch (error) {
      logger.error("creative planning model returned incomplete plan", {
        projectId: payload.projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(`The creative planning model returned an incomplete storyboard: ${error instanceof Error ? error.message : "unknown validation error"}. No plan was saved.`);
    }

    const shots: Shot[] = [...footage];
    if (payload.card !== false) {
      shots.push({
        id: "end-card",
        kind: "card",
        beat: "CTA",
        cardTitle: project.title,
        cardSub: narrative.cta,
        motion: "Clean 250ms reveal, then a steady readable end card.",
        seconds: Math.min(3, secondsPerShot),
      });
    }

    const audioStrategy = optionalText(plan.audioStrategy, 500) ?? "Use a clean licensed music bed and natural product sound design; keep speech and CTA intelligible.";
    const renderPlan: RenderPlan = {
      provider: "higgsfield",
      model: "seedance_2_0",
      creditSource: "higgsfield_subscription",
      aspectRatio: "9:16",
      durationSeconds: shots.reduce((total, shot) => total + shot.seconds, 0),
      audioStrategy,
      referencePolicy:
        "Every non-card footage beat is image-to-video from the supplied client-approved product/reference image. Re-sign the stored image key at render time when available; do not synthesize replacement assets.",
      fallbackPolicy: "fail_closed",
      providerInstructions: [
        "Render only through Higgsfield using Seedance 2.0.",
        "Charge only the connected Higgsfield subscription credits.",
        "Use the approved reference image as the image-to-video input for every non-card shot.",
        "Do not call FAL, OpenAI image generation, or any alternate provider/model.",
        "Fail the job with a clear error instead of silently substituting a provider, model, or credit source.",
      ],
    };

    const storyboardVersion = await convex.action(api.creativeGateway.persistPlan, {
      serviceToken,
      payload: { projectId: project._id, narrative, shots, renderPlan },
    });
    logger.log("subscription-only Seedance 2.0 plan ready", {
      projectId: project._id,
      storyboardVersion,
      footageShots: footage.length,
      totalShots: shots.length,
      provider: renderPlan.provider,
      model: renderPlan.model,
      creditSource: renderPlan.creditSource,
    });
    return { projectId: project._id, storyboardVersion, shots: shots.length, provider: renderPlan.provider, model: renderPlan.model };
  },
});
