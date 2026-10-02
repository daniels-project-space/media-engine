
/** The single approved image-to-video model for this workspace. */
export const CANONICAL_VIDEO_MODEL = "seedance_2_0" as const;
export type VideoModel = typeof CANONICAL_VIDEO_MODEL;

export const SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE =
  "Seedance rendering is unavailable until the official MCP tool schema is verified from the linked production session";

/**
 * Keep the public render admission path closed as well as the worker adapter.
 * This stops a deployment from creating a render job or dispatching a Trigger
 * run before the exact billable MCP tool contract has been reviewed.
 */
export function assertSeedanceRendererEnabled(): void {
  throw new Error(SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE);
}

/**
 * A link is not permission to guess provider tool names or arguments. The
 * operator first inspects the authenticated, non-billable MCP tool manifest;
 * then this adapter is filled with an allowlisted Seedance 2.0 schema only.
 */
export async function primeHiggsfield(): Promise<void> {
  assertSeedanceRendererEnabled();
}

/**
 * Deliberately fail closed until the authenticated MCP manifest gives us the
 * exact Seedance tool name, inputs, asynchronous result, and poll semantics.
 * This replaces the retired undocumented FNF REST adapter.
 */
export async function renderClip(opts: {
  model: VideoModel;
  imageUrl?: string;
  imageBytes: Buffer;
  imageContentType?: string;
  motion: string;
  durationSeconds?: number;
  aspectRatio?: string;
  subscriptionOnly?: true;
}): Promise<{ url: string; provider: "higgsfield"; costPence: 0; credits: number }> {
  void opts;
  assertSeedanceRendererEnabled();
  // Keeps the return contract explicit to TypeScript. In practice the assertion
  // above always throws until a reviewed implementation replaces this adapter.
  throw new Error(SEEDANCE_SCHEMA_UNVERIFIED_MESSAGE);
}
