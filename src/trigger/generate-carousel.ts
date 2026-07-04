import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { putObject, presignedGet } from "../lib/storage";
import { scoreImage } from "../lib/vision";
import { buildVariantTag } from "../lib/variant";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const DEFAULT_CAP_PENCE = 500;
const EST_PENCE_PER_IMAGE = 8; // gpt-image-2 medium portrait, conservative estimate
const DEFAULT_BEST_OF = 2;

const SAFETY_CLAUSE =
  " Fully clothed in modest everyday clothing, tasteful family-friendly lifestyle content, no suggestive posing.";

type Payload = {
  // Either generate an EXISTING planned post (postId) or an inline spec.
  postId?: string;
  streamSlug?: string;
  platform?: string;
  kind?: "carousel" | "reel" | "short" | "image" | "story";
  title?: string;
  hook?: string;
  caption?: string;
  prompts?: string[];
  personaId?: string;
  usePersonaLock?: boolean;
  quality?: "low" | "medium" | "high";
  bestOf?: number; // candidates per slide, keep the highest-scoring (default 2)
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function generateImage(apiKey: string, prompt: string, quality: string, n: number): Promise<Buffer[]> {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1536", quality, moderation: "low", n }),
  });
  if (!r.ok) {
    const detail = await r.text();
    const err = new Error(`gpt-image-2 HTTP ${r.status}: ${detail.slice(0, 300)}`);
    (err as Error & { safety?: boolean }).safety = detail.includes("safety");
    throw err;
  }
  const data = (await r.json()) as { data: { b64_json: string }[] };
  return data.data.map((d) => Buffer.from(d.b64_json, "base64"));
}

