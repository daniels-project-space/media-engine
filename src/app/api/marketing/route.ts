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
    if (view === "plan") {
      const projectId = id.parse(request.nextUrl.searchParams.get("projectId"));
      const [plan, run] = await Promise.all([
        marketingCall("latestPlan", { projectId }),
        marketingCall("latestPlanRun", { projectId, asOfMinute: Math.floor(Date.now() / 60_000) }),
      ]);
      return NextResponse.json(
        { plan, run },
        { headers },
      );
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
        expectedRevision: z.number().int().min(0),
        strategy: z.string().min(1).max(20_000),
        calendar: z.string().max(20_000),
        sources: z.string().max(10_000),
      }).strict().parse(input.payload);
      return NextResponse.json({ result: await marketingCall("savePlan", payload) }, { headers });
    }
    if (input.action === "generate-plan") {
      const payload = z.object({ projectId: id, requestKey: z.string().uuid() }).strict().parse(input.payload);
      const run = await marketingCall<{ runId: string; status: string }>("startPlan", payload);
      if (run.status === "queued") {
        const key = process.env.TRIGGER_SECRET_KEY || (await vaultService("trigger")).TRIGGER_SECRET_KEY_MEDIA_ENGINE;
        if (!key) throw new Error("The AI planning worker is not configured. Retry the same request after setup.");
        const response = await fetch("https://api.trigger.dev/api/v1/tasks/marketing-ai-plan/trigger", {
          method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({ payload: { runId: run.runId }, options: { idempotencyKey: `marketing-plan:${run.runId}`, idempotencyKeyTTL: "7d" } }),
          signal: AbortSignal.timeout(15_000), redirect: "error",
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || typeof result.id !== "string")
          throw new Error("Worker dispatch is unconfirmed. Retry this same request before starting another.");
      }
      return NextResponse.json({ result: run }, { headers });
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
