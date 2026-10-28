import { describe, expect, it, vi } from "vitest";
import { hyperRenderReadiness } from "../src/lib/marketing/hyper-render-readiness";

describe("new GPU service readiness", () => {
  it("reports catalogue qualification without claiming project access or dispatch", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      hardware: { initial: "rtx3090", future: "rtx5090" },
      models: [{ id: "image", nativeQualified: true, qualifiedGpuTypes: ["rtx3090"], readiness: "requires-compatible-worker" }],
    }))) as unknown as typeof fetch;
    const result = await hyperRenderReadiness(fetcher);
    expect(result.models[0].nativeQualified).toBe(true);
    expect(result.projectConnectionVerified).toBe(false);
    expect(result.dispatchEnabled).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://hyper-render-service.vercel.app/api/engine/models",
      expect.objectContaining({ redirect: "error", cache: "no-store" }),
    );
  });

  it("fails closed when the catalogue is unavailable or malformed", async () => {
    const unavailable = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    const malformed = (async () => new Response(JSON.stringify({ models: [{ nativeQualified: true }] }))) as typeof fetch;
    await expect(hyperRenderReadiness(unavailable)).rejects.toThrow();
    await expect(hyperRenderReadiness(malformed)).rejects.toThrow();
  });
});
