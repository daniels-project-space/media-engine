import { vaultService, vaultSet } from "./vault";

const API = "https://fnf.higgsfield.ai/agents";
const AUTH = "https://fnf-device-auth.higgsfield.ai";
const UA = "hf-cli/1";

// Higgsfield access tokens expire hourly and refresh tokens rotate (single-use).
// Calls within a runtime share one refresh; a separate worker recovers from the
// persisted rotated session instead of needlessly demanding another login.
let cachedAccess: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

type HiggsTokens = { access: string | null; refresh: string | null };

function storedSession(raw?: string): HiggsTokens | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof value.access_token === "string" && typeof value.refresh_token === "string" && value.access_token && value.refresh_token) {
      return { access: value.access_token, refresh: value.refresh_token };
    }
  } catch {
    // Fall back to the initial two-secret setup. A malformed session is never
    // sent to the provider as an authentication credential.
  }
  return null;
}

async function tokens(): Promise<{ access: string | null; refresh: string | null }> {
  const s = await vaultService("higgsfield");
  // Keep rotating credentials together after the first refresh. That avoids a
  // cold worker reading an access token from one rotation and a refresh token
  // from another.
  const session = storedSession(s.HIGGSFIELD_SESSION);
  if (session) return session;
  return {
    access: s.HIGGSFIELD_ACCESS_TOKEN?.trim() || null,
    refresh: s.HIGGSFIELD_REFRESH_TOKEN?.trim() || null,
  };
}

async function waitForOtherWorkerRefresh(previousRefresh: string): Promise<string | null> {
  // A different Trigger worker may have consumed the one-time refresh token
  // milliseconds before this request. Reuse its persisted session rather than
  // treating a harmless race as an operator re-authentication requirement.
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    const latest = await tokens();
    if (latest.access && latest.refresh && latest.refresh !== previousRefresh) {
      cachedAccess = latest.access;
      return latest.access;
    }
  }
  return null;
}

