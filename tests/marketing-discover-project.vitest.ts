import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), vault: vi.fn(), search: vi.fn(), inspect: vi.fn() }));
vi.mock("../src/lib/marketing/service", () => ({ marketingCall: mocks.call }));
vi.mock("../src/lib/vault", () => ({ vaultService: mocks.vault }));
vi.mock("../src/lib/marketing/discovery", () => ({ discoverResearchUrls: mocks.search }));
vi.mock("../src/lib/marketing/website", () => ({ inspectResearchWebsite: mocks.inspect }));
import { discoverProjectResearch } from "../src/lib/marketing/discover-project";

describe("project research orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("MARKETING_TAVILY_DISCOVERY_ENABLED", "true");
    mocks.vault.mockResolvedValue({ TAVILY_API_KEY: "fixture" });
    mocks.call.mockImplementation(async (operation: string) => {
      if (operation === "listWorkspace") return { projects: [{ _id: "project", version: 1, website: "https://own.example/", offer: "Offer", audience: "Audience" }] };
      if (operation === "startDiscovery") return { discoveryId: "discovery", status: "running", canRun: true, captured: 0 };
      return {};
    });
    mocks.search.mockResolvedValue(["https://reference.example/"]);
    mocks.inspect.mockResolvedValue({ url: "https://reference.example/", title: "Reference", description: "Claim", excerpt: "Text", capturedAt: Date.now() });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("reserves before searching and stores attributed independently fetched sources", async () => {
    expect(await discoverProjectResearch("project", "request")).toMatchObject({ status: "completed", captured: 1 });
    expect(mocks.call.mock.calls.map(call => call[0])).toEqual(["listWorkspace", "startDiscovery", "saveResearch", "finishDiscovery"]);
    expect(mocks.call.mock.calls[2][1]).toMatchObject({ projectId: "project", origin: "discovered", kind: "reference" });
  });
  it("does not search again when a request has already been reserved", async () => {
    mocks.call.mockImplementation(async (operation: string) => operation === "listWorkspace" ? { projects: [{ _id: "project", version: 1, website: "https://own.example/" }] } : { discoveryId: "discovery", status: "running", canRun: false, captured: 0 });
    expect(await discoverProjectResearch("project", "request")).toMatchObject({ replay: true });
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
