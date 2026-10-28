import { describe, expect, it, vi } from "vitest";
import { checkHyperPreflight } from "../src/lib/marketing/hyper-preflight";

const model = { id: "minimax-h3", nativeQualified: false, qualifiedGpuTypes: [], readiness: "requires-native-qualification" };
const catalogue = { hardware: { initial: "rtx3090", future: "rtx5090" }, models: [model], checkedAt: "2026-01-01T00:00:00Z", projectConnectionVerified: false, dispatchEnabled: false };
const connection = { projectId: "4cd9662c-4267-4d8d-8f20-96ed2a2ab184", token: "fixture-token-not-real", bucket: "media-engine" as const, prefix: "project/" };
const input = { projectId: "project-a", environmentId: "6c23d114-ef9b-41a8-aee4-2728e9fa6dab", brief: { modelId: "minimax-h3", stale: true } };
describe("render preflight", () => {
  it("checks only the specified owned environment and never claims authorization or spend control", async () => {
    const environment = vi.fn().mockResolvedValue({ id: input.environmentId, modelId: "minimax-h3", modelMatches: true, prepared: true });
    const result = await checkHyperPreflight(input, { connection: vi.fn().mockResolvedValue(connection), catalogue: vi.fn().mockResolvedValue(catalogue), environment, project: vi.fn() });
    expect(environment).toHaveBeenCalledWith(connection, input.environmentId, "minimax-h3");
    expect(result).toMatchObject({ briefStale: true, projectConnection: "verified", model, dispatchEnabled: false, monetaryCapVerified: false, capacityVerified: false, outputVerified: false });
    expect(JSON.stringify(result)).not.toContain(connection.token);
  });
  it("distinguishes missing connection, vault failure and missing catalogue without submitting", async () => {
    const environment = vi.fn();
    const project = vi.fn();
    const result = await checkHyperPreflight(input, { connection: vi.fn().mockResolvedValue(null), catalogue: vi.fn().mockRejectedValue(new Error("offline")), environment, project });
    expect(result).toMatchObject({ model: null, catalogueAvailable: false, projectConnection: "missing", environment: null, dispatchEnabled: false });
    const unavailable = await checkHyperPreflight(input, { connection: vi.fn().mockRejectedValue(new Error("offline")), catalogue: vi.fn().mockResolvedValue(catalogue), environment, project });
    expect(unavailable.projectConnection).toBe("unavailable");
    expect(environment).not.toHaveBeenCalled();
  });
  it("verifies the project storage scope even when no environment is selected", async () => {
    const project = vi.fn().mockResolvedValue({ connected: true });
    const environment = vi.fn();
    const result = await checkHyperPreflight({ ...input, environmentId: undefined }, { connection: vi.fn().mockResolvedValue(connection), catalogue: vi.fn().mockResolvedValue(catalogue), environment, project });
    expect(project).toHaveBeenCalledWith(connection);
    expect(environment).not.toHaveBeenCalled();
    expect(result).toMatchObject({ projectConnection: "verified", environment: null, dispatchEnabled: false });
  });
});
