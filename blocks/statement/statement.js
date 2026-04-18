/**
 * Statement block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Statement")
 *   Row 2: kicker (optional, plain text label, e.g. "Our promise")
 *   Row 3: headline (required, rendered as <h2> by default)
 *   Row 4: sub-copy (optional paragraph)
 *   Any row beyond row 4 is ignored.
 *
 * Headline level: defaults to <h2>. Author can override to <h1> via the UE
 * model's headline_level field, or by adding a `data-headline-level="h1"`
 * attribute on the block in da.live (block-options syntax).
 *
 * Output:
 *   <div class="statement block reveal">
 *     <p class="statement-kicker">…</p>
 *     <h2 class="statement-headline">…</h2>
 *     <p class="statement-sub">…</p>
 *   </div>
 *
 * Reveal: adds .reveal so styles/interactions.css §1 fades the block up
 * once it crosses the viewport (respects prefers-reduced-motion globally).
 */

const ALLOWED_LEVELS = new Set(['h1', 'h2']);

function resolveHeadlineLevel(block) {
  const attr = (block.dataset.headlineLevel || '').trim().toLowerCase();
  if (ALLOWED_LEVELS.has(attr)) return attr;
  // da.live "block options" surface as classes on the block: e.g. "statement h1"
  if (block.classList.contains('h1')) return 'h1';
  return 'h2';
}

function cellText(row) {
  if (!row) return '';
  const cell = row.firstElementChild;
  return cell ? cell.textContent.trim() : '';
}

function cellHTML(row) {
  if (!row) return '';
  const cell = row.firstElementChild;
  return cell ? cell.innerHTML.trim() : '';
}

export default function decorate(block) {
  const rows = [...block.children];
  const [kickerRow, headlineRow, subRow] = rows;

  const fragment = document.createDocumentFragment();

  const kickerText = cellText(kickerRow);
  if (kickerText) {
    const kicker = document.createElement('p');
    kicker.className = 'statement-kicker';
    kicker.textContent = kickerText;
    fragment.append(kicker);
  }

  const headlineHTML = cellHTML(headlineRow);
  if (headlineHTML) {
    const headline = document.createElement(resolveHeadlineLevel(block));
    headline.className = 'statement-headline';
    headline.innerHTML = headlineHTML;
    fragment.append(headline);
  }

  const subHTML = cellHTML(subRow);
  if (subHTML) {
    const sub = document.createElement('p');
    sub.className = 'statement-sub';
    sub.innerHTML = subHTML;
    fragment.append(sub);
  }

  block.classList.add('reveal');
  block.replaceChildren(fragment);
}
