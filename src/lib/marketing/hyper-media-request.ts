import { createHash } from "node:crypto";
import { z } from "zod";

const modelSchema = z.object({
  id: z.enum(["minimax-h3", "qwen-image-2-1"]),
  nativeQualified: z.boolean(),
  readiness: z.string().max(100),
  requestGuide: z.unknown(),
}).passthrough();

const promptInputSchema = z.object({
  name: z.literal("prompt"),
  type: z.literal("text"),
  required: z.literal(true),
  maxChars: z.number().int().positive(),
}).passthrough();

const commonGuideSchema = z.object({
  mode: z.literal("native"),
  qualityPolicy: z.literal("server-injected-immutable"),
  modelId: z.enum(["minimax-h3", "qwen-image-2-1"]),
  outputContentType: z.enum(["video/mp4", "image/png"]),
  pinnedQuality: z.record(z.unknown()),
  inputs: z.array(z.unknown()),
  inputAssets: z.array(z.unknown()),
  rules: z.array(z.string()),
  minimalExample: z.object({
    inputs: z.record(z.unknown()),
    settings: z.record(z.unknown()),
    requiredInputAssetNames: z.array(z.string()),
  }).passthrough(),
}).passthrough();

const h3GuideSchema = commonGuideSchema.extend({
  modelId: z.literal("minimax-h3"),
  outputContentType: z.literal("video/mp4"),
  pinnedQuality: z.object({
    steps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frames: z.number().int().positive(),
    fps: z.number().positive(),
    durationSeconds: z.number().positive(),
    precision: z.string(),
    approximateCache: z.boolean(),
    postprocess: z.object({
      latentScale: z.number().positive(),
      videoRestoration: z.string(),
      finalWidth: z.number().int().positive(),
      finalHeight: z.number().int().positive(),
      required: z.boolean(),
    }).passthrough(),
  }).passthrough(),
  nativeQualification: z.object({ qualified: z.boolean() }).passthrough(),
}).passthrough();

const qwenGuideSchema = commonGuideSchema.extend({
  modelId: z.literal("qwen-image-2-1"),
  outputContentType: z.literal("image/png"),
  pinnedQuality: z.object({
    precision: z.string(),
    steps: z.number().int().positive(),
    cfg: z.number().positive(),
    outputResolution: z.number().int().positive(),
    useKvCache: z.boolean(),
    cpuOffload: z.boolean(),
    defaultSeed: z.number().int().nonnegative(),
  }).passthrough(),
  optionalRuntimeSettings: z.array(z.object({ name: z.string(), type: z.string(), required: z.boolean() }).passthrough()),
}).passthrough();

const qwenReferenceInputSchema = z.object({
  name: z.literal("referenceImages"),
  type: z.literal("filename-list"),
  required: z.literal(false),
  minItems: z.literal(0),
  maxItems: z.literal(10),
}).passthrough();

const h3QualitySchema = z.object({
  kind: z.literal("video"),
  steps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().positive(),
  fps: z.number().positive(),
  durationSeconds: z.number().positive(),
  precision: z.string(),
  approximateCache: z.boolean(),
  postprocess: z.object({
    latentScale: z.number().positive(),
    videoRestoration: z.string(),
    finalWidth: z.number().int().positive(),
    finalHeight: z.number().int().positive(),
    required: z.boolean(),
  }).strict(),
}).strict();

const qwenQualitySchema = z.object({
  kind: z.literal("image"),
  precision: z.string(),
  steps: z.number().int().positive(),
  cfg: z.number().positive(),
  outputResolution: z.number().int().positive(),
  useKvCache: z.boolean(),
  cpuOffload: z.boolean(),
  defaultSeed: z.number().int().nonnegative(),
}).strict();

export const hyperRenderBlockers = [
  "native-model-unqualified",
  "gpu-profile-unverified",
  "model-gpu-unqualified",
  "project-connection-missing",
  "project-connection-unavailable",
  "environment-required",
  "environment-model-mismatch",
  "environment-not-prepared",
  "requested-format-not-supported",
  "capacity-unverified",
  "spend-control-unverified",
  "output-delivery-unverified",
  "dispatch-disabled",
] as const;

export type HyperRenderBlocker = (typeof hyperRenderBlockers)[number];
export type HyperMediaQuality = z.infer<typeof h3QualitySchema> | z.infer<typeof qwenQualitySchema>;
export type HyperMediaSettings = { width: number; height: number } | Record<string, never>;

export function isPortraitVideoFormat(format: string): boolean {
  return /\b(reel|story|vertical|portrait)\b|9\s*:\s*16/i.test(format);
}

