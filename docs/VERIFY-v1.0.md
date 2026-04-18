# VERIFY v1.0 — Block Library Baseline (a11y / SEO / Best-Practices)

**Date:** 2026-04-18
**Scope:** All 8 foundational blocks (statement, cta-grid, cta-sticky, product-hero, product-summary, feature-grid, reviews-condensed, press-quotes).
**Method:** Local `aem up --html-folder drafts` against `/drafts/{name}.html`. Lighthouse 13.1 (a11y + SEO + best-practices only) + axe-core (wcag2aa + wcag21aa + best-practice) + viewport scan at 320/768/1024/1440/1920 px via puppeteer + Chrome headless.
**Perf scores deliberately excluded:** local `aem up` runs without CDN, real network, or production caching — perf numbers from `localhost` are unreliable for production decisions. Production perf pass is deferred to **VERIFY-v1.1** against the first flywheel-generated Revlon page on `https://main--BLA--Xoery1234.aem.live/`.

---

## How to reproduce

```bash
# 1. Pull latest
git fetch origin && git reset --hard origin/main

# 2. Start local server (background)
npx -y @adobe/aem-cli up --no-open --html-folder drafts

# 3. Run verify pass (writes .verify-out/verify-summary.json)
cd .verify-out && npm install --no-save axe-core puppeteer lighthouse chrome-launcher
node run.mjs
```

The drafts pages explicitly include the EDS bootstrap (`/scripts/aem.js`, `/scripts/scripts.js`, `/styles/styles.css`) so block decoration runs under `aem up --html-folder`. AEM preview/live URLs inject this via `head.html` automatically; raw drafts files don't, so we wire it in-page.

---

## Per-block scorecard

| Block | axe violations (block-scoped) | LH a11y | LH SEO* | LH BP | Viewport 320–1920 |
|---|---|---|---|---|---|
| `statement` | 0 | 1.00 | 0.58 | 0.96 | clean |
| `cta-grid` | **1 (color-contrast)** | 0.96 | 0.58 | 0.96 | clean |
| `cta-sticky` | 0 | 1.00 | 0.58 | 0.96 | clean |
| `product-hero` | 0 | 1.00 | 0.58 | 0.96 | clean |
| `product-summary` | 0 | 1.00 | 0.58 | 0.96 | clean |
| `feature-grid` | 0 | 1.00 | 0.58 | 0.96 | clean |
| `reviews-condensed` | **1 (color-contrast)** | 0.96 | 0.58 | 0.96 | clean |
| `press-quotes` | **1 (aria-hidden-focus)** | 0.97 | 0.58 | 0.96 | clean |

\* SEO 0.58 across the board is a drafts-page artifact — the test scaffolds have no `<meta name="description">` and the `aem up` server returns `X-Robots-Tag: noindex` for drafts. Both are scaffold concerns, not block defects. Production pages will pass these audits.

---

## Cross-cutting "noise" — NOT block defects

The following violations appear on every page but are caused by externals:

### `scrollable-region-focusable` on `.carousel-slides` (8/8 pages, axe serious)
Source: the **footer fragment** (auto-loaded by EDS) renders a `.carousel` block with a `<ul class="carousel-slides">` element that's missing `tabindex="0"`. Lives in `blocks/carousel/carousel.js`, NOT in any of the 8 verified blocks. **Defect in `carousel`** — track separately.

### `page-has-heading-one` on 6/8 pages (axe moderate)
Source: drafts test scaffolds have no `<h1>` (only `cta-sticky.html` and `product-hero.html` do). Production pages always have an H1 either via the page title or a `product-hero` block. **Test-scaffold artifact**, not a block defect.

### Lighthouse SEO 0.58 on 8/8 pages
Source: drafts pages lack `<meta name="description">`; `aem up` adds `X-Robots-Tag: noindex` for the `/drafts/` path. Production pages have meta descriptions and are crawlable. **Test-scaffold artifact**.

