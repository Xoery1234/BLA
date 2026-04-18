/**
 * Product Hero block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live) — one cell per row, in this order:
 *   Row 1 : block name ("Product Hero")
 *   Row 2 : hero image
 *   Row 3 : product name (rendered as <h1>)
 *   Row 4 : tagline (optional)
 *   Row 5 : shade — "Cherries in the Snow | #B2333F" (optional)
 *   Row 6 : price (required)
 *   Row 7 : primary CTA — formatted [Add to bag](/cart/add/...)
 *   Row 8 : secondary CTA (optional)
 *
 * Output:
 *   <div class="product-hero block">
 *     <div class="product-hero-media parallax">…</div>
 *     <div class="product-hero-body reveal">
 *       <h1 class="product-hero-name">…</h1>
 *       <p class="product-hero-tagline">…</p>
 *       <div class="product-hero-shade">
 *         <span class="product-hero-swatch" aria-hidden="true" style="--swatch:#hex"></span>
 *         <span class="product-hero-shade-name">Cherries in the Snow</span>
 *       </div>
 *       <p class="product-hero-price">…</p>
 *       <div class="product-hero-cta">
 *         <a class="button primary">Add to bag</a>
 *         <a class="button secondary">Find in store</a>
 *       </div>
 *     </div>
 *   </div>
 *
 * Row parsing is positional but resilient to missing optional rows: image is
 * found by <picture>, CTAs by anchors, shade by the "name | #hex" pattern,
 * price by a $-prefixed string, tagline = remaining short text.
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

const HEX_SHADE_RE = /^(.+?)\s*[|·-]\s*(#[0-9a-f]{3,8})\s*$/i;
const PRICE_RE = /^[€£¥$]?\s*\d/;

function rowText(row) {
  if (!row) return '';
  return row.textContent.trim();
}

function rowHasPicture(row) {
  return row && row.querySelector('picture');
}

function rowHasAnchor(row) {
  return row && row.querySelector('a[href]');
}

function buildMedia(row) {
  const wrapper = document.createElement('div');
  wrapper.className = 'product-hero-media parallax';
  const img = row.querySelector('img');
  if (img) {
    wrapper.append(
      createOptimizedPicture(img.src, img.alt || '', true, [
        { media: '(min-width: 900px)', width: '720' },
        { width: '750' },
      ]),
    );
  }
  return wrapper;
}

function buildShade(text) {
  const match = text.match(HEX_SHADE_RE);
  if (!match) return null;
  const [, name, hex] = match;
  const wrap = document.createElement('div');
  wrap.className = 'product-hero-shade';
  const swatch = document.createElement('span');
  swatch.className = 'product-hero-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  swatch.style.setProperty('--swatch', hex);
  const label = document.createElement('span');
  label.className = 'product-hero-shade-name';
  label.textContent = name.trim();
  wrap.append(swatch, label);
  return wrap;
}

function buildCta(row, variant) {
  const anchor = row.querySelector('a[href]');
  if (!anchor) return null;
  const link = document.createElement('a');
  link.className = `button ${variant}`;
  link.href = anchor.getAttribute('href');
  link.textContent = anchor.textContent.trim();
  return link;
}

export default function decorate(block) {
  const rows = [...block.children];

  // Pull image row (first row containing a <picture>).
  const imageRow = rows.find(rowHasPicture);
  const remaining = rows.filter((r) => r !== imageRow);

  // Pull CTA rows (rows containing anchors). First = primary, second = secondary.
  const ctaRows = remaining.filter(rowHasAnchor);
  const textRows = remaining.filter((r) => !rowHasAnchor(r));

  // Positional text rows: name, tagline, shade, price.
  // Detect price (first $-prefixed) + shade (matches "name | #hex") to be order-tolerant.
  const texts = textRows.map(rowText).filter(Boolean);
  let name = '';
  let tagline = '';
  let shade = '';
  let price = '';

  texts.forEach((t) => {
    if (!shade && HEX_SHADE_RE.test(t)) { shade = t; return; }
    if (!price && PRICE_RE.test(t)) { price = t; return; }
    if (!name) { name = t; return; }
    if (!tagline) { tagline = t; }
  });

  // Build output
  const root = document.createDocumentFragment();

  if (imageRow) root.append(buildMedia(imageRow));

  const body = document.createElement('div');
  body.className = 'product-hero-body reveal';

  if (name) {
    const h1 = document.createElement('h1');
    h1.className = 'product-hero-name';
    h1.textContent = name;
    body.append(h1);
  }

  if (tagline) {
    const p = document.createElement('p');
    p.className = 'product-hero-tagline';
    p.textContent = tagline;
    body.append(p);
  }

  if (shade) {
    const shadeEl = buildShade(shade);
    if (shadeEl) body.append(shadeEl);
  }

  if (price) {
    const priceEl = document.createElement('p');
    priceEl.className = 'product-hero-price';
    priceEl.textContent = price;
    body.append(priceEl);
  }

  if (ctaRows.length) {
    const ctaWrap = document.createElement('div');
    ctaWrap.className = 'product-hero-cta';
    const primary = buildCta(ctaRows[0], 'primary');
    const secondary = ctaRows[1] ? buildCta(ctaRows[1], 'secondary') : null;
    if (primary) ctaWrap.append(primary);
    if (secondary) ctaWrap.append(secondary);
    body.append(ctaWrap);
  }

  root.append(body);
  block.replaceChildren(root);
}