// Best-of-N: generate N candidates, keep the highest vision-QC score vs intent.
async function bestSlide(
  apiKey: string,
  prompt: string,
  quality: string,
  n: number,
): Promise<{ bytes: Buffer; score: number }> {
  const candidates = await generateImage(apiKey, prompt, quality, n);
  const scored = await Promise.all(
    candidates.map(async (bytes) => {
      const { score } = await scoreImage(`data:image/png;base64,${bytes.toString("base64")}`, prompt);
      return { bytes, score };
    }),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

export const generateCarousel = task({
  id: "generate-carousel",
  maxDuration: 900,
  run: async (payload: Payload, { ctx }) => {
    const convex = new ConvexHttpClient(CONVEX_URL);

    // Resolve the post: reuse existing (planned post or retry attempt) or create one.
    let postId: Id<"posts">;
    let prompts: { prompt: string; role?: string }[];
    let personaId: string | undefined;

    if (payload.postId) {
      const post = await convex.query(api.posts.get, { id: payload.postId as Id<"posts"> });
      if (!post) throw new AbortTaskRunError(`post ${payload.postId} not found`);
      if (post.status === "ready" || post.status === "published") {
        logger.log("post already generated, skipping", { postId: post._id });
        return { postId: post._id, slides: post.slides?.length ?? 0, skipped: true };
      }
      postId = post._id;
      prompts = (post.slides ?? []).map((s) => ({ prompt: s.prompt, role: s.role }));
      personaId = post.personaId;
      if (prompts.length === 0) throw new AbortTaskRunError("post has no slide prompts");
    } else {
      if (!payload.prompts?.length || !payload.streamSlug) {
        throw new AbortTaskRunError("need postId or (prompts + streamSlug)");
      }
      // Idempotency across Trigger retries: reuse the post tagged with this run id.
      const failedPosts = await convex.query(api.posts.byStatus, { status: "failed" });
      const generating = await convex.query(api.posts.byStatus, { status: "generating" });
      const prior = [...failedPosts, ...generating].find((p) => p.externalId === ctx.run.id);
      if (prior) {
        postId = prior._id;
      } else {
        const tag = buildVariantTag({
          concept: payload.title ?? payload.streamSlug,
          hook: payload.hook ?? payload.caption,
          variantId: ctx.run.id.slice(-8),
        });
        postId = (await convex.mutation(api.posts.create, {
          streamSlug: payload.streamSlug,
          personaId: payload.personaId as Id<"personas"> | undefined,
          platform: payload.platform ?? "instagram",
          kind: payload.kind ?? "carousel",
          title: payload.title,
          hook: payload.hook,
          caption: payload.caption,
          slides: payload.prompts.map((p) => ({ prompt: p })),
          externalId: ctx.run.id,
          variantTag: tag.variantTag,
          concept: tag.concept,
          hookId: tag.hookId,
          variantId: tag.variantId,
        })) as Id<"posts">;
      }
      prompts = payload.prompts.map((p) => ({ prompt: p }));
      personaId = payload.personaId;
    }

    // Budget guard — cap comes from settings, default £5/day.
    const settings = await convex.query(api.settings.all, {});
    const cap = Number(settings.dailyCapPence ?? DEFAULT_CAP_PENCE);
    const spend = await convex.query(api.spend.forDay, { day: today() });
    const estimate = prompts.length * EST_PENCE_PER_IMAGE;
    if (spend.totalPence + estimate > cap) {
      throw new AbortTaskRunError(
        `daily budget cap: spent ${spend.totalPence}p + estimated ${estimate}p exceeds ${cap}p`,
      );
    }

    let lock = "";
    if ((payload.usePersonaLock ?? Boolean(personaId)) && personaId) {
      const personas = await convex.query(api.personas.list, {});
      const persona = personas.find((p) => p._id === personaId);
      if (persona) lock = persona.globalLock + " ";
    }

    await convex.mutation(api.posts.setStatus, { id: postId, status: "generating" });
    const { OPENAI_API_KEY } = await vaultService("openai");
    if (!OPENAI_API_KEY) throw new AbortTaskRunError("vault openai/OPENAI_API_KEY missing");

    const bestOf = Math.max(1, Math.min(4, payload.bestOf ?? DEFAULT_BEST_OF));
    let scoreSum = 0;
    let scoreCount = 0;

    try {
      const slides: { r2Key: string; url: string; prompt: string; role?: string }[] = [];
      for (let i = 0; i < prompts.length; i++) {
        const base = lock + prompts[i].prompt;
        const quality = payload.quality ?? "medium";
        logger.log(`slide ${i + 1}/${prompts.length} (best-of-${bestOf})`);
        let picked: { bytes: Buffer; score: number };
        try {
          picked = await bestSlide(OPENAI_API_KEY, base, quality, bestOf);
        } catch (err) {
          // Safety rejections are usually prompt-phrasing flukes — one softened retry.
          if ((err as Error & { safety?: boolean }).safety) {
            logger.warn(`slide ${i + 1} safety-flagged, retrying with softened prompt`);
            picked = await bestSlide(OPENAI_API_KEY, base + SAFETY_CLAUSE, quality, bestOf);
          } else {
            throw err;
          }
        }
        scoreSum += picked.score;
        scoreCount++;
        logger.log(`slide ${i + 1} winner score ${picked.score}`);
        const r2Key = `posts/${postId}/slide-${i + 1}.png`;
        await putObject(r2Key, picked.bytes, "image/png");
        const url = await presignedGet(r2Key);
        slides.push({ r2Key, url, prompt: base, role: prompts[i].role });

        await convex.mutation(api.spend.log, {
          day: today(),
          service: "openai",
          model: `gpt-image-2 x${bestOf}`,
          costPence: EST_PENCE_PER_IMAGE * bestOf,
          ref: postId,
        });
      }

      await convex.mutation(api.posts.attachResult, { id: postId, slides });
      if (scoreCount > 0) {
        await convex.mutation(api.posts.setQc, { id: postId, qcScore: Math.round(scoreSum / scoreCount) });
      }
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
