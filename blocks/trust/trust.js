/**
 * Trust block decorator — animated stats strip.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Trust")
 *   Row 2+: each row becomes one stat
 *           Column 1: the big number (e.g., "500+", "$2M", "98%", "4.9")
 *                     Optional prefix / suffix characters are parsed out.
 *           Column 2: label text (e.g., "happy customers")
 *
 * The big-number element is wired with data-count-target / data-count-prefix /
 * data-count-suffix / data-count-decimals so scripts/interactions.js
 * §initCountUp() picks it up on scroll and animates the value.
 *
 * Optional label-only row (no number) is rendered as the section kicker.
 */

const NUMBER_RE = /(-?\d+(?:[.,]\d+)?)/;

function parseAuthoredNumber(raw) {
  const text = (raw || '').trim();
  if (!text) return null;

  const match = text.match(NUMBER_RE);
  if (!match) return null;

  const numText = match[1].replace(',', '.');
  const target = parseFloat(numText);
  if (Number.isNaN(target)) return null;

  // Decimals from authored text (e.g., "4.9" → 1)
  const dotIdx = numText.indexOf('.');
  const decimals = dotIdx === -1 ? 0 : numText.length - dotIdx - 1;

  // Split on the matched number to get prefix / suffix (e.g., "$2M" → "$" + "M")
  const parts = text.split(match[1]);
  const prefix = (parts[0] || '').trim();
  const suffix = (parts.slice(1).join(match[1]) || '').trim();

  return {
    target, decimals, prefix, suffix,
  };
}

export default function decorate(block) {
  // Flatten — look at every grandchild cell regardless of row grouping.
  // Supports two authoring layouts:
  //   A) One row per stat, col1=number, col2=label
  //   B) One row, many cells, each cell has <strong>number</strong> + <p>label</p>
  const cells = [...block.querySelectorAll(':scope > div > div')];
  const fragment = document.createDocumentFragment();

  let kickerText = '';
  let kickerSubText = '';
  const stats = [];

  cells.forEach((cell) => {
    const heading = cell.querySelector('h1, h2, h3, h4, h5, h6');
    const strong = cell.querySelector('strong');

    // Cell with a heading and no number → kicker (intro text).
    if (heading && !strong) {
      if (!kickerText) {
        kickerText = heading.textContent.trim();
        const para = cell.querySelector('p');
        if (para) kickerSubText = para.textContent.trim();
      }
      return;
    }

    // Number source: prefer <strong> (bolded number), else first line of cell text.
    const numberSource = strong
      ? strong.textContent
      : (cell.textContent.split('\n').find((s) => s.trim()) || '');
    const parsed = parseAuthoredNumber(numberSource);
    if (!parsed) return;

    // Label: any <p> that doesn't contain the <strong>.
    let label = '';
    [...cell.querySelectorAll('p')].forEach((p) => {
      if (strong && p.contains(strong)) return;
      const t = p.textContent.trim();
      if (t) label += (label ? ' ' : '') + t;
    });
    // Fallback: plain text that wasn't in any <p>
    if (!label && !strong) {
      const rest = cell.textContent.split('\n').slice(1).join(' ').trim();
      if (rest) label = rest;
    }

    stats.push({ ...parsed, label });
  });

  if (kickerText) {
    const kicker = document.createElement('p');
    kicker.className = 'trust-kicker';
    kicker.textContent = kickerText;
    fragment.append(kicker);
  }
  if (kickerSubText) {
    const sub = document.createElement('p');
    sub.className = 'trust-kicker-sub';
    sub.textContent = kickerSubText;
    fragment.append(sub);
  }

  const list = document.createElement('ul');
  list.className = 'trust-stats';
  list.setAttribute('role', 'list');

  stats.forEach(({
    target, decimals, prefix, suffix, label,
  }) => {
    const li = document.createElement('li');
    li.className = 'trust-stat';

    const value = document.createElement('span');
    value.className = 'trust-stat-value';
    value.dataset.countTarget = String(target);
    if (decimals) value.dataset.countDecimals = String(decimals);
    if (prefix) value.dataset.countPrefix = prefix;
    if (suffix) value.dataset.countSuffix = suffix;
    value.dataset.countDuration = '1800';
    // Initial render — interactions.js replaces this on scroll.
    value.textContent = `${prefix}0${decimals ? '.'.padEnd(decimals + 1, '0') : ''}${suffix}`;
    li.append(value);

    if (label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'trust-stat-label';
      labelEl.textContent = label;
      li.append(labelEl);
    }

    list.append(li);
  });

  fragment.append(list);
  block.replaceChildren(fragment);
}
