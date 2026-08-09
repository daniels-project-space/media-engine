import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { requireOperator } from "@/lib/operator-auth";
import { creativeServiceToken } from "@/lib/creative-service";
import { vaultService } from "@/lib/vault";
import { presignedGet } from "@/lib/storage";
import { chatJson } from "@/lib/llm";

export const maxDuration = 60;

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://blissful-sardine-231.convex.cloud";
const MAX_MESSAGE_CHARS = 3_000;

type ProjectContext = {
  project: {
    _id: string;
    buyer: string;
    title: string;
    brief: string;
    stage: string;
    intakeStatus?: string;
    missingFields?: string[];
    intakeSummary?: string;
    narrative?: {
      audience: string;
      objective: string;
      corePromise: string;
      insight: string;
      arc: { beat: string; purpose: string }[];
      voiceover?: string;
      cta: string;
    };
    shots?: {
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
    }[];
    storyboardVersion?: number;
    approvedPlanVersion?: number;
    renderPlan?: unknown;
  };
  order: { productImageKey?: string } | null;
  messages: { role: string; body: string; status: string; createdAt: number }[];
};

type IntakeAssessment = {
  summary?: string;
  missingFields?: string[];
  nextQuestion?: string;
};

const REQUIRED_FIELDS = ["goal", "target audience", "key benefit", "delivery format"] as const;

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const clean = value.trim();
  if (!clean) throw new Error(`${label} is required`);
  if (clean.length > max) throw new Error(`${label} is too long`);
  return clean;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, "value", max);
}

function asProjectId(value: unknown): Id<"adProjects"> {
  return requiredText(value, "projectId", 128) as Id<"adProjects">;
}

async function serviceClient() {
  const [serviceToken] = await Promise.all([creativeServiceToken()]);
  return { convex: new ConvexHttpClient(CONVEX_URL), serviceToken };
}

async function projectContext(projectId: Id<"adProjects">): Promise<ProjectContext | null> {
  const { convex, serviceToken } = await serviceClient();
  return (await convex.action(api.creativeGateway.getProjectForPlanning, {
    serviceToken,
    payload: { projectId },
  })) as ProjectContext | null;
}

