import { createHmac, randomBytes } from "node:crypto";
import { creativeServiceToken } from "@/lib/creative-service";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/operator-auth";
import {
  boundedJson,
  marketingCall,
  marketingReadiness,
  refreshProviderAccounts,
  providerClient,
  publicFailure,
} from "@/lib/marketing/service";
import { snapshotHash } from "../../../../convex/marketingPolicy";
import { vaultService } from "@/lib/vault";
import { inspectResearchWebsite } from "@/lib/marketing/website";
import { discoverProjectResearch } from "@/lib/marketing/discover-project";
import { completedBriefRender, hyperProjectConnection, inspectHyperProject } from "@/lib/marketing/hyper-project";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const id = z.string().regex(/^[a-z0-9]{20,64}$/);
const projectInput = z
  .object({
    name: z.string().min(1).max(120),
    website: z.string().url(),
    offer: z.string().min(1).max(2_000),
    audience: z.string().min(1).max(1_000),
    facts: z.array(z.string().min(1).max(500)).min(1).max(12),
    goal: z.enum(["signup", "lead", "purchase"]),
    tone: z.string().min(1).max(300),
    timezone: z.string().max(100),
    cadence: z.number().int().min(1).max(7),
    generationLimitMinor: z.number().int().min(0),
    advertisingLimitMinor: z.number().int().min(0),
    currency: z.enum(["USD", "GBP", "EUR", "CHF"]),
    onboardingKey: z.string().uuid().optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const view = request.nextUrl.searchParams.get("view");
    if (view === "research") {
      const projectId = id.parse(request.nextUrl.searchParams.get("projectId"));
      return NextResponse.json({ sources: await marketingCall("listResearch", { projectId }) }, { headers });
    }
    if (view === "plan") {
      const projectId = id.parse(request.nextUrl.searchParams.get("projectId"));
      const [plan, run, aiAllowed, aiCheck] = await Promise.all([
        marketingCall("latestPlan", { projectId }),
        marketingCall("latestPlanRun", { projectId, asOfMinute: Math.floor(Date.now() / 60_000) }),
        marketingCall("marketingAiAllowed", {}),
        marketingCall("latestAiCheck", { projectId, asOfMinute: Math.floor(Date.now() / 60_000) }),
      ]);
      return NextResponse.json(
        { plan, run, aiAllowed: aiAllowed === true, aiCheck },
        { headers },
      );
    }
    if (view === "render-briefs") {
      const projectId = id.parse(request.nextUrl.searchParams.get("projectId"));
      return NextResponse.json({ briefs: await marketingCall("listRenderBriefs", { projectId }) }, { headers });
    }
    if (view === "overview")
      return NextResponse.json(
        await marketingCall("overview", {
          asOfMinute: Math.floor(Date.now() / 60_000),
        }),
        {
          headers,
        },
      );
    if (view === "table") {
      const kind = z
        .enum(["uploads", "content", "costs"])
        .parse(request.nextUrl.searchParams.get("kind"));
      const cursor = z
        .string()
        .max(10_000)
        .nullable()
        .parse(request.nextUrl.searchParams.get("cursor"));
      return NextResponse.json(
        await marketingCall("contentTable", {
          kind,
          paginationOpts: { cursor, numItems: 25 },
        }),
        { headers },
      );
    }
    const projectId = request.nextUrl.searchParams.get("projectId");
    const data = await marketingCall<Record<string, unknown>>(
      "listWorkspace",
      projectId ? { projectId: id.parse(projectId) } : {},
    );
    return NextResponse.json(
      { ...data, readiness: marketingReadiness() },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      { error: publicFailure(error) },
      { status: 503, headers },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const input = z
      .object({
        action: z.string(),
        payload: z.record(z.unknown()).default({}),
      })
      .strict()
      .parse(await boundedJson(request));
    if (input.action === "create-project") {
      const payload = projectInput.parse(input.payload),
        conversionToken = payload.onboardingKey
          ? createHmac("sha256", await creativeServiceToken())
              .update(`marketing-conversion:v1:${payload.onboardingKey}`)
              .digest("hex")
          : randomBytes(32).toString("hex");
      const projectId = await marketingCall<string>("createProject", {
        ...payload,
        conversionTokenHash: snapshotHash(conversionToken),
      });
      return NextResponse.json(
        { projectId, conversionToken },
        { status: 201, headers },
      );
    }
    if (input.action === "refresh-accounts") {
      const result = await refreshProviderAccounts();
      return NextResponse.json(result, { headers });
    }
    if (input.action === "record-cost") {
      const payload = z
        .object({
          projectId: id.optional(),
          label: z.string().min(1).max(120),
          category: z.enum(["subscription", "generation", "hosting"]),
          amountMinor: z.number().int().nonnegative(),
          currency: z.enum(["USD", "GBP", "EUR", "CHF"]),
          occurredAt: z.number().int(),
          reference: z.string().min(1).max(160),
        })
        .strict()
        .parse(input.payload);
      return NextResponse.json(await marketingCall("recordCost", payload), {
        headers,
      });
    }
    if (input.action === "void-cost") {
      const payload = z.object({ costId: id }).strict().parse(input.payload);
      return NextResponse.json(await marketingCall("voidCost", payload), {
        headers,
      });
    }
    if (input.action === "update-project") {
      const payload = projectInput
        .omit({ currency: true, goal: true, onboardingKey: true })
        .extend({ projectId: id, expectedVersion: z.number().int().min(1) })
        .parse(input.payload);
      const result = await marketingCall("updateProject", payload);
      return NextResponse.json({ result }, { headers });
    }
    if (input.action === "save-plan") {
      const payload = z.object({
        projectId: id,
        expectedProjectVersion: z.number().int().min(1),
        expectedResearchVersion: z.number().int().min(0),
        expectedRevision: z.number().int().min(0),
        strategy: z.string().min(1).max(20_000),
        calendar: z.string().max(20_000),
        sources: z.string().max(10_000),
      }).strict().parse(input.payload);
      return NextResponse.json({ result: await marketingCall("savePlan", payload) }, { headers });
    }
    if (input.action === "create-plan-draft") {
      const payload = z.object({ projectId: id, planId: id, entryIndex: z.number().int().min(0).max(27), channelId: id.optional() }).strict().parse(input.payload);
      return NextResponse.json({ result: await marketingCall("createPlanDraft", payload) }, { headers });
    }
    if (input.action === "create-render-brief") {
      const payload = z.object({ projectId: id, planId: id, entryIndex: z.number().int().min(0).max(27),
        modelId: z.enum(["minimax-h3", "qwen-image-2-1"]) }).strict().parse(input.payload);
      return NextResponse.json({ result: await marketingCall("createRenderBrief", payload) }, { headers });
    }
    if (input.action === "capture-research") {
      const payload = z.object({ projectId: id, url: z.string().url().max(700) }).strict().parse(input.payload);
      const workspace = await marketingCall<{ projects: Array<{ _id: string; version: number; website: string }> }>("listWorkspace", { projectId: payload.projectId });
      const project = workspace.projects.find(row => row._id === payload.projectId);
      if (!project) throw new Error("Marketing project not found");
      const source = await inspectResearchWebsite(payload.url);
      const kind = new URL(source.url).hostname === new URL(project.website).hostname ? "project" : "reference";
      const result = await marketingCall("saveResearch", { projectId: payload.projectId, expectedProjectVersion: project.version, ...source, kind });
      return NextResponse.json({ result }, { headers });
    }
    if (input.action === "discover-research") {
      const payload = z.object({ projectId: id, requestKey: z.string().uuid() }).strict().parse(input.payload);
      return NextResponse.json({ result: await discoverProjectResearch(payload.projectId, payload.requestKey) }, { headers });
    }
    if (input.action === "check-ai-worker") {
      const payload = z.object({ projectId: id, requestKey: z.string().uuid() }).strict().parse(input.payload);
      const check = await marketingCall<{ status: string }>("startAiCheck", payload);
      if (check.status === "queued") {
        const key = process.env.TRIGGER_SECRET_KEY || (await vaultService("trigger")).TRIGGER_SECRET_KEY_MEDIA_ENGINE;
        if (!key) throw new Error("Worker check is queued, but the Trigger connection is not configured. Retry this check after setup.");
        const response = await fetch("https://api.trigger.dev/api/v1/tasks/marketing-ai-check/trigger", {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ payload, options: { idempotencyKey: `marketing-ai-check:${payload.projectId}:${payload.requestKey}`, idempotencyKeyTTL: "1d" } }),
          signal: AbortSignal.timeout(8_000), redirect: "error",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.id !== "string") throw new Error("Worker check dispatch is unconfirmed. Retry the same check.");
      }
      return NextResponse.json({ result: check }, { headers });
    }
    if (input.action === "generate-plan") {
      const payload = z.object({ projectId: id, requestKey: z.string().uuid() }).strict().parse(input.payload);
      if ((await marketingCall("marketingAiAllowed", {})) !== true)
        throw new Error("AI planning is paused by the global safety switch. No planning request was created.");
      const previous = await marketingCall<{ requestKey: string; status: string; recoverable?: boolean } | null>("latestPlanRun", { projectId: payload.projectId, asOfMinute: Math.floor(Date.now() / 60_000) });
      if (previous && previous.requestKey !== payload.requestKey && (previous.status === "queued" || (previous.status === "running" && !previous.recoverable)))
        throw new Error("A planning run is already in progress; check its status before retrying.");
      let researchNotice: string | undefined;
      if (previous?.requestKey !== payload.requestKey) {
        const captureProject = async () => {
          const workspace = await marketingCall<{ projects: Array<{ _id: string; version: number; website: string }> }>("listWorkspace", { projectId: payload.projectId });
          const project = workspace.projects.find(row => row._id === payload.projectId);
          if (!project) throw new Error("Marketing project not found");
          const source = await inspectResearchWebsite(project.website);
          await marketingCall("saveResearch", { projectId: payload.projectId, expectedProjectVersion: project.version, ...source, kind: "project" });
        };
        const enabled = process.env.MARKETING_TAVILY_DISCOVERY_ENABLED === "true";
        const [siteResult, discoveryResult] = await Promise.allSettled([
          captureProject(), enabled ? discoverProjectResearch(payload.projectId, payload.requestKey) : Promise.resolve(null),
        ]);
        const warnings = [];
        if (siteResult.status === "rejected") warnings.push("The project website could not be captured.");
        if (enabled && discoveryResult.status === "rejected") warnings.push("Market discovery was unavailable or reached its daily limit.");
        if (warnings.length) researchNotice = `${warnings.join(" ")} The plan will use the saved brief and sources.`;
      }
      const run = await marketingCall<{ runId: string; status: string }>("startPlan", payload);
      if (run.status === "queued") {
        const key = process.env.TRIGGER_SECRET_KEY || (await vaultService("trigger")).TRIGGER_SECRET_KEY_MEDIA_ENGINE;
        if (!key) throw new Error("The AI planning worker is not configured. Retry the same request after setup.");
        const response = await fetch("https://api.trigger.dev/api/v1/tasks/marketing-ai-plan/trigger", {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ payload: { runId: run.runId }, options: { idempotencyKey: `marketing-plan:${run.runId}`, idempotencyKeyTTL: "7d" } }),
          signal: AbortSignal.timeout(8_000), redirect: "error",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.id !== "string")
          throw new Error("Worker dispatch is unconfirmed. Retry this same request before starting another.");
      }
      return NextResponse.json({ result: run, researchNotice }, { headers });
    }
    if (input.action === "import-hyper-render") {
      const payload = z.object({ projectId: id, briefId: id, jobId: z.string().uuid().transform(value => value.toLowerCase()), rightsConfirmed: z.literal(true) }).strict().parse(input.payload);
      const brief = await marketingCall<{ modelId: string; stale: boolean }>("getRenderBrief", { projectId: payload.projectId, briefId: payload.briefId });
      if (brief.stale) throw new Error("Review the current strategy and recreate this render brief before importing media");
      const connection = await hyperProjectConnection(payload.projectId);
      if (!connection) throw new Error("This project has no configured new-service connection");
      const inspected = await inspectHyperProject(connection, payload.jobId);
      completedBriefRender(inspected.job, brief.modelId);
      const imported = await marketingCall<{ importId: string; attempt: number; status: string }>("requestHyperImport", payload);
      if (imported.status === "queued") {
        const key = process.env.TRIGGER_SECRET_KEY || (await vaultService("trigger")).TRIGGER_SECRET_KEY_MEDIA_ENGINE;
        if (!key) throw new Error("The import worker is not configured. Retry this same request after setup.");
        const response = await fetch("https://api.trigger.dev/api/v1/tasks/marketing-hyper-import/trigger", {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ payload: { projectId: payload.projectId, importId: imported.importId, attempt: imported.attempt },
            options: { idempotencyKey: `hyper-import:${imported.importId}:${imported.attempt}`, idempotencyKeyTTL: "7d" } }),
          signal: AbortSignal.timeout(15_000), redirect: "error",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.id !== "string") throw new Error("Import dispatch is unconfirmed. Retry this same request.");
      }
      return NextResponse.json({ result: imported }, { headers });
    }
    if (input.action === "track-hyper-render") {
      const payload = z.object({ projectId: id, briefId: id, jobId: z.string().uuid().transform(value => value.toLowerCase()), rightsConfirmed: z.literal(true) }).strict().parse(input.payload);
      const brief = await marketingCall<{ modelId: string; stale: boolean }>("getRenderBrief", { projectId: payload.projectId, briefId: payload.briefId });
      if (brief.stale) throw new Error("Review the current strategy and recreate this render brief before tracking a job");
      const connection = await hyperProjectConnection(payload.projectId);
      if (!connection) throw new Error("This project has no configured new-service connection");
      const inspected = await inspectHyperProject(connection, payload.jobId);
      if (!inspected.job || inspected.job.modelId !== brief.modelId) throw new Error("The render job must use the model selected for this creative brief");
      const tracked = await marketingCall("trackHyperImport", { ...payload, modelId: inspected.job.modelId, providerState: inspected.job.state, errorCode: inspected.job.errorCode ?? undefined });
      return NextResponse.json({ result: { tracked, job: inspected.job } }, { headers });
    }
    if (input.action === "available-renders") {
      const result = await marketingCall("availableRenders", {
        projectId: id.parse(input.payload.projectId),
      });
      return NextResponse.json({ result }, { headers });
    }
    if (input.action === "import-render") {
      const payload = z
        .object({
          projectId: id,
          renderJobId: id,
          rightsConfirmed: z.literal(true),
        })
        .strict()
        .parse(input.payload);
      const imported = await marketingCall<{
        importId: string;
        attempt: number;
        status: string;
      }>("requestRenderImport", payload);
      if (imported.status !== "verified") {
        const key =
          process.env.TRIGGER_SECRET_KEY ||
          (await vaultService("trigger")).TRIGGER_SECRET_KEY_MEDIA_ENGINE;
        if (!key)
          throw new Error(
            "Media Engine Trigger is not configured for private media imports",
          );
        const response = await fetch(
          "https://api.trigger.dev/api/v1/tasks/marketing-import-render/trigger",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              payload: {
                projectId: payload.projectId,
                importId: imported.importId,
                attempt: imported.attempt,
              },
              options: {
                idempotencyKey: `marketing-import:${imported.importId}:${imported.attempt}`,
                idempotencyKeyTTL: "7d",
              },
            }),
            signal: AbortSignal.timeout(15_000),
            redirect: "error",
          },
        );
        const run = await response.json().catch(() => ({}));
        if (!response.ok || typeof run.id !== "string")
          throw new Error(
            "Import dispatch is unconfirmed. Refresh its receipt before requesting the same import again.",
          );
      }
      return NextResponse.json({ result: imported }, { headers });
    }
    const operations: Record<string, string> = {
      "save-channel": "saveChannel",
      "create-item": "createItem",
      "approve-item": "approveItem",
      "edit-draft": "editDraft",
      "assign-draft-channel": "assignDraftChannel",
      "recheck-item": "recheckItem",
      "settle-ad-billing": "settleAdBilling",
      "set-project-status": "setProjectStatus",
      "generate-week": "generateWeek",
    };
    const operation = operations[input.action];
    if (!operation) throw new Error("Unknown marketing action");
    id.parse(input.payload.projectId);
    if (input.action === "save-channel" && input.payload.mode !== "off") {
      const workspace = await marketingCall<{
        accounts: Array<{
          _id: string;
          providerAccountId: string;
          platform: string;
        }>;
        projects: Array<{ _id: string; currency: string }>;
      }>("listWorkspace", { projectId: input.payload.projectId });
      const account = workspace.accounts.find(
        (account) => account._id === input.payload.accountId,
      );
      const project = workspace.projects.find(
        (project) => project._id === input.payload.projectId,
      );
      if (!account || !project) throw new Error("Project or account not found");
      if (["googleads", "metaads"].includes(account.platform)) {
        const client = await providerClient();
        await client.verifyAdAccount(
          account.providerAccountId,
          z.string().parse(input.payload.adAccountId),
          project.currency,
        );
        if (account.platform === "metaads")
          await client.verifyMetaPage(
            account.providerAccountId,
            z.string().parse(input.payload.pageId),
          );
      }
    }
    // Public operator routes deliberately cannot claim jobs, forge outcomes,
    // ingest webhooks/conversions, or supply raw provider credentials.
    const result = await marketingCall(operation, input.payload);
    return NextResponse.json({ result }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: publicFailure(error) },
      { status: error instanceof z.ZodError ? 400 : 409, headers },
    );
  }
}
