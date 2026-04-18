/**
 * CTA Grid block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("CTA Grid")
 *   Row 2+: each row becomes one card
 *           Column 1: image (optional)
 *           Column 2: heading (plain text)
 *           Column 3: one-line blurb
 *           Column 4: link (label + URL)
 *
 * Output:
 *   <ul class="cta-grid-list" role="list">
 *     <li class="cta-grid-card hover-lift">
 *       <a class="cta-grid-link" href="…">
 *         <div class="cta-grid-image"><picture>…</picture></div>
 *         <h3 class="cta-grid-heading">…</h3>
 *         <p class="cta-grid-blurb">…</p>
 *         <span class="cta-grid-cue">… →</span>
 *       </a>
 *     </li>
 *     …
 *   </ul>
 *
 * Reveal: adds .reveal-stagger so styles/interactions.css §1 fades children
 * up in sequence (respects prefers-reduced-motion globally).
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

function looksLikeUrl(text) {
  if (!text) return false;
  return /^https?:\/\//i.test(text) || text.startsWith('/');
}

function pickFirstText(cell) {
  if (!cell) return '';
  return cell.textContent.trim();
}

export default function decorate(block) {
  const ul = document.createElement('ul');
  ul.className = 'cta-grid-list';
  ul.setAttribute('role', 'list');

  [...block.children].forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;

    // Identify the link cell — last <a> in the row, regardless of column position.
    const anchor = row.querySelector('a[href]');
    const href = anchor ? anchor.getAttribute('href') : '';
    const linkText = anchor ? anchor.textContent.trim() : '';
    const linkCell = anchor ? anchor.closest(':scope > div > div') : null;

    // Identify image cell (any cell containing a <picture>).
    const imageCell = cells.find((c) => c.querySelector('picture'));

    // Text cells = remaining cells in document order, excluding image + link.
    const textCells = cells.filter((c) => c !== imageCell && c !== linkCell);
    const heading = pickFirstText(textCells[0]);
    const blurb = pickFirstText(textCells[1]);

    const li = document.createElement('li');
    li.className = 'cta-grid-card hover-lift';

    const link = document.createElement('a');
    link.className = 'cta-grid-link';
    link.href = href || '#';

    if (imageCell) {
      const wrapper = document.createElement('div');
      wrapper.className = 'cta-grid-image';
      const img = imageCell.querySelector('img');
      if (img) {
        wrapper.append(
          createOptimizedPicture(img.src, img.alt || heading || '', false, [
            { media: '(min-width: 900px)', width: '520' },
            { width: '640' },
          ]),
        );
      }
      link.append(wrapper);
    }

    if (heading) {
      const h = document.createElement('h3');
      h.className = 'cta-grid-heading';
      h.textContent = heading;
      link.append(h);
    }

    if (blurb) {
      const p = document.createElement('p');
      p.className = 'cta-grid-blurb';
      p.textContent = blurb;
      link.append(p);
    }

    const cue = document.createElement('span');
    cue.className = 'cta-grid-cue';
    cue.textContent = `${(linkText && !looksLikeUrl(linkText)) ? linkText : 'Explore'} →`;
    link.append(cue);

    li.append(link);
    ul.append(li);
  });

  block.classList.add('reveal-stagger');
  block.replaceChildren(ul);
}
