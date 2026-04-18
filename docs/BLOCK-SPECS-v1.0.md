# BLOCK-SPECS v1.0 — Brand Launch Accelerator

**Purpose.** The contract for the 8 pending blocks in the Revlon pilot (R2.A).
Each block in this doc ships **5 artifacts** per `CLAUDE.md`:

1. `blocks/{name}/{name}.css`
2. `blocks/{name}/{name}.js`
3. `blocks/{name}/_{name}.json` — Universal Editor component-definition
4. da.live authoring notes (inline in this doc, § *Authoring*)
5. Revlon content example (inline in this doc, § *Revlon example*)

**Read order first:** `AGENTS.md` → `CLAUDE.md` → this file → `docs/CCP-v1.1.md`.

---

## Shared conventions (applies to every block)

**Decorate signature.** `export default function decorate(block) { ... }` — synchronous unless the block genuinely needs async (image pipelines, fragment fetches). Match the pattern in `blocks/product-grid/product-grid.js`.

**Selectors.** All CSS scoped under `.{blockname} ...`. Never use bare `.card` or `.title`. Never use `.{blockname}-container` or `.{blockname}-wrapper` — those are taken by sections.

**Tokens.** Reach for semantic tokens from `styles/styles.css` first:
`--color-primary`, `--color-text-primary`, `--color-text-secondary`, `--color-surface-primary`, `--color-border-default`, `--spacing-4/6/8/12/16`, `--radius-sm/md/lg`, `--duration-base`, `--easing-default`, `--heading-font-size-s/m/l/xl/xxl`, `--body-font-size-s/m`, `--nav-height`.
Tenant brand tokens cascade in via `styles/brands/{tenant}.css` — **never** read `data-brand` inside block JS.

**Responsive.** Mobile-first. `min-width: 600px` (tablet) and `min-width: 900px` (desktop) are the only breakpoints. Use `clamp()` for fluid type inside the heading scale.

**Interaction.** Reuse the shared runtime: `.reveal`, `.reveal-stagger`, `.hover-lift`, `.parallax`, `.text-reveal`, `data-count-*`, `.image-zoom`. Only add block-scoped JS for motion the runtime doesn't cover.

