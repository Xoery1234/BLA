/**
 * Press Quotes block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Press Quotes")
 *   Row 2+: each row = one quote, three cells:
 *           Column 1: publication logo (image)
 *           Column 2: pull quote (≤ 140 chars)
 *           Column 3: source link — anchor with publication name
 *
 * Output:
 *   <div class="press-quotes block">
 *     <ul class="press-quotes-track" role="list">
 *       <li class="press-quotes-item" aria-hidden="false">
 *         <figure>
 *           <blockquote class="press-quotes-quote">…</blockquote>
 *           <figcaption class="press-quotes-source">
 *             <img class="press-quotes-logo" alt="Vogue" src="…">
 *             <a href="…" rel="noopener">Read in Vogue</a>
 *           </figcaption>
 *         </figure>
 *       </li>
 *       …
 *     </ul>
 *     <div class="press-quotes-dots" role="tablist">
 *       <button type="button" role="tab" aria-selected="true">1</button>
 *       …
 *     </div>
 *   </div>
 *
 * Carousel:
 *  - Auto-advance every 6s, paused on hover/focus.
 *  - IntersectionObserver: only auto-advance when block is visible.
 *  - Keyboard: Left/Right keys advance.
 *  - prefers-reduced-motion: no auto-advance.
 *
 * Reveal: .reveal added pre-paint by scripts.js → autoRevealBlocks.
 */

const ADVANCE_INTERVAL_MS = 6000;
const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function rowCells(row) {
  return row ? [...row.children] : [];
}

function pickAnchor(cell) {
  return cell ? cell.querySelector('a[href]') : null;
}

function pickImage(cell) {
  return cell ? cell.querySelector('img') : null;
}

function buildItem(row, index) {
  const cells = rowCells(row);
  const logoImg = pickImage(cells[0]);
  const quoteCell = cells[1];
  const sourceAnchor = pickAnchor(cells[2]);
  const quoteText = quoteCell ? quoteCell.textContent.trim() : '';
  if (!quoteText) return null;

  let publication = '';
  if (sourceAnchor) publication = sourceAnchor.textContent.trim();
  else if (logoImg && logoImg.alt) publication = logoImg.alt;

  const li = document.createElement('li');
  li.className = 'press-quotes-item';
  li.dataset.index = String(index);
  li.setAttribute('aria-hidden', index === 0 ? 'false' : 'true');

  const figure = document.createElement('figure');
  const quote = document.createElement('blockquote');
  quote.className = 'press-quotes-quote';
  quote.textContent = `“${quoteText.replace(/^["“]|["”]$/g, '')}”`;
  figure.append(quote);

  const caption = document.createElement('figcaption');
  caption.className = 'press-quotes-source';

  if (logoImg) {
    const logo = document.createElement('img');
    logo.className = 'press-quotes-logo';
    logo.src = logoImg.src;
    logo.alt = logoImg.alt || publication || '';
    logo.loading = 'lazy';
    caption.append(logo);
  }

  if (sourceAnchor) {
    const link = document.createElement('a');
    link.href = sourceAnchor.getAttribute('href');
    link.rel = 'noopener';
    link.textContent = `Read in ${publication || 'press'}`;
    caption.append(link);
  } else if (publication) {
    const span = document.createElement('span');
    span.textContent = publication;
    caption.append(span);
  }

  figure.append(caption);
  li.append(figure);
  return li;
}

function attachCarousel(block, items) {
  if (items.length <= 1) return;

  const dots = block.querySelector('.press-quotes-dots');
  const dotButtons = dots ? [...dots.querySelectorAll('button')] : [];
  let current = 0;
  let timer = null;
  let isVisible = false;
  let isHovered = false;

  function show(index) {
    current = ((index % items.length) + items.length) % items.length;
    items.forEach((item, i) => {
      item.setAttribute('aria-hidden', i === current ? 'false' : 'true');
    });
    dotButtons.forEach((btn, i) => {
      btn.setAttribute('aria-selected', i === current ? 'true' : 'false');
      btn.tabIndex = i === current ? 0 : -1;
    });
  }

  function stop() {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function start() {
    if (PREFERS_REDUCED_MOTION) return;
    if (timer || !isVisible || isHovered) return;
    timer = window.setInterval(() => show(current + 1), ADVANCE_INTERVAL_MS);
  }

  dotButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      show(i);
      stop();
      start();
    });
  });

  block.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      show(current + 1);
      stop();
      start();
    } else if (e.key === 'ArrowLeft') {
      show(current - 1);
      stop();
      start();
    }
  });

  block.addEventListener('mouseenter', () => { isHovered = true; stop(); });
  block.addEventListener('mouseleave', () => { isHovered = false; start(); });
  block.addEventListener('focusin', () => { isHovered = true; stop(); });
  block.addEventListener('focusout', () => { isHovered = false; start(); });

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      isVisible = entry.isIntersecting;
      if (isVisible) start();
      else stop();
    });
  }, { threshold: 0.25 });
  observer.observe(block);

  show(0);
}

export default function decorate(block) {
  const rows = [...block.children];

  const track = document.createElement('ul');
  track.className = 'press-quotes-track';
  track.setAttribute('role', 'list');

  const items = [];
  rows.forEach((row) => {
    const li = buildItem(row, items.length);
    if (li) {
      items.push(li);
      track.append(li);
    }
  });

  const dots = document.createElement('div');
  dots.className = 'press-quotes-dots';
  dots.setAttribute('role', 'tablist');
  items.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('aria-label', `Show quote ${i + 1} of ${items.length}`);
    btn.textContent = String(i + 1);
    btn.style.fontSize = '0';
    dots.append(btn);
  });

  block.replaceChildren(track, dots);

  attachCarousel(block, items);
}
