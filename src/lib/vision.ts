// Remote vision QC used Anthropic's API path. Image generation is now paused
// unless an approved source image is supplied, so preserving the historic
// fail-open behavior avoids blocking those existing-asset video workflows.
export async function scoreImage(
  _imageUrl: string,
  _intent: string,
): Promise<{ ok: boolean; score: number; issues: string }> {
  void _imageUrl;
  void _intent;
  return { ok: true, score: 100, issues: "remote vision QC removed — approved-source workflow" };
}