**A11y.** Proper heading order (never skip levels), alt text on all images, `role="list"` on `<ul>` when styling strips the default, `:focus-visible` rings on interactive elements, `prefers-reduced-motion` respected (the runtime handles this — don't add raw `requestAnimationFrame` animations without a reduced-motion branch).

**da.live authoring shape.** Row 1 of every block is the block name ("Product Hero"). Rows 2+ are content. Columns within a row map to fields. Document any extended shape (multiple rows per item, config row, etc.) in § *Authoring*.

**Universal Editor component-definition.** Every block ships `_{name}.json` at `blocks/{name}/_{name}.json` containing `definitions[]` + `models[]` + `filters[]`. Resource type is `core/franklin/components/block/v1/block`. Schema reference: [UE component definition](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/developing/universal-editor/component-definition). Keep field `name`s snake/camel-free — lowercase, hyphenated (matches authored CSS class names).

**Commit.** One block per commit. `feat(blocks): add {name} block — {one-line what it does}`. Run `npm run lint` first; fix all errors.

---

## 1. `statement` — manifesto large-type

**Purpose.** Single large-type statement with optional kicker + supporting line. Anchors a section emotionally. Used on Home and PDP for brand voice moments.

**Content model.**
- Kicker (optional, short label, e.g., "Our promise")
- Headline (required, 1–2 sentences, displayed at `heading-font-size-xxl`)
- Sub-copy (optional, one paragraph)

**Authored structure (da.live).**
```
| Statement          |
|--------------------|
| Our promise        |   ← kicker (optional, plain text)
| We don't follow... |   ← headline (h2)
| Supporting copy... |   ← sub-copy (optional <p>)
```
Any row after row 3 is ignored.

**Decorated HTML.**
```html
<div class="statement block reveal">
  <p class="statement-kicker">Our promise</p>
  <h2 class="statement-headline">We don't follow trends. We set them.</h2>
  <p class="statement-sub">Every shade is tested on real skin by real humans.</p>
</div>
```

**Key CSS.**
```css
.statement { text-align: center; padding-block: var(--spacing-16) var(--spacing-24); }
.statement .statement-kicker {
  margin: 0 0 var(--spacing-4);
  font-size: var(--body-font-size-s);
  letter-spacing: var(--letter-spacing-caps);
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.statement .statement-headline {
  margin: 0 auto;
  max-width: 22ch;
  font-family: var(--heading-font-family);
  font-size: clamp(2rem, 4vw + 1rem, var(--heading-font-size-xxl));
  font-weight: var(--heading-font-weight, 700);
  line-height: var(--line-height-tight);
  letter-spacing: var(--letter-spacing-display);
  color: var(--text-color);
}
.statement .statement-sub {
  margin: var(--spacing-6) auto 0;
  max-width: 52ch;
  color: var(--color-text-secondary);
}
```

**Interaction.** Whole block gets `.reveal` (fade-up on scroll). Optional: add `.text-reveal` to the headline for word-by-word reveal on high-impact sections.

**A11y.** Headline renders as `<h2>` by default — if the block sits at the top of the page, author overrides to `<h1>` via the UE model.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "Statement",
    "id": "statement",
    "plugins": {
      "xwalk": {
        "page": {
          "resourceType": "core/franklin/components/block/v1/block",
          "template": { "name": "Statement", "model": "statement" }
        }
      }
    }
  }],
  "models": [{
    "id": "statement",
    "fields": [
      { "component": "text", "name": "kicker", "label": "Kicker (optional)" },
      { "component": "richtext", "name": "headline", "label": "Headline" },
      { "component": "richtext", "name": "sub", "label": "Sub-copy (optional)" }
    ]
  }],
  "filters": [{ "id": "statement", "components": [] }]
}
```

**Authoring.** 3-row block. Kicker is plain text; headline and sub-copy are rich text (bold/italic allowed, no lists).

**Revlon example.**
> Kicker: "Crafted since 1932"
> Headline: "Color is our language. Confidence is the message."
> Sub: "Ninety years of shade expertise in every lipstick."

---

## 2. `cta-grid` — 2-3 entry points

**Purpose.** A grid of 2–3 destination cards. Each card = icon/image + headline + short blurb + link. Used mid-Home to route visitors into category hubs (Lips / Eyes / Face, or Shop / Learn / Inspiration).

**Content model.**
- 2 or 3 cards. Each card: image (optional), headline, one-line blurb, link label + URL.

**Authored structure.**
```
| CTA Grid                                           |
|----------------------------------------------------|
| [image] | Lips   | Bold color, all day.  | [link]  |
| [image] | Eyes   | Shades that transform. | [link] |
| [image] | Face   | Skin-first glow.      | [link]  |
```
Row 1 = block name. Each subsequent row = one card. Column order is fixed: image, headline, blurb, link.

**Decorated HTML.**
```html
<ul class="cta-grid-list" role="list">
  <li class="cta-grid-card hover-lift">
    <a class="cta-grid-link" href="/lips">
      <div class="cta-grid-image"><picture>...</picture></div>
      <h3 class="cta-grid-heading">Lips</h3>
      <p class="cta-grid-blurb">Bold color, all day.</p>
      <span class="cta-grid-cue">Shop Lips →</span>
    </a>
  </li>
  ...
