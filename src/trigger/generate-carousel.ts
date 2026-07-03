import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";
import { putObject, presignedGet } from "../lib/storage";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const DEFAULT_CAP_PENCE = 500;
const EST_PENCE_PER_IMAGE = 8; // gpt-image-2 medium portrait, conservative estimate

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
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function generateImage(apiKey: string, prompt: string, quality: string): Promise<Buffer> {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-image-2",
      prompt,
      size: "1024x1536",
      quality,
      moderation: "low",
      n: 1,
    }),
  });
  if (!r.ok) {
    const detail = await r.text();
    const err = new Error(`gpt-image-2 HTTP ${r.status}: ${detail.slice(0, 300)}`);
    (err as Error & { safety?: boolean }).safety = detail.includes("safety");
    throw err;
  }
  const data = (await r.json()) as { data: { b64_json: string }[] };
  return Buffer.from(data.data[0].b64_json, "base64");
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

    try {
      const slides: { r2Key: string; url: string; prompt: string; role?: string }[] = [];
      for (let i = 0; i < prompts.length; i++) {
        const base = lock + prompts[i].prompt;
        logger.log(`slide ${i + 1}/${prompts.length}`);
        let png: Buffer;
        try {
          png = await generateImage(OPENAI_API_KEY, base, payload.quality ?? "medium");
        } catch (err) {
          // Safety rejections are usually prompt-phrasing flukes — one softened retry.
          if ((err as Error & { safety?: boolean }).safety) {
            logger.warn(`slide ${i + 1} safety-flagged, retrying with softened prompt`);
            png = await generateImage(OPENAI_API_KEY, base + SAFETY_CLAUSE, payload.quality ?? "medium");
          } else {
            throw err;
          }
        }
        const r2Key = `posts/${postId}/slide-${i + 1}.png`;
        await putObject(r2Key, png, "image/png");
        const url = await presignedGet(r2Key);
        slides.push({ r2Key, url, prompt: base, role: prompts[i].role });

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