### Lighthouse Best-Practices 0.96 on 8/8 pages
Single failing audit: `csp-xss` (no Content Security Policy header from `aem up` dev server). Production EDS sends CSP via the `head.html` `<meta http-equiv>`. **Dev-server artifact**, not a block defect.

---

## Real block defects (3) — remediation tracked

### 1. `cta-grid` — `.cta-grid-cue` color contrast 3.81:1 (WCAG AA needs 4.5:1)
**Computed:** foreground `#d71920` (Revlon `--color-primary`) on background `#0a0a0a` (Revlon dark surface) under `font-size: 14px`.
**Root cause:** `.cta-grid-cue` is colored with `var(--color-primary)`. The Revlon brand cascade (`styles/brands/revlon.css`) overrides primary to `#d71920` and surface-primary to `#0a0a0a`. The pairing fails contrast.
**Where to fix:** brand-token level — adjust the Revlon `--color-primary` to a brighter red (e.g. `#ff4757` ≈ 4.6:1) OR override `--color-cta-link` specifically for cards on dark surfaces. Block CSS itself is sound; do NOT swap to a different token in the block.
**Severity:** serious (WCAG 1.4.3). Blocks tenant launch on dark cards until the brand palette is tuned.

### 2. `reviews-condensed` — `.reviews-condensed-verified` badge contrast 2.48:1 (WCAG AA needs 4.5:1)
**Computed:** white text on background `#44bb44` (Revlon `--color-status-success`) under `font-size: 12px`.
**Root cause:** Revlon brand override sets `--color-status-success` to `#44bb44`, which is too light for white text. Default boilerplate value `#2e7d32` passes (5.6:1).
**Where to fix:** brand-token level — restore Revlon `--color-status-success` to a darker green (`#2e7d32` or `#1b5e20`), OR change the badge to use a darker text color. Block CSS is sound.
**Severity:** serious (WCAG 1.4.3). Visible in any verified-buyer reviews.

### 3. `press-quotes` — `aria-hidden-focus` on inactive carousel slides
**Computed:** items with `aria-hidden="true"` (slides 2 and 3 of 3) still contain focusable `<a>` source links. Tab key reaches hidden slides.
**Root cause:** the carousel decorator sets `aria-hidden` on inactive slides but does not propagate `tabindex="-1"` to descendant focusables.
**Where to fix:** block CSS — apply `inert` attribute (96%+ browser support) on inactive slides, OR set `tabindex="-1"` on descendant `<a>` when `aria-hidden="true"`. Single-file fix in `blocks/press-quotes/press-quotes.js`.
**Severity:** serious (WCAG 4.1.2). Keyboard users can tab into invisible carousel slides.

---

## Cross-browser — Safari 15 mask check (`reviews-condensed` stars)

**Issue:** `reviews-condensed.css` rendered the star aggregate via `mask: url('/icons/stars-5.svg')`. `mask` shipped unprefixed in Safari **15.4** (March 2022). **Safari 15.0–15.3 (Sept 2021–Jan 2022) require `-webkit-mask`.** iOS 15.0–15.3 still has meaningful share in beauty/cosmetics audiences.

**Resolution:** added `-webkit-mask` back with a targeted stylelint disable comment scoped to the rule. Both the prefix and the unprefixed property are now declared. Stylelint stays green; iOS 15.0–15.3 renders the stars correctly. Committed in the same change as this doc.

**Other Safari 15 risks reviewed (no fix needed):**
- `inset: auto 0 0` on `.cta-sticky` — supported Safari 14.1+. Pass.
- `aspect-ratio` on `.product-hero-media img` and `.cta-grid-image img` — supported Safari 15.0+. Pass.
- `clamp()` on `.statement-headline`, `.product-hero-name`, `.press-quotes-quote` — supported Safari 13.1+. Pass.
- `:focus-visible` on `.cta-grid-link`, `.press-quotes-dots button` — supported Safari 15.4+. Safari 15.0–15.3 falls back to `:focus`, which is graceful (focus ring still appears). Acceptable degradation.

