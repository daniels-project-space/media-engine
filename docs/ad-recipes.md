# Ad recipe library — generate-ad payloads

Style target (derived from studying Higgsfield's "Ads, brands & sharp text" showcase — all prompts below are original):
15s music-driven montage · 8–10 hard cuts (~1.5s each) · product-as-hero or beauty-editorial ·
max ONE stylized transition · brand text BAKED INTO the frames via GPT Image 2 (its strength) ·
locked brand palette across every shot · filmed-on-camera skin texture · billboard gloss.

Assembly rules: one i2v clip per scene, trim 1.2–1.8s in the stitch; hard match-cuts on gesture;
film-burn only before the final logo card; music bed dominant, VO = one tagline.

## A — "Hypermotion" tech-gadget spot (electronics e-com, premium tier)

```json
{"title":"Volta earbuds — hypermotion spot","scenes":[
 {"imagePrompt":"Matte-black wireless earbuds levitating in a dark studio void, volumetric teal rim light, chrome particles suspended mid-air, engraved logo 'VOLTA' crisp on the case, product-hero CGI render style, 9:16","motion":"crash zoom in toward the case as particles whip past camera","model":"seedance-lite"},
 {"imagePrompt":"Exploded-view diagram of the same earbuds, components separated in space, thin white spec callout text 'DRIVER 11MM' and '36H BATTERY' floating beside parts, dark background, consistent teal accent","motion":"slow 360 orbit, components rotating and reassembling","model":"seedance-lite"},
 {"imagePrompt":"Athletic woman mid-run at night under sodium streetlights wearing the earbuds, motion blur city bokeh, cinematic skin texture, teal accent grade","motion":"tracking shot alongside runner, slight handheld energy","model":"kling-pro"},
 {"imagePrompt":"End card: earbuds on wet black slate, droplets, bold condensed headline 'SOUND THAT MOVES' and small 'VOLTA — SHOP NOW', razor-sharp typography","motion":"subtle dolly in, droplet ripple","model":"veo-lite"}],
"voScript":"Volta. Sound that moves."}
```

## B — Luxury skincare match-cut campaign (beauty/cosmetics)

```json
{"title":"Lumea skincare — match-cut campaign","scenes":[
 {"imagePrompt":"Elegant woman with slicked-back hair in emerald satin dress descending amber-lit marble stairs holding a frosted-glass serum bottle labeled 'LUMEA', editorial fashion photography, filmic grain, real skin texture","motion":"slow crane down following her descent","model":"kling-pro"},
 {"imagePrompt":"Extreme macro: dollop of white cream swirling on a fingertip, jar lid beside it reading 'LUMEA NIGHT REPAIR' in sharp serif type, soft morning window light","motion":"macro focus pull as finger lifts cream","model":"kling-turbo"},
 {"imagePrompt":"Different woman floating on her back in a turquoise pool, serum bottle standing on the pool edge in foreground, high-key sunlight, water caustics on skin","motion":"top-down drift, gentle water ripple","model":"kling-pro"},
 {"imagePrompt":"Third woman lit by magenta-and-cyan neon, inverted composition, applying one serum drop to cheekbone, glass dropper catching neon highlights, bottle label 'LUMEA' tack-sharp","motion":"slow rotate from upside-down to upright","model":"seedance-lite"}],
"voScript":"Three women. One ritual. Lumea."}
```

Palette lock: serum green + cream white in every prompt.

## C — Restaurant "sharp text" menu drop (local food clients)

```json
{"title":"Friday Stack — menu drop","scenes":[
 {"imagePrompt":"Smash burger mid-assembly, cheese melting over the patty edge, flame flare behind, chalk-style headline 'THE FRIDAY STACK' baked into dark background, appetizing commercial food photography","motion":"crash zoom into the cheese melt","model":"seedance-lite"},
 {"imagePrompt":"Overhead of fries cascading into a steel basket, salt crystals frozen mid-air, price tag card reading '£8.50 — FRI ONLY' crisp in corner","motion":"slow-motion fall, camera pushes in overhead","model":"kling-turbo"},
 {"imagePrompt":"Neon-lit storefront at dusk, sign reading the restaurant name sharply, warm interior glow, a hand pulling the door open","motion":"dolly toward the door as it opens","model":"veo-lite"}],
"voScript":"The Friday Stack. One day. No mercy."}
```

## D — Streetwear drop teaser (fashion e-com)

```json
{"title":"ARC/03 — drop teaser","scenes":[
 {"imagePrompt":"Model in oversized graphite hoodie against raw concrete, hood text embroidery 'ARC/03' sharply legible, single hard spotlight, editorial street style","motion":"whip pan arriving on subject, settle","model":"kling-pro"},
 {"imagePrompt":"The hoodie folded on a rotating pedestal in a white void, stitched label macro reading 'ARC/03 — 200 UNITS', studio product lighting","motion":"360 orbit with focus change fabric-to-label","model":"seedance-lite"},
 {"imagePrompt":"Full-bleed typographic end card: massive condensed numerals '10.07' with 'DROPS FRIDAY' beneath, grain texture, brand color band","motion":"subtle parallax zoom, letters holding razor sharp","model":"veo-lite"}],
"voScript":"Two hundred units. Then it's gone."}
```

Plus the six archetypes from the portfolio blueprint (crash-zoom hero, food macro, product-in-hand,
before/after FLF, unboxing, lipsync testimonial) — see project memory / session research.
Cost per ad at these model choices: ~£0.70–1.60.
