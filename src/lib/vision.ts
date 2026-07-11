import { aiEnabled } from "./ai-gate";
import { anthropicCreds, MODEL } from "./llm";

// Quality gate: score a rendered image against what it was supposed to be, so we
// catch off-intent or low-quality renders (garbled text, wrong subject, artifacts)
// before spending on video or publishing. Uses Claude vision on the subscription.
export async function scoreImage(
  imageUrl: string,
  intent: string,
): Promise<{ ok: boolean; score: number; issues: string }> {
  if (!(await aiEnabled())) return { ok: true, score: 100, issues: "AI paused — QC skipped" };

  const system =
    "You are a strict advertising QC reviewer. Judge whether an image is usable in a paid ad. " +
    "Reply ONLY with JSON {\"score\": 0-100, \"issues\": \"short reason\"}. " +
    "Score high only if the image clearly shows the intended subject AND is photorealistic/clean with NO garbled text, NO warped anatomy, NO AI artifacts, NO wrong subject. " +
    "If the intended subject is absent or the image shows something unrelated, score under 30. If on-screen text is required and it is misspelled or garbled, score under 40.";

  try {
    const { base, token, apiKey } = await anthropicCreds();
    const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": "2023-06-01" };
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else if (apiKey) {
      headers["x-api-key"] = apiKey;
    } else {
      return { ok: true, score: 100, issues: "no Claude credential — QC skipped" };
    }
    const r = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Intended: ${intent}\nScore this image.` },
              { type: "image", source: { type: "url", url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!r.ok) return { ok: true, score: 100, issues: `QC HTTP ${r.status} — skipped` };
    const data = (await r.json()) as { content?: { type: string; text?: string }[] };
    let text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
    const s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1) text = text.slice(s, e + 1);
    const parsed = JSON.parse(text) as { score: number; issues?: string };
    const score = Number(parsed.score) || 0;
    return { ok: score >= 60, score, issues: parsed.issues ?? "" };
  } catch (err) {
    // QC must never block a render on its own failure — fail open.
    return { ok: true, score: 100, issues: `QC error: ${String(err).slice(0, 80)} — skipped` };
  }
}
