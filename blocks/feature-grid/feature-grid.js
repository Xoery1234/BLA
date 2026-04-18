/**
 * Feature Grid block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Feature Grid")
 *   Row 2+: each row = one feature cell, three cells per row:
 *           Column 1: icon — either ":icon-name:" text token, or an inline
 *                     <span class="icon icon-{name}"></span> already produced
 *                     by decorateIcons (when run before us).
 *           Column 2: title (plain text)
 *           Column 3: benefit (one-line text)
 *
 * Output:
 *   <ul class="feature-grid-list" role="list">
 *     <li class="feature-grid-item">
 *       <span class="feature-grid-icon" aria-hidden="true">
 *         <span class="icon icon-leaf"></span>   ← decorateIcons swaps to <svg>/<img>
 *       </span>
 *       <h3 class="feature-grid-title">Plant-based</h3>
 *       <p class="feature-grid-benefit">90% natural origin ingredients.</p>
 *     </li>
 *     …
 *   </ul>
 *
 * Reveal: .reveal-stagger added pre-paint by scripts.js → autoRevealBlocks.
 */
import { decorateIcons } from '../../scripts/aem.js';

const ICON_TOKEN_RE = /:icon-([a-z0-9-]+):/i;

function cellText(cell) {
  if (!cell) return '';
  return cell.textContent.trim();
}

function buildIconSpan(cell) {
  if (!cell) return null;

  // 1) Already-decorated icon (decorateIcons ran first).
  const existing = cell.querySelector('.icon');
  if (existing) return existing;

  // 2) Token form ":icon-name:" — produce the .icon span; decorateIcons fills it.
  const text = cell.textContent.trim();
  const match = text.match(ICON_TOKEN_RE);
  if (match) {
    const span = document.createElement('span');
    span.className = `icon icon-${match[1].toLowerCase()}`;
    return span;
  }

  return null;
}

export default function decorate(block) {
  const ul = document.createElement('ul');
  ul.className = 'feature-grid-list';
  ul.setAttribute('role', 'list');

  [...block.children].forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;

    const iconCell = cells[0];
    const titleCell = cells[1];
    const benefitCell = cells[2];

    const li = document.createElement('li');
    li.className = 'feature-grid-item';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'feature-grid-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    const iconEl = buildIconSpan(iconCell);
    if (iconEl) iconWrap.append(iconEl);
    li.append(iconWrap);

    const title = cellText(titleCell);
    if (title) {
      const h = document.createElement('h3');
      h.className = 'feature-grid-title';
      h.textContent = title;
      li.append(h);
    }

    const benefit = cellText(benefitCell);
    if (benefit) {
      const p = document.createElement('p');
      p.className = 'feature-grid-benefit';
      p.textContent = benefit;
      li.append(p);
    }

    ul.append(li);
  });

  block.replaceChildren(ul);

  // Resolve any newly-created `.icon` spans that decorateIcons hasn't touched yet
  // (case where the author used the :icon-name: token form).
  decorateIcons(block);
}
