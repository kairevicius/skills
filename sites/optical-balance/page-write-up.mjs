/**
 * The page as a blog post: a narrative that walks from the problem through every example to
 * the method, in plain sentences with one term per concept. Every number is a measurement
 * passed in from build-docs.mjs, and every comparative claim (which logo is largest, which
 * way a shape moves) is derived from those measurements rather
 * than written as text, so a rebuild cannot leave a sentence that the figures contradict.
 */
import { ACCENT_CONTRAST, BACKGROUND_CONTRAST, CENTER_BLEND, DEFAULT_RASTER_EDGE, EXTENT_ALPHA } from "../../skills/optical-balance/scripts/lib.mjs";
import { motionFigure, MOTION_CSS } from "./page-parts.mjs";

export default function renderWriteUp({ F, N, img, label, labelOf, offCenterOf, demo, PAIR_W, ACCENT, LINK, GUIDE, ACCENT_SHARE_LABEL }) {
    const abs = (v) => Math.abs(Number(v));
    const pct1 = (v) => Number(v).toFixed(1);
    /** Distance from the visual center to the container center on both axes, the value each figure's label scores. */
    const optical = Object.values(F).filter((rec) => rec?.src && labelOf(rec) === "Optical").map((rec) => offCenterOf(rec).px);
    const residual = { max: Math.max(...optical).toFixed(1), off: optical.filter((px) => px >= 0.05).length, total: optical.length };
    const off = (id) => offCenterOf(F[id]).px.toFixed(1);
    const dxOf = (id) => Math.abs((F[id].marks[0].x - F[id].box.x) / (F[id].unit ?? 1)).toFixed(1);
    /** A figure with its label. `name` overrides the shared label where this page names the result differently. */
    const fig = (rec, w, h, alt, cls = "", name) => `<figure>${label(rec, name)}${img(rec, w, h, alt, cls)}</figure>`;
    const box = `<svg class="legend-box" width="20" height="12" viewBox="0 0 20 12" aria-hidden="true"><rect x="0.5" y="0.5" width="19" height="11" fill="none" stroke="#a6a6a6" stroke-dasharray="3 2"/></svg>`;
    const initialsMax = Math.max(...N.initials.per.map((r) => abs(r.dyEm))).toFixed(2);
    const [slack, shopify, airbnb] = N.lockup.brands;
    const brand = (name) => ({ amazon: "Amazon", google: "Google", stripe: "Stripe", slack: "Slack", shopify: "Shopify", apple: "Apple", mastercard: "Mastercard", netflix: "Netflix", airbnb: "Airbnb" })[name] ?? name;
    const bySize = [...N.strip].sort((a, b) => Number(b.size) - Number(a.size));
    const largest = bySize.slice(0, 3).map((r) => brand(r.name));
    const smallest = brand(bySize[bySize.length - 1].name);
    const list = (names) => `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;

    const M = F.introMotion;
    const motion = motionFigure(M);
    const moves = Object.fromEntries(N.introMotion.map((r) => [r.id, r]));
    const direction = ({ moveX, moveY }) => {
        const x = Number(moveX), y = Number(moveY);
        return Math.abs(y) >= Math.abs(x) ? (y < 0 ? "up" : "down") : (x > 0 ? "to the right" : "to the left");
    };
    /**
     * The live demo, embedded through srcdoc so this page stays one file. Which row shapes stay
     * still, and which way the others move under vertical-center alignment, comes from the demo's
     * own measurements: a visual center below the box center means optical moves the layer up.
     */
    const demoDoc = demo.html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const rowLayers = ["square", "circle", "triangle", "star", "heart"].map((id) => demo.layers.find((l) => l.id === id));
    const rowNames = (keep) => rowLayers.filter((l) => keep(l.visual.y - 0.5)).map((l) => l.name.toLowerCase());
    const rowStill = rowNames((d) => Math.abs(d) < 0.0005), rowUp = rowNames((d) => d >= 0.0005), rowDown = rowNames((d) => d <= -0.0005);
    const and = (names) => names.length < 2 ? names.join("") : names.length === 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
    const moveText = (names, way) => `the ${and(names)} ${names.length === 1 ? "moves" : "move"} ${way}`;
    const rowMoves = [rowUp.length ? moveText(rowUp, "up") : "", rowDown.length ? moveText(rowDown, "down") : ""].filter(Boolean).join(", and ");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The box is not the ink</title>
<style>
:root {
    --paper: #fbfbfb; --ink: #1a1a1a; --muted: #6b6b6b; --faint: #a3a3a3; --hair: #e4e4e4; --accent: ${ACCENT}; --link: ${LINK}; --guide: ${GUIDE};
    /* Four sizes, two weights. */
    --size-title: 34px; --size-lede: 20px; --size-body: 17px; --size-small: 13px;
}
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; background: var(--paper); color: var(--ink); font: var(--size-body)/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 880px; margin: 0 auto; padding: 88px 32px 112px; }
h1 { font-size: var(--size-title); font-weight: 600; line-height: 1.15; margin: 0 0 16px; letter-spacing: -0.015em; max-width: 680px; }
h2 { font-size: var(--size-lede); font-weight: 600; line-height: 1.3; margin: 80px 0 12px; letter-spacing: -0.005em; }
h3 { font-size: var(--size-body); font-weight: 600; margin: 48px 0 8px; }
p { margin: 0 0 16px; max-width: 660px; }
.lede { font-size: var(--size-lede); line-height: 1.5; color: var(--muted); max-width: 680px; margin-bottom: 8px; }
.muted { color: var(--muted); }
.small, pre, table { font-size: var(--size-small); }
p.small { line-height: 1.5; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; align-items: start; margin: 40px 0 20px; }
/* Bottom-aligned, so a label that wraps at a narrow width does not push its tile below its neighbors. */
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: end; margin: 40px 0 32px; }
.steps figure { min-width: 0; }
@media (max-width: 720px) { .steps { grid-template-columns: 1fr; } }
.pair figure { min-width: 0; }
.pair.stack { grid-template-columns: minmax(0, ${PAIR_W * 2}px); row-gap: 28px; }
figure { margin: 0; }
figure.wide { margin: 40px 0 20px; }
/* Two stacked strips are tall blocks; the pair needs a clear break, not a hairline. */
figure.wide + figure.wide { margin-top: 64px; }
figure.hero { margin: 48px 0 32px; }
.fig { position: relative; display: block; width: 100%; }
.fig img { display: block; width: 100%; height: auto; }
.fig.tile { outline: 1px solid var(--hair); }
.overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.overlay-lines { mix-blend-mode: multiply; }
.fig.dark .overlay-lines { mix-blend-mode: screen; }
.overlay .guide, .overlay .mark { display: none; }
.overlay .bbox { fill: none; stroke: #a6a6a6; stroke-width: 1px; stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
.fig.dark .overlay .bbox { stroke: #6a6a6a; }
.overlay .measure-line { stroke: var(--muted); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.overlay .measure-cap { fill: var(--muted); }
.overlay .measure-text { fill: var(--ink); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 500; }
.fig.dark .overlay .measure-line { stroke: #a0a0a0; }
.fig.dark .overlay .measure-cap { fill: #a0a0a0; }
.fig.dark .overlay .measure-text { fill: #e6e6e6; }
@keyframes marker-cycle {
    0%, 4% { opacity: 0; filter: blur(10px); }
    16%, 52% { opacity: 1; filter: blur(0); }
    64%, 100% { opacity: 0; filter: blur(10px); }
}
.overlay { animation: marker-cycle 7s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
${MOTION_CSS}
@media (prefers-reduced-motion: reduce) {
    .overlay { animation: none; opacity: 1; filter: none; }
}
.legend-box { vertical-align: middle; margin: 0 6px 0 0; }
.demo { display: block; width: 100%; height: 640px; border: 0; outline: 1px solid var(--hair); background: #f5f5f5; }
@media (max-width: 720px) { .demo { height: 720px; } }
.label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; font-size: var(--size-small); font-weight: 600; color: var(--ink); margin: 0 0 8px; letter-spacing: 0.01em; }
.label .score { font-weight: 400; color: var(--faint); font-variant-numeric: tabular-nums; }
pre { font: var(--size-small)/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; background: transparent; margin: 20px 0; padding: 0; white-space: pre; overflow-x: auto; color: var(--ink); }
code { font: var(--size-small) ui-monospace, SFMono-Regular, Menlo, monospace; }
table { border-collapse: collapse; margin: 20px 0; width: 100%; max-width: 660px; }
th, td { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--hair); vertical-align: top; font-variant-numeric: tabular-nums; }
th { font-weight: 600; color: var(--muted); }
td.num, th.num { text-align: right; padding-right: 0; padding-left: 12px; }
/* A right-aligned column that is not the last one still needs a gutter. */
td.num:not(:last-child), th.num:not(:last-child) { padding-right: 20px; }
.scroll { overflow-x: auto; }
ul, ol { padding-left: 22px; max-width: 660px; margin: 0 0 16px; }
li { margin: 6px 0; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
<p class="small"><a href="index.html">Optical balance</a></p>
<h1>The box is not the ink</h1>
<p class="lede">Center a logo by its bounding box and it looks off center. I built an agent skill that measures where the eye sees the center of a mark and how large the mark looks. It works with Claude Code, Codex, Cursor, or any agent that reads skills. Every figure in this post is its output, and every number is a measurement of that figure.</p>

<figure class="hero">${motion}</figure>
<p>Each shape starts with its layout box on the exact center of its tile, the way a layout system places it. Then it moves to where the eye reads its center, and its dashed box moves with it. The triangle moves ${direction(moves.triangle)}, the Amazon wordmark moves ${direction(moves.amazon)}, and the play icon moves ${direction(moves.play)}.</p>
<p>The rest of this post is about that second position: how to measure it, and where it changes real interfaces.</p>

<h2>Two obvious fixes, both wrong</h2>
<p>The first fix is to center the ink instead of the box. The second is to center the weight of the ink. I tried both, and three tests show why neither works.</p>
<ul>
<li>Center the ink box, and the triangle looks ${abs(N.intro["step-box"].dy)}px too low. Most of its ink is near its base.</li>
<li>Center the mass centroid, and the same triangle looks ${abs(N.intro["step-mass"].dy)}px too high. The eye also reads where a shape ends, not only where its weight is.</li>
<li>Count every visible pixel the same, and a dark mark with a faint accent looks ${abs(N.intro["step-ink"].dy)}px too high. The eye gives faint ink less weight.</li>
</ul>
<div class="steps">
${fig(F["step-box"], F.stepSize.w, F.stepSize.h, `A triangle on the center of its ink box. It looks ${abs(N.intro["step-box"].dy)}px low.`, "", "Box center: too low")}
${fig(F["step-mass"], F.stepSize.w, F.stepSize.h, `The same triangle on its mass centroid. It looks ${abs(N.intro["step-mass"].dy)}px high.`, "", "Mass centroid: too high")}
${fig(F["step-ink"], F.stepSize.w, F.stepSize.h, `A two-tone mark on the centroid of all its ink. The dark part looks ${abs(N.intro["step-ink"].dy)}px high.`, "", "All ink equal: too high")}
</div>
<p>The two errors on the triangle are almost the same size, in opposite directions. So the point the eye reads is halfway between them. I call it the visual center: the midpoint of the extent center (the center of the ink box) and the mass centroid. The mass centroid weights each pixel by the square of its contrast against the background, so faint ink counts for less.</p>
<p>The skill measures the visual center, moves the element until that point sits on the center of its container, and then measures the result again.</p>

<h3>Reading the figures</h3>
<p>Each comparison below has two labels. Geometric is what a layout system does by default: the layout box sits on the center of the container. Optical is the result of the skill: the visual center sits there instead.</p>
<p>Off center is the distance from the visual center to the center of the container, as a percentage of the shorter side of the container. ${box}The dashed box is the ink box, and the numbers around it give the space to the container, in pixels of the figure. They fade in and out on a 7-second loop.</p>

<h2>The Amazon smile</h2>
<p>The Amazon wordmark has black letters and an orange smile. On white, the smile has about a third of the contrast of the letters. So the eye reads the letters as the logo, and the smile hangs below them. Geometric centering puts the letters too high. Counting every pixel the same still leaves them ${abs(N.amazon.result.alpha.dy)}px high.</p>
<p>Contrast squared fixes it, together with one more rule: the extent comes from the dark letters only. The offset is ${N.amazon.dyPct}% of the height of the mark, down. That is the old advice that a logo should sit a bit lower, with a number on it.</p>
<div class="pair">
${fig(F["amazon-box"], PAIR_W, PAIR_W, `Geometric centering. The visual center is ${abs(N.amazon.result.box.dy)}px above the tile center.`, "tile")}
${fig(F["amazon-visual"], PAIR_W, PAIR_W, `Optical centering. The visual center is ${off("amazon-visual")}px from the tile center. The letters sit on the line, and the smile hangs below.`, "tile")}
</div>
<p>The background is an input, not a detail. On black, the inverted smile has a contrast of ${N.amazonDark.smileContrastDark}. That is above ${ACCENT_CONTRAST}, the threshold where ink stops being faint. So the smile counts as part of the mark, and the offset drops to ${N.amazonDark.dyPct}%. One logo in two themes needs two offsets.</p>
<div class="pair">
${fig(F["amazon-dark-box"], PAIR_W, PAIR_W, `Geometric centering on black. The visual center is ${abs(N.amazonDark.boxDy)}px above the tile center.`, "tile")}
${fig(F["amazon-dark-visual"], PAIR_W, PAIR_W, `Optical centering on black. The visual center is ${off("amazon-dark-visual")}px from the tile center. The smile counts, so the letters sit higher than on white.`, "tile")}
</div>

<h2>When the faint part is not an accent</h2>
<p>Giving faint ink less weight can also go wrong. The lighter blue of PayPal is ${N.paypal.accentShare}% of its ink. That is a second color, not an accent. A discount would push the visual center ${abs(N.paypal.massShiftPct)}% of the width toward the darker monogram, and the wordmark would sit off its tile.</p>
<p>So the discount only applies when faint ink is at most a third of the mark. Above that share, every pixel counts at its full alpha weight. The optical result then moves the wordmark only ${abs(N.paypal.shiftPct)}% of its width, toward the heavier monogram.</p>
<div class="pair">
${fig(F["paypal-box"], PAIR_W, Math.round(PAIR_W / 2), `Geometric centering on a wide tile. The visual center is ${abs(N.paypal.plainDx)}px left of the tile center, because the monogram has more ink than the letters.`, "tile")}
${fig(F["paypal-visual"], PAIR_W, Math.round(PAIR_W / 2), `Optical centering, ${abs(N.paypal.dx)}px to the right. The visual center is ${N.paypal.convergedPx}px from the tile center. Both blues count at full weight.`, "tile")}
</div>
<p class="small muted">A wordmark fills the width of a square tile, so a horizontal offset needs a tile that is wider than the mark.</p>

<h2>Small marks</h2>

<h3>Icons in round buttons</h3>
<p>A play triangle has two thirds of its area in its left half. With geometric centering, it looks pushed to the left, and designers nudge it right by eye. Its mass centroid pushes it too far. Halfway between is ${N.icons.play.dx}px for a 24px icon, or ${N.icons.play.dxPctIcon}% of the icon. An arrow is the mirror case: its head has more ink than its shaft, so it moves ${abs(N.icons.arrow.dx)}px to the left.</p>
<div class="pair">
${fig(F["play-before"], PAIR_W, PAIR_W, `Play icon, geometric centering. The visual center is ${abs(N.icons.play.beforeOff)}px left of the button center.`)}
${fig(F["play-after"], PAIR_W, PAIR_W, `Play icon, ${N.icons.play.dx}px to the right. The visual center is ${abs(N.icons.play.afterOff)}px from the button center.`)}
</div>
<div class="pair">
${fig(F["arrow-before"], PAIR_W, PAIR_W, `Arrow icon, geometric centering. The visual center is ${abs(N.icons.arrow.beforeOff)}px right of the button center.`)}
${fig(F["arrow-after"], PAIR_W, PAIR_W, `Arrow icon, ${abs(N.icons.arrow.dx)}px to the left. The visual center is ${abs(N.icons.arrow.afterOff)}px from the button center.`)}
</div>
<p class="small muted">Enlarged. The button is 64px, and the icon is 24px.</p>
<p>The offset belongs in the icon component, one value for each icon. Then every button that shows the icon gets it, and a percentage holds at every size.</p>

<h3>A caps label in a pill</h3>
<p>Line-height centers the em box, and the em box keeps room for descenders. Capitals have no descenders, so a caps label sits high in a pill. At ${N.pill.font}px, this one sits ${abs(N.pill.dy)}px (${abs(N.pill.dyEm)}em) high. Letter-spacing also leaves a gap after the last letter, which pushes the text ${abs(N.pill.dx)}px to the left. One measurement finds both.</p>
<div class="pair">
${fig(F["pill-before"], PAIR_W, Math.round(PAIR_W * 32 / 104), `Centered by the em box. The capitals sit ${abs(N.pill.dy)}px high and ${abs(N.pill.dx)}px left.`)}
${fig(F["pill-after"], PAIR_W, Math.round(PAIR_W * 32 / 104), `Moved ${abs(N.pill.dy)}px down and ${abs(N.pill.dx)}px right. The visual center is ${abs(N.pill.afterDy)}px from the center.`)}
</div>
<p class="small muted">Enlarged. The pill is 32px tall.</p>
<p>An offset in em holds at every font size. It is a property of the typeface, not of the text, so I measure it once for each font.</p>

<h3>Initials in an avatar</h3>
<p>When a company has no logo, an app often draws its initials on a colored disc. The layout centers each letter by its em box and its advance width. That leaves J leaning right and hanging low, L heavy on the left, and A heavy at its base. At ${N.initials.font}px semibold, the offsets are mostly vertical and run up to about ${initialsMax}em. Each letter needs its own, so I store one offset for each letter of the glyph set.</p>
<div class="pair stack">
${fig(F["initials-before"], PAIR_W * 2, Math.round((PAIR_W * 2) * F.initialsSize.h / F.initialsSize.w), `Centered by the em box and the advance width. The letters sit high, and J and L lean.`)}
${fig(F["initials-after"], PAIR_W * 2, Math.round((PAIR_W * 2) * F.initialsSize.h / F.initialsSize.w), `Each letter moved by its own offset.`)}
</div>

<h3>An icon beside a label</h3>
<p>A button with an icon and a word has the same problem sideways. Equal padding centers the content box, but the word has more ink than the icon. So the content looks shifted toward the word. The measured fix is ${N.button.padIcon}px on the icon side and ${N.button.padText}px on the text side, not ${N.button.pad}px on each side. Designers describe this as slightly less padding on the icon side, and here it has a value.</p>
<div class="pair">
${fig(F["button-before"], PAIR_W, Math.round(PAIR_W * 48 / 140), `Equal padding, ${N.button.pad}px on each side. The visual center of the content is ${abs(N.button.beforeOff)}px right of the button center.`)}
${fig(F["button-after"], PAIR_W, Math.round(PAIR_W * 48 / 140), `Padding of ${N.button.padIcon}px left and ${N.button.padText}px right. The visual center is ${abs(N.button.afterOff)}px from the button center.`)}
</div>

<h2>A shipped mark: Vercel</h2>
<p>The Vercel icon is a white triangle on a black disc, so the disc is the container. A triangle keeps its ink near its base. On this ${N.vercel.mark} mark, the box center and the mass centroid are ${N.vercel.gap}px apart. The correction is ${abs(N.vercel.dy)}px up, ${N.vercel.dyPct}% of the height of the mark. Geometric centering leaves the triangle ${pct1(N.vercel.beforePct)}% off the center of the disc. Optical centering leaves ${pct1(N.vercel.afterPct)}%.</p>
<div class="pair">
${fig(F["vercel-box"], PAIR_W, PAIR_W, `Geometric centering in the disc. The visual center of the triangle is ${N.vercel.beforePx}px low.`, "tile")}
${fig(F["vercel-visual"], PAIR_W, PAIR_W, `Optical centering, moved up. The visual center is ${N.vercel.afterPx}px from the disc center.`, "tile")}
</div>
<p>The disc itself needs nothing. It has its own background, and it is symmetric, so the skill skips it and measures only the triangle inside. Nothing here is specific to Vercel. App icons, favicons, and avatars all put marks in circles and squares. Any mark with its weight away from its box center carries the same error until the placement rule changes.</p>

<h2>Two parts of one logo</h2>
<p>A lockup puts a symbol beside a wordmark. The wordmark has ascenders, so its box center sits above the mass of its lowercase letters. Align the symbol to that box center, and the symbol sits high.</p>
<p>Slack does not do that. Its symbol sits within ${slack.visual}% of the word height from the visual center of the word, while the two box centers are ${slack.box}% apart. Below, I rebuilt the lockup from its parts at the gap Slack uses. Geometric aligns the two box centers. Optical aligns the two visual centers, and it matches the lockup that Slack ships. The score here is vertical only, because the layout sets the horizontal position.</p>
<div class="pair">
${fig(F["lockup-before"], PAIR_W, Math.round(PAIR_W / 2), `Box centers aligned. The visual center of the symbol is ${abs(N.lockup.defaultOff)}px above the visual center of the word, which is ${abs(N.lockup.defaultOffPct)}% of the word height.`, "tile")}
${fig(F["lockup-after"], PAIR_W, Math.round(PAIR_W / 2), `Visual centers aligned, ${abs(N.lockup.afterOff)}px apart. The symbol sits on the mass of the lowercase letters, where Slack puts it.`, "tile")}
</div>
<p>Other brands make other choices. Airbnb aligns the box center of its symbol with the visual center of the word, within ${abs(airbnb.cross)}%. The Bélo has most of its mass low in its box, so its own visual center is lower. Shopify follows a different rule: the bag is ${shopify.symShare}% of the word height, and its base is near the descender line. That is a brand decision, not an error. When a brand has no rule, I align the visual centers and store the offset in the lockup asset.</p>

<h2>Equal height is not equal size</h2>
<p>Give nine logos the same height, and the row looks uneven. ${list(largest)} carry the most ink and look largest. ${smallest} looks smallest.</p>
<p>The size rule scales every logo to the perceived size of the smallest one, so no logo grows past its cell. It measures the whole set at once, so a line break cannot change the scale of a logo. Each logo also sits on its own visual center, so the Amazon letters stay on the line.</p>
<figure class="wide">${label(F["strip-before"])}${img(F["strip-before"], F.stripSize.width, F.stripSize.height, "Nine logos on two rows at equal height")}</figure>
<figure class="wide">${label(F["strip-after"], "Equal perceived size")}${img(F["strip-after"], F.stripSize.width, F.stripSize.height, "Nine logos on two rows at equal perceived size, with optical centering")}</figure>
<p>Size spread is the difference between the largest and the smallest perceived size, as a percentage of the smallest. It goes from ${N.stripVerify.spreadBefore}% to ${N.stripVerify.spreadAfter}%.</p>
<p>Perceived size is the geometric mean of two readings. One is the visual size, the square root of the contrast-weighted ink area. The other is the height of the ink. It gives mass and extent equal weight, the same way the visual center does. When every logo starts at one height, a scale of the square root of the size ratio makes their perceived sizes equal. Full equalization of the ink area goes too far. I picked the default from seven variants of this strip, rendered side by side in <a href="${F["sizing-experiment"]}">the experiment sheet</a>.</p>
<div class="scroll"><table>
<tr><th>logo</th><th class="num">equal height</th><th class="num">visual size</th><th class="num">scale</th><th class="num">rendered</th></tr>
${N.strip.map((r) => `<tr><td>${brand(r.name)}</td><td class="num">${r.equal}</td><td class="num">${r.size}</td><td class="num">×${r.correction}</td><td class="num">${r.rendered}</td></tr>`).join("\n")}
</table></div>
<p class="small muted">Sizes in px at a 40px row. The default target is the smallest baseline perceived size, ${N.stripTarget}px. Both strips use one canvas width, because the page shows every figure at one width.</p>

<h2>It also crops photos</h2>
<p>An uploaded photo is often wide, with the person on one side, and a center crop shows mostly wall. The same measurement can frame it. The measured region is every pixel that contrasts with the backdrop, weighted by contrast squared. There is no accent discount here: a photo is a continuous field, and the eye goes to its brightest region with the most contrast.</p>
<p>Contrast cannot identify a face or preferred portrait framing. Inspect the final crop; a collar or highlight may dominate.</p>
<div class="pair">
${fig(F["frame-box"], PAIR_W, PAIR_W, `A center crop at ${N.frame.zoom}% of the short side shows the backdrop and half of the subject. The visual center is ${N.frame.beforeOffPct}% off the avatar center.`)}
${fig(F["frame-visual"], PAIR_W, PAIR_W, `The crop moved ${N.frame.moved} in the source. The visual center is ${N.frame.afterOffPct}% off the avatar center.`)}
</div>
<p>This works on a plain backdrop: casual portraits against a wall, product photos on white, and scans. It centers a subject, not a face. A busy scene needs a face or subject detector first, and then the rule centers the crop on what the detector returns.</p>
<p class="small muted">The source is Vermeer's <em>Girl with a Pearl Earring</em> (public domain). The script extends it by ${N.frame.extend}px on the left and ${N.frame.extendRight}px on the right with its own backdrop, to simulate a wide upload.</p>

<h2>What if align tools worked this way</h2>
<p>Design tools align the layer box, so every correction above is a manual step today. I built a small canvas where the align buttons have a second mode. Optical centers each layer on its measured visual center, and it aligns edges by the ink instead of the padded frame. Each layer was measured against the fill behind it.</p>
<figure class="wide"><iframe class="demo" title="A design canvas with geometric and optical align tools" loading="lazy" srcdoc="${demoDoc}"></iframe></figure>
<p>Select the five shapes in the bottom row, and align their vertical centers with the button or with ⌥V. Then switch between Geometric and Optical. The switch replays the last align, so each shape moves between the two answers. The ${and(rowStill)} stay still, because they are symmetric. In Optical, ${rowMoves}.</p>
<p class="small muted">Click into the canvas before you use the shortcuts. The edges use the ink box only, because the method does not model the overshoot of round shapes.</p>

<h2>How the measurement works</h2>
<p>This is a reproducible heuristic. Scoring its own placements checks implementation consistency, not human perception. No blind preference results are available.</p>
<p>Everything above comes from one pass over the pixels. Vector input is rasterized first, at a ${DEFAULT_RASTER_EDGE}px longest edge, so an SVG measures like the bitmap a browser paints. Each pixel gets two weights, one for position and one for size.</p>
<pre>luma           = 0.299 R + 0.587 G + 0.114 B     Rec. 601
contrast       = |luma − background luma| / 255  0 to 1
                                                 at ${BACKGROUND_CONTRAST} or less, the pixel is background
mass weight  w = alpha × contrast²               for position
size weight  s = alpha × contrast                for size</pre>
<div class="steps">
${fig(F["weight-mark"], F.methodPanel.w, F.methodPanel.h, `The mark as it renders on the tile.`, "", "The mark")}
${fig(F["weight-alpha"], F.methodPanel.w, F.methodPanel.h, `Every visible pixel at full weight. The smile weighs as much as the letters.`, "", "Every pixel equal")}
${fig(F["weight-contrast"], F.methodPanel.w, F.methodPanel.h, `Weighted by contrast squared. The letters keep ${N.method.letterWeight}, and the smile drops to ${N.method.smileWeight}.`, "", "Weighted by contrast²")}
</div>
<p>Squaring the contrast is what lets an accent hang. At half contrast, a pixel gets a quarter of the weight. So the letters keep a weight of ${N.method.letterWeight}, and the smile drops to ${N.method.smileWeight}. Size uses linear contrast instead. The squared form turns differences in color into differences in size. With it, a coral wordmark would measure a third smaller than a black one of the same shape.</p>
<p>Pixels within ${BACKGROUND_CONTRAST} contrast of the background do not count. So background pixels are excluded; translucent edges still change after compositing. A white background in the file does not pull every centroid toward the box center.</p>
<pre>alpha centroid   Σ(alpha · p) / Σ alpha
mass centroid    Σ(w · p) / Σ w
accent share     Σ alpha where contrast &lt; ${ACCENT_CONTRAST}  ÷  Σ alpha
mass             accent share ≤ ${ACCENT_SHARE_LABEL} ? mass centroid : alpha centroid
extent           center of the ink box, pixels with alpha ≥ ${EXTENT_ALPHA}
                 (strong ink only, while the accent discount applies)
visual center    extent + ${CENTER_BLEND} × (mass − extent)
offset           container center − visual center     positive y moves down</pre>
<figure class="wide">${img(F["method-centers"], F.methodDiagram.w, F.methodDiagram.h, "The extent center, the mass centroid, and the visual center on one mark")}</figure>
<p>The diagram uses the Vercel triangle, because its two readings are ${N.method.gapPct}% of its height apart. The center of the ink box is at y ${N.method.extentY}. The mass centroid is lower, at y ${N.method.massY}, because a triangle has its weight near its base. The visual center is halfway, at y ${N.method.visualY}, and placement moves the element until that point is on the center of the container.</p>
<p>The ink box counts only pixels that are at least half opaque. Resampling leaves almost transparent pixels at the edges, and their color is noise. If the ink box counted them, it would grow to the edge of an accent that the mass just discounted.</p>
<pre>visual size      √ Σ s
perceived size   √( visual size × ink height )
baseline         min( row height ÷ ink height , max width ÷ ink width )
correction       target perceived size ÷ baseline perceived size</pre>
<p>The method fits each element to the row first, then scales it toward a target. The target is the smallest baseline size, or one named element when a set has a keyline.</p>
<p>Six numbers drive all of it, and a measurement set each one:</p>
<div class="scroll"><table>
<tr><th>constant</th><th class="num">value</th><th>controls</th><th>set by</th></tr>
<tr><td>background contrast</td><td class="num">${BACKGROUND_CONTRAST}</td><td>which pixels are background, not ink</td><td>low enough that background pixels are excluded; translucent edges still change after compositing</td></tr>
<tr><td>extent alpha</td><td class="num">${EXTENT_ALPHA}</td><td>which pixels set the ink box</td><td>half opaque, so edge pixels from resampling cannot grow the box</td></tr>
<tr><td>accent contrast</td><td class="num">${ACCENT_CONTRAST}</td><td>which ink is faint</td><td>the Amazon smile measures ${N.amazonDark.smileContrastLight} on white and ${N.amazonDark.smileContrastDark} inverted on black, and the threshold is between the two</td></tr>
<tr><td>accent max share</td><td class="num">${ACCENT_SHARE_LABEL}</td><td>when faint ink stops being an accent</td><td>the lighter PayPal blue is ${N.paypal.accentShare}% of its mark and must keep its full weight</td></tr>
<tr><td>center blend</td><td class="num">${CENTER_BLEND}</td><td>where the visual center sits between extent and mass</td><td>box centering and mass centering miss a triangle by ${abs(N.intro["step-box"].dy)}px and ${abs(N.intro["step-mass"].dy)}px, in opposite directions</td></tr>
<tr><td>size power</td><td class="num">0.5</td><td>how strongly a set is equalized</td><td>seven variants of the logo strip, rendered side by side; at one ink height it makes the perceived sizes equal</td></tr>
</table></div>

<h2>Why it never reaches zero</h2>
<p>None of the optical figures lands exactly on center. The largest residual is ${residual.max}px, and ${residual.off} of the ${residual.total} optical figures are not exactly on it. Three things cause the gap, and only one of them can be fixed:</p>
<ul>
<li>Placement uses whole pixels, so up to half a pixel of every offset rounds away. On a ${N.amazonClamp.tile}px tile, one pixel is ${N.amazonClamp.onePx}% of the width.</li>
<li>Edge pixels blend into the background, and that moves the visual center of the result a little. This one is fixable: measure the result and move it again until it stops changing. On the PayPal tile, that takes the residual from ${N.paypal.onePassPx}px to ${N.paypal.convergedPx}px.</li>
<li>The artwork has no room to move. The Amazon wordmark is ${N.amazonClamp.artWidth}px wide in a ${N.amazonClamp.artBox}px art box, so its horizontal residual stays: ${dxOf("amazon-visual")}px on white and ${dxOf("amazon-dark-visual")}px on black.</li>
</ul>
<p>So the skill accepts a result within 1% of the container. A residual under one pixel is smaller than the pixel grid can show.</p>

<h2>Using it</h2>
<p>The procedure has five steps:</p>
<ol>
<li>Skip an element with its own background, such as a disc badge or a full-bleed image.</li>
<li>Measure the element against the luminance of the surface that it renders on.</li>
<li>Apply the offset where the position is set: the asset bake, the shared component, the icon set, or the layout. Never one instance.</li>
<li>Measure the rendered result, not the source, and correct the residual until it stops changing.</li>
<li>Accept a result that is 1% or less off center, or a set with a size spread of 3% or less. Record what the output measured.</li>
</ol>
<p>The offset is a translation, with positive y down:</p>
<pre>/* CSS: the icon component stores its own optical offset */
.icon-play { transform: translateX(${N.icons.play.dxPctIcon}%); }

/* SVG: put the offset into the symbol */
&lt;g transform="translate(${N.icons.play.dx} 0)"&gt;…&lt;/g&gt;

/* Asset bake (sharp): place the element by its measured visual center */
left = round(tile / 2 - visual.x); top = round(tile / 2 - visual.y);</pre>
<p>The script runs on Node with sharp:</p>
<pre>cd optical-balance/scripts &amp;&amp; npm ci        # once, to install sharp

node optical.mjs measure  logo.svg --bg 255           # find the visual center
node optical.mjs measure  logo.png --bg "#141414"     # measure against the real background
node optical.mjs equalize a.svg b.svg c.svg --height 40   # equal perceived size in a 40px row
node optical.mjs tile     logo.svg --out tile.png     # bake a tile with optical centering
node optical.mjs strip    a.svg b.svg c.svg --out strip.png   # render the equalized row
node optical.mjs frame    photo.jpg --out avatar.png --bg "#0a0a08" --tolerance 0.15 --zoom 0.72 --circle   # crop around the visual center</pre>
<p>To check a set, measure each rendered logo and compare the <code>perceived size</code> lines. The nine logos above measure ${N.stripVerify.min}px to ${N.stripVerify.max}px.</p>

<h2>What it gets wrong</h2>
<p>The wrong background gives a wrong number that looks right. Measured against black instead of white, the Amazon mark loses its letters to the background, and the offset comes out as ${N.amazonWrongBg.dyPct}% instead of ${N.amazon.dyPct}%. Nothing in the output warns you, so the background is always an explicit input.</p>
<p>Busy photos have no plain backdrop to contrast with, so the visual center goes to the busiest region. They need a detector first.</p>
<p>Hue is the limit I do not know how to solve yet. The method measures luminance contrast only, so a saturated red and a gray of the same luminance get the same weight. The red still looks heavier. If you have a model for the weight of hue that holds up on real logos, I would like to see it.</p>

<h2>Prior art</h2>
<p>Designers already make these corrections by eye. The skill puts a number on them.</p>
<ul>
<li>Jakub Krehel's list of interface details gives the icon side of a button slightly less padding, and fixes icon shapes in the SVG itself. <a href="https://jakub.kr/writing/details-that-make-interfaces-feel-better">jakub.kr</a></li>
<li>"A play button centred by coordinates looks left-heavy. Nudge it right and it sits." The play button above measures that nudge. <a href="http://index.how/to/articulate">index.how</a></li>
<li>Refactoring UI explains that bold text looks emphasized because it covers more surface, and that icons look heavy for the same reason. Surface times contrast is the size weight here.</li>
<li>Helena Zhang's icon series draws a dot slightly larger than the stroke, because a dot at the stroke weight looks too small. It is the same kind of correction, at the level of a glyph. <a href="https://minoraxis.medium.com/advanced-icon-design-dots-590cf96bf279">minoraxis</a></li>
</ul>

</main>
</body>
</html>
`;
}