</ul>
```

**Key CSS.**
```css
.cta-grid .cta-grid-list {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: 1fr; gap: var(--spacing-6);
}
@media (min-width: 600px) {
  .cta-grid .cta-grid-list { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 900px) {
  .cta-grid .cta-grid-list { grid-template-columns: repeat(3, 1fr); }
}
.cta-grid .cta-grid-link {
  display: flex; flex-direction: column; gap: var(--spacing-4);
  text-decoration: none; color: inherit;
  padding: var(--spacing-6);
  border-radius: var(--radius-md);
  background: var(--color-surface-primary);
  border: 1px solid var(--color-border-default);
  transition: transform var(--duration-base) var(--easing-default);
}
.cta-grid .cta-grid-image img { aspect-ratio: 4 / 3; width: 100%; object-fit: cover; border-radius: var(--radius-sm); }
.cta-grid .cta-grid-heading { margin: 0; font-size: var(--heading-font-size-m); }
.cta-grid .cta-grid-blurb { margin: 0; color: var(--color-text-secondary); }
.cta-grid .cta-grid-cue { margin-top: auto; color: var(--color-primary); font-weight: 600; }
```

**Decorator (key bits).**
- Wrap each authored row in `<li class="cta-grid-card hover-lift">` and an `<a>` that consumes the authored link.
- Pass the image through `createOptimizedPicture` with `[{ media: '(min-width: 900px)', width: '520' }, { width: '640' }]`.
- Normalize the "cue" label: if authored link text is just a URL, fall back to `Explore →`.

**Interaction.** `.hover-lift` (shared runtime). Parent `.cta-grid` gets `.reveal-stagger` so cards fade-up in sequence.

**A11y.** The `<a>` wraps the whole card content. Heading is `<h3>` (category cards sit under an H2 section title).

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "CTA Grid",
    "id": "cta-grid",
    "plugins": {
      "xwalk": {
        "page": {
          "resourceType": "core/franklin/components/block/v1/block",
          "template": { "name": "CTA Grid", "model": "cta-grid" }
        }
      }
    }
  }],
  "models": [
    {
      "id": "cta-grid",
      "fields": [
        { "component": "text", "name": "section-title", "label": "Section title (optional)" }
      ]
    },
    {
      "id": "cta-grid-item",
      "fields": [
        { "component": "reference", "name": "image", "label": "Image", "valueType": "string" },
        { "component": "text", "name": "image-alt", "label": "Image alt" },
        { "component": "text", "name": "heading", "label": "Heading" },
        { "component": "text", "name": "blurb", "label": "Blurb" },
        { "component": "aem-content", "name": "link", "label": "Link target" },
        { "component": "text", "name": "link-label", "label": "Link label" }
      ]
    }
  ],
  "filters": [{ "id": "cta-grid", "components": ["cta-grid-item"] }]
}
```

**Authoring.** 2 or 3 cards recommended; 4 is allowed but drops to 2-up at all breakpoints (authors should avoid).

**Revlon example.**
| Lips | Bold color, all day. | `/lips` |
| Eyes | Shades that transform. | `/eyes` |
| Face | Skin-first glow. | `/face` |

---

## 3. `product-hero` — PDP "arrive" beat

**Purpose.** The first frame of a PDP. Large product image left (or parallax bg), product name + shade + price + primary CTA + secondary CTA right. Anchors conversion.

**Content model.**
- Hero image (required)
- Product name (required, h1)
- Tagline (optional, one line)
- Shade label + swatch color (optional — shown as a chip)
- Price (required)
- Primary CTA: label + URL
- Secondary CTA: label + URL (optional)

**Authored structure.**
```
| Product Hero                                            |
|---------------------------------------------------------|
| [image]                                                 |
| Super Lustrous Lipstick                                 |
| The original creamy-color icon.                         |
| Cherries in the Snow | #B2333F                          |
| $9.99                                                   |
| [Add to bag](/cart/add/super-lustrous-cherries)         |
| [Find in store](/store-locator)                         |
```
Each row = one field (left column). Parser tolerates missing optional rows.

**Decorated HTML.**
```html
<div class="product-hero block">
  <div class="product-hero-media parallax"><picture>...</picture></div>
  <div class="product-hero-body">
    <h1 class="product-hero-name">Super Lustrous Lipstick</h1>
    <p class="product-hero-tagline">The original creamy-color icon.</p>
    <div class="product-hero-shade">
      <span class="product-hero-swatch" style="--swatch:#B2333F"></span>
      <span class="product-hero-shade-name">Cherries in the Snow</span>
    </div>
    <p class="product-hero-price">$9.99</p>
    <div class="product-hero-cta">
      <a class="button primary" href="/cart/add/...">Add to bag</a>
      <a class="button secondary" href="/store-locator">Find in store</a>
    </div>
  </div>
</div>
```

**Key CSS.**
```css
.product-hero { display: grid; grid-template-columns: 1fr; gap: var(--spacing-8); align-items: center; }
@media (min-width: 900px) { .product-hero { grid-template-columns: 1fr 1fr; gap: var(--spacing-12); } }
.product-hero .product-hero-media img { width: 100%; aspect-ratio: 4/5; object-fit: cover; border-radius: var(--radius-md); }
.product-hero .product-hero-name { margin: 0; font-size: clamp(2rem, 3vw + 1rem, var(--heading-font-size-xxl)); line-height: var(--line-height-tight); }
.product-hero .product-hero-tagline { margin: var(--spacing-4) 0 var(--spacing-6); color: var(--color-text-secondary); }
.product-hero .product-hero-shade { display: inline-flex; align-items: center; gap: var(--spacing-2); margin-bottom: var(--spacing-4); }
.product-hero .product-hero-swatch { width: 18px; height: 18px; border-radius: var(--radius-full); background: var(--swatch, #000); box-shadow: 0 0 0 1px rgb(0 0 0 / 10%); }
.product-hero .product-hero-price { font-size: var(--heading-font-size-l); margin: var(--spacing-2) 0 var(--spacing-6); }
.product-hero .product-hero-cta { display: flex; gap: var(--spacing-4); flex-wrap: wrap; }
```

**Decorator.** Pull first `<picture>` as media. Remaining rows map by position (name, tagline, shade, price, CTAs). Shade row is parsed `"name | #hex"`. CTAs detect a `<strong><a>` pattern for primary vs secondary (same convention as `scripts/aem.js` button decorator).

**Interaction.** `.product-hero-media` gets `.parallax` (subtle). `.product-hero-body` gets `.reveal`. Add `.image-zoom` to media on desktop only.

**A11y.** The name is `<h1>` on PDP. Swatch has `aria-hidden="true"` + swatch name in adjacent `<span>` for screen readers.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "Product Hero",
    "id": "product-hero",
    "plugins": {
      "xwalk": {
        "page": {
          "resourceType": "core/franklin/components/block/v1/block",
          "template": { "name": "Product Hero", "model": "product-hero" }
        }
      }
    }
  }],
  "models": [{
    "id": "product-hero",
    "fields": [
      { "component": "reference", "name": "image", "label": "Hero image", "valueType": "string" },
      { "component": "text", "name": "image-alt", "label": "Image alt" },
      { "component": "text", "name": "name", "label": "Product name", "required": true },
      { "component": "text", "name": "tagline", "label": "Tagline" },
      { "component": "text", "name": "shade-name", "label": "Shade name" },
      { "component": "text", "name": "shade-hex", "label": "Shade hex (e.g. #B2333F)" },
      { "component": "text", "name": "price", "label": "Price", "required": true },
      { "component": "aem-content", "name": "cta-primary", "label": "Primary CTA link" },
      { "component": "text", "name": "cta-primary-label", "label": "Primary CTA label" },
      { "component": "aem-content", "name": "cta-secondary", "label": "Secondary CTA link" },
      { "component": "text", "name": "cta-secondary-label", "label": "Secondary CTA label" }
    ]
  }],
  "filters": [{ "id": "product-hero", "components": [] }]
}
```

**Authoring.** Order of rows is the contract. Price string renders as authored (no currency math on the client).

**Revlon example.** Super Lustrous Lipstick, shade "Cherries in the Snow" `#B2333F`, $9.99, primary CTA `/cart/add/super-lustrous-cherries`, secondary CTA `/store-locator`.

