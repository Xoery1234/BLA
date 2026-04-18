/**
 * Horizontal Scroll block — vertical scroll translates to horizontal motion.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1:   block name ("Horizontal Scroll") — added automatically
 *   Row 2+:  each row is one slide. All cells in the row form the slide content.
 *
 * Decorator builds:
 *   <div class="horizontal-scroll" style="--slide-count: 4;">
 *     <div class="horizontal-scroll-stage">
 *       <div class="horizontal-scroll-track">
 *         <div class="horizontal-scroll-slide">...</div>
 *         ...
 *       </div>
 *     </div>
 *   </div>
 *
 * Block height auto-scales to (slideCount + 1) * 100vh so the full sweep
 * happens during scroll through. Desktop-only; mobile CSS falls back to
 * vertical stack.
 */

export default function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  const track = document.createElement('div');
  track.className = 'horizontal-scroll-track';

  rows.forEach((row) => {
    const slide = document.createElement('div');
    slide.className = 'horizontal-scroll-slide';
    [...row.children].forEach((cell) => {
      while (cell.firstChild) slide.appendChild(cell.firstChild);
    });
    track.appendChild(slide);
  });

  const stage = document.createElement('div');
  stage.className = 'horizontal-scroll-stage';
  stage.appendChild(track);

  block.style.setProperty('--slide-count', String(rows.length));
  block.replaceChildren(stage);
}
