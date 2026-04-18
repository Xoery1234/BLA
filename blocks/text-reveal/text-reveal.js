/**
 * Text Reveal block — word-by-word reveal.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1: block name ("Text Reveal")
 *   Row 2: the text (usually a heading, but any text content works)
 *
 * Decorator flattens the block and adds the .text-reveal class to the block
 * itself. scripts/interactions.js §initTextReveal walks text nodes and wraps
 * each word in a <span class="word"> with a staggered transition-delay.
 * IntersectionObserver triggers the .is-revealed class at 30% visibility.
 */

export default function decorate(block) {
  // Flatten — move all grandchild content up to the block level.
  const cells = [...block.querySelectorAll(':scope > div > div')];
  const fragment = document.createDocumentFragment();
  cells.forEach((cell) => {
    while (cell.firstChild) fragment.appendChild(cell.firstChild);
  });
  block.replaceChildren(fragment);
  // .text-reveal class is already present (EDS added it from the block name),
  // but make it explicit in case of variant class names.
  block.classList.add('text-reveal');
}