---

## 4. `product-summary` — short copy + key specs

**Purpose.** Below-hero summary: 1 paragraph + a 4–6 item spec list (finish, wear time, ingredients highlight, size, etc.).

**Content model.**
- Summary paragraph (required)
- Spec list: label → value pairs (4–6 recommended)

**Authored structure.**
```
| Product Summary                                     |
|-----------------------------------------------------|
| Soft, buttery texture that hugs lips all day.       |  ← summary
| Finish     | Creamy                                 |
| Wear time  | Up to 8 hours                          |
| Key actives| Vitamin E, Jojoba oil                  |
| Size       | 4.2 g / 0.15 oz                        |
```
Row 1 = block name. Row 2 = summary. Remaining rows = 2-column spec rows.

**Decorated HTML.**
```html
<div class="product-summary block reveal">
  <p class="product-summary-copy">Soft, buttery texture that hugs lips all day.</p>
  <dl class="product-summary-specs">
    <div class="product-summary-spec"><dt>Finish</dt><dd>Creamy</dd></div>
    <div class="product-summary-spec"><dt>Wear time</dt><dd>Up to 8 hours</dd></div>
    ...
  </dl>
</div>
```

**Key CSS.**
```css
.product-summary { display: grid; grid-template-columns: 1fr; gap: var(--spacing-8); }
@media (min-width: 900px) { .product-summary { grid-template-columns: 5fr 4fr; } }
.product-summary .product-summary-copy { font-size: var(--body-font-size-m); line-height: var(--line-height-relaxed); }
.product-summary .product-summary-specs { margin: 0; display: grid; gap: 0; border-top: 1px solid var(--color-border-default); }
.product-summary .product-summary-spec { display: grid; grid-template-columns: 1fr 2fr; gap: var(--spacing-4); padding: var(--spacing-4) 0; border-bottom: 1px solid var(--color-border-default); }
.product-summary .product-summary-spec dt { margin: 0; color: var(--color-text-secondary); font-weight: 600; }
.product-summary .product-summary-spec dd { margin: 0; color: var(--text-color); }
```

**Decorator.** First row with only one cell → summary paragraph. Any row with two cells → a `<dt>/<dd>` pair under `<dl>`. Use `<div>` wrappers inside the `<dl>` so grid works (semantic-safe pattern).

**Interaction.** Block gets `.reveal`.

