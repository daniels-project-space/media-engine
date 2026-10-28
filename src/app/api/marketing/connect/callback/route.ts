import { NextRequest, NextResponse } from "next/server";
import { creativeServiceToken } from "@/lib/creative-service";
import { mediaEnginePublicOrigin } from "@/lib/higgsfield-oauth";
import {
  verifyMarketingConnectionState,
  type ConnectionPlatform,
  type MarketingConnectionState,
} from "@/lib/marketing/connection-state";
import { marketingCall, refreshProviderAccounts } from "@/lib/marketing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConnectionResult = "connected" | "pending" | "failed" | "invalid";

function returnToMarketing(
  origin: string,
  result: ConnectionResult,
  projectId?: string,
) {
  const destination = new URL("/marketing", origin);
  if (projectId) destination.searchParams.set("projectId", projectId);
  destination.searchParams.set("connection", result);
  return NextResponse.redirect(destination, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: NextRequest) {
  const origin = mediaEnginePublicOrigin();
  let state: MarketingConnectionState | null;
  try {
    state = verifyMarketingConnectionState(
      request.nextUrl.searchParams.get("connectState"),
      await creativeServiceToken(),
    );
  } catch {
    return returnToMarketing(origin, "invalid");
  }
  if (!state) return returnToMarketing(origin, "invalid");

  const params = request.nextUrl.searchParams;
  if (params.has("error"))
    return returnToMarketing(origin, "failed", state.projectId);
  const accountId = params.get("accountId");
  const returnedProfileId = params.get("profileId");
  if (!accountId || returnedProfileId !== state.profileId)
    return returnToMarketing(origin, "pending", state.projectId);

  try {
    await refreshProviderAccounts();
    const workspace = await marketingCall<{
      projects: Array<{ _id: string; zernioProfileId?: string }>;
      accounts: Array<{
        providerAccountId: string;
        profileId: string;
        platform: ConnectionPlatform;
        connected: boolean;
      }>;
    }>("listWorkspace", { projectId: state.projectId });
    const project = workspace.projects.find(
      (row) => row._id === state.projectId,
    );
    const account = workspace.accounts.find(
      (row) => row.providerAccountId === accountId,
    );
    if (
      project?.zernioProfileId === state.profileId &&
      account?.profileId === state.profileId &&
      account.platform === state.platform &&
      account.connected
    )
      return returnToMarketing(origin, "connected", state.projectId);
  } catch {
    // The provider may have completed OAuth while billing or inventory sync is
    // temporarily unavailable. Let the owner retry a read-only account refresh.
  }
  return returnToMarketing(origin, "pending", state.projectId);
}
