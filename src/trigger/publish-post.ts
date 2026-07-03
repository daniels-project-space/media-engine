import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { vaultService } from "../lib/vault";

const CONVEX_URL = "https://blissful-sardine-231.convex.cloud";
const IG_BASE = "https://graph.instagram.com/v23.0";

async function ig(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(`${IG_BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`IG ${path}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function waitContainer(id: string, token: string) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${IG_BASE}/${id}?fields=status_code&access_token=${token}`);
    const d = (await r.json()) as { status_code?: string };
    if (d.status_code === "FINISHED") return;
    if (d.status_code === "ERROR") throw new Error(`IG container ${id} errored`);
    await new Promise((res) => setTimeout(res, 4000));
  }
  throw new Error(`IG container ${id} not ready after 2min`);
}

// Publishes an approved post to its persona's linked account.
// Instagram uses the "Instagram API with Instagram Login" flow (no Facebook Page):
// per-slide containers -> carousel container -> media_publish.
export const publishPost = task({
  id: "publish-post",
  maxDuration: 600,
  run: async (payload: { postId: string }) => {
    const convex = new ConvexHttpClient(CONVEX_URL);
    const post = await convex.query(api.posts.get, { id: payload.postId as Id<"posts"> });
    if (!post) throw new AbortTaskRunError("post not found");
    if (post.status !== "approved") throw new AbortTaskRunError(`post is ${post.status}, not approved`);

    const accounts = await convex.query(api.accounts.list, {});
    const account = accounts.find(
      (a) => a.platform === post.platform && (!post.personaId || a.personaId === post.personaId),
    );

    try {
      if (!account) throw new Error(`no ${post.platform} account configured for this post`);
      if (!account.tokenKey) {
        throw new Error(
          `account ${account.handle} not linked — connect it in Settings (needs ${post.platform} token in vault)`,
        );
      }
      const secrets = await vaultService(account.tokenService ?? "media-engine-accounts");
      const token = secrets[account.tokenKey];
      const igUserId = (account.meta as { igUserId?: string } | undefined)?.igUserId;
      if (!token || !igUserId) throw new Error(`token or igUserId missing for ${account.handle}`);

      if (post.platform !== "instagram") throw new Error(`${post.platform} publishing not implemented yet`);

      const slides = (post.slides ?? []).filter((s) => s.url);
      if (slides.length === 0) throw new Error("post has no rendered media");
      const caption = [post.caption, post.hook].filter(Boolean).join("\n\n");

      let creationId: string;
      if (post.kind === "reel" || post.kind === "short") {
        const c = await ig(`${igUserId}/media`, {
          media_type: "REELS",
          video_url: slides[0].url!,
          caption,
          access_token: token,
        });
        creationId = String(c.id);
        await waitContainer(creationId, token);
      } else if (slides.length === 1) {
        const c = await ig(`${igUserId}/media`, {
          image_url: slides[0].url!,
          caption,
          access_token: token,
        });
        creationId = String(c.id);
        await waitContainer(creationId, token);
      } else {
        const children: string[] = [];
        for (const s of slides.slice(0, 10)) {
          const c = await ig(`${igUserId}/media`, {
            image_url: s.url!,
            is_carousel_item: "true",
            access_token: token,
          });
          children.push(String(c.id));
        }
        for (const id of children) await waitContainer(id, token);
        const carousel = await ig(`${igUserId}/media`, {
          media_type: "CAROUSEL",
          children: children.join(","),
          caption,
          access_token: token,
        });
        creationId = String(carousel.id);
        await waitContainer(creationId, token);
      }

      const published = await ig(`${igUserId}/media_publish`, {
        creation_id: creationId,
        access_token: token,
      });

      await convex.mutation(api.posts.setStatus, { id: post._id, status: "published" });
      logger.log("published", { postId: post._id, mediaId: published.id });
      return { postId: post._id, mediaId: published.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await convex.mutation(api.posts.fail, { id: post._id, error: `publish: ${message}` });
      throw err;
    }
  },
});
