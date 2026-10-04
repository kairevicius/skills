/**
 * Parts shared by the docs pages. The opening animation lives here so the landing page
 * and the write-up show one figure built from one set of measurements.
 */

/**
 * The opening row: empty plates with each shape as its own layer. Every position is a
 * percentage of the row or of the layer, so the figure scales with the page, and the move
 * is a percentage of the layer's own size because CSS translate resolves against it.
 */
export function motionFigure(M, alt = "A triangle, the Amazon wordmark, and a play icon that move from geometric centering to optical centering on their tiles") {
    const pctOf = (v, total) => `${((v / total) * 100).toFixed(4)}%`;
    return `<span class="fig motion" style="aspect-ratio: ${M.rowW} / ${M.rowH}"><img src="${M.src}" width="${M.w}" height="${M.h}" alt="${alt}">${M.layers.map((l) => `<span class="motion-el" style="left: ${pctOf(l.left, M.rowW)}; top: ${pctOf(l.top, M.rowH)}; width: ${pctOf(l.w, M.rowW)}; height: ${pctOf(l.h, M.rowH)}; --mx: ${pctOf(l.moveX, l.w)}; --my: ${pctOf(l.moveY, l.h)}"><img src="${l.src}" alt=""><svg class="motion-box" style="left: ${pctOf(l.ink.x, l.w)}; top: ${pctOf(l.ink.y, l.h)}; width: ${pctOf(l.ink.w, l.w)}; height: ${pctOf(l.ink.h, l.h)}" viewBox="0 0 ${l.ink.w} ${l.ink.h}" preserveAspectRatio="none" aria-hidden="true"><rect width="${l.ink.w}" height="${l.ink.h}"/></svg></span>`).join("")}</span>`;
}

/**
 * Each shape holds at geometric centering, moves to its optical position, holds there, and
 * returns. The dashed box is part of the layer, so it stays visible and moves with the
 * shape. With reduced motion, the shapes rest at their optical positions.
 */
export const MOTION_CSS = `
.motion { position: relative; display: block; width: 100%; }
.motion > img { display: block; width: 100%; height: auto; }
.motion-el { position: absolute; display: block; animation: settle 6s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
.motion-el img { display: block; width: 100%; height: 100%; }
.motion-box { position: absolute; overflow: visible; }
.motion-box rect { fill: none; stroke: #a6a6a6; stroke-width: 1px; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
@keyframes settle {
    0%, 25% { transform: translate(0, 0); }
    45%, 85% { transform: translate(var(--mx), var(--my)); }
    100% { transform: translate(0, 0); }
}
@media (prefers-reduced-motion: reduce) {
    .motion-el { animation: none; transform: translate(var(--mx), var(--my)); }
}`;
