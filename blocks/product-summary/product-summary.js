/**
 * Product Summary block decorator
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Product Summary")
 *   Row 2: summary paragraph (single cell)
 *   Row 3+: spec rows — two cells each (label, value)
 *
 * Output:
 *   <div class="product-summary block">
 *     <p class="product-summary-copy">…</p>
 *     <dl class="product-summary-specs">
 *       <div class="product-summary-spec"><dt>Label</dt><dd>Value</dd></div>
 *       …
 *     </dl>
 *   </div>
 *
 * Reveal: .reveal class is added pre-paint by scripts.js → autoRevealBlocks
 * (this block is in the section-fade selector list).
 */

function rowCells(row) {
  return row ? [...row.children] : [];
}

function cellText(cell) {
  if (!cell) return '';
  return cell.textContent.trim();
}

function cellHTML(cell) {
  if (!cell) return '';
  return cell.innerHTML.trim();
}

export default function decorate(block) {
  const rows = [...block.children];
  const fragment = document.createDocumentFragment();

  // First row with exactly one cell → summary copy.
  let summaryRow = null;
  const specRows = [];
  rows.forEach((row) => {
    const cells = rowCells(row);
    if (cells.length === 1 && !summaryRow) {
      summaryRow = row;
    } else if (cells.length >= 2) {
      specRows.push(row);
    }
  });

  if (summaryRow) {
    const cellEl = summaryRow.firstElementChild;
    const html = cellHTML(cellEl);
    if (html) {
      const copy = document.createElement('p');
      copy.className = 'product-summary-copy';
      // If author wrote a real <p> inside the cell, hoist its content.
      const inner = cellEl.querySelector('p');
      copy.innerHTML = inner ? inner.innerHTML.trim() : html;
      fragment.append(copy);
    }
  }

  if (specRows.length) {
    const dl = document.createElement('dl');
    dl.className = 'product-summary-specs';
    specRows.forEach((row) => {
      const cells = rowCells(row);
      const label = cellText(cells[0]);
      const value = cellText(cells[1]);
      if (!label && !value) return;

      const wrap = document.createElement('div');
      wrap.className = 'product-summary-spec';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      wrap.append(dt, dd);
      dl.append(wrap);
    });
    fragment.append(dl);
  }

  block.replaceChildren(fragment);
}
