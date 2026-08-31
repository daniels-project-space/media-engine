import "server-only";
import { aiEnabled } from "@/lib/ai-gate";

/**
 * Creator Promotions uses its own narrow server-side OpenAI credential. It is
 * deliberately not added to the shared vault allowlist: this surface should
 * never be able to read arbitrary cross-product credentials. Configure the
 * private deployment secret directly as `CREATOR_OPENAI_API_KEY`.
 */
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 2_048;
const MAX_INSTRUCTIONS_CHARS = 10_000;
const MAX_INPUT_CHARS = 24_000;
const MAX_RESPONSE_TEXT_CHARS = 48_000;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

export type CreatorPromotionLlmHealth = {
  status: "ready" | "paused" | "unavailable";
  canGenerate: boolean;
  model: string;
  authentication: "openai_api";
  missing: readonly string[];
  notes: readonly string[];
};

type CreatorPromotionRuntime = {
  apiKey: string;
  model: string;
};

type ResponsesApiPayload = {
  output_text?: unknown;
  output?: unknown;
};

export type CreatorPromotionJsonOptions = {
  system: string;
  user: string;
  maxOutputTokens: number;
};

function envValue(name: "CREATOR_LLM_ENABLED" | "CREATOR_LLM_MODEL" | "CREATOR_OPENAI_API_KEY"): string {
  return process.env[name]?.trim() ?? "";
}

function staticConfiguration(): { runtime?: CreatorPromotionRuntime; missing: string[] } {
  const model = envValue("CREATOR_LLM_MODEL");
  const apiKey = envValue("CREATOR_OPENAI_API_KEY");
  const missing: string[] = [];

  if (!model || !MODEL_NAME.test(model)) missing.push("CREATOR_LLM_MODEL");
  // Validate only that this is a private, non-empty server secret. Key formats
  // can evolve, so a provider request—not a health probe—is the authority.
  if (apiKey.length < 20 || /\s/.test(apiKey)) missing.push("CREATOR_OPENAI_API_KEY");

  return missing.length ? { missing } : { runtime: { apiKey, model }, missing };
}

/**
 * Health is intentionally static: it reads only the global kill switch and
 * local server configuration. It must never make an OpenAI request.
 */
export async function checkCreatorPromotionLlmHealth(): Promise<CreatorPromotionLlmHealth> {
  if (!(await aiEnabled())) {
    return {
      status: "paused",
      canGenerate: false,
      model: envValue("CREATOR_LLM_MODEL") || "Not configured",
      authentication: "openai_api",
      missing: ["Global AI enablement"],
      notes: ["Generation is paused. No OpenAI request can be made until the server-side AI setting is enabled."],
    };
  }

  if (envValue("CREATOR_LLM_ENABLED") !== "true") {
    return {
      status: "paused",
      canGenerate: false,
      model: envValue("CREATOR_LLM_MODEL") || "Not configured",
      authentication: "openai_api",
      missing: ["CREATOR_LLM_ENABLED=true"],
      notes: ["Creator draft generation is separately disabled. No OpenAI request will be made."],
    };
  }

  const configuration = staticConfiguration();
  if (!configuration.runtime) {
    return {
      status: "unavailable",
      canGenerate: false,
      model: envValue("CREATOR_LLM_MODEL") || "Not configured",
      authentication: "openai_api",
      missing: configuration.missing,
      notes: ["Creator draft generation is fail-closed until its private server configuration is complete."],
    };
  }

  return {
    status: "ready",
    canGenerate: true,
    model: configuration.runtime.model,
    authentication: "openai_api",
    missing: [],
    notes: ["The server can request draft-only structured output. This status does not send a provider health probe."],
  };
}

async function requireCreatorPromotionRuntime(): Promise<CreatorPromotionRuntime> {
  const health = await checkCreatorPromotionLlmHealth();
  if (!health.canGenerate) {
    throw new Error("Creator Promotion AI is unavailable; no model request was made.");
  }

  const configuration = staticConfiguration();
  if (!configuration.runtime) {
    // The environment can change between the static health projection and use.
    throw new Error("Creator Promotion AI is unavailable; no model request was made.");
  }
  return configuration.runtime;
}

function responseText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const payload = value as ResponsesApiPayload;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload.output)) return undefined;

  const output = payload.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  });
  return output.join("").trim() || undefined;
}

function assertRequestBounds(options: CreatorPromotionJsonOptions): void {
  if (!Number.isInteger(options.maxOutputTokens) || options.maxOutputTokens < 1 || options.maxOutputTokens > MAX_OUTPUT_TOKENS) {
    throw new Error("Creator Promotion AI request was rejected before sending.");
  }
  if (!options.system.trim() || !options.user.trim() || options.system.length > MAX_INSTRUCTIONS_CHARS || options.user.length > MAX_INPUT_CHARS) {
    throw new Error("Creator Promotion AI request was rejected before sending.");
  }
}

/**
 * The only billable path. It is server-only, bounded, has no tools, stores no
 * response state, and returns data for existing review-gated flows only.
 * Never log request prompts, outputs, headers, or provider error bodies here.
 */
export async function createCreatorPromotionJson<T = Record<string, unknown>>(
  options: CreatorPromotionJsonOptions,
): Promise<T> {
  assertRequestBounds(options);
  const runtime = await requireCreatorPromotionRuntime();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: runtime.model,
        instructions: options.system,
        input: options.user,
        max_output_tokens: options.maxOutputTokens,
        store: false,
        text: { format: { type: "json_object" } },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new Error("Creator Promotion AI request did not complete; no draft or plan was created.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error("Creator Promotion AI request was unavailable; no draft or plan was created.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Creator Promotion AI returned no usable output; no draft or plan was created.");
  }

  const output = responseText(payload);
  if (!output || output.length > MAX_RESPONSE_TEXT_CHARS) {
    throw new Error("Creator Promotion AI returned no usable output; no draft or plan was created.");
  }

  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error("Creator Promotion AI returned invalid structured output; no draft or plan was created.");
  }
}
