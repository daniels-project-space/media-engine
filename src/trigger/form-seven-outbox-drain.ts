import { AbortTaskRunError, logger, schedules } from "@trigger.dev/sdk";

const DRAIN_PATH = "/api/control-plane/drain";
const REQUEST_TIMEOUT_MS = 15_000;

type DrainResult = {
  attempted: number;
  delivered: number;
  queued: number;
};

function configuredValue(value: string | undefined, label: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    logger.warn("FORM / SEVEN outbox retry is not configured", { missing: label });
    return null;
  }
  return trimmed;
}

function drainEndpoint(value: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AbortTaskRunError("FORM / SEVEN outbox drain URL is invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.pathname !== DRAIN_PATH || endpoint.search || endpoint.hash) {
    throw new AbortTaskRunError("FORM / SEVEN outbox drain URL is not the approved endpoint");
  }
  return endpoint;
}

function asDrainResult(value: unknown): DrainResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("FORM / SEVEN outbox drain returned an invalid response");
  }
  const candidate = value as Record<string, unknown>;
  const counts = [candidate.attempted, candidate.delivered, candidate.queued];
  if (!counts.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0 && count <= 10_000)) {
    throw new Error("FORM / SEVEN outbox drain returned invalid aggregate counts");
  }
  return {
    attempted: candidate.attempted as number,
    delivered: candidate.delivered as number,
    queued: candidate.queued as number,
  };
}

/**
 * Retries FORM / SEVEN's durable, signed intake outbox. It only asks the
 * source site to drain already-recorded events; it cannot send a customer
 * message, create a render, publish media, or inspect a submission body.
 */
export const formSevenOutboxDrain = schedules.task({
  id: "form-seven-outbox-drain",
  cron: "17 * * * *",
  maxDuration: 60,
  retry: { maxAttempts: 3 },
  run: async () => {
    const url = configuredValue(process.env.FORM_SEVEN_OUTBOX_DRAIN_URL, "FORM_SEVEN_OUTBOX_DRAIN_URL");
    // Keep the exact bearer bytes. Whitespace is part of a token and must not
    // be normalised differently by the caller and source-site verifier.
    const token = process.env.FORM_SEVEN_OUTBOX_DRAIN_TOKEN;
    if (!url || !token || Buffer.byteLength(token, "utf8") < 32) {
      if (!token || Buffer.byteLength(token, "utf8") < 32) {
        logger.warn("FORM / SEVEN outbox retry is not configured", { missing: "FORM_SEVEN_OUTBOX_DRAIN_TOKEN" });
      }
      return { configured: false, attempted: 0, delivered: 0, queued: 0 };
    }

    const endpoint = drainEndpoint(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        logger.error("FORM / SEVEN outbox drain was rejected", { status: response.status });
        if (response.status >= 400 && response.status < 500) {
          throw new AbortTaskRunError("FORM / SEVEN outbox drain authentication or endpoint configuration was rejected");
        }
        throw new Error(`FORM / SEVEN outbox drain failed with HTTP ${response.status}`);
      }
      const result = asDrainResult(await response.json());
      logger.log("FORM / SEVEN outbox drain completed", result);
      return { configured: true, ...result };
    } finally {
      clearTimeout(timeout);
    }
  },
});
