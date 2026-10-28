import { discoverResearchUrls } from "./discovery";
import { inspectResearchWebsite } from "./website";
import { marketingCall } from "./service";
import { vaultService } from "../vault";

export async function discoverProjectResearch(projectId: string, requestKey: string) {
  if (process.env.MARKETING_TAVILY_DISCOVERY_ENABLED !== "true") throw new Error("Automatic market discovery is not configured");
  const apiKey = (await vaultService("media-engine")).TAVILY_API_KEY;
  if (!apiKey) throw new Error("Automatic market discovery has no configured search credential");
  const workspace = await marketingCall<{ projects: Array<{ _id: string; version: number; website: string; offer: string; audience: string }> }>("listWorkspace", { projectId });
  const project = workspace.projects.find(row => row._id === projectId);
  if (!project) throw new Error("Marketing project not found");
  const reservation = await marketingCall<{ discoveryId: string; status: string; canRun: boolean; captured: number }>("startDiscovery", { projectId, expectedProjectVersion: project.version, requestKey });
  if (!reservation.canRun) return { status: reservation.status, captured: reservation.captured, replay: true };
  let captured = 0;
  try {
    const urls = await discoverResearchUrls({ apiKey, offer: project.offer, audience: project.audience, ownWebsite: project.website });
    const results = await Promise.allSettled(urls.map(inspectResearchWebsite));
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      if (new URL(result.value.url).hostname === new URL(project.website).hostname) continue;
      try {
        await marketingCall("saveResearch", { projectId, expectedProjectVersion: project.version, ...result.value, kind: "reference", origin: "discovered" });
        captured++;
      } catch { /* An unsafe, stale, duplicate-capacity or inaccessible source is skipped. */ }
    }
    await marketingCall("finishDiscovery", { projectId, discoveryId: reservation.discoveryId, success: true, captured });
    return { status: "completed", captured, replay: false };
  } catch {
    await marketingCall("finishDiscovery", { projectId, discoveryId: reservation.discoveryId, success: false, captured });
    throw new Error("Market discovery could not be completed; its free-plan or provider status needs attention");
  }
}