**A11y.** Real `<dl>/<dt>/<dd>` semantics — don't swap for divs.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "Product Summary",
    "id": "product-summary",
    "plugins": {
      "xwalk": { "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "Product Summary", "model": "product-summary" } } }
    }
  }],
  "models": [
    { "id": "product-summary", "fields": [{ "component": "richtext", "name": "summary", "label": "Summary" }] },
    { "id": "product-summary-spec", "fields": [
      { "component": "text", "name": "label", "label": "Spec label" },
      { "component": "text", "name": "value", "label": "Spec value" }
    ]}
  ],
  "filters": [{ "id": "product-summary", "components": ["product-summary-spec"] }]
}
```

**Authoring.** 4–6 spec rows reads best. Keep values short (< 40 chars).

**Revlon example.** Finish: Creamy. Wear: Up to 8 hours. Key actives: Vitamin E, Jojoba oil. Size: 4.2 g / 0.15 oz. Free from: Parabens, Sulfates.

---

## 5. `feature-grid` — 3×2 icon + benefit

**Purpose.** Six (or four) feature cells each with an icon, a short title, and a one-line benefit statement. Breaks up long PDP content; also used on Home.

**Content model.**
- 4 or 6 cells. Each cell: icon (SVG, via AEM icon system), title, benefit line.

**Authored structure.**
```
| Feature Grid                                    |
|-------------------------------------------------|
| :icon-leaf:   | Plant-based | 90% natural origin |
| :icon-heart:  | Cruelty-free| Never tested on animals |
| :icon-sparkle:| High-shine  | Mirror finish, no tack |
...
```
Row 1 = block name. Each subsequent row = one cell. 3 columns per row.

**Decorated HTML.**
```html
<ul class="feature-grid-list" role="list">
  <li class="feature-grid-item reveal-stagger-item">
    <span class="feature-grid-icon"><svg class="icon icon-leaf">...</svg></span>
    <h3 class="feature-grid-title">Plant-based</h3>
    <p class="feature-grid-benefit">90% natural origin ingredients.</p>
  </li>
  ...
