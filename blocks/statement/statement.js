/**
 * Statement block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Statement")
 *   Row 2: kicker (optional, plain text label, e.g. "Our promise")
 *   Row 3: headline (required, rendered as <h2>)
 *   Row 4: sub-copy (optional paragraph)
 *   Any row beyond row 4 is ignored.
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
    const headline = document.createElement('h2');
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
