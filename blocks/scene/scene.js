/**
 * Scene block — pinned scrollytelling stage.
 * TD-1 §3.6: cascade only, never reads data-brand.
 *
 * Authored structure (da.live):
 *   Row 1:   block name ("Scene")  — added automatically
 *   Row 2:   OPTIONAL duration config. Single cell matching /^\d+(vh|px)$/.
 *            e.g. "400vh" → scene scroll length. Default 300vh.
 *   Row 3+:  each row is one layer:
 *            Column 1: range like "0-0.33" or "0.2-0.7" (scene progress 0–1)
 *            Column 2: the content (heading, image, paragraph, etc.)
 *
 * Decorator builds:
 *   <div class="scene" style="--scene-duration: 300vh;">
 *     <div class="scene-stage">
 *       <div class="scene-layer" data-scene-from="0" data-scene-to="0.33">...</div>
 *       ...
 *     </div>
 *   </div>
 *
 * scripts/interactions.js §initScenes sets --layer-progress (0–1) on each
 * layer based on scroll position, and CSS drives opacity + translate from that.
 */

const CONFIG_RE = /^\d+(?:vh|px|rem)$/;
const RANGE_RE = /^\s*([\d.]+)\s*[-\u2013\u2014\u2212]\s*([\d.]+)\s*$/;

export default function decorate(block) {
  const rows = [...block.children];
  if (!rows.length) return;

  // Detect optional duration config row (single cell, pure dimension value).
  let duration = '300vh';
  const first = rows[0];
  if (first && first.children.length === 1) {
    const text = first.textContent.trim();
    if (CONFIG_RE.test(text)) {
      duration = text;
      rows.shift();
    }
  }

  const stage = document.createElement('div');
  stage.className = 'scene-stage';

  rows.forEach((row) => {
    const cells = [...row.children];
    if (!cells.length) return;

    const rangeText = (cells[0].textContent || '').trim();
    const match = rangeText.match(RANGE_RE);

    let from;
    let to;
    let contentCells;

    if (match) {
      from = parseFloat(match[1]);
      to = parseFloat(match[2]);
      contentCells = cells.slice(1);
    } else {
      // No range prefix — layer is active across the whole scene.
      from = 0;
      to = 1;
      contentCells = cells;
    }

    const layer = document.createElement('div');
    layer.className = 'scene-layer';
    layer.dataset.sceneFrom = String(from);
    layer.dataset.sceneTo = String(to);

    contentCells.forEach((cell) => {
      while (cell.firstChild) layer.appendChild(cell.firstChild);
    });

    stage.appendChild(layer);
  });

  block.style.setProperty('--scene-duration', duration);
  block.replaceChildren(stage);
}