function promptFromExample(guide: z.infer<typeof commonGuideSchema>, maxChars: number, prompt: string) {
  const exampleInputs = guide.minimalExample.inputs;
  if (Object.keys(exampleInputs).length !== 1 || typeof exampleInputs.prompt !== "string" ||
      Object.keys(guide.minimalExample.settings).length !== 0 || guide.minimalExample.requiredInputAssetNames.length !== 0) {
    throw new Error("The current Hyper request guide does not support the prompt-only marketing workflow");
  }
  const trimmed = prompt.trim();
  if (!trimmed || trimmed.length > maxChars)
    throw new Error(`The creative prompt is empty or exceeds the current ${maxChars.toLocaleString()} character limit`);
  return trimmed;
}

function imageDimensions(format: string, rules: string[]) {
  const value = format.toLowerCase();
  const dimensions = /4\s*:\s*5/.test(value) ? { width: 1792, height: 2400 }
    : /3\s*:\s*2/.test(value) ? { width: 2528, height: 1696 }
      : /2\s*:\s*3/.test(value) ? { width: 1696, height: 2528 }
        : /16\s*:\s*9|\blandscape\b|\bwide\b/.test(value) ? { width: 2752, height: 1536 }
          : /9\s*:\s*16|\breel\b|\bstory\b|\bvertical\b|\bportrait\b/.test(value) ? { width: 1536, height: 2752 }
            : { width: 2048, height: 2048 };
  if (!rules.some(rule => rule.includes(`${dimensions.width}×${dimensions.height}`))) {
    throw new Error("The selected image format is not present in the current Hyper size guide");
  }
  return dimensions;
}

/** Build only the native image/video fields permitted by the live Hyper guide. */
export function buildHyperMediaRequestTemplate(modelValue: unknown, promptValue: string, formatValue: string) {
  const model = modelSchema.parse(modelValue);
  const parsedGuide = commonGuideSchema.parse(model.requestGuide);
  if (parsedGuide.modelId !== model.id) throw new Error("The Hyper model and request guide do not match");

  if (model.id === "minimax-h3") {
    const guide = h3GuideSchema.parse(parsedGuide);
    if (guide.outputContentType !== "video/mp4" ||
        guide.nativeQualification.qualified !== model.nativeQualified ||
        guide.inputs.length !== 1 ||
        !promptInputSchema.safeParse(guide.inputs[0]).success ||
        guide.inputAssets.length !== 0) {
      throw new Error("The current H3 request guide does not match the supported text-to-video contract");
    }
    const prompt = promptFromExample(guide, (guide.inputs[0] as { maxChars: number }).maxChars, promptValue);
    const guideHash = createHash("sha256").update(JSON.stringify(guide)).digest("hex");
    return {
      modelId: guide.modelId,
      kind: "video" as const,
      outputContentType: guide.outputContentType,
      guideHash,
      nativeQualified: model.nativeQualified,
      readiness: model.readiness,
      format: formatValue,
      quality: h3QualitySchema.parse({ kind: "video", ...guide.pinnedQuality }),
      settings: {} as HyperMediaSettings,
      request: {
        inputs: { prompt },
        settings: {},
        inputRefs: [] as { assetId: string; name: string; kind: "input" }[],
        outputKind: "final" as const,
        finalRetention: "project-default" as const,
      },
    };
  }

  const guide = qwenGuideSchema.parse(parsedGuide);
  const promptInput = promptInputSchema.safeParse(guide.inputs[0]);
  const referenceInput = qwenReferenceInputSchema.safeParse(guide.inputs[1]);
  const referenceAsset = guide.inputAssets[0] as Record<string, unknown> | undefined;
  if (guide.outputContentType !== "image/png" ||
      guide.inputs.length !== 2 || !promptInput.success || !referenceInput.success ||
      guide.inputAssets.length !== 1 || referenceAsset?.inputField !== "referenceImages" ||
      referenceAsset.required !== false || referenceAsset.minFiles !== 0 ||
      referenceAsset.maxFiles !== 10 ||
      !guide.optionalRuntimeSettings.some(setting => setting.name === "width" && setting.type === "integer" && setting.required === false) ||
      !guide.optionalRuntimeSettings.some(setting => setting.name === "height" && setting.type === "integer" && setting.required === false)) {
    throw new Error("The current Qwen guide does not match the supported prompt-only image contract");
  }

  const imagePromptInput = promptInputSchema.parse(guide.inputs[0]);
  const prompt = promptFromExample(guide, imagePromptInput.maxChars, promptValue);
  const dimensions = imageDimensions(formatValue, guide.rules);
  const guideHash = createHash("sha256").update(JSON.stringify(guide)).digest("hex");
  const quality = qwenQualitySchema.parse({ kind: "image", ...guide.pinnedQuality });
  return {
    modelId: guide.modelId,
    kind: "image" as const,
    outputContentType: guide.outputContentType,
    guideHash,
    nativeQualified: model.nativeQualified,
    readiness: model.readiness,
    format: formatValue,
    quality,
    settings: dimensions,
    request: {
      inputs: { prompt },
      settings: dimensions,
      inputRefs: [] as { assetId: string; name: string; kind: "input" }[],
      outputKind: "final" as const,
      finalRetention: "project-default" as const,
    },
  };
}
