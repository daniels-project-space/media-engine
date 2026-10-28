import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn(), connection: vi.fn(), receipt: vi.fn(), copy: vi.fn() }));
vi.mock("@trigger.dev/sdk", () => ({ task: (definition: unknown) => definition }));
vi.mock("../src/lib/marketing/service", () => ({ marketingCall: mocks.call }));
vi.mock("../src/lib/marketing/hyper-project", () => ({ hyperProjectConnection: mocks.connection, getHyperImportReceipt: mocks.receipt }));
vi.mock("../src/lib/marketing/assets", () => ({ copyHyperMarketingAsset: mocks.copy }));
import { marketingHyperImport } from "../src/trigger/marketing-hyper-import";

const worker = marketingHyperImport as unknown as { run: (payload: { projectId: string; importId: string; attempt: number }, context: { ctx: { run: { id: string } } }) => Promise<unknown> };
const payload = { projectId: "project-a", importId: "import-a", attempt: 1 }, context = { ctx: { run: { id: "worker-a" } } };
const receipt = { key: "project/output.png", sha256: "a".repeat(64), bytes: 10, contentType: "image/png", generation: 1 };

describe("new renderer import worker", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.call.mockImplementation(async (name: string) => name === "claimHyperImport" ? { jobId: "job-a" } : { status: "verified" });
    mocks.connection.mockResolvedValue({ prefix: "project/" });
    mocks.receipt.mockResolvedValue(receipt);
    mocks.copy.mockResolvedValue({ key: "marketing/project-a/assets/hash.png", sha256: receipt.sha256, bytes: 10, contentType: "image/png" });
  });
  it("registers only after source and destination verification and receipt recheck", async () => {
    await worker.run(payload, context);
    expect(mocks.receipt).toHaveBeenCalledTimes(2);
    expect(mocks.copy).toHaveBeenCalledOnce();
    expect(mocks.call).toHaveBeenLastCalledWith("settleHyperImport", expect.objectContaining({ receipt: expect.objectContaining({ sha256: receipt.sha256 }) }));
  });
  it("records failure rather than registering if the source receipt changes", async () => {
    mocks.receipt.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ ...receipt, sha256: "b".repeat(64) });
    await worker.run(payload, context);
    expect(mocks.call).toHaveBeenLastCalledWith("settleHyperImport", expect.objectContaining({ error: expect.any(String) }));
    expect(mocks.call.mock.calls.at(-1)?.[1]).not.toHaveProperty("receipt");
  });
});
