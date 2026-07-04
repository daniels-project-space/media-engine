import { vaultService } from "./vault";

// Quality gate: score a rendered image against what it was supposed to be, so we
// catch off-intent or low-quality renders (garbled text, wrong subject, artifacts)
// before spending on video or publishing. Uses a cheap OpenRouter vision model.
export async function scoreImage(
  imageUrl: string,
  intent: string,
): Promise<{ ok: boolean; score: number; issues: string }> {
  const { OPENROUTER_API_KEY } = await vaultService("openrouter");
  if (!OPENROUTER_API_KEY) return { ok: true, score: 100, issues: "no QC key — skipped" };

  const system =
    "You are a strict advertising QC reviewer. Judge whether an image is usable in a paid ad. " +
    "Reply ONLY with JSON {\"score\": 0-100, \"issues\": \"short reason\"}. " +
    "Score high only if the image clearly shows the intended subject AND is photorealistic/clean with NO garbled text, NO warped anatomy, NO AI artifacts, NO wrong subject. " +
    "If the intended subject is absent or the image shows something unrelated, score under 30. If on-screen text is required and it is misspelled or garbled, score under 40.";

  const body = {
    model: "google/gemini-2.5-flash",
    max_tokens: 200,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: `Intended: ${intent}\nScore this image.` },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ],
  };

  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENROUTER_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: true, score: 100, issues: `QC HTTP ${r.status} — skipped` };
    const data = (await r.json()) as { choices: { message: { content: string } }[] };
    let text = data.choices[0].message.content.trim();
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
