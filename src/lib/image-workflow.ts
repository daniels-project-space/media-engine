// No equivalent approved image-generation provider is configured. Keep this
// explicit so callers and Trigger runs do not silently downgrade a request.
export const IMAGE_WORKFLOW_PAUSED_REASON =
  "Image generation is paused: the OpenAI image provider was removed. Supply an approved source image to render video from existing assets.";

export function needsGeneratedImage(scene: { kind?: string; imageUrl?: string; lastImagePrompt?: string }): boolean {
  return scene.kind !== "card" && (!scene.imageUrl || Boolean(scene.lastImagePrompt));
}
