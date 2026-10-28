import { describe, expect, it, vi } from "vitest";
import { completedBriefRender, hyperProjectConnection, HyperJobSubmissionError, HyperProjectApiError, inspectHyperEnvironment, inspectHyperProject, submitHyperProjectJob } from "../src/lib/marketing/hyper-project";
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
  it("classifies project API authentication and transient failures without exposing response bodies", async () => {
    const expired = await inspectHyperProject(connection, undefined, (async () => new Response("private upstream detail", { status: 401 })) as typeof fetch).catch(value => value);
    expect(expired).toBeInstanceOf(HyperProjectApiError);
    expect(expired).toMatchObject({ status: 401, code: "HYPER_CONNECTION_REQUIRED", retryable: true });
    expect(String(expired)).not.toContain("private upstream detail");
    const unavailable = await inspectHyperProject(connection, undefined, (async () => new Response("private upstream detail", { status: 503 })) as typeof fetch).catch(value => value);
    expect(unavailable).toMatchObject({ status: 503, code: "HYPER_SERVICE_UNAVAILABLE", retryable: true });
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
  it("submits an immutable project job with a stable idempotency key and records no provider secrets", async () => {
    const created = { id: jobId, projectId, modelId: "qwen-image-2-1", state: "queued", generation: 0 };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(guide)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: jobId, modelId: "qwen-image-2-1", prepared: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 202 })) as unknown as typeof fetch;
    const result = await submitHyperProjectJob(connection, {
      environmentId: jobId,
      idempotencyKey: "media-engine-hyper:brief:request-fingerprint",
      modelId: "qwen-image-2-1",
      request: { inputs: { prompt: "A clean product image" }, settings: { width: 2048, height: 2048 }, inputRefs: [], outputKind: "final", finalRetention: "project-default" },
    }, fetcher);
    expect(result).toEqual({ id: jobId, projectId, modelId: "qwen-image-2-1", state: "queued", generation: 0 });
    const [url, init] = vi.mocked(fetcher).mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toBe(`https://hyper-render-service.vercel.app/api/engine/projects/${projectId}/jobs`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("idempotency-key")).toBe("media-engine-hyper:brief:request-fingerprint");
    expect(JSON.parse(String(init.body))).toMatchObject({ environmentId: jobId, idempotencyKey: "media-engine-hyper:brief:request-fingerprint", inputs: { prompt: "A clean product image" } });
    expect(JSON.stringify(result)).not.toContain(connection.token);
  });
  it("refuses an unprepared environment before the GPU submission call", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(guide)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: jobId, modelId: "qwen-image-2-1", prepared: false }))) as unknown as typeof fetch;
    await expect(submitHyperProjectJob(connection, {
      environmentId: jobId,
      idempotencyKey: "media-engine-hyper:brief:request-fingerprint",
      modelId: "qwen-image-2-1",
      request: { inputs: { prompt: "A clean product image" }, settings: {}, inputRefs: [], outputKind: "final", finalRetention: "project-default" },
    }, fetcher)).rejects.toThrow(/prepared/);
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(2);
  });
  it("marks a timed out upstream submit as uncertain so retries reuse the same request key", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(guide)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: jobId, modelId: "qwen-image-2-1", prepared: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "RENDER_API_TIMEOUT" }), { status: 504 })) as unknown as typeof fetch;
    const error = await submitHyperProjectJob(connection, {
      environmentId: jobId,
      idempotencyKey: "media-engine-hyper:brief:request-fingerprint",
      modelId: "qwen-image-2-1",
      request: { inputs: { prompt: "A clean product image" }, settings: {}, inputRefs: [], outputKind: "final", finalRetention: "project-default" },
    }, fetcher).catch(value => value);
    expect(error).toBeInstanceOf(HyperJobSubmissionError);
    expect(error.outcomeUncertain).toBe(true);
  });
});
