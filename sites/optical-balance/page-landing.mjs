/**
 * The landing page: one screen of claim, proof, and install, built for a phone first.
 * Like the write-up, it states no number that the build did not measure; each value
 * comes from the figures and numbers that build-docs.mjs passes in.
 */
import { installCommand, motionFigure, MOTION_CSS } from "./page-parts.mjs";

export default function renderLanding({ F, N, label, webp, repo, ACCENT, LINK }) {
    const abs = (v) => Math.abs(Number(v));
    const pct1 = (v) => Number(v).toFixed(1);
    const pic = (id, alt) => `<img src="${webp[id]}" width="${F[id].rw}" height="${F[id].rh}" alt="${alt}" loading="lazy" decoding="async">`;
    /** A before-and-after pair: the measured label above each image, one line of measured fact below. */
    const pair = (title, before, after, fact, altBefore, altAfter) => `<section class="example">
<h3>${title}</h3>
<div class="pair">
<figure>${label(F[before])}${pic(before, altBefore)}</figure>
<figure>${label(F[after])}${pic(after, altAfter)}</figure>
</div>
<p class="fact">${fact}</p>
</section>`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Optical balance</title>
<meta name="description" content="An agent skill for Claude Code, Codex, Cursor, and other agents that centers and sizes logos and icons by what the eye sees, measures the result, and gives you the CSS offset.">
<meta property="og:title" content="Optical balance">
<meta property="og:description" content="Center and size logos and icons by what the eye sees, not by the bounding box.">
<meta name="theme-color" content="#fbfbfb">
<style>
:root {
    --paper: #fbfbfb; --ink: #1a1a1a; --muted: #6b6b6b; --faint: #a3a3a3; --hair: #e4e4e4; --accent: ${ACCENT}; --link: ${LINK};
    /* Four sizes, two weights. */
    --size-title: clamp(32px, 8vw, 48px); --size-lede: 20px; --size-body: 17px; --size-small: 13px;
    --gutter: 16px;
}
@media (min-width: 720px) { :root { --gutter: 32px; } }
* { box-sizing: border-box; }
html { color-scheme: light; -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: var(--size-body)/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
.wrap { max-width: 960px; margin: 0 auto; padding: 0 max(var(--gutter), env(safe-area-inset-left)) 0 max(var(--gutter), env(safe-area-inset-right)); }
header.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 64px; }
.brand { display: inline-flex; align-items: center; min-height: 44px; font-weight: 600; color: var(--ink); text-decoration: none; }
nav { display: flex; gap: 4px; margin-right: -12px; }
nav a, .links a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; color: var(--link); text-decoration: none; }
nav a:hover, .links a:hover, a:hover { text-decoration: underline; }
h1 { font-size: var(--size-title); font-weight: 600; line-height: 1.1; letter-spacing: -0.02em; margin: 40px 0 16px; max-width: 760px; }
h2 { font-size: var(--size-lede); font-weight: 600; line-height: 1.3; margin: 0 0 12px; }
h3 { font-size: var(--size-body); font-weight: 600; margin: 0 0 12px; }
p { margin: 0 0 16px; max-width: 640px; }
.lede { font-size: var(--size-lede); line-height: 1.5; color: var(--muted); max-width: 680px; }
.links { display: flex; flex-wrap: wrap; gap: 0 8px; margin: 8px 0 0 -12px; }
.links a { font-weight: 600; }
section.block { padding: 64px 0 0; }
@media (min-width: 720px) { section.block { padding-top: 88px; } }
figure { margin: 0; min-width: 0; }
img { display: block; width: 100%; height: auto; }
.hero { margin: 40px 0 8px; }
.small { font-size: var(--size-small); color: var(--muted); }
.examples { display: grid; grid-template-columns: 1fr; gap: 48px; margin-top: 32px; }
@media (min-width: 720px) { .examples { grid-template-columns: 1fr 1fr; gap: 56px 40px; } }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pair img { outline: 1px solid var(--hair); }
.fact { font-size: var(--size-small); color: var(--muted); margin: 10px 0 0; }
.label { display: grid; font-size: var(--size-small); font-weight: 600; line-height: 1.4; margin: 0 0 6px; }
.label .score { font-weight: 400; color: var(--faint); font-variant-numeric: tabular-nums; }
.strip { margin-top: 32px; display: grid; gap: 32px; }
.strip img { outline: 1px solid var(--hair); }
ol.steps { margin: 24px 0 0; padding: 0; list-style: none; counter-reset: step; display: grid; gap: 24px; max-width: 680px; }
ol.steps li { counter-increment: step; display: grid; grid-template-columns: 32px 1fr; gap: 0 8px; }
ol.steps li::before { content: counter(step); font-weight: 600; color: var(--accent); }
ol.steps strong { font-weight: 600; }
pre { font: var(--size-small)/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 16px 0; padding: 16px 0; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); overflow-x: auto; white-space: pre; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; }
ul.asks { margin: 0 0 16px; padding-left: 20px; max-width: 640px; }
ul.asks li { margin: 6px 0; }
footer { margin: 88px 0 0; padding: 24px 0 48px; border-top: 1px solid var(--hair); }
footer p { font-size: var(--size-small); color: var(--muted); max-width: none; }
a { color: var(--link); }
${MOTION_CSS}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
<a class="brand" href="index.html">Optical balance</a>
<nav aria-label="Pages"><a href="write-up.html">Write-up</a><a href="demo.html">Demo</a>${repo ? `<a href="https://github.com/${repo}">GitHub</a>` : ""}</nav>
</header>