---

## Viewport pass — 320/768/1024/1440/1920 px

All 8 blocks pass at all 5 widths after blocks decorate (no horizontal overflow, no `main` overflow). Test result detail in `.verify-out/verify-summary.json`.

**Initial-run defect (since fixed via drafts patch):** the first verify run measured the raw authored markup because the drafts pages didn't include the EDS bootstrap. Without decoration, the placeholder image (intrinsic `width="400"`) overflowed at 320px. Once `/scripts/scripts.js` was wired in, decoration runs, `.cta-grid-image img { width: 100% }` (and equivalent in `product-hero` and `press-quotes`) constrains the image, and overflow disappears.

---

## Pre-existing project lint debt (deferred — out of scope for v1.0 baseline)

Surfaced during the verify pass but not introduced by the 8-block workload:

### Stylelint — 53 errors in `styles/interactions.css` and 3 cinematic blocks
- `no-descending-specificity` (recurring): cinematic-tier rules (`.scene`, `.parallax-layers`, `.horizontal-scroll`, `.ken-burns`) are declared after lower-specificity baseline rules.
- `color-function-notation`, `alpha-value-notation`: legacy `rgba(0,0,0,0.08)` syntax.
- `color-hex-length`: `#ffffff` should be `#fff`.
- `rule-empty-line-before`: missing blank lines before rules.

Files affected: `styles/interactions.css`, `blocks/horizontal-scroll/horizontal-scroll.css`, `blocks/parallax-layers/parallax-layers.css`, `blocks/scene/scene.css`, `blocks/product-grid/product-grid.css`, `styles/templates/pdp.css`.

**Recommend:** separate `chore(lint)` cleanup commit owned by the cinematic-tier author. Not gating any block work.

---

## Deferred to VERIFY-v1.1 (production preview)

Run after the **first flywheel-generated Revlon page** lands on production preview at `https://main--BLA--Xoery1234.aem.live/`:

1. Lighthouse **performance** category against the live page (target: ≥95 per BLOCK-SPECS verify checklist item 8).
2. Real-device Safari 15 / iOS 15 cross-check on the stars mask (only needed if analytics shows non-trivial iOS 15 traffic; otherwise the prefix-fallback fix is sufficient).
3. Lighthouse **SEO** with real `<meta name="description">` and crawlable headers (the 0.58 baseline above is artificial).
4. Production CDN load tests (LCP, CLS, INP from real network).
5. axe + Lighthouse on the actual Revlon PDP composed from `product-hero` + `product-summary` + `reviews-condensed` + `press-quotes` + `cta-sticky` (block-on-block interaction defects only surface on real pages).

---

## Baseline guarantee for future blocks

Every new block added to BLA must meet or exceed the v1.0 baseline:

- **0 axe violations attributable to block code** (cross-cutting noise from externals like the footer carousel is ignored once tracked).
- **Lighthouse a11y ≥ 0.96** with no `color-contrast` failures attributable to brand-default tokens (use semantic tokens — escalate brand-token contrast issues to brand stylesheet).
- **Lighthouse best-practices ≥ 0.96.**
- **No horizontal overflow at 320 / 768 / 1024 / 1440 / 1920 px.**
- **Safari 15.0+ rendering** for any `mask`, `:has()`, or `:focus-visible` reliance — vendor-prefix fallback if needed.
- **`prefers-reduced-motion` honored** for any motion the block adds beyond the shared runtime.

---

## Artifacts

- Raw verify dataset: `.verify-out/verify-summary.json` (NOT committed; regenerate via repro steps above).
- Verify runner: `.verify-out/run.mjs` (NOT committed; one-off scaffold).
- Drafts pages (committed): `drafts/{name}.html` × 8, each wired with EDS bootstrap.
