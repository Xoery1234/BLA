/**
 * Social Proof Strip decorator — R1.B §4 item 4
 * Parses authored logo rows into a horizontal logo strip.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Social Proof")
 *   Row 2+: each row contains a logo image, optionally wrapped in a link
 *           First row can be a text label (e.g., "As seen in")
 */
export default function decorate(block) {
  const rows = [...block.children];
  const fragment = document.createDocumentFragment();

  let labelText = '';
  const logoItems = [];

  rows.forEach((row) => {
    const img = row.querySelector('img');
    const link = row.querySelector('a');

    if (!img) {
      // Text-only row = label
      const text = row.textContent.trim();
      if (text && !labelText) {
        labelText = text;
      }
      return;
    }

    logoItems.push({ img, link });
  });

  // Label
  if (labelText) {
    const label = document.createElement('p');
    label.className = 'social-proof-label';
    label.textContent = labelText;
    fragment.append(label);
  }

  // Logo list
  const list = document.createElement('ul');
  list.className = 'social-proof-logos';
  list.setAttribute('role', 'list');

  logoItems.slice(0, 6).forEach(({ img, link }) => {
    const li = document.createElement('li');
    li.className = 'social-proof-logo';

    if (link) {
      link.setAttribute('rel', 'noopener noreferrer');
      if (!link.getAttribute('target')) {
        link.setAttribute('target', '_blank');
      }
      // Move img inside link if not already
      if (!link.contains(img)) {
        link.textContent = '';
        link.append(img);
      }
      li.append(link);
    } else {
      li.append(img);
    }

    list.append(li);
  });

  block.textContent = '';
  fragment.append(list);
  block.append(fragment);
}
