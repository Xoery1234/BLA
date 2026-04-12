/**
 * Hero block decorator — Sprint 3
 * Parses da.live authored content into semantic hero structure.
 * TD-1 §3.6: consumes tokens via cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: Hero image (picture element)
 *   Row 2: Text content — first <p> before <h1> = eyebrow, <h1> = headline,
 *           first <p> after <h1> = subhead, remaining <p> with links = CTAs
 */
export default function decorate(block) {
  const rows = [...block.children];

  // Extract picture from first row (or wherever it appears)
  const picture = block.querySelector('picture');

  // Build content wrapper
  const content = document.createElement('div');
  content.className = 'hero-content';

  // Collect all text elements from the block
  const textElements = [];
  rows.forEach((row) => {
    [...row.children].forEach((cell) => {
      [...cell.children].forEach((child) => {
        if (child.tagName !== 'PICTURE') {
          textElements.push(child);
        }
      });
    });
  });

  let foundH1 = false;
  const actions = document.createElement('div');
  actions.className = 'hero-actions';
  let hasActions = false;

  textElements.forEach((el) => {
    if (el.tagName === 'H1') {
      foundH1 = true;
      content.append(el);
      return;
    }

    // Paragraphs before H1 = eyebrow
    if (!foundH1 && (el.tagName === 'P' || el.tagName === 'H6' || el.tagName === 'H5')) {
      el.className = 'hero-eyebrow';
      content.append(el);
      return;
    }

    // Check if paragraph contains CTA links (button-wrapper pattern)
    if (foundH1 && el.classList.contains('button-wrapper')) {
      actions.append(el);
      hasActions = true;
      return;
    }

    // First paragraph after H1 without buttons = subhead
    if (foundH1 && el.tagName === 'P' && !el.querySelector('a.button')) {
      el.className = 'hero-subhead';
      content.append(el);
      return;
    }

    // Paragraph with button links = CTA
    if (foundH1 && el.tagName === 'P' && el.querySelector('a.button')) {
      actions.append(el);
      hasActions = true;
      return;
    }

    // Anything else goes into content
    content.append(el);
  });

  if (hasActions) {
    content.append(actions);
  }

  // Clear block and rebuild
  block.textContent = '';

  if (picture) {
    block.append(picture);
  }

  block.append(content);
}
