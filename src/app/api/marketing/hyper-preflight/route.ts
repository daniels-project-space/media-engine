import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/operator-auth";
import { marketingCall } from "@/lib/marketing/service";
import { checkHyperPreflight } from "@/lib/marketing/hyper-preflight";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const id = z.string().regex(/^[a-z0-9]{20,64}$/);
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  try {
    const input = z.object({ projectId: id, briefId: id, environmentId: z.string().uuid().transform(value => value.toLowerCase()).optional() }).strict().parse({
      projectId: request.nextUrl.searchParams.get("projectId"), briefId: request.nextUrl.searchParams.get("briefId"),
      ...(request.nextUrl.searchParams.get("environmentId") ? { environmentId: request.nextUrl.searchParams.get("environmentId") } : {}),
    });
    const brief = await marketingCall<{ modelId: string; stale: boolean }>("getRenderBrief", { projectId: input.projectId, briefId: input.briefId });
    return NextResponse.json(await checkHyperPreflight({ ...input, brief }), { headers });
  } catch {
    return NextResponse.json({ error: "Could not verify this project, brief, or render environment. Check the project connection and environment ID." }, { status: 400, headers });
  }
}