async function doRefresh(): Promise<string | null> {
  const { refresh: rt } = await tokens();
  if (!rt) return null;
  const r = await fetch(`${AUTH}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ refresh_token: rt }),
  });
  if (!r.ok) return waitForOtherWorkerRefresh(rt);
  const t = (await r.json()) as { access_token?: string; refresh_token?: string };
  if (!t.access_token || !t.refresh_token) return null;
  // Persist the rotated pair as one record before using it. The two initial
  // setup secrets remain accepted only until this first successful refresh.
  await vaultSet("higgsfield", "HIGGSFIELD_SESSION", JSON.stringify(t));
  cachedAccess = t.access_token;
  return t.access_token;
}

function refreshOnce(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function authed(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<Response> {
  if (!cachedAccess) {
    const stored = await tokens();
    cachedAccess = stored.access ?? (await refreshOnce());
    if (!cachedAccess) throw new Error("Higgsfield subscription credentials are not linked");
  }
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cachedAccess}`,
      "user-agent": UA,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if ((r.status === 401 || r.status === 403) && !retried) {
    const fresh = await refreshOnce();
    if (fresh) return authed(method, path, body, true);
    cachedAccess = null;
  }
  return r;
}

// Generates audio (music via sonilo_music, SFX via mirelo_text_to_audio) and
// returns the result URL, or null if it fails (caller can proceed silent).
export async function higgsGenerateAudio(
  jobSetType: "sonilo_music" | "mirelo_text_to_audio",
  prompt: string,
  duration: number,
): Promise<string | null> {
  try {
    const sub = await authed("POST", "/jobs", { job_set_type: jobSetType, params: { prompt, duration } });
    if (!sub.ok) return null;
    const ids = (await sub.json()) as string[] | { id?: string };
    const jobId = Array.isArray(ids) ? ids[0] : ids.id;
    if (!jobId) return null;
    for (let i = 0; i < 48; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      const p = await authed("GET", `/jobs/${jobId}`);
      if (!p.ok) continue;
      const d = (await p.json()) as { status: string; result_url?: string; audio_url?: string };
      if (d.status === "completed") return d.result_url ?? d.audio_url ?? null;
      if (d.status === "failed" || d.status === "canceled") return null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function higgsBalance(): Promise<number> {
  const r = await authed("GET", "/balance");
  if (!r.ok) throw new Error(`higgs balance HTTP ${r.status}`);
  return ((await r.json()) as { credits: number }).credits;
}

export async function higgsCost(jobSetType: string, params: Record<string, unknown>): Promise<number> {
  const r = await authed("POST", "/jobs/cost", { job_set_type: jobSetType, params });
  if (!r.ok) throw new Error(`higgs cost HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  // A Response body can only be consumed once. Reading it twice made every
  // successful cost quote throw on the fallback expression and hid the exact
  // credit total needed for a fail-closed subscription render.
  const body = (await r.json()) as { credits_exact?: number; credits?: number };
  const credits = body.credits_exact ?? body.credits;
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits < 0) {
    throw new Error(`higgs cost returned no valid credit quote for ${jobSetType}`);
  }
  return credits;
}

function supportedImageType(value?: string): "image/png" | "image/jpeg" | "image/webp" {
  if (value === "image/jpeg" || value === "image/jpg") return "image/jpeg";
  if (value === "image/webp") return "image/webp";
  return "image/png";
}

// Uploads image bytes to Higgsfield, returns a media-input id usable as input_image.
// Client reference images can be JPEG/WebP as well as PNG; declaring PNG for
// every byte stream caused some providers to reject otherwise valid uploads.
export async function higgsUploadImage(bytes: Buffer, contentType?: string): Promise<string> {
  const type = supportedImageType(contentType);
  const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
  const r = await authed("POST", "/uploads?type=image", { filename: `scene.${extension}`, content_type: type });
  if (!r.ok) throw new Error(`higgs upload-slot HTTP ${r.status}`);
  const slot = (await r.json()) as { id: string; upload_url: string };
  const put = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "content-type": type },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new Error(`higgs upload PUT HTTP ${put.status}`);
  return slot.id;
}

// Submits an image-to-video job and polls to completion. Returns the result mp4 URL.
export async function higgsGenerateVideo(opts: {
  jobSetType: string;
  prompt: string;
  imageBytes: Buffer;
  imageContentType?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  extraParams?: Record<string, unknown>;
  /** Fail before submitting when the account cannot cover a quoted render. */
  availableCredits?: number;
  /** Canonical subscription renders must have a reliable credit quote. */
  requireCreditQuote?: boolean;
}): Promise<{ url: string; credits: number }> {
  const uploadId = await higgsUploadImage(opts.imageBytes, opts.imageContentType);
  const params: Record<string, unknown> = {
    prompt: opts.prompt,
    duration: opts.durationSeconds ?? 5,
    aspect_ratio: opts.aspectRatio ?? "9:16",
    input_image: { id: uploadId, type: "media_input" },
    ...opts.extraParams,
  };

  // Legacy renders may tolerate a missing quote, but a subscription-only render
  // must never submit a job whose credit use cannot be preflighted.
  const credits = opts.requireCreditQuote
    ? await higgsCost(opts.jobSetType, params)
    : await higgsCost(opts.jobSetType, params).catch(() => 0);
  if (opts.availableCredits !== undefined && credits > opts.availableCredits) {
    throw new Error(
      `higgs subscription has ${opts.availableCredits} credits but ${opts.jobSetType} needs ${credits}`,
    );
  }

  const sub = await authed("POST", "/jobs", { job_set_type: opts.jobSetType, params });
  if (!sub.ok) throw new Error(`higgs submit HTTP ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
  const ids = (await sub.json()) as string[];
  const jobId = Array.isArray(ids) ? ids[0] : (ids as { id?: string }).id;
  if (!jobId) throw new Error("higgs submit returned no job id");

  // ~5min ceiling: HF clips normally finish in under a minute, so a longer wait
  // means the job is stuck — fail closed. Also bail
  // fast if auth breaks mid-poll (repeated non-ok) instead of grinding the full 5min.
  let authFails = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise((res) => setTimeout(res, 5000));
    const p = await authed("GET", `/jobs/${jobId}`);
    if (!p.ok) {
      if (p.status === 401 || p.status === 403) {
        if (++authFails >= 3) throw new Error("higgs auth lost mid-poll");
      }
      continue;
    }
    authFails = 0;
    const d = (await p.json()) as { status: string; result_url?: string; h264_url?: string };
    if (d.status === "completed") {
      const url = d.h264_url ?? d.result_url;
      if (!url) throw new Error("higgs job completed with no result url");
      return { url, credits };
    }
    if (d.status === "failed" || d.status === "canceled") throw new Error(`higgs job ${d.status}`);
  }
  throw new Error("higgs job timed out");
}
