/**
 * Product Grid decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Product Grid")
 *   Row 2+: each row becomes one card
 *           Column 1: product image
 *           Column 2: heading (h3) + body copy + optional button link
 *
 * Each card gets .hover-lift so the global interaction pattern applies.
 */
import { createOptimizedPicture } from '../../scripts/aem.js';

export default function decorate(block) {
  const ul = document.createElement('ul');
  ul.className = 'product-grid-list';
  ul.setAttribute('role', 'list');

  [...block.children].forEach((row) => {
    const li = document.createElement('li');
    li.className = 'product-grid-card hover-lift';

    // Each row's columns become direct children of the card
    while (row.firstElementChild) li.append(row.firstElementChild);

    // First child with a <picture> → image wrapper; remaining → body
    [...li.children].forEach((div) => {
      if (div.children.length === 1 && div.querySelector('picture')) {
        div.className = 'product-grid-card-image';
      } else {
        div.className = 'product-grid-card-body';
      }
    });

    ul.append(li);
  });

  // Optimize images (same convention as cards block)
  ul.querySelectorAll('picture > img').forEach((img) => {
    img.closest('picture').replaceWith(
      createOptimizedPicture(img.src, img.alt, false, [
        { media: '(min-width: 900px)', width: '520' },
        { width: '750' },
      ]),
    );
  });

  block.replaceChildren(ul);
}
