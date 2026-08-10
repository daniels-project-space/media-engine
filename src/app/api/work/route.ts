import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { hasOperatorSession, requireOperator } from "@/lib/operator-auth";
import { creativeServiceToken } from "@/lib/creative-service";
import { vaultService } from "@/lib/vault";
import { chatJson } from "@/lib/llm";
import { assertSeedanceRendererEnabled, SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE } from "@/lib/video-router";

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

type PublicWorkspaceProject = {
  project: {
    _id: string;
    buyer: string;
    title: string;
    stage: string;
    storyboardVersion?: number;
    approvedPlanVersion?: number;
    error?: string;
    lastActivityAt?: number;
  };
  renderJobs: {
    _id: string;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    kind: "draft" | "final";
    updatedAt: number;
    error?: string;
  }[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRenderStatus(value: unknown): value is PublicWorkspaceProject["renderJobs"][number]["status"] {
  return value === "queued" || value === "running" || value === "succeeded" || value === "failed" || value === "cancelled";
}

function isRenderKind(value: unknown): value is PublicWorkspaceProject["renderJobs"][number]["kind"] {
  return value === "draft" || value === "final";
}

function publicWorkspace(value: unknown): PublicWorkspaceProject[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, projectIndex) => {
    if (!isRecord(item) || !isRecord(item.project)) return [];
    const project = item.project;
    const stage = typeof project.stage === "string" ? project.stage : "unknown";
    const renderJobs = Array.isArray(item.renderJobs)
      ? item.renderJobs.flatMap((job, jobIndex) => {
        if (!isRecord(job)) return [];
        const status = job.status;
        const kind = job.kind;
        const updatedAt = finiteNumber(job.updatedAt);
        if (!isRenderStatus(status) || !isRenderKind(kind) || updatedAt === undefined) return [];
        return [{ _id: `public-render-${projectIndex + 1}-${jobIndex + 1}`, status, kind, updatedAt }];
      })
      : [];
    const failed = stage === "failed" || renderJobs.some((job) => job.status === "failed");

    return [{
      project: {
        _id: `public-project-${projectIndex + 1}`,
        buyer: "Private client",
        title: "Client production",
        stage,
        storyboardVersion: finiteNumber(project.storyboardVersion),
        approvedPlanVersion: finiteNumber(project.approvedPlanVersion),
        error: failed ? "This work item requires an operator review." : undefined,
        lastActivityAt: finiteNumber(project.lastActivityAt),
      },
      renderJobs,
    }];
  });
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
  try {
    const { convex, serviceToken } = await serviceClient();
    const projects = await convex.action(api.creativeGateway.listWorkspace, { serviceToken });
    return NextResponse.json(
      { projects: hasOperatorSession(request) ? projects : publicWorkspace(projects) },
      { headers: { "Cache-Control": "no-store" } },
    );
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
      const runId = await triggerTask("plan-ad-script", { projectId, clipCount: 3, secondsPerShot: 5 });
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
      // Fail before we create a render job or invoke Trigger. The worker has a
      // matching guard, but admission must be safe even if a prior worker build
      // is still serving a deployment during the cloud cutover.
      assertSeedanceRendererEnabled();
      const dispatchToken = randomBytes(32).toString("base64url");
      const { convex, serviceToken } = await serviceClient();
      const admission = (await convex.action(api.creativeGateway.startRender, {
        serviceToken,
        payload: { projectId, kind, dispatchToken },
      })) as { jobId: Id<"renderJobs">; reused: boolean };
      if (admission.reused) return NextResponse.json({ jobId: admission.jobId, reused: true });

      try {
        const runId = await triggerTask("generate-ad", {
          renderJobId: admission.jobId,
          dispatchToken,
        });
        return NextResponse.json({ jobId: admission.jobId, runId, reused: false });
      } catch (error) {
        await convex.action(api.creativeGateway.failQueuedDispatch, {
          serviceToken,
          payload: {
            jobId: admission.jobId,
            dispatchToken,
            error: error instanceof Error ? error.message : "render dispatch failed",
          },
        }).catch(() => {});
        throw error;
      }
    }

    return NextResponse.json({ error: "Unknown work action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Work request failed";
    const status = message.includes(SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE)
      ? 503
      : message.includes("required") || message.includes("before") || message.includes("must") || message.includes("No approved") || message.includes("Every storyboard")
        ? 400
        : 500;
    console.error("work action failed", error);
    return NextResponse.json({ error: message.slice(0, 500) }, { status });
  }
}
