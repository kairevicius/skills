import { sitePage } from '../site.mjs';
/**
 * The landing page: one screen of claim, proof, and install, built for a phone first.
 * Like the write-up, it states no number that the build did not measure; each value
 * comes from the figures and numbers that build-docs.mjs passes in.
 */
import { installCommand } from "./page-parts.mjs";
import { BASE, PAPER } from "./page-reel.mjs";

export default function renderLanding({ F, N, label, webp, reel }) {
    // Embedded through srcdoc, like the write-up's demo, so the page still works as one file.
    const reelDoc = reel.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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

    return sitePage(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Optical balance</title>
<meta name="description" content="An agent skill for Claude Code, Codex, Cursor, and other agents that centers and sizes logos and icons by what the eye sees, measures the result, and gives you the CSS offset.">
<meta property="og:title" content="Optical balance">
<meta property="og:description" content="Center and size logos and icons by what the eye sees, not by the bounding box.">
<meta name="theme-color" content="#fafafa">
<style>
img { display: block; width: 100%; height: auto; }
.links { display: flex; flex-wrap: wrap; }
.links a { display: inline-flex; align-items: center; min-height: 44px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.pair img { outline: 1px solid var(--hair); }
.fact { font-size: var(--size-small); color: var(--muted); margin: 10px 0 0; }
.label { display: grid; font-size: var(--size-small); font-weight: 600; line-height: 1.4; margin: 0 0 6px; }
.label .score { font-weight: 400; color: var(--faint); font-variant-numeric: tabular-nums; }
.strip { margin-top: 32px; display: grid; gap: 32px; }
.strip img { outline: 1px solid var(--hair); }
ol.steps { margin: 24px 0 0; padding: 0; list-style: none; counter-reset: step; display: grid; gap: 24px; max-width: 680px; }
ol.steps li { counter-increment: step; display: grid; grid-template-columns: 32px 1fr; gap: 0 8px; }
ol.steps li::before { content: counter(step); }
ol.steps strong { font-weight: 600; }
ul.asks { margin: 0 0 16px; padding-left: 20px; max-width: 640px; }
ul.asks li { margin: 6px 0; }
.reel iframe { display: block; width: 100%; aspect-ratio: ${BASE.w} / ${BASE.h}; border: 0; border-radius: 14px; background: ${PAPER}; box-shadow: var(--card-shadow); }
</style>
</head>
<body>
<div class="wrap">


<main>
<h1>Center by what the eye sees</h1>
<p class="lede">A layout centers the bounding box, but the eye does not. Optical balance is an agent skill, for Claude Code, Codex, Cursor, or any agent that reads skills. It estimates centering and sizing with a reproducible heuristic; measured gates do not prove human preference. It gives you the CSS offset and checks the result.</p>
<figure class="hero reel"><iframe srcdoc="${reelDoc}" title="Five examples move from their box center to their visual center, and nine logos move to one perceived size"></iframe></figure>
<p class="small">Each example moves from its box center to its measured visual center, and the logos move to one perceived size.</p>
<div class="links"><a href="#install">Install the skill</a><a href="demo.html">Try the demo</a></div>

<section class="block" aria-labelledby="fixes">
<h2 id="fixes">What it fixes</h2>
<p>Each pair is real output. Off center is the distance from the visual center to the container center, as a percentage of the container's shorter side.</p>
<div class="examples">
${pair("A logo in a tile", "amazon-box", "amazon-visual", `The mark moves down ${N.amazon.dyPct}% of its height, including the orange smile's perceptual weight.`, "Amazon wordmark centered by its box on a tile", "Amazon wordmark centered optically on a tile")}
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
<p>You need Node <code>^18.17.0 || ^20.3.0 || &gt;=21.0.0</code> and an agent that reads skills, such as Claude Code, Codex, Cursor, OpenCode, or Gemini CLI. Install the skill:</p>
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
`, 'optical-balance');
}
