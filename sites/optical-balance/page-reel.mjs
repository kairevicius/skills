/**
 * The reel: the examples alone and large on a fixed stage, for a screen recording. Each
 * scene holds the box-centered state, moves to the measured optical state, and holds it.
 * Every position comes from build-docs.mjs, so the end of each move is a real measurement.
 * One caption pair names the two states for every scene, at the bottom of the stage.
 *
 * The stage fills the window, so the caption sits on the window's bottom edge and a
 * recording of any window size has no empty bands. The examples scale to fit BASE.
 *
 * Keys: Space pauses, R restarts, the arrow keys and 1 to 9 change scenes, and C hides
 * the captions. The embedded variant, which the landing page shows, takes no keys and
 * keeps the pointer, so it never changes how the page around it scrolls.
 */
import { EASE } from "./page-parts.mjs";

/**
 * Seconds into a scene. A scene's fade-out runs into the next scene, so the two cross-fade.
 * The caption is one element for every scene, so its two states never cross-fade with each
 * other: the first gives way before the move, and the second fades out before the next scene.
 */
const SCENE = 5, FADE = 0.4, MOVE = [1.6, 2.6], CAPTION_FADE = 0.3, CAPTION_OUT = [1.6, 1.9], CAPTION_IN = [2.3, 2.6];
/** The stage px that must stay visible: the widest example with margins, and the tallest. */
export const BASE = { w: 1200, h: 900 };
export const PAPER = "#fbfbfb";
const CAPTIONS = ["Box Center", "Visual Center"];