async function triggerTask(taskId: string, payload: unknown): Promise<string> {
  const trigger = await vaultService("trigger");
  const key = trigger.TRIGGER_SECRET_KEY_MEDIA_ENGINE;
  if (!key) throw new Error("Trigger is not configured");
  const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${taskId}/trigger`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ payload }),
  });
  const text = await response.text();
  let body: { id?: string; error?: unknown } = {};
  try {
    body = JSON.parse(text) as { id?: string; error?: unknown };
  } catch {
    // The body is deliberately not echoed: provider responses can contain internals.
  }
  if (!response.ok || !body.id) throw new Error("Trigger could not accept this run");
  return body.id;
}

function transcript(context: ProjectContext): string {
  return context.messages
    .slice(-12)
    .map((message) => `${message.role}: ${message.body.slice(0, 700)}`)
    .join("\n");
}

function normalizeMissing(candidate: unknown, hasReference: boolean): string[] {
  const raw = Array.isArray(candidate) ? candidate.map((item) => String(item).toLowerCase()) : [];
  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    const aliases = field === "target audience" ? ["audience", "target"] : field === "key benefit" ? ["benefit", "promise"] : [field];
    if (raw.some((item) => aliases.some((alias) => item.includes(alias)))) missing.push(field);
  }
  if (!hasReference) missing.push("product/reference image");
  return [...new Set(missing)];
}

async function appendMessage(
  projectId: Id<"adProjects">,
  role: "buyer" | "operator" | "assistant" | "system",
  body: string,
  status: "received" | "draft" | "approved" | "sent",
) {
  const { convex, serviceToken } = await serviceClient();
  await convex.action(api.creativeGateway.appendMessage, {
    serviceToken,
    payload: { projectId, role, body, status },
  });
}

export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const { convex, serviceToken } = await serviceClient();
    const projects = await convex.action(api.creativeGateway.listWorkspace, { serviceToken });
    return NextResponse.json({ projects });
  } catch (error) {
    console.error("work workspace unavailable", error);
    return NextResponse.json({ error: "Creative workspace is not configured yet." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request" }, { status: 400 });
  }

  try {
    const action = requiredText(body.action, "action", 64);

    if (action === "create-request") {
      const source = body.source === "fiverr" ? "fiverr" : body.source === "direct" ? "direct" : null;
      const tier = body.tier === "basic" || body.tier === "standard" || body.tier === "premium" ? body.tier : null;
      if (!source || !tier) throw new Error("source and tier are required");
      const buyer = requiredText(body.buyer, "buyer", 120);
      const title = requiredText(body.title, "project title", 160);
      const brief = requiredText(body.brief, "brief", 6_000);
      const productImageKey = optionalText(body.productImageKey, 500);
      const pricePence = typeof body.pricePence === "number" && Number.isFinite(body.pricePence) && body.pricePence >= 0
        ? Math.round(body.pricePence)
        : undefined;
      const { convex, serviceToken } = await serviceClient();
      const result = await convex.action(api.creativeGateway.createRequest, {
        serviceToken,
        payload: { buyer, source, tier, title, brief, productImageKey, pricePence },
      });
      return NextResponse.json(result, { status: 201 });
    }

    const projectId = asProjectId(body.projectId);

    if (action === "add-buyer-message") {
      const message = requiredText(body.message, "buyer message", MAX_MESSAGE_CHARS);
      await appendMessage(projectId, "buyer", message, "received");
      return NextResponse.json({ ok: true });
    }

    if (action === "attach-product-image") {
      const productImageKey = requiredText(body.productImageKey, "product image", 500);
      if (!productImageKey.startsWith("products/client/")) {
        throw new Error("Attach a product image through the private upload control");
      }
      const { convex, serviceToken } = await serviceClient();
      await convex.action(api.creativeGateway.setProductReference, {
        serviceToken,
        payload: { projectId, productImageKey },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "assess-intake") {
      const context = await projectContext(projectId);
      if (!context) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      const hasReference = Boolean(context.order?.productImageKey);
      const assessment = await chatJson<IntakeAssessment>({
        system:
          "You are an exacting video-production account manager. Assess whether a client request has enough information for a truthful Seedance 2.0 product video. Return strict JSON only: {summary:string, missingFields:string[], nextQuestion:string}. Required facts: goal, target audience, key benefit, delivery format. Do not claim a product image exists unless stated. Ask exactly one short, highest-value question if anything is missing; otherwise nextQuestion is an empty string. Never promise a delivery time or invent product facts.",
        user: `Project brief:\n${context.project.brief}\n\nReference image supplied: ${hasReference ? "yes" : "no"}\n\nConversation:\n${transcript(context)}`,
        maxTokens: 700,
      });
      const missingFields = normalizeMissing(assessment.missingFields, hasReference);
      const status = missingFields.length ? "needs_reply" : "ready_to_plan";
      const summary = (assessment.summary?.trim() || "Intake assessed.").slice(0, 1_200);
      const { convex, serviceToken } = await serviceClient();
      await convex.action(api.creativeGateway.updateIntake, {
        serviceToken,
        payload: { projectId, status, summary, missingFields },
      });
      const question = assessment.nextQuestion?.trim().slice(0, 800);
      if (missingFields.length && question) await appendMessage(projectId, "assistant", question, "draft");
      return NextResponse.json({ status, summary, missingFields, draftQuestion: missingFields.length ? question ?? "" : "" });
    }

    if (action === "draft-reply") {
      const context = await projectContext(projectId);
      if (!context) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      const lastBuyerMessage = [...context.messages].reverse().find((message) => message.role === "buyer")?.body;
      if (!lastBuyerMessage) throw new Error("Add a buyer message before drafting a reply");
      const draft = await chatJson<{ reply?: string }>({
        system:
          "Write a concise, professional Fiverr/direct-client reply for a human seller to review. Return strict JSON only: {reply:string}. Be honest, ask no more than one question, do not promise dates or results, and do not say that a message was sent.",
        user: `Brief:\n${context.project.brief}\n\nLatest buyer message:\n${lastBuyerMessage}\n\nConversation:\n${transcript(context)}`,
        maxTokens: 500,
      });
      const reply = requiredText(draft.reply, "draft reply", 1_500);
      await appendMessage(projectId, "assistant", reply, "draft");
      return NextResponse.json({ draft: reply });
    }

    if (action === "generate-plan") {
      const context = await projectContext(projectId);
      if (!context) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      if (context.project.intakeStatus !== "ready_to_plan" && context.project.intakeStatus !== "complete") {
        throw new Error("Complete the intake before generating a plan");
      }
      if (!context.order?.productImageKey) {
        throw new Error("A client product or approved reference image is required for subscription-only rendering");
      }
      const productImageUrl = await presignedGet(context.order.productImageKey, 60 * 60 * 24);
      const runId = await triggerTask("plan-ad-script", { projectId, productImageUrl, clipCount: 3, secondsPerShot: 5 });
      return NextResponse.json({ runId });
    }

    if (action === "approve-plan") {
      const { convex, serviceToken } = await serviceClient();
      const version = await convex.action(api.creativeGateway.approvePlan, {
        serviceToken,
        payload: { projectId },
      });
      return NextResponse.json({ version });
    }

    if (action === "mark-delivered") {
      const { convex, serviceToken } = await serviceClient();
      await convex.action(api.creativeGateway.markDelivered, {
        serviceToken,
        payload: { projectId },
      });
      return NextResponse.json({
        ok: true,
        message: "Client order marked delivered. Media Engine did not send anything to the client.",
      });
    }

    if (action === "render") {
      const kind = body.kind === "draft" || body.kind === "final" ? body.kind : null;
      if (!kind) throw new Error("render kind must be draft or final");
      const context = await projectContext(projectId);
      if (!context) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      const { convex, serviceToken } = await serviceClient();
      const admission = (await convex.action(api.creativeGateway.startRender, {
        serviceToken,
        payload: { projectId, kind },
      })) as { jobId: Id<"renderJobs">; reused: boolean };
      if (admission.reused) return NextResponse.json({ jobId: admission.jobId, reused: true });

      try {
        const shots = context.project.shots ?? [];
        if (!shots.length) throw new Error("No approved storyboard shots exist");
        const scenes = await Promise.all(shots.map(async (shot) => {
          if (shot.kind === "card") {
            return {
              model: "seedance-2",
              kind: "card",
              cardTitle: shot.cardTitle ?? context.project.buyer,
              cardSub: shot.cardSub ?? context.project.narrative?.cta ?? "",
              motion: "hold clean brand end card",
              seconds: Math.max(2, Math.min(4, shot.seconds || 3)),
            };
          }
          // Signed URLs are intentionally short lived. Keep the durable R2 key in
          // the approved storyboard and re-sign it at dispatch time so an old
          // plan does not fail merely because it waited for client approval.
          const imageUrl = shot.imageKey
            ? await presignedGet(shot.imageKey, 60 * 60 * 24)
            : shot.imageUrl;
          if (!imageUrl) throw new Error("Every storyboard shot needs an approved client/reference image");
          return {
            model: "seedance-2",
            imageUrl,
            intent: shot.beat ?? shot.imagePrompt ?? context.project.brief,
            motion: shot.motion,
            seconds: Math.max(4, Math.min(12, shot.seconds)),
          };
        }));
        const runId = await triggerTask("generate-ad", {
          projectId,
          renderJobId: admission.jobId,
          renderKind: kind,
          subscriptionOnly: true,
          title: `${context.project.title} — ${kind}`,
          concept: `creative-${projectId}-${kind}-v${context.project.storyboardVersion ?? 1}`,
          caption: context.project.narrative?.corePromise,
          hook: context.project.narrative?.arc[0]?.beat,
          // `quick` enables the Higgsfield subscription music/SFX mix. Explicit
          // storyboard seconds still control every clip length, so this is not a
          // short-cut trim of the approved marketing narrative.
          quick: true,
          bestOf: 1,
          // Music is only generated through the linked Higgsfield subscription;
          // the task rejects any third-party audio fallback in this mode.
          musicPrompt: "polished, modern product-film atmosphere, no vocals",
          scenes,
        });
        await convex.action(api.creativeGateway.markRenderDispatched, {
          serviceToken,
          payload: { jobId: admission.jobId, triggerRunId: runId },
        });
        return NextResponse.json({ jobId: admission.jobId, runId, reused: false });
      } catch (error) {
        await convex.action(api.creativeGateway.failRender, {
          serviceToken,
          payload: { jobId: admission.jobId, error: error instanceof Error ? error.message : "render dispatch failed" },
        }).catch(() => {});
        throw error;
      }
    }

    return NextResponse.json({ error: "Unknown work action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Work request failed";
    const status = message.includes("required") || message.includes("before") || message.includes("must") || message.includes("No approved") || message.includes("Every storyboard") ? 400 : 500;
    console.error("work action failed", error);
    return NextResponse.json({ error: message.slice(0, 500) }, { status });
  }
}
