// Client-side helpers for referencing R2 media through the stable proxy route,
// so the UI never shows an expired presigned URL.

export type Slide = {
  r2Key?: string;
  url?: string;
  prompt: string;
  role?: string;
};

export function mediaUrl(r2Key: string): string {
  return `/api/media/${r2Key}`;
}

// Prefer the stable proxy (from r2Key); fall back to any stored presigned url.
export function slideSrc(slide: Slide): string | null {
  if (slide.r2Key) return mediaUrl(slide.r2Key);
  return slide.url ?? null;
}

export function isVideo(slide: Slide): boolean {
  return Boolean(slide.r2Key?.endsWith(".mp4") || slide.url?.includes(".mp4"));
}