<main>
<h1>Center by what the eye sees</h1>
<p class="lede">A layout centers the bounding box, but the eye does not. Optical balance is an agent skill, for Claude Code, Codex, Cursor, or any agent that reads skills. It estimates centering and sizing with a reproducible heuristic; measured gates do not prove human preference. It gives you the CSS offset and checks the result.</p>
<figure class="hero">${motionFigure(F.introMotion)}</figure>
<p class="small">Each shape moves from its box center to its measured visual center.</p>
<div class="links"><a href="#install">Install the skill</a><a href="demo.html">Try the demo</a></div>

<section class="block" aria-labelledby="fixes">
<h2 id="fixes">What it fixes</h2>
<p>Each pair is real output. Off center is the distance from the visual center to the container center, as a percentage of the container's shorter side.</p>
<div class="examples">
${pair("A logo in a tile", "amazon-box", "amazon-visual", `The letters move down ${N.amazon.dyPct}% of the mark's height, and the smile hangs below them.`, "Amazon wordmark centered by its box on a tile", "Amazon wordmark centered optically on a tile")}
${pair("An icon in a round button", "play-before", "play-after", `The play icon moves ${N.icons.play.dx}px to the right at 24px, ${N.icons.play.dxPctIcon}% of the icon.`, "Play icon centered by its box in a button", "Play icon centered optically in a button")}
${pair("A mark in a disc", "vercel-box", "vercel-visual", `The triangle moves up ${N.vercel.dyPct}% of its height. It was ${pct1(N.vercel.beforePct)}% off center, and is now ${pct1(N.vercel.afterPct)}%.`, "Vercel triangle centered by its box in a disc", "Vercel triangle centered optically in a disc")}
${pair("An icon beside a label", "button-before", "button-after", `The fix is less padding on the icon side: ${N.button.padIcon}px and ${N.button.padText}px, not ${N.button.pad}px on each side.`, "Button with equal padding", "Button with optical padding")}
</div>
</section>

<section class="block" aria-labelledby="sizes">
<h2 id="sizes">Same size, not same height</h2>
<p>At one height, wide wordmarks look large and compact marks look small. The skill scales each logo to one perceived size and measures the rendered row again.</p>
<div class="strip">
<figure>${label(F["strip-before"])}${pic("strip-before", "Nine logos at equal height")}</figure>
<figure>${label(F["strip-after"], "Equal perceived size")}${pic("strip-after", "Nine logos at equal perceived size")}</figure>
</div>
</section>

<section class="block" aria-labelledby="how">
<h2 id="how">How it works</h2>
<ol class="steps">
<li><span><strong>Measure.</strong> The visual center is halfway between the center of the ink box and the mass centroid. Each pixel weighs by the square of its contrast with the background, so a faint accent counts for less.</span></li>
<li><span><strong>Place.</strong> The skill gives the offset as a CSS translate, in percent of the element, so it holds at every size. Put it in the component, not in one instance.</span></li>
<li><span><strong>Check.</strong> It renders the result at 4x and measures it again. A placement passes at 1% or less off center, and a set passes at 3% or less size spread.</span></li>
</ol>
</section>

<section class="block" aria-labelledby="try">
<h2 id="try">Try optical align tools</h2>
<p>The demo is a small design canvas whose align buttons switch between geometric and optical. Select the shapes, align their centers, and switch modes to see each shape move between the two answers.</p>
<div class="links"><a href="demo.html">Open the demo</a></div>
</section>

<section class="block" aria-labelledby="install">
<h2 id="install">Install</h2>
<p>You need Node 18.17 or later and an agent that reads skills, such as Claude Code, Codex, Cursor, OpenCode, or Gemini CLI. Install the skill:</p>
<pre>${installCommand("one-skill", "optical-balance")}</pre>
<p>The CLI asks which agents to install it for. Its one dependency, sharp, installs on first use: the skill tells your agent how, and the script prints the exact command if it is missing.</p>
<p>Then ask your agent in your own words, for example:</p>
<ul class="asks">
<li>The play icon in our round button looks off center. Fix it.</li>
<li>Make these partner logos look the same size in a 32px row.</li>
<li>Bake these company logos into 96px avatar tiles.</li>
</ul>
<p>The command line works on its own too, from the skill folder:</p>
<pre>node scripts/optical.mjs place play.svg \\
  --container 40 --element 20 \\
  --plate "#111111" --shape circle</pre>
</section>

<section class="block" aria-labelledby="more">
<h2 id="more">Read more</h2>
<p>The write-up walks through every example, the method, the constants, and what the skill gets wrong.</p>
<div class="links"><a href="write-up.html">Read the write-up</a></div>
</section>
</main>

<footer>
<p>MIT license. The brand logos are trademarks of their owners and appear only as test material. Icons from Bootstrap Icons (MIT). Portrait by Johannes Vermeer, public domain.</p>
</footer>
</div>
</body>
</html>
`;
}
