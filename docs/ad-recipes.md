# Client render-plan contract

`generate-ad` is intentionally a single-provider production task:

- Moving scenes use Higgsfield **Seedance 2.0** only.
- Every moving scene requires an approved client product/reference image.
- Cards are deterministic Sharp/FFmpeg frames; music and transition SFX use the linked Higgsfield subscription.
- Input-image quality and final-frame drift are checked. A drifting clip is replaced by a deterministic Ken-Burns treatment of the approved still.
- No FAL, OpenAI image generation, ElevenLabs, first/last-frame, or lipsync route exists in this task. A missing subscription credit balance or render failure is surfaced to the operator without provider fallback.

The Work API creates this payload after the client has approved a render plan. `subscriptionOnly` must remain `true`; URLs are short-lived signed URLs generated from the retained client asset key.

```json
{
  "title": "Volta earbuds — product-film draft",
  "subscriptionOnly": true,
  "quick": true,
  "musicPrompt": "polished, modern product-film atmosphere, no vocals",
  "scenes": [
    {
      "kind": "i2v",
      "model": "seedance-2",
      "imageUrl": "https://signed-media.example/approved/volta-hero.jpg",
      "intent": "Matte-black earbuds and charging case remain recognisable throughout the shot.",
      "motion": "Slow premium dolly toward the product, restrained teal rim-light reflections, no new objects.",
      "seconds": 5
    },
    {
      "kind": "i2v",
      "model": "seedance-2",
      "imageUrl": "https://signed-media.example/approved/volta-detail.jpg",
      "intent": "Close product detail remains accurate to the approved image.",
      "motion": "Gentle macro orbit, controlled highlight roll across the case, stable logo.",
      "seconds": 5
    },
    {
      "kind": "card",
      "model": "seedance-2",
      "cardTitle": "SOUND THAT MOVES",
      "cardSub": "VOLTA — SHOP NOW",
      "motion": "Hold clean brand end card",
      "seconds": 3
    }
  ]
}
```

Seedance clips are 4–15 seconds. The renderer normalizes the assembled output to a 1080×1920 H.264 social-video delivery; it does not claim a 4K output after that normalization.
