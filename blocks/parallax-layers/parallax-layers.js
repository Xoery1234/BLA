/**
 * Parallax Layers block — true multi-depth parallax.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1:   block name ("Parallax Layers") — added automatically
 *   Row 2:   OPTIONAL height config. Single cell matching /^\d+(px|vh|rem)$/.
 *            e.g. "600px". Default 500px.
 *   Row 3+:  each row is one layer:
 *            Column 1: speed multiplier (0 = pinned, 1 = normal, <1 slower/bg, >1 faster/fg)
 *            Column 2: the content (image, heading, etc.)
 *
 * Decorator builds:
 *   <div class="parallax-layers" style="--layers-min-height: 600px;">
 *     <div class="parallax-layer" data-parallax-speed="0.3">...</div>
 *     <div class="parallax-layer" data-parallax-speed="0.8">...</div>
 *     ...
 *   </div>
 *
 * scripts/interactions.js §initParallaxLayers sets --layer-translate on each
 * layer based on viewport offset and speed, and CSS applies translate3d.
 */

const CONFIG_RE = /^\d+(?:px|vh|rem)$/;
const SPEED_RE = /^-?\d+(?:\.\d+)?$/;

export default function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  let minHeight = '500px';
  const first = rows[0];
  if (first && first.children.length === 1) {
    const text = first.textContent.trim();
    if (CONFIG_RE.test(text)) {
      minHeight = text;
      rows.shift();
    }
  }

  const layers = [];
  rows.forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;

    const speedText = (cells[0].textContent || '').trim();
    let speed;
    let contentCells;
    if (SPEED_RE.test(speedText)) {
      speed = parseFloat(speedText);
      contentCells = cells.slice(1);
    } else {
      speed = 0.5;
      contentCells = cells;
    }

    const layer = document.createElement('div');
    layer.className = 'parallax-layer';
    layer.dataset.parallaxSpeed = String(speed);

    contentCells.forEach((cell) => {
      while (cell.firstChild) layer.appendChild(cell.firstChild);
    });

    layers.push(layer);
  });

  block.style.setProperty('--layers-min-height', minHeight);
  block.replaceChildren(...layers);
}
