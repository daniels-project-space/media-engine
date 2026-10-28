import { describe, expect, it, vi } from "vitest";
import { completedBriefRender, hyperProjectConnection, inspectHyperEnvironment, inspectHyperProject } from "../src/lib/marketing/hyper-project";
import { vaultService } from "../src/lib/vault";

vi.mock("../src/lib/vault", () => ({ vaultService: vi.fn() }));

const projectId = "4cd9662c-4267-4d8d-8f20-96ed2a2ab184";
const jobId = "6c23d114-ef9b-41a8-aee4-2728e9fa6dab";
const connection = { projectId, token: "test-project-token-not-real", bucket: "media-engine" as const, prefix: "projects/alpha/" };
const guide = { project: { id: projectId, output: { bucket: "media-engine", prefix: "projects/alpha/" } } };
const job = { id: jobId, projectId, modelId: "qwen-image-2-1", state: "completed", generation: 1,
  output: { projectId, jobId, generation: 1, bucket: "media-engine", key: "projects/alpha/jobs/output.png",
    sha256: "a".repeat(64), bytes: 123, contentType: "image/png", available: true, downloadUrl: "https://signed.invalid/secret" } };

describe("new rendering service project scope", () => {
  it("requires completed available media from the model selected for the linked brief", () => {
    const completed = { modelId: "minimax-h3", state: "completed", receipt: { available: true } };
    expect(completedBriefRender(completed, "minimax-h3")).toEqual(completed);
    expect(() => completedBriefRender({ ...completed, state: "running" }, "minimax-h3")).toThrow(/finish/);
    expect(() => completedBriefRender({ ...completed, receipt: { available: false } }, "minimax-h3")).toThrow(/finish/);
    expect(() => completedBriefRender({ ...completed, modelId: "qwen-image-2-1" }, "minimax-h3")).toThrow(/selected/);
    expect(() => completedBriefRender(null, "minimax-h3")).toThrow(/selected/);
  });
  it("rejects overlapping project mappings from the server-only vault", async () => {
    const first = "a".repeat(25), second = "b".repeat(25);
    vi.mocked(vaultService).mockResolvedValue({ HYPER_RENDER_PROJECT_CONNECTIONS: JSON.stringify({
      [first]: connection, [second]: { ...connection, projectId: jobId, prefix: "projects/alpha/nested/" },
    }) });
    await expect(hyperProjectConnection(first)).rejects.toThrow(/isolated/);
  });
  it("checks the real project and receipt contract without exposing credentials or claiming hash verification", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(guide))).mockResolvedValueOnce(new Response(JSON.stringify(job))) as unknown as typeof fetch;
    const result = await inspectHyperProject(connection, jobId, fetcher);
    expect(result.job?.receipt).toMatchObject({ objectHashVerifiedByMediaEngine: false, bytes: 123 });
    expect(result.dispatchEnabled).toBe(false);
    expect(JSON.stringify(result)).not.toContain(connection.token);
    expect(JSON.stringify(result)).not.toContain("signed.invalid");
  });
  it("rejects storage scope changes and cross-project output receipts", async () => {
    const changedGuide = { project: { ...guide.project, output: { ...guide.project.output, bucket: "other" } } };
    await expect(inspectHyperProject(connection, undefined, (async () => new Response(JSON.stringify(changedGuide))) as typeof fetch)).rejects.toThrow(/storage configuration/);
    const crossJob = { ...job, output: { ...job.output, key: "projects/beta/output.png" } };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(guide))).mockResolvedValueOnce(new Response(JSON.stringify(crossJob))) as unknown as typeof fetch;
    await expect(inspectHyperProject(connection, jobId, fetcher)).rejects.toThrow(/receipt/);
  });
  it("checks the project-scoped environment without claiming capacity or dispatch", async () => {
    const env = { id: jobId, modelId: "qwen-image-2-1", prepared: true, spec: { secret: "never-returned" } };
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(guide))).mockResolvedValueOnce(new Response(JSON.stringify(env))) as unknown as typeof fetch;
    const result = await inspectHyperEnvironment(connection, jobId, "minimax-h3", fetcher);
    expect(result).toEqual({ id: jobId, modelId: "qwen-image-2-1", modelMatches: false, prepared: true });
    expect(JSON.stringify(result)).not.toContain("never-returned");
    expect(JSON.stringify(result)).not.toContain(connection.token);
  });
  it("rejects an environment whose returned identity does not match the request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(guide))).mockResolvedValueOnce(new Response(JSON.stringify({ id: projectId, modelId: "minimax-h3", prepared: true }))) as unknown as typeof fetch;
    await expect(inspectHyperEnvironment(connection, jobId, "minimax-h3", fetcher)).rejects.toThrow(/environment/);
  });
});
