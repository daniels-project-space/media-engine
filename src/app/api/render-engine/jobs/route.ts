import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import {
  getRenderEngineProjectJob,
  RenderEngineConfigurationError,
} from "@/lib/render-engine-client";

export const maxDuration = 15;

/** Operator-only inspection of a Media Engine job in Render Engine. */
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const jobId = request.nextUrl.searchParams.get("jobId") ?? "";
  if (!/^[a-z0-9]{32}$/.test(jobId)) return NextResponse.json({ error: "Valid jobId is required" }, { status: 400 });
  try {
    const job = await getRenderEngineProjectJob(jobId);
    return NextResponse.json(job ?? { error: "Job not found" }, {
      status: job ? 200 : 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RenderEngineConfigurationError
      ? "Render Engine project connection is not configured"
      : "Render Engine job lookup failed" }, {
      status: error instanceof RenderEngineConfigurationError ? 503 : 502,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