</ul>
```

**Key CSS.**
```css
.feature-grid .feature-grid-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: var(--spacing-6); }
@media (min-width: 600px) { .feature-grid .feature-grid-list { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 900px) { .feature-grid .feature-grid-list { grid-template-columns: repeat(3, 1fr); } }
.feature-grid .feature-grid-item { display: flex; flex-direction: column; gap: var(--spacing-2); padding: var(--spacing-6); border-radius: var(--radius-md); background: var(--color-surface-secondary); }
.feature-grid .feature-grid-icon { width: 32px; height: 32px; color: var(--color-primary); }
.feature-grid .feature-grid-icon svg { width: 100%; height: 100%; }
.feature-grid .feature-grid-title { margin: 0; font-size: var(--heading-font-size-s); }
.feature-grid .feature-grid-benefit { margin: 0; color: var(--color-text-secondary); font-size: var(--body-font-size-s); }
```

**Decorator.** Use `decorateIcons` from `scripts/aem.js` for the icon column. Treat column 1 as icon (via `:icon-name:`), column 2 as title, column 3 as benefit.

**Interaction.** `.feature-grid` root gets `.reveal-stagger` (runtime staggers children).

**A11y.** Icons are decorative → `aria-hidden="true"`. Title is `<h3>`.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "Feature Grid",
    "id": "feature-grid",
    "plugins": {
      "xwalk": { "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "Feature Grid", "model": "feature-grid" } } }
    }
  }],
  "models": [
    { "id": "feature-grid", "fields": [] },
    { "id": "feature-grid-item", "fields": [
      { "component": "text", "name": "icon", "label": "Icon name (e.g. leaf)" },
      { "component": "text", "name": "title", "label": "Title" },
      { "component": "text", "name": "benefit", "label": "Benefit" }
    ]}
  ],
  "filters": [{ "id": "feature-grid", "components": ["feature-grid-item"] }]
}
```

**Authoring.** 6 items reads best on desktop (3×2). 4 works for above-fold. Icons must exist in `/icons/` — author can add new SVGs to the folder.

**Revlon example.** 6 items: Plant-based (leaf), Cruelty-free (heart), High-shine (sparkle), Long-wear (clock), Buildable (layers), Vitamin-rich (seedling).

---

## 6. `reviews-condensed` — rating + 3 reviews

**Purpose.** Aggregate star rating + 3 featured reviews. Trust signal on PDP below the fold. Not a full reviews widget — just the teaser.

**Content model.**
- Aggregate rating (e.g., `4.7`), review count (e.g., `1,240`)
- 3 reviews. Each review: star count, title, body (1–2 sentences), reviewer name, verified flag.

**Authored structure.**
```
| Reviews Condensed                              |
|------------------------------------------------|
| 4.7 | 1240                                     |  ← aggregate row
| 5   | Obsessed   | Holy grail lipstick. | Maya | verified |
| 5   | Perfect    | Best red I've owned. | Leah | verified |
| 4   | Love it    | Long-lasting, no dry. | Zoe  |          |
```

**Decorated HTML.**
```html
<div class="reviews-condensed block reveal">
  <div class="reviews-condensed-aggregate">
    <span class="reviews-condensed-score">4.7</span>
    <span class="reviews-condensed-stars" aria-label="4.7 out of 5 stars" style="--filled:94%"></span>
    <span class="reviews-condensed-count">1,240 reviews</span>
  </div>
  <ul class="reviews-condensed-list" role="list">
    <li class="reviews-condensed-item">
      <div class="reviews-condensed-stars" aria-label="5 out of 5" style="--filled:100%"></div>
      <h3 class="reviews-condensed-title">Obsessed</h3>
      <p class="reviews-condensed-body">Holy grail lipstick.</p>
      <p class="reviews-condensed-author">Maya<span class="reviews-condensed-verified">Verified buyer</span></p>
    </li>
    ...
  </ul>
</div>
```

**Key CSS.**
```css
.reviews-condensed .reviews-condensed-aggregate { display: flex; align-items: baseline; gap: var(--spacing-4); margin-bottom: var(--spacing-8); }
.reviews-condensed .reviews-condensed-score { font-size: var(--heading-font-size-xl); font-weight: 700; }
.reviews-condensed .reviews-condensed-stars {
  --filled: 0%;
  display: inline-block; width: 96px; height: 16px;
  background:
    linear-gradient(90deg, var(--color-trust-badge, #c9a84c) var(--filled), var(--color-border-default) var(--filled))
    content-box;
  /* star mask via CSS gradient — no external SVG needed */
  mask: url('/icons/stars-5.svg') center / contain no-repeat;
}
.reviews-condensed .reviews-condensed-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: var(--spacing-6); }
@media (min-width: 900px) { .reviews-condensed .reviews-condensed-list { grid-template-columns: repeat(3, 1fr); gap: var(--spacing-8); } }
.reviews-condensed .reviews-condensed-item { padding: var(--spacing-6); border: 1px solid var(--color-border-default); border-radius: var(--radius-md); }
.reviews-condensed .reviews-condensed-title { margin: var(--spacing-2) 0; font-size: var(--heading-font-size-s); }
.reviews-condensed .reviews-condensed-body { margin: 0 0 var(--spacing-4); color: var(--color-text-primary); }
.reviews-condensed .reviews-condensed-author { margin: 0; font-size: var(--body-font-size-s); color: var(--color-text-secondary); }
.reviews-condensed .reviews-condensed-verified { margin-left: var(--spacing-2); padding: 2px 6px; font-size: 0.75rem; background: var(--color-status-success); color: white; border-radius: var(--radius-sm); }
```

**Decorator.** Row 2 = aggregate (`score | count`). Rows 3–5 = reviews. Parse star count to set `--filled: {n*20}%`. Any row past row 5 is ignored (condensed view only).

**Interaction.** `.reveal` on the whole block.

**A11y.** Stars are visual; each group has `aria-label="4.7 out of 5 stars"`.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "Reviews Condensed",
    "id": "reviews-condensed",
    "plugins": {
      "xwalk": { "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "Reviews Condensed", "model": "reviews-condensed" } } }
    }
  }],
  "models": [
    { "id": "reviews-condensed", "fields": [
      { "component": "text", "name": "score", "label": "Aggregate score (e.g. 4.7)" },
      { "component": "text", "name": "count", "label": "Review count" }
    ]},
    { "id": "reviews-condensed-item", "fields": [
      { "component": "number", "name": "stars", "label": "Stars (1-5)" },
      { "component": "text", "name": "title", "label": "Review title" },
      { "component": "text", "name": "body", "label": "Review body" },
      { "component": "text", "name": "author", "label": "Reviewer name" },
      { "component": "boolean", "name": "verified", "label": "Verified buyer" }
    ]}
  ],
  "filters": [{ "id": "reviews-condensed", "components": ["reviews-condensed-item"] }]
}
```

**Authoring.** Exactly 3 reviews displayed. Full reviews widget is a separate block (post-MVP).

**Revlon example.** 4.7 / 1,240 reviews. 3 verified reviews pulled from existing PDP (copy real quotes, not invented — flag with `TODO: Revlon content` in drafts).

---

## 7. `press-quotes` — quote carousel

**Purpose.** 3–5 press quotes rotating. Each quote = attribution (publication logo or name) + pull quote. Trust / authority signal above the fold on Home.

**Content model.**
- 3–5 quotes. Each: logo or publication name, short pull quote (≤ 140 chars), source URL (optional).

**Authored structure.**
```
| Press Quotes                                        |
|-----------------------------------------------------|
| [vogue logo] | "The lipstick that launched a thousand imitators." | [https://vogue.com/...] |
| [allure logo]| "Still the benchmark, 90 years in."                | [https://allure.com/...]|
| [elle logo]  | "A classic that earns its status every year."       | [https://elle.com/...]  |
```

**Decorated HTML.**
```html
<div class="press-quotes block reveal">
  <ul class="press-quotes-track" role="list">
    <li class="press-quotes-item" data-index="0">
      <figure>
        <blockquote class="press-quotes-quote">"The lipstick that launched a thousand imitators."</blockquote>
        <figcaption class="press-quotes-source">
          <img alt="Vogue" src="..." class="press-quotes-logo" />
          <a href="https://vogue.com/..." rel="noopener">Read in Vogue</a>
        </figcaption>
      </figure>
    </li>
    ...
  </ul>
  <div class="press-quotes-dots" role="tablist">
    <button type="button" role="tab" aria-selected="true">1</button>
    ...
  </div>
</div>
```

**Key CSS.**
```css
.press-quotes { text-align: center; }
.press-quotes .press-quotes-track { list-style: none; margin: 0; padding: 0; display: flex; overflow: hidden; scroll-snap-type: x mandatory; }
.press-quotes .press-quotes-item { flex: 0 0 100%; scroll-snap-align: center; padding-inline: var(--spacing-6); }
.press-quotes .press-quotes-quote { margin: 0 auto; max-width: 32ch; font-family: var(--heading-font-family); font-size: clamp(1.5rem, 2vw + 1rem, var(--heading-font-size-l)); line-height: var(--line-height-tight); }
.press-quotes .press-quotes-source { margin-top: var(--spacing-6); display: flex; align-items: center; justify-content: center; gap: var(--spacing-4); color: var(--color-text-secondary); }
.press-quotes .press-quotes-logo { height: 20px; width: auto; filter: grayscale(1); opacity: 0.7; }
.press-quotes .press-quotes-dots { margin-top: var(--spacing-8); display: flex; gap: var(--spacing-2); justify-content: center; }
.press-quotes .press-quotes-dots button { width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--color-border-default); border: 0; padding: 0; cursor: pointer; }
.press-quotes .press-quotes-dots button[aria-selected="true"] { background: var(--color-primary); }
```

**Decorator.**
- Build the track + dots. Auto-advance every 6s (`setInterval`), pause on hover/focus. Respect `prefers-reduced-motion` — when set, don't auto-advance.
- Keyboard: Left/Right keys move between quotes. Dots are real `<button>`s.
- One small IntersectionObserver: only auto-advance when the block is visible.

**Interaction.** Carousel logic is block-scoped (not a shared pattern). Outer fade-up via `.reveal`.

**A11y.** Proper `role="tablist"` + `role="tab"` + `aria-selected`. Each slide wrapped in `<figure>/<blockquote>/<figcaption>`.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "Press Quotes",
    "id": "press-quotes",
    "plugins": {
      "xwalk": { "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "Press Quotes", "model": "press-quotes" } } }
    }
  }],
  "models": [
    { "id": "press-quotes", "fields": [] },
    { "id": "press-quotes-item", "fields": [
      { "component": "reference", "name": "logo", "label": "Publication logo (SVG preferred)", "valueType": "string" },
      { "component": "text", "name": "publication", "label": "Publication name" },
      { "component": "text", "name": "quote", "label": "Pull quote (≤ 140 chars)" },
      { "component": "aem-content", "name": "source-url", "label": "Source URL" }
    ]}
  ],
  "filters": [{ "id": "press-quotes", "components": ["press-quotes-item"] }]
}
```

**Authoring.** Upload logos as transparent PNG or SVG (preferred). Keep quote short — truncation breaks the layout.

**Revlon example.** 3 quotes from Vogue, Allure, Elle. Real publication quotes only — flag with `TODO: Revlon content` if not yet cleared.

---

## 8. `cta-sticky` — sticky purchase CTA

**Purpose.** A persistent bar that pins to the bottom of the viewport on PDP (mobile) and slides in from below after the hero scrolls out of view. Contains product name + price + primary CTA.

**Content model.**
- Product name (short, reused from hero)
- Price
- Primary CTA: label + URL
- Show threshold (optional, default = after hero)

**Authored structure.**
```
| CTA Sticky                                     |
|------------------------------------------------|
| Super Lustrous Lipstick                        |
| $9.99                                          |
| [Add to bag](/cart/add/super-lustrous-cherries)|
```
Row 1 = block name. Rows 2–4 = name, price, CTA.

**Decorated HTML.**
```html
<div class="cta-sticky block" hidden>
  <div class="cta-sticky-inner">
    <div class="cta-sticky-info">
      <p class="cta-sticky-name">Super Lustrous Lipstick</p>
      <p class="cta-sticky-price">$9.99</p>
    </div>
    <a class="button primary cta-sticky-button" href="/cart/add/super-lustrous-cherries">Add to bag</a>
  </div>
</div>
```

**Key CSS.**
```css
.cta-sticky {
  position: fixed; inset: auto 0 0 0;
  background: var(--color-surface-primary);
  border-top: 1px solid var(--color-border-default);
  box-shadow: var(--elevation-md);
  transform: translateY(100%);
  transition: transform var(--duration-base) var(--easing-default);
  z-index: 50;
}
.cta-sticky.is-visible { transform: translateY(0); }
.cta-sticky .cta-sticky-inner { display: flex; align-items: center; gap: var(--spacing-4); padding: var(--spacing-4) var(--spacing-6); max-width: var(--max-page-width, 1200px); margin: 0 auto; }
.cta-sticky .cta-sticky-info { flex: 1; min-width: 0; }
.cta-sticky .cta-sticky-name { margin: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cta-sticky .cta-sticky-price { margin: 0; color: var(--color-text-secondary); font-size: var(--body-font-size-s); }
.cta-sticky .cta-sticky-button { flex-shrink: 0; }
@media (min-width: 900px) { .cta-sticky { display: none; } } /* mobile-only by default */
```

**Decorator.**
- Remove the `hidden` attribute and start observing the product-hero.
- When `product-hero` leaves the viewport going down → add `.is-visible`. When it re-enters going up → remove.
- If no `product-hero` on the page, show immediately after scroll > 300px.
- Expose a `data-cta-sticky-desktop="true"` attribute to opt-in desktop visibility (rare; mobile-first by default).

**Interaction.** Slide-in transform (CSS). No JS animation loop. Respect `prefers-reduced-motion` — when set, fade in instead of slide.

**A11y.** `z-index: 50` sits above body but below modals. Don't trap focus; button is fully keyboard-reachable.

**Universal Editor schema.**
```json
{
  "definitions": [{
    "title": "CTA Sticky",
    "id": "cta-sticky",
    "plugins": {
      "xwalk": { "page": { "resourceType": "core/franklin/components/block/v1/block", "template": { "name": "CTA Sticky", "model": "cta-sticky" } } }
    }
  }],
  "models": [{
    "id": "cta-sticky",
    "fields": [
      { "component": "text", "name": "name", "label": "Product name" },
      { "component": "text", "name": "price", "label": "Price" },
      { "component": "aem-content", "name": "cta", "label": "CTA link" },
      { "component": "text", "name": "cta-label", "label": "CTA label" }
    ]
  }],
  "filters": [{ "id": "cta-sticky", "components": [] }]
}
```

**Authoring.** One `cta-sticky` per page max. Place anywhere on the page — position is fixed, content location is irrelevant.

**Revlon example.** Name "Super Lustrous Lipstick — Cherries in the Snow", price "$9.99", CTA "Add to bag" → `/cart/add/super-lustrous-cherries`.

---

## Verify checklist (per block, before commit)

1. `npm run lint` clean (zero warnings, zero errors).
2. Decorator handles missing optional fields without throwing.
3. CSS selectors all scoped under `.{blockname}`.
4. No new runtime dependencies; no `build` step; no framework imports.
5. `_{name}.json` validates as JSON and follows the UE definition/model/filter shape above.
6. Block example runs locally against `drafts/{name}.html` with `aem up --html-folder drafts`.
7. Axe or Lighthouse a11y pass — zero WCAG 2.1 AA issues on the block.
8. Lighthouse performance ≥ 95 on the test page.
9. Commit message: `feat(blocks): add {name} block — {one-liner}`.
10. Push to `Xoery1234/BLA main`, confirm `https://main--BLA--Xoery1234.aem.page/drafts/{name}` renders.

---

## Agent Teams split (reference)

Per `CLAUDE.md` → three builders:
- **Group A — simple single-purpose:** `statement`, `cta-grid`, `cta-sticky`
- **Group B — PDP content:** `product-hero`, `product-summary`
- **Group C — social proof:** `feature-grid`, `reviews-condensed`, `press-quotes`

Each builder owns their blocks end-to-end (CSS + JS + `_*.json` + commit + push + verify). Route coordination through the orchestrator — builders don't peer-sync.

---

## Deferred / out of scope for v1

- Full reviews widget (pagination, filtering).
- Quick-buy modal from `cta-sticky`.
- PDP image gallery (multi-image hero). Tracked post-R2.A.
- Variant picker (shade grid) — requires product data feed; depends on D-CCP-10.
- Any tenant-specific copy baked into block JS. Revlon content lives in content/, not blocks/.
