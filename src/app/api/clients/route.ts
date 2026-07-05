import { NextRequest, NextResponse } from "next/server";
import { vaultService } from "@/lib/vault";
import { aiEnabled } from "@/lib/ai-gate";
import { presignedGet } from "@/lib/storage";

export const maxDuration = 60;

// Client-order fulfilment bridge (Fiverr AI-ads agency).
//   action "generate": turn a brief (+ optional product image) into a 4K Seedance ad
//   action "draft-reply": AI-draft a buyer reply the seller sends manually (Fiverr
//                         forbids automated buyer messaging — drafts only)
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    action: "generate" | "draft-reply";
    orderId?: string;
    brief?: string;
    tier?: "basic" | "standard" | "premium";
    productImageKey?: string;
    buyerMessage?: string;
    buyer?: string;
  };

  if (body.action === "generate") {
    if (!body.orderId || !body.brief) return NextResponse.json({ error: "orderId + brief required" }, { status: 400 });
    const trigger = await vaultService("trigger");
    const key = trigger.TRIGGER_SECRET_KEY_MEDIA_ENGINE;
    if (!key) return NextResponse.json({ error: "trigger key missing" }, { status: 500 });

    const brief = body.brief.slice(0, 600);
    const productUrl = body.productImageKey ? await presignedGet(body.productImageKey, 60 * 60 * 24) : null;
    const cinematic = body.tier === "premium"; // premium = longer narrated cut; else quick UGC

    // Scene 1 anchors on the real product image when supplied (product stays accurate).
    const scenes: Record<string, unknown>[] = [];
    if (productUrl) {
      scenes.push({ model: "seedance-4k", imageUrl: productUrl, intent: brief, motion: "slow cinematic hero reveal of the product, premium studio light, subtle move" });
      scenes.push({ model: "seedance-4k", imagePrompt: `Lifestyle scene for this product: ${brief}. Photorealistic, shot on iPhone, natural light.`, intent: brief, motion: "gentle push-in, natural motion" });
    } else {
      scenes.push({ model: "seedance-4k", imagePrompt: `Hero product shot: ${brief}. Photorealistic commercial photography, premium.`, intent: brief, motion: "slow cinematic hero reveal, premium light" });
      scenes.push({ model: "seedance-4k", imagePrompt: `Detail shot: ${brief}. Photorealistic, natural light.`, intent: brief, motion: "macro focus pull" });
    }
    scenes.push({ model: "seedance-4k", kind: "card", cardTitle: (body.buyer ?? "Your Brand"), cardSub: "Made with Media Engine", motion: "end card" });

    const payload = {
      title: `Client order — ${body.buyer ?? "buyer"}`,
      concept: `order-${body.orderId}`,
      caption: brief,
      quick: !cinematic,
      bestOf: 3,
      musicPrompt: "premium commercial music bed, glossy and driving, no vocals",
      scenes,
    };
    const r = await fetch("https://api.trigger.dev/api/v1/tasks/generate-ad/trigger", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ payload }),
    });
    const data = await r.json();
    if (!r.ok) return NextResponse.json({ error: data }, { status: r.status });
    return NextResponse.json({ runId: data.id });
  }

  if (body.action === "draft-reply") {
    if (!(await aiEnabled())) return NextResponse.json({ error: "AI drafting paused" }, { status: 200 });
    const { OPENROUTER_API_KEY } = await vaultService("openrouter");
    if (!OPENROUTER_API_KEY) return NextResponse.json({ error: "openrouter key missing" }, { status: 500 });
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        max_tokens: 500,
        messages: [
          { role: "system", content: "You are a professional, friendly AI-video-ad freelancer replying to a Fiverr buyer. Warm, concise, confident, no emojis overload. Never over-promise. Reply as plain text the seller can paste." },
          { role: "user", content: `Buyer (${body.buyer ?? "buyer"}) said:\n"${(body.buyerMessage ?? "").slice(0, 800)}"\n\nWrite a reply.` },
        ],
      }),
    });
    if (!r.ok) return NextResponse.json({ error: "draft failed" }, { status: r.status });
    const d = (await r.json()) as { choices: { message: { content: string } }[] };
    return NextResponse.json({ draft: d.choices[0].message.content.trim() });
  }

  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
