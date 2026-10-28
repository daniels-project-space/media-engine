import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), inspect: vi.fn() }));
vi.mock("@trigger.dev/sdk", () => ({ task: (definition: unknown) => definition }));
vi.mock("../src/lib/marketing/service", () => ({ marketingCall: mocks.call }));
vi.mock("../src/lib/llm", () => ({ inspectCodexSubscription: mocks.inspect }));
import { marketingAiCheck, marketingAiEnvironmentCheck } from "../src/trigger/marketing-ai-check";

const worker = marketingAiCheck as unknown as { run: (payload: { projectId: string; requestKey: string }) => Promise<unknown> };
const payload = { projectId: "project-a", requestKey: "check-a" };
describe("cloud subscription diagnostic", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("inspects only after an exclusive claim and stores the bounded outcome", async () => {
    mocks.call.mockResolvedValue(true); mocks.inspect.mockResolvedValue("subscription-login");
    await worker.run(payload);
    expect(mocks.inspect).toHaveBeenCalledOnce();
    expect(mocks.call).toHaveBeenLastCalledWith("finishAiCheck", { ...payload, outcome: "subscription-login" });
  });
  it("does nothing when a stale or duplicate worker cannot claim", async () => {
    mocks.call.mockResolvedValue(false);
    expect(await worker.run(payload)).toEqual({ claimed: false });
    expect(mocks.inspect).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledOnce();
  });
  it("checks the worker before onboarding without touching project records", async () => {
    const probe = marketingAiEnvironmentCheck as unknown as { run: () => Promise<unknown> };
    mocks.inspect.mockResolvedValue("unavailable");
    expect(await probe.run()).toEqual({ login: "unavailable" });
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
