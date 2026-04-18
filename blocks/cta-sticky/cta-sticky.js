/**
 * CTA Sticky block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("CTA Sticky")
 *   Row 2: product name (short)
 *   Row 3: price
 *   Row 4: CTA link (label + URL, e.g. [Add to bag](/cart/add/...))
 *
 * Output:
 *   <div class="cta-sticky block" hidden>
 *     <div class="cta-sticky-inner">
 *       <div class="cta-sticky-info">
 *         <p class="cta-sticky-name">…</p>
 *         <p class="cta-sticky-price">…</p>
 *       </div>
 *       <a class="button primary cta-sticky-button" href="…">Add to bag</a>
 *     </div>
 *   </div>
 *
 * Visibility: starts hidden. IntersectionObserver watches .product-hero
 * and toggles .is-visible when it leaves the viewport. If no .product-hero
 * exists, falls back to scrollY > 300.
 *
 * Block-scoped JS by design — the shared .sticky-cta handler in
 * scripts/interactions.js is for a different (legacy) class.
 */

const SCROLL_THRESHOLD_PX = 300;

function cellText(row) {
  if (!row) return '';
  const cell = row.firstElementChild;
  return cell ? cell.textContent.trim() : '';
}

function findAnchor(row) {
  return row ? row.querySelector('a[href]') : null;
}

function attachScrollFallback(block) {
  let ticking = false;

  function update() {
    block.classList.toggle('is-visible', window.scrollY > SCROLL_THRESHOLD_PX);
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  update();
}

function attachHeroObserver(block, hero) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        block.classList.toggle('is-visible', !entry.isIntersecting);
      });
    },
    { threshold: 0 },
  );
  observer.observe(hero);
}

export default function decorate(block) {
  const [nameRow, priceRow, ctaRow] = [...block.children];

  const name = cellText(nameRow);
  const price = cellText(priceRow);
  const anchor = findAnchor(ctaRow);
  const href = anchor ? anchor.getAttribute('href') : '';
  const label = anchor ? anchor.textContent.trim() : 'Buy now';

  const inner = document.createElement('div');
  inner.className = 'cta-sticky-inner';

  const info = document.createElement('div');
  info.className = 'cta-sticky-info';

  if (name) {
    const nameEl = document.createElement('p');
    nameEl.className = 'cta-sticky-name';
    nameEl.textContent = name;
    info.append(nameEl);
  }

  if (price) {
    const priceEl = document.createElement('p');
    priceEl.className = 'cta-sticky-price';
    priceEl.textContent = price;
    info.append(priceEl);
  }

  inner.append(info);

  if (href) {
    const button = document.createElement('a');
    button.className = 'button primary cta-sticky-button';
    button.href = href;
    button.textContent = label;
    inner.append(button);
  }

  block.replaceChildren(inner);

  // Wait for product-hero to exist (decoration order isn't guaranteed across blocks).
  // Defer one frame so the page has finished its first decoration pass.
  window.requestAnimationFrame(() => {
    const hero = document.querySelector('.product-hero');
    if (hero) {
      attachHeroObserver(block, hero);
    } else {
      attachScrollFallback(block);
    }
  });
}
