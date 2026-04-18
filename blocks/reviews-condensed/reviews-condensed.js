/**
 * Reviews Condensed block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Reviews Condensed")
 *   Row 2: aggregate — two cells: score | count (e.g. "4.7" | "1240")
 *   Row 3-5: review rows — five cells each:
 *           Column 1: stars (1-5)
 *           Column 2: title
 *           Column 3: body
 *           Column 4: author name
 *           Column 5: verified flag (truthy = "verified", "true", "yes", "✓")
 *   Rows past 5 are ignored (condensed view only).
 *
 * Output:
 *   <div class="reviews-condensed block">
 *     <div class="reviews-condensed-aggregate">
 *       <span class="reviews-condensed-score">4.7</span>
 *       <span class="reviews-condensed-stars" aria-label="…" style="--filled:94%"></span>
 *       <span class="reviews-condensed-count">1,240 reviews</span>
 *     </div>
 *     <ul class="reviews-condensed-list" role="list">
 *       <li class="reviews-condensed-item">
 *         <span class="reviews-condensed-stars" aria-label="…" style="--filled:100%"></span>
 *         <h3 class="reviews-condensed-title">…</h3>
 *         <p class="reviews-condensed-body">…</p>
 *         <p class="reviews-condensed-author">Maya
 *           <span class="reviews-condensed-verified">Verified buyer</span>
 *         </p>
 *       </li>
 *       …
 *     </ul>
 *   </div>
 *
 * Stars: visual fill driven by --filled (0-100%); SVG mask in CSS.
 * Reveal: .reveal added pre-paint by scripts.js → autoRevealBlocks.
 */

const MAX_STARS = 5;
const TRUTHY_RE = /^(true|yes|verified|y|1|\u2713|x)$/i;

function rowCells(row) {
  return row ? [...row.children] : [];
}

function cellText(cell) {
  if (!cell) return '';
  return cell.textContent.trim();
}

function parseStars(raw) {
  const num = parseFloat((raw || '').trim());
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(MAX_STARS, num));
}

function buildStars(value, ariaLabel) {
  const stars = document.createElement('span');
  stars.className = 'reviews-condensed-stars';
  stars.setAttribute('role', 'img');
  stars.setAttribute('aria-label', ariaLabel);
  const pct = Math.round((value / MAX_STARS) * 100);
  stars.style.setProperty('--filled', `${pct}%`);
  return stars;
}

function formatCount(raw) {
  const cleaned = (raw || '').trim().replace(/[^\d]/g, '');
  if (!cleaned) return raw || '';
  return Number(cleaned).toLocaleString();
}

function buildAggregate(row) {
  if (!row) return null;
  const cells = rowCells(row);
  const score = cellText(cells[0]);
  const count = cellText(cells[1]);
  if (!score && !count) return null;

  const wrap = document.createElement('div');
  wrap.className = 'reviews-condensed-aggregate';

  if (score) {
    const scoreEl = document.createElement('span');
    scoreEl.className = 'reviews-condensed-score';
    scoreEl.textContent = score;
    wrap.append(scoreEl);

    const value = parseStars(score);
    wrap.append(buildStars(value, `${score} out of ${MAX_STARS} stars`));
  }

  if (count) {
    const countEl = document.createElement('span');
    countEl.className = 'reviews-condensed-count';
    countEl.textContent = `${formatCount(count)} reviews`;
    wrap.append(countEl);
  }

  return wrap;
}

function buildReview(row) {
  const cells = rowCells(row);
  const stars = parseStars(cellText(cells[0]));
  const title = cellText(cells[1]);
  const body = cellText(cells[2]);
  const author = cellText(cells[3]);
  const verified = TRUTHY_RE.test(cellText(cells[4]));
  if (!title && !body && !author) return null;

  const li = document.createElement('li');
  li.className = 'reviews-condensed-item';

  li.append(buildStars(stars, `${stars} out of ${MAX_STARS}`));

  if (title) {
    const h = document.createElement('h3');
    h.className = 'reviews-condensed-title';
    h.textContent = title;
    li.append(h);
  }

  if (body) {
    const p = document.createElement('p');
    p.className = 'reviews-condensed-body';
    p.textContent = body;
    li.append(p);
  }

  if (author) {
    const authorEl = document.createElement('p');
    authorEl.className = 'reviews-condensed-author';
    authorEl.textContent = author;
    if (verified) {
      const badge = document.createElement('span');
      badge.className = 'reviews-condensed-verified';
      badge.textContent = 'Verified buyer';
      authorEl.append(badge);
    }
    li.append(authorEl);
  }

  return li;
}

export default function decorate(block) {
  const rows = [...block.children];
  const [aggregateRow, ...reviewRows] = rows;

  const fragment = document.createDocumentFragment();

  const aggregate = buildAggregate(aggregateRow);
  if (aggregate) fragment.append(aggregate);

  const list = document.createElement('ul');
  list.className = 'reviews-condensed-list';
  list.setAttribute('role', 'list');

  reviewRows.slice(0, 3).forEach((row) => {
    const li = buildReview(row);
    if (li) list.append(li);
  });

  if (list.children.length) fragment.append(list);

  block.replaceChildren(fragment);
}
