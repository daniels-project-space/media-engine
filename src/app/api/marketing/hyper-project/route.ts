import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/operator-auth";
import { marketingCall } from "@/lib/marketing/service";
import { hyperProjectConnection, inspectHyperProject } from "@/lib/marketing/hyper-project";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = requireOperator(request);
  if (denied) return denied;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") ?? "";
    await marketingCall("listWorkspace", { projectId });
    const connection = await hyperProjectConnection(projectId);
    if (!connection) return NextResponse.json({ connected: false, dispatchEnabled: false }, { headers });
    const jobId = request.nextUrl.searchParams.get("jobId") || undefined;
    return NextResponse.json(await inspectHyperProject(connection, jobId), { headers });
  } catch {
    return NextResponse.json({ error: "Could not verify this project's new rendering service connection or job." }, { status: 503, headers });
  }
}
