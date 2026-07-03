import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { putObject, presignedGet } from "../lib/storage";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const DAILY_CAP_PENCE = 500;
const EST_PENCE_PER_IMAGE = 8; // gpt-image-2 medium portrait, conservative estimate

type Payload = {
  streamSlug: string;
  platform: string;
  kind: "carousel" | "reel" | "short" | "image" | "story";
  title: string;
  hook?: string;
  caption?: string;
  prompts: string[];
  personaId?: string;
  usePersonaLock?: boolean;
  quality?: "low" | "medium" | "high";
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const generateCarousel = task({
  id: "generate-carousel",
  maxDuration: 900,
  run: async (payload: Payload) => {
    const convex = new ConvexHttpClient(CONVEX_URL);

    const spend = await convex.query(api.spend.forDay, { day: today() });
    const estimate = payload.prompts.length * EST_PENCE_PER_IMAGE;
    if (spend.totalPence + estimate > DAILY_CAP_PENCE) {
      throw new AbortTaskRunError(
        `daily cap: spent ${spend.totalPence}p + est ${estimate}p > ${DAILY_CAP_PENCE}p`,
      );
    }

    let lock = "";
    if (payload.usePersonaLock && payload.personaId) {
      const personas = await convex.query(api.personas.list, {});
      const persona = personas.find((p) => p._id === payload.personaId);
      if (!persona) throw new AbortTaskRunError(`persona ${payload.personaId} not found`);
      lock = persona.globalLock + " ";
    }

    const postId = (await convex.mutation(api.posts.create, {
      streamSlug: payload.streamSlug,
      personaId: payload.personaId as Id<"personas"> | undefined,
      platform: payload.platform,
      kind: payload.kind,
      title: payload.title,
      hook: payload.hook,
      caption: payload.caption,
      slides: payload.prompts.map((p) => ({ prompt: p })),
    })) as Id<"posts">;
    await convex.mutation(api.posts.setStatus, { id: postId, status: "generating" });
    logger.log("post created", { postId, slides: payload.prompts.length });

    const { OPENAI_API_KEY } = await vaultService("openai");
    if (!OPENAI_API_KEY) throw new AbortTaskRunError("vault openai/OPENAI_API_KEY missing");

    try {
      const slides: { r2Key: string; url: string; prompt: string }[] = [];
      for (let i = 0; i < payload.prompts.length; i++) {
        const prompt = lock + payload.prompts[i];
        logger.log(`generating slide ${i + 1}/${payload.prompts.length}`);
        const r = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            authorization: `Bearer ${OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-image-2",
            prompt,
            size: "1024x1536",
            quality: payload.quality ?? "medium",
            n: 1,
          }),
        });
        if (!r.ok) {
          const detail = await r.text();
          throw new Error(`gpt-image-2 HTTP ${r.status}: ${detail.slice(0, 300)}`);
        }
        const data = (await r.json()) as { data: { b64_json: string }[] };
        const png = Buffer.from(data.data[0].b64_json, "base64");
        const r2Key = `posts/${postId}/slide-${i + 1}.png`;
        await putObject(r2Key, png, "image/png");
        const url = await presignedGet(r2Key);
        slides.push({ r2Key, url, prompt });

        await convex.mutation(api.spend.log, {
          day: today(),
          service: "openai",
          model: "gpt-image-2",
          costPence: EST_PENCE_PER_IMAGE,
          ref: postId,
        });
      }

      await convex.mutation(api.posts.attachResult, { id: postId, slides });
      logger.log("post ready", { postId });
      return { postId, slides: slides.length };
    } catch (err) {
      await convex.mutation(api.posts.fail, {
        id: postId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
