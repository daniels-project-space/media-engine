import { vaultService, vaultSet } from "./vault";

const API = "https://fnf.higgsfield.ai/agents";
const AUTH = "https://fnf-device-auth.higgsfield.ai";
const UA = "hf-cli/1";

// Higgsfield access tokens expire hourly and refresh tokens rotate on use, so a
// naive per-call refresh would race and burn the rotating token. We refresh at
// most once per cold task, persist the rotated pair, and reuse the access token.
let cachedAccess: string | null = null;

async function tokens(): Promise<{ access: string; refresh: string | null }> {
  const s = await vaultService("higgsfield");
  return { access: s.HIGGSFIELD_ACCESS_TOKEN, refresh: s.HIGGSFIELD_REFRESH_TOKEN ?? null };
}

async function refresh(refreshToken: string): Promise<string | null> {
  const r = await fetch(`${AUTH}/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!r.ok) return null;
  const t = (await r.json()) as { access_token: string; refresh_token: string };
  // Persist the rotated pair so the next cold task starts valid.
  await vaultSet("higgsfield", "HIGGSFIELD_ACCESS_TOKEN", t.access_token);
  await vaultSet("higgsfield", "HIGGSFIELD_REFRESH_TOKEN", t.refresh_token);
  cachedAccess = t.access_token;
  return t.access_token;
}

async function authed(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<Response> {
  if (!cachedAccess) cachedAccess = (await tokens()).access;
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
    const { refresh: rt } = await tokens();
    if (rt) {
      const fresh = await refresh(rt);
      if (fresh) return authed(method, path, body, true);
    }
    cachedAccess = null;
  }
  return r;
}

export async function higgsBalance(): Promise<number> {
  const r = await authed("GET", "/balance");
  if (!r.ok) throw new Error(`higgs balance HTTP ${r.status}`);
  return ((await r.json()) as { credits: number }).credits;
}

export async function higgsCost(jobSetType: string, params: Record<string, unknown>): Promise<number> {
  const r = await authed("POST", "/jobs/cost", { job_set_type: jobSetType, params });
  if (!r.ok) throw new Error(`higgs cost HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return ((await r.json()) as { credits_exact?: number; credits?: number }).credits_exact
    ?? ((await r.json()) as { credits: number }).credits;
}

// Uploads image bytes to Higgsfield, returns a media-input id usable as input_image.
export async function higgsUploadImage(bytes: Buffer): Promise<string> {
  const r = await authed("POST", "/uploads?type=image", { filename: "scene.png", content_type: "image/png" });
  if (!r.ok) throw new Error(`higgs upload-slot HTTP ${r.status}`);
  const slot = (await r.json()) as { id: string; upload_url: string };
  const put = await fetch(slot.upload_url, {
    method: "PUT",
    headers: { "content-type": "image/png" },
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
  durationSeconds?: number;
  aspectRatio?: string;
  extraParams?: Record<string, unknown>;
}): Promise<{ url: string; credits: number }> {
  const uploadId = await higgsUploadImage(opts.imageBytes);
  const params: Record<string, unknown> = {
    prompt: opts.prompt,
    duration: opts.durationSeconds ?? 5,
    aspect_ratio: opts.aspectRatio ?? "9:16",
    input_image: { id: uploadId, type: "media_input" },
    ...opts.extraParams,
  };

  const credits = await higgsCost(opts.jobSetType, params).catch(() => 0);

  const sub = await authed("POST", "/jobs", { job_set_type: opts.jobSetType, params });
  if (!sub.ok) throw new Error(`higgs submit HTTP ${sub.status}: ${(await sub.text()).slice(0, 300)}`);
  const ids = (await sub.json()) as string[];
  const jobId = Array.isArray(ids) ? ids[0] : (ids as { id?: string }).id;
  if (!jobId) throw new Error("higgs submit returned no job id");

  for (let i = 0; i < 120; i++) {
    await new Promise((res) => setTimeout(res, 6000));
    const p = await authed("GET", `/jobs/${jobId}`);
    if (!p.ok) continue;
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