export default function renderReel({ scenes }, { embed = false } = {}) {
    const total = scenes.length * SCENE;
    const pct = (s, of) => `${((s / of) * 100).toFixed(3)}%`;
    const n = (v) => v.toFixed(4);
    const rect = (prefix, r) => `--${prefix}l: ${n(r.left)}%; --${prefix}t: ${n(r.top)}%; --${prefix}w: ${n(r.w)}%; --${prefix}h: ${n(r.h)}%`;

    const single = ({ plate, layer: l }) => `<div class="plate" style="width: ${plate.w}px; height: ${plate.h}px; background: ${plate.fill}; border-radius: ${plate.shape === "circle" ? "50%" : `${plate.radius}px`}">
<span class="el" style="left: ${n(l.left)}%; top: ${n(l.top)}%; width: ${n(l.w)}%; height: ${n(l.h)}%; --mx: ${n(l.mx)}%; --my: ${n(l.my)}%"><img src="${l.src}" alt=""></span>
</div>`;
    const strip = ({ strip: s, logos }) => `<div class="strip" style="width: min(${Math.round(s.w)}px, 100% - 160px); aspect-ratio: ${Math.round(s.w)} / ${Math.round(s.h)}">
${logos.map((g) => `<img class="logo" src="${g.src}" alt="${g.name}" style="${rect("b", g.before)}; ${rect("a", g.after)}">`).join("\n")}
</div>`;
    const scene = (s, i) => `<section class="scene" style="--i: ${i}" aria-label="${s.label}">
${s.logos ? strip(s) : single(s)}
</section>`;

    // The recording controls: seek, pause, captions, and a pointer that hides when it rests.
    const controls = `
// Every animation shares one timeline, so seeking all of them to one time keeps them in step.
const animations = () => stage.getAnimations({ subtree: true });
const now = () => animations()[0]?.currentTime ?? 0;
const current = () => Math.floor((now() % (SCENE_MS * COUNT)) / SCENE_MS);
// A seek lands just after the fade-in, so a recording starts on a whole scene.
const go = (i) => animations().forEach((a) => { a.currentTime = ((i + COUNT) % COUNT) * SCENE_MS + FADE_MS; });
const setPaused = (p) => animations().forEach((a) => (p ? a.pause() : a.play()));

addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (e.code === "Space") setPaused(animations()[0]?.playState !== "paused");
    else if (e.code === "KeyR") { go(0); setPaused(false); }
    else if (e.code === "ArrowRight") go(current() + 1);
    else if (e.code === "ArrowLeft") go(current() - 1);
    else if (digit && Number(digit[1]) <= COUNT) go(Number(digit[1]) - 1);
    else if (e.code === "KeyC") stage.classList.toggle("no-captions");
    else return;
    e.preventDefault();
});

let idle;
const rest = () => { document.body.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => document.body.classList.add("idle"), 1200); };
addEventListener("pointermove", rest);
rest();`;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Optical balance reel</title>
<style>
:root { --paper: ${PAPER}; --ink: #1a1a1a; --T: ${total}s; --S: ${SCENE}s; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; overflow: hidden; background: var(--paper); }
body { color: var(--ink); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
body.idle { cursor: none; }
#stage { position: fixed; left: 50%; top: 50%; width: var(--w); height: var(--h); transform: translate(-50%, -50%) scale(var(--s, 1)); }
.scene { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; }
.scene, .scene * { animation-duration: var(--T); animation-iteration-count: infinite; animation-delay: calc(var(--i) * var(--S) - var(--T)); }
.scene { animation-name: show; }
.plate, .strip { position: relative; flex: none; }
.el { position: absolute; animation-name: settle; }
.el img { display: block; width: 100%; height: 100%; }
.logo { position: absolute; left: var(--bl); top: var(--bt); width: var(--bw); height: var(--bh); animation-name: resize; }
/* At least 12 CSS px, so the caption stays readable when the reel is embedded small. */
.cap { position: absolute; left: 0; right: 0; bottom: 40px; display: grid; margin: 0; font-weight: 600; font-size: max(30px, calc(12px / var(--s, 1))); line-height: 1.2; letter-spacing: -0.01em; }
.cap span { grid-area: 1 / 1; text-align: center; animation-duration: var(--S); animation-iteration-count: infinite; }
.cap-a { animation-name: caption-out; }
.cap-b { animation-name: caption-in; }
#stage.no-captions .cap { visibility: hidden; }
@keyframes show { 0% { opacity: 0; } ${pct(FADE, total)}, ${pct(SCENE, total)} { opacity: 1; } ${pct(SCENE + FADE, total)}, 100% { opacity: 0; } }
@keyframes settle {
    0%, ${pct(MOVE[0], total)} { transform: translate(0, 0); animation-timing-function: ${EASE}; }
    ${pct(MOVE[1], total)}, 100% { transform: translate(var(--mx), var(--my)); }
}
@keyframes resize {
    0%, ${pct(MOVE[0], total)} { left: var(--bl); top: var(--bt); width: var(--bw); height: var(--bh); animation-timing-function: ${EASE}; }
    ${pct(MOVE[1], total)}, 100% { left: var(--al); top: var(--at); width: var(--aw); height: var(--ah); }
}
@keyframes caption-out { 0% { opacity: 0; } ${pct(CAPTION_FADE, SCENE)}, ${pct(CAPTION_OUT[0], SCENE)} { opacity: 1; } ${pct(CAPTION_OUT[1], SCENE)}, 100% { opacity: 0; } }
@keyframes caption-in { 0%, ${pct(CAPTION_IN[0], SCENE)} { opacity: 0; } ${pct(CAPTION_IN[1], SCENE)}, ${pct(SCENE - CAPTION_FADE, SCENE)} { opacity: 1; } 100% { opacity: 0; } }
/* Each scene rests in its optical state; the scenes still cross-fade. */
@media (prefers-reduced-motion: reduce) {
    .el { animation: none; transform: translate(var(--mx), var(--my)); }
    .logo { animation: none; left: var(--al); top: var(--at); width: var(--aw); height: var(--ah); }
    .cap-a { animation: none; opacity: 0; }
    .cap-b { animation: none; opacity: 1; }
}
</style>
</head>
<body>
<main id="stage">
${scenes.map(scene).join("\n")}
<p class="cap"><span class="cap-a">${CAPTIONS[0]}</span><span class="cap-b">${CAPTIONS[1]}</span></p>
</main>
<script>
const BASE = ${JSON.stringify(BASE)};
const SCENE_MS = ${SCENE * 1000}, FADE_MS = ${FADE * 1000}, COUNT = ${scenes.length};
const stage = document.getElementById("stage");
const fit = () => {
    const s = Math.min(innerWidth / BASE.w, innerHeight / BASE.h) || 1;
    stage.style.setProperty("--s", s);
    stage.style.setProperty("--w", innerWidth / s + "px");
    stage.style.setProperty("--h", innerHeight / s + "px");
};
addEventListener("resize", fit);
fit();
${embed ? "" : controls}
</script>
</body>
</html>
`;
}
