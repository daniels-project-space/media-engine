import { describe, expect, it } from "vitest";
import { buildHyperMediaRequestTemplate, isPortraitVideoFormat } from "../src/lib/marketing/hyper-media-request";

const h3 = {
  id: "minimax-h3",
  nativeQualified: false,
  readiness: "requires-native-qualification",
  requestGuide: {
    modelId: "minimax-h3",
    mode: "native",
    outputContentType: "video/mp4",
    qualityPolicy: "server-injected-immutable",
    pinnedQuality: {
      steps: 50,
      width: 1280,
      height: 720,
      frames: 360,
      fps: 24,
      durationSeconds: 15,
      precision: "int8-convrot / nvfp4-awq",
      approximateCache: false,
      postprocess: { latentScale: 2, videoRestoration: "seedvr2", finalWidth: 3840, finalHeight: 2160, required: true },
    },
    inputs: [{ name: "prompt", type: "text", required: true, maxChars: 20_000 }],
    inputAssets: [],
    rules: ["Only prompt is accepted; native assets are not consumed."],
    nativeQualification: { qualified: false, requirements: ["native runtime qualification"] },
    minimalExample: { inputs: { prompt: "Example" }, settings: {}, requiredInputAssetNames: [] },
  },
};

const qwen = {
  id: "qwen-image-2-1",
  nativeQualified: false,
  readiness: "requires-native-qualification",
  requestGuide: {
    modelId: "qwen-image-2-1",
    mode: "native",
    outputContentType: "image/png",
    qualityPolicy: "server-injected-immutable",
    pinnedQuality: { precision: "bf16", steps: 40, cfg: 1, outputResolution: 2048, useKvCache: true, cpuOffload: true, defaultSeed: 42 },
    inputs: [
      { name: "prompt", type: "text", required: true, maxChars: 10_000 },
      { name: "referenceImages", type: "filename-list", required: false, minItems: 0, maxItems: 10, namePattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$" },
    ],
    optionalRuntimeSettings: [
      { name: "seed", type: "integer", required: false },
      { name: "width", type: "integer", required: false },
      { name: "height", type: "integer", required: false },
    ],
    inputAssets: [{ inputField: "referenceImages", refKind: "input", required: false, minFiles: 0, maxFiles: 10 }],
    rules: ["Allowed pairs: 2048×2048, 2400×1792, 1792×2400, 2528×1696, 1696×2528, 2752×1536, 1536×2752."],
    minimalExample: { inputs: { prompt: "Example" }, settings: {}, requiredInputAssetNames: [] },
  },
};

describe("new Hyper promotional media request contracts", () => {
  it("builds only the live prompt-only H3 request and preserves pinned output quality", () => {
    const result = buildHyperMediaRequestTemplate(h3, "A short, grounded product story.", "16:9 video");
    expect(result).toMatchObject({
      modelId: "minimax-h3",
      kind: "video",
      outputContentType: "video/mp4",
      nativeQualified: false,
      quality: { kind: "video", steps: 50, width: 1280, height: 720, durationSeconds: 15, fps: 24, postprocess: { finalWidth: 3840, finalHeight: 2160 } },
      request: {
        inputs: { prompt: "A short, grounded product story." },
        settings: {},
        inputRefs: [],
        outputKind: "final",
        finalRetention: "project-default",
      },
    });
    expect(result.guideHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("builds Qwen image prompts using only guide-approved 2K dimensions", () => {
    const result = buildHyperMediaRequestTemplate(qwen, "A product in a calm studio with natural light.", "Instagram Story 9:16 portrait");
    expect(result).toMatchObject({
      kind: "image",
      modelId: "qwen-image-2-1",
      outputContentType: "image/png",
      quality: { kind: "image", precision: "bf16", steps: 40, cfg: 1, outputResolution: 2048 },
      settings: { width: 1536, height: 2752 },
      request: { inputs: { prompt: "A product in a calm studio with natural light." }, settings: { width: 1536, height: 2752 }, inputRefs: [] },
    });
    expect(buildHyperMediaRequestTemplate(qwen, "Square product image", "square 1:1").settings).toEqual({ width: 2048, height: 2048 });
  });

  it("refuses a changed guide that needs assets or changes the native input", () => {
    const withAsset = { ...structuredClone(h3), requestGuide: { ...structuredClone(h3.requestGuide), inputAssets: [{ inputField: "image", required: true }] } };
    expect(() => buildHyperMediaRequestTemplate(withAsset, "Product promo", "16:9 video")).toThrow(/request guide/);
    const withWrongInput = structuredClone(h3);
    withWrongInput.requestGuide.inputs = [{ name: "prompt", type: "filename", required: true, maxChars: 20_000 }];
    expect(() => buildHyperMediaRequestTemplate(withWrongInput, "Product promo", "16:9 video")).toThrow(/request guide/);
    const changedQwenSizes = structuredClone(qwen);
    changedQwenSizes.requestGuide.rules = ["Only 2048×2048 is allowed."];
    expect(() => buildHyperMediaRequestTemplate(changedQwenSizes, "Product promo", "Reel 9:16")).toThrow(/selected image format/);
    const changedQwenQuality = structuredClone(qwen);
    (changedQwenQuality.requestGuide.pinnedQuality as Record<string, unknown>).newImmutableControl = true;
    expect(() => buildHyperMediaRequestTemplate(changedQwenQuality, "Product promo", "square")).toThrow();
  });

  it("enforces live prompt limits and identifies portrait-only video formats", () => {
    expect(() => buildHyperMediaRequestTemplate(h3, " ", "16:9 video")).toThrow(/empty/);
    expect(() => buildHyperMediaRequestTemplate(h3, "x".repeat(20_001), "16:9 video")).toThrow(/limit/);
    expect(() => buildHyperMediaRequestTemplate(qwen, "x".repeat(10_001), "square")).toThrow(/limit/);
    expect(isPortraitVideoFormat("Instagram Reel · 9:16")).toBe(true);
    expect(isPortraitVideoFormat("16:9 landscape promo" )).toBe(false);
  });
});
