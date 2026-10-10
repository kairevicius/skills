/**
 * Builds dist/demo.html: a design-canvas mock whose align tools work in two modes.
 * Geometric aligns the layer box, the way design tools do today. Optical aligns centers on
 * the measured visual center and edges on the ink box.
 *
 * Every layer is measured here, by lib.mjs, against the fill directly behind it, and the page
 * only applies the measured fractions. The page draws the same SVG strings that this script
 * measures, so the numbers and the pixels describe one artwork.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { measure, parseColor, toRaw, DEFAULT_RASTER_EDGE } from "../../skills/optical-balance/scripts/lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = join(HERE, "../../skills/optical-balance");
const sharp = createRequire(join(SKILL, "scripts/package.json"))("sharp");
const SRC = join(HERE, "sources");
const INK = "#1a1a1a";

const FRAME = { w: 760, h: 470, fill: "#ffffff" };
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const icon = (name, color = INK) => readFileSync(join(SKILL, "fixtures/icons", `${name}-fill.svg`), "utf8").replace(/currentColor/g, color);

/**
 * The scene. Containers are layers that hold children; a child is measured against its
 * container's fill, and a top-level layer against the frame. A play triangle drawn centered
 * by its ink box stands for the common hand-drawn icon.
 */
const CONTAINERS = [
    { id: "button", name: "Button", x: 56, y: 48, w: 160, h: 160, fill: "#ececec", art: svg(160, 160, `<circle cx="80" cy="80" r="80" fill="#ececec"/>`) },
    { id: "tile", name: "Logo tile", x: 280, y: 48, w: 200, h: 160, fill: "#f0f0f0", art: svg(200, 160, `<rect width="200" height="160" rx="20" fill="#f0f0f0"/>`) },
    { id: "disc", name: "Badge", x: 544, y: 48, w: 160, h: 160, fill: "#1a1a1a", art: svg(160, 160, `<circle cx="80" cy="80" r="80" fill="#1a1a1a"/>`) },
];
const CHILDREN = [
    { id: "play", name: "Play", parent: "button", w: 72, h: 72, art: svg(24, 24, `<path d="M6.5 5 L17.5 12 L6.5 19 Z" fill="${INK}"/>`) },
    { id: "amazon", name: "Amazon", parent: "tile", w: 152, h: Math.round((152 * 182) / 603), art: readFileSync(join(SRC, "amazon.svg"), "utf8") },
    { id: "triangle-white", name: "Triangle", parent: "disc", w: 84, h: 84, art: icon("triangle", "#ffffff") },
    { id: "square", name: "Square", parent: "frame", x: 64, y: 300, w: 80, h: 80, art: icon("square") },
    { id: "circle", name: "Circle", parent: "frame", x: 200, y: 336, w: 80, h: 80, art: icon("circle") },
    { id: "triangle", name: "Triangle", parent: "frame", x: 336, y: 286, w: 80, h: 80, art: icon("triangle") },
    { id: "star", name: "Star", parent: "frame", x: 472, y: 322, w: 80, h: 80, art: icon("star") },
    { id: "heart", name: "Heart", parent: "frame", x: 608, y: 296, w: 80, h: 80, art: icon("heart") },
];

/** Rasterize an SVG string the way lib.mjs rasterizes an SVG file, then measure it. */
async function measureSvg(art, bg) {
    const meta = await sharp(Buffer.from(art)).metadata();
    const edge = Math.max(meta.width, meta.height);
    const png = await sharp(Buffer.from(art), { density: (72 * DEFAULT_RASTER_EDGE) / edge }).ensureAlpha().png().toBuffer();
    const m = measure(await toRaw(png), parseColor(bg));
    const r = (v) => Math.round(v * 1e5) / 1e5;
    return {
        ink: { x0: r(m.inkBox.left / m.width), y0: r(m.inkBox.top / m.height), x1: r((m.inkBox.left + m.inkBox.width) / m.width), y1: r((m.inkBox.top + m.inkBox.height) / m.height) },
        visual: { x: r(m.visual.x / m.width), y: r(m.visual.y / m.height) },
        faint: Math.round(m.accentShare * 100), discounted: m.discounted,
    };
}

const uri = (art) => `data:image/svg+xml;base64,${Buffer.from(art).toString("base64")}`;
/** Measure every layer and return the page, so the docs build can embed the same demo. */
export async function renderDemo() {
    const layers = [];
    for (const c of CONTAINERS) layers.push({ ...c, parent: "frame", bg: FRAME.fill, ...(await measureSvg(c.art, FRAME.fill)), src: uri(c.art) });
    for (const c of CHILDREN) {
        const host = CONTAINERS.find((p) => p.id === c.parent);
        const bg = host ? host.fill : FRAME.fill;
        // A child starts where geometric centering puts it, the way the file would look today.
        const x = c.x ?? Math.round((host.w - c.w) / 2), y = c.y ?? Math.round((host.h - c.h) / 2);
        layers.push({ ...c, x, y, bg, ...(await measureSvg(c.art, bg)), src: uri(c.art) });
    }
    for (const l of layers) delete l.art;

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Optical align</title>
<style>
:root {
    --canvas: #f5f5f5; --panel: #ffffff; --ink: #1a1a1a; --muted: #6b6b6b; --faint: #a3a3a3; --hair: #e6e6e6; --field: #f5f5f5;
    --select: #0d99ff; --geo: #f24e8a; --optical: #06b6d4; --tip: #1e1e1e;
    --size-title: 15px; --size-body: 13px; --size-small: 11px;
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--canvas); color: var(--ink); font: var(--size-body)/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; overflow: hidden; }
.app { display: grid; grid-template-columns: minmax(0, 1fr) 280px; height: 100vh; }
.canvas { position: relative; overflow: hidden; user-select: none; -webkit-user-select: none; }
.canvas-title { position: absolute; left: 20px; top: 16px; font-weight: 600; font-size: var(--size-body); }
.canvas-hint { position: absolute; left: 20px; bottom: 16px; color: var(--muted); font-size: var(--size-small); }
.stage { position: absolute; }
.frame-name { position: absolute; top: -20px; left: 0; font-size: var(--size-small); color: var(--muted); }
.frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; background: ${FRAME.fill}; box-shadow: 0 0 0 1px rgba(0,0,0,0.06); }
.layer { position: absolute; transition: left 520ms cubic-bezier(0.2, 0.8, 0.2, 1), top 520ms cubic-bezier(0.2, 0.8, 0.2, 1); cursor: default; }
.dragging .layer, .layer.instant { transition: none; }
.layer > img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.layer:hover:not(:has(.layer:hover))::after { content: ""; position: absolute; inset: 0; outline: 1px solid var(--select); pointer-events: none; z-index: 3; }
.layer.selected::after { content: ""; position: absolute; inset: 0; outline: 1.5px solid var(--select); pointer-events: none; z-index: 3; }
.handle { display: none; position: absolute; width: 8px; height: 8px; background: #fff; border: 1.5px solid var(--select); z-index: 4; pointer-events: none; }
.layer.selected > .handle { display: block; }
.handle.tl { left: -4px; top: -4px; } .handle.tr { right: -4px; top: -4px; } .handle.bl { left: -4px; bottom: -4px; } .handle.br { right: -4px; bottom: -4px; }
.ink, .dot { display: none; position: absolute; pointer-events: none; z-index: 2; }
.show .layer.selected > .ink { display: block; outline: 1px dashed #9a9a9a; }
.show .layer.selected.on-dark > .ink { outline-color: #8a8a8a; }
.show .layer.selected > .dot { display: block; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; box-shadow: 0 0 0 1.5px #fff; }
.dot.geo { background: var(--geo); }
.dot.vis { background: var(--optical); }
.guide { position: absolute; pointer-events: none; z-index: 5; opacity: 0; transition: opacity 240ms ease; }
.guide.on { opacity: 1; }
.guide.v { width: 0; border-left: 1px solid; }
.guide.h { height: 0; border-top: 1px solid; }
.panel { background: var(--panel); border-left: 1px solid var(--hair); overflow-y: auto; }
.section { padding: 16px; border-bottom: 1px solid var(--hair); }
.section:last-child { border-bottom: 0; }
.head { font-size: var(--size-title); font-weight: 600; }
.sub { color: var(--muted); font-size: var(--size-small); margin-top: 2px; min-height: 16px; }
.label { font-weight: 600; margin: 0 0 10px; }
.segmented { display: grid; grid-template-columns: 1fr 1fr; background: var(--field); border-radius: 6px; padding: 2px; }
.segmented button { border: 0; background: transparent; font: inherit; padding: 6px 0; border-radius: 5px; color: var(--muted); cursor: pointer; }
.segmented button[aria-pressed="true"] { background: #fff; color: var(--ink); font-weight: 600; box-shadow: 0 0 0 1px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06); }
.mode-note { color: var(--muted); font-size: var(--size-small); margin: 8px 0 0; }
.mode-note .key { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin: 0 4px 1px 0; vertical-align: middle; }
.aligns { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
.group { display: grid; grid-template-columns: repeat(3, 1fr); background: var(--field); border-radius: 6px; overflow: hidden; }
.group button { border: 0; background: transparent; height: 32px; display: grid; place-items: center; cursor: pointer; color: var(--ink); }
.group button:hover:not(:disabled) { background: #ebebeb; }
.group button:disabled { color: #c4c4c4; cursor: default; }
.group button:focus-visible, .segmented button:focus-visible, .row button:focus-visible { outline: 2px solid var(--select); outline-offset: -2px; }
.result { margin: 0; padding: 0; list-style: none; }
.result li { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-variant-numeric: tabular-nums; }
.result .delta { color: var(--muted); }
.empty { color: var(--faint); }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-variant-numeric: tabular-nums; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.row label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.row button { border: 1px solid var(--hair); background: #fff; font: inherit; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
.foot { color: var(--muted); font-size: var(--size-small); }
.tip { position: fixed; z-index: 20; background: var(--tip); color: #fff; font-size: 12px; padding: 6px 10px; border-radius: 6px; pointer-events: none; white-space: nowrap; display: none; }
.tip .k { color: #a8a8a8; margin-left: 12px; }
@media (prefers-reduced-motion: reduce) { .layer, .guide { transition: none; } }
@media (max-width: 760px) { .app { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; } .panel { border-left: 0; border-top: 1px solid var(--hair); max-height: 46vh; } }
</style>
</head>
<body>
<div class="app">
  <div class="canvas" id="canvas">
    <div class="canvas-title">Optical align</div>
    <div class="stage" id="stage"><div class="frame-name">Frame 1</div><div class="frame show" id="frame"></div></div>
    <div class="canvas-hint">Click a layer, shift-click to add a sibling, drag to move. ⌥H and ⌥V align centers. Arrows nudge.</div>
  </div>
  <aside class="panel" aria-label="Design panel">
    <div class="section"><div class="head" id="selTitle">No selection</div><div class="sub" id="selSub">Select a layer on the canvas</div></div>
    <div class="section">
      <div class="label">Align by</div>
      <div class="segmented" role="group" aria-label="Align by">
        <button type="button" data-mode="geometric" aria-pressed="false">Geometric</button>
        <button type="button" data-mode="optical" aria-pressed="true">Optical</button>
      </div>
      <p class="mode-note" id="modeNote"></p>
    </div>
    <div class="section">
      <div class="label">Position</div>
      <div class="aligns">
        <div class="group" role="group" aria-label="Horizontal alignment">
          <button type="button" data-align="left" data-tip="Align left" data-key="⌥A" aria-label="Align left"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 1.5v13" stroke="currentColor"/><rect x="4" y="4" width="9" height="3" rx="1" fill="currentColor"/><rect x="4" y="9" width="5" height="3" rx="1" fill="currentColor"/></svg></button>
          <button type="button" data-align="hcenter" data-tip="Align horizontal centers" data-key="⌥H" aria-label="Align horizontal centers"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v13" stroke="currentColor"/><rect x="3" y="4" width="10" height="3" rx="1" fill="currentColor"/><rect x="5" y="9" width="6" height="3" rx="1" fill="currentColor"/></svg></button>
          <button type="button" data-align="right" data-tip="Align right" data-key="⌥D" aria-label="Align right"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 1.5v13" stroke="currentColor"/><rect x="3" y="4" width="9" height="3" rx="1" fill="currentColor"/><rect x="7" y="9" width="5" height="3" rx="1" fill="currentColor"/></svg></button>
        </div>
        <div class="group" role="group" aria-label="Vertical alignment">
          <button type="button" data-align="top" data-tip="Align top" data-key="⌥W" aria-label="Align top"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 2.5h13" stroke="currentColor"/><rect x="4" y="4" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="4" width="3" height="5" rx="1" fill="currentColor"/></svg></button>
          <button type="button" data-align="vcenter" data-tip="Align vertical centers" data-key="⌥V" aria-label="Align vertical centers"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8h13" stroke="currentColor"/><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="5" width="3" height="6" rx="1" fill="currentColor"/></svg></button>
          <button type="button" data-align="bottom" data-tip="Align bottom" data-key="⌥S" aria-label="Align bottom"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 13.5h13" stroke="currentColor"/><rect x="4" y="3" width="3" height="9" rx="1" fill="currentColor"/><rect x="9" y="7" width="3" height="5" rx="1" fill="currentColor"/></svg></button>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="label">Optical against geometric</div>
      <ul class="result" id="result"><li class="empty">Align a selection to compare the two rules.</li></ul>
    </div>
    <div class="section">
      <div class="label">Measurement</div>
      <dl id="measure"><dt class="empty">Select one layer</dt><dd></dd></dl>
    </div>
    <div class="section">
      <div class="row"><label><input type="checkbox" id="show" checked> Show centers and ink boxes</label><button type="button" id="reset">Reset</button></div>
    </div>
    <div class="section foot">Each layer was measured by the optical-balance skill against the fill behind it. Pink is the center of the layer box. Cyan is the visual center: halfway between the center of the ink box and the contrast-weighted mass centroid. The skill does not model the overshoot of round shapes at an edge.</div>
  </aside>
</div>
<div class="tip" id="tip"></div>
<script>
const FRAME = ${JSON.stringify(FRAME)};
const LAYERS = ${JSON.stringify(layers)};
const state = { mode: "optical", selection: [], last: null };
const byId = Object.fromEntries(LAYERS.map((l) => [l.id, { ...l, home: { x: l.x, y: l.y } }]));
const $ = (id) => document.getElementById(id);
const frame = $("frame"), stage = $("stage"), canvas = $("canvas");
const parentBox = (layer) => layer.parent === "frame" ? { w: FRAME.w, h: FRAME.h } : { w: byId[layer.parent].w, h: byId[layer.parent].h };
const dark = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 128; };

// Build the layer tree: containers sit on the frame, children inside their container.
for (const l of Object.values(byId)) {
    const el = document.createElement("div");
    el.className = "layer" + (dark(l.bg) ? " on-dark" : "");
    el.dataset.id = l.id;
    el.style.width = l.w + "px"; el.style.height = l.h + "px";
    el.innerHTML = '<img alt="" src="' + l.src + '">'
        + '<span class="ink" style="left:' + l.ink.x0 * 100 + '%;top:' + l.ink.y0 * 100 + '%;width:' + (l.ink.x1 - l.ink.x0) * 100 + '%;height:' + (l.ink.y1 - l.ink.y0) * 100 + '%"></span>'
        + '<span class="dot geo" style="left:50%;top:50%"></span>'
        + '<span class="dot vis" style="left:' + l.visual.x * 100 + '%;top:' + l.visual.y * 100 + '%"></span>'
        + '<span class="handle tl"></span><span class="handle tr"></span><span class="handle bl"></span><span class="handle br"></span>';
    el.setAttribute("aria-label", l.name);
    l.el = el;
}
for (const l of Object.values(byId)) (l.parent === "frame" ? frame : byId[l.parent].el).appendChild(l.el);
frame.style.width = FRAME.w + "px"; frame.style.height = FRAME.h + "px";
const place = (l) => { l.el.style.left = l.x + "px"; l.el.style.top = l.y + "px"; };
Object.values(byId).forEach(place);

// Guides are drawn in frame coordinates, so a child's guide adds its container's offset.
const guides = { v: Object.assign(document.createElement("div"), { className: "guide v" }), h: Object.assign(document.createElement("div"), { className: "guide h" }) };
frame.append(guides.v, guides.h);
let guideTimer;
function showGuide(axis, value, parentId) {
    const g = guides[axis], host = parentId === "frame" ? { x: 0, y: 0, w: FRAME.w, h: FRAME.h } : byId[parentId];
    g.style.borderColor = state.mode === "optical" ? "var(--optical)" : "var(--geo)";
    if (axis === "v") Object.assign(g.style, { left: host.x + value + "px", top: host.y + "px", height: host.h + "px" });
    else Object.assign(g.style, { top: host.y + value + "px", left: host.x + "px", width: host.w + "px" });
    guides.v.classList.remove("on"); guides.h.classList.remove("on");
    requestAnimationFrame(() => g.classList.add("on"));
    clearTimeout(guideTimer); guideTimer = setTimeout(() => g.classList.remove("on"), 1400);
}

// Fit the frame into the canvas.
let scale = 1;
function fit() {
    const r = canvas.getBoundingClientRect();
    scale = Math.min(1.4, (r.width - 80) / FRAME.w, (r.height - 120) / FRAME.h);
    frame.style.transform = "scale(" + scale + ")";
    stage.style.width = FRAME.w * scale + "px"; stage.style.height = FRAME.h * scale + "px";
    stage.style.left = Math.round((r.width - FRAME.w * scale) / 2) + "px"; stage.style.top = Math.round((r.height - FRAME.h * scale) / 2) + "px";
}
new ResizeObserver(fit).observe(canvas);

// The two rules. Each returns the reference points of a layer in its parent's coordinates.
function points(l, mode, at = l) {
    if (mode === "geometric") return { left: at.x, right: at.x + l.w, hcenter: at.x + l.w / 2, top: at.y, bottom: at.y + l.h, vcenter: at.y + l.h / 2 };
    return { left: at.x + l.ink.x0 * l.w, right: at.x + l.ink.x1 * l.w, hcenter: at.x + l.visual.x * l.w, top: at.y + l.ink.y0 * l.h, bottom: at.y + l.ink.y1 * l.h, vcenter: at.y + l.visual.y * l.h };
}
const horizontal = (kind) => kind === "left" || kind === "hcenter" || kind === "right";

/** Positions for one align action under one rule, from the positions before the action. */
function solve(action, mode) {
    const layers = action.ids.map((id) => byId[id]);
    const from = Object.fromEntries(action.before.map((p) => [p.id, p]));
    let target;
    if (layers.length === 1) {
        // One layer aligns to its parent, like a design tool does. Every parent here is symmetric.
        const box = parentBox(layers[0]);
        target = { left: 0, right: box.w, hcenter: box.w / 2, top: 0, bottom: box.h, vcenter: box.h / 2 }[action.kind];
    } else {
        // Edges align to the outer edge of the selection under each rule. Centers share one line,
        // the center of the layer boxes, so switching rules moves only the layers whose visual
        // center differs from their box center, and a symmetric layer stays where it is.
        const edgeMode = action.kind === "hcenter" || action.kind === "vcenter" ? "geometric" : mode;
        const all = layers.map((l) => points(l, edgeMode, from[l.id]));
        const lo = (k) => Math.min(...all.map((p) => p[k])), hi = (k) => Math.max(...all.map((p) => p[k]));
        target = { left: lo("left"), right: hi("right"), hcenter: (lo("left") + hi("right")) / 2, top: lo("top"), bottom: hi("bottom"), vcenter: (lo("top") + hi("bottom")) / 2 }[action.kind];
    }
    return layers.map((l) => {
        const p = points(l, mode, from[l.id])[action.kind];
        const shift = target - p;
        return horizontal(action.kind) ? { id: l.id, x: from[l.id].x + shift, y: from[l.id].y } : { id: l.id, x: from[l.id].x, y: from[l.id].y + shift };
    });
}

function apply(action) {
    const result = solve(action, state.mode);
    for (const p of result) { const l = byId[p.id]; l.x = p.x; l.y = p.y; place(l); }
    const first = byId[action.ids[0]], axis = horizontal(action.kind) ? "v" : "h";
    showGuide(axis, points(first, state.mode)[action.kind], first.parent);
    report(action);
    renderPanel();
}

function align(kind) {
    if (!state.selection.length) return;
    state.last = { kind, ids: [...state.selection], before: state.selection.map((id) => ({ id, x: byId[id].x, y: byId[id].y })), dirty: false };
    apply(state.last);
}

const fmt = (v) => (Math.abs(v) < 0.05 ? "0" : (v > 0 ? "+" : "−") + Math.abs(v).toFixed(1)) + "px";
function report(action) {
    const geo = Object.fromEntries(solve(action, "geometric").map((p) => [p.id, p]));
    const opt = Object.fromEntries(solve(action, "optical").map((p) => [p.id, p]));
    const along = horizontal(action.kind) ? "x" : "y";
    const word = (d) => Math.abs(d) < 0.05 ? "same place" : along === "x" ? (d > 0 ? "further right" : "further left") : (d > 0 ? "lower" : "higher");
    $("result").innerHTML = action.ids.map((id) => {
        const d = opt[id][along] - geo[id][along];
        return '<li><span>' + byId[id].name + '</span><span class="delta">' + fmt(d) + " " + along + ", " + word(d) + "</span></li>";
    }).join("");
}

function select(ids) {
    state.selection = ids;
    for (const l of Object.values(byId)) l.el.classList.toggle("selected", ids.includes(l.id));
    renderPanel();
}

function renderPanel() {
    const sel = state.selection.map((id) => byId[id]);
    $("selTitle").textContent = sel.length === 0 ? "No selection" : sel.length === 1 ? sel[0].name : sel.length + " selected";
    const parent = sel[0] && (sel[0].parent === "frame" ? "Frame 1" : byId[sel[0].parent].name);
    $("selSub").textContent = sel.length === 0 ? "Select a layer on the canvas" : sel.length === 1 ? "Aligns to " + parent : "Aligns to the selection, in " + parent;
    document.querySelectorAll("[data-align]").forEach((b) => (b.disabled = sel.length === 0));
    document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    $("modeNote").innerHTML = state.mode === "optical"
        ? '<span class="key" style="background:var(--optical)"></span>Centers use the measured visual center. Edges use the ink box.'
        : '<span class="key" style="background:var(--geo)"></span>Centers and edges use the layer box, as design tools do today.';
    const m = $("measure");
    if (sel.length !== 1) { m.innerHTML = '<dt class="empty">Select one layer</dt><dd></dd>'; return; }
    const l = sel[0], dx = (l.visual.x - 0.5) * l.w, dy = (l.visual.y - 0.5) * l.h, pc = (v) => (v * 100).toFixed(1) + "%";
    m.innerHTML = "<dt>Visual center</dt><dd>" + pc(l.visual.x) + ", " + pc(l.visual.y) + "</dd>"
        + "<dt>From box center</dt><dd>" + fmt(dx) + " x, " + fmt(dy) + " y</dd>"
        + "<dt>Ink box</dt><dd>" + pc(l.ink.x0) + "–" + pc(l.ink.x1) + " × " + pc(l.ink.y0) + "–" + pc(l.ink.y1) + "</dd>"
        + "<dt>Faint ink</dt><dd>" + l.faint + "%" + (l.faint > 0 ? (l.discounted ? ", discounted" : ", counted") : "") + "</dd>"
        + "<dt>Measured on</dt><dd>" + l.bg + "</dd>";
}

function setMode(mode) {
    if (mode === state.mode) return;
    state.mode = mode;
    // Replay the last action under the other rule, so the two answers can be compared in place.
    if (state.last && !state.last.dirty) apply(state.last); else renderPanel();
}

// Pointer: select the deepest layer under the pointer, then drag the selection.
let drag = null;
canvas.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".layer");
    if (!el) { select([]); return; }
    const l = byId[el.dataset.id];
    let ids = state.selection;
    const sibling = ids.length && byId[ids[0]].parent === l.parent;
    if (e.shiftKey && sibling) ids = ids.includes(l.id) ? ids.filter((id) => id !== l.id) : [...ids, l.id];
    else if (!ids.includes(l.id) || !sibling) ids = [l.id];
    // A plain click on a layer that is already part of a larger selection keeps the selection for a
    // drag, and narrows it to that layer on release when there was no drag, as design tools do.
    const collapseTo = !e.shiftKey && ids.length > 1 && ids.includes(l.id) ? l.id : null;
    select(ids);
    drag = { x: e.clientX, y: e.clientY, start: ids.map((id) => ({ id, x: byId[id].x, y: byId[id].y })), moved: false, collapseTo };
    canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / scale, dy = (e.clientY - drag.y) / scale;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    drag.moved = true; frame.classList.add("dragging");
    for (const p of drag.start) { const l = byId[p.id]; l.x = Math.round(p.x + dx); l.y = Math.round(p.y + dy); place(l); }
});
const endDrag = () => {
    if (drag && drag.moved && state.last) state.last.dirty = true;
    if (drag && !drag.moved && drag.collapseTo) select([drag.collapseTo]);
    drag = null; frame.classList.remove("dragging");
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

// Panel controls.
document.querySelectorAll("[data-align]").forEach((b) => b.addEventListener("click", () => align(b.dataset.align)));
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("show").addEventListener("change", (e) => frame.classList.toggle("show", e.target.checked));
$("reset").addEventListener("click", () => {
    for (const l of Object.values(byId)) { l.x = l.home.x; l.y = l.home.y; place(l); }
    state.last = null; $("result").innerHTML = '<li class="empty">Align a selection to compare the two rules.</li>'; renderPanel();
});

// Tooltips in the style of a design tool, with the shortcut beside the name.
const tip = $("tip");
document.querySelectorAll("[data-tip]").forEach((b) => {
    b.addEventListener("mouseenter", () => {
        tip.innerHTML = b.dataset.tip + '<span class="k">' + b.dataset.key + "</span>";
        tip.style.display = "block";
        const r = b.getBoundingClientRect(), t = tip.getBoundingClientRect();
        tip.style.left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2)) + "px";
        tip.style.top = r.bottom + 8 + "px";
    });
    b.addEventListener("mouseleave", () => (tip.style.display = "none"));
});

// Keyboard: the align shortcuts of design tools (⌥ + A H D W V S), arrow nudges, Escape.
const KEYS = { KeyA: "left", KeyH: "hcenter", KeyD: "right", KeyW: "top", KeyV: "vcenter", KeyS: "bottom" };
document.addEventListener("keydown", (e) => {
    if (e.altKey && KEYS[e.code]) { e.preventDefault(); align(KEYS[e.code]); return; }
    if (e.key === "Escape") { select([]); return; }
    const step = e.shiftKey ? 10 : 1, move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move && state.selection.length) {
        e.preventDefault();
        for (const id of state.selection) { const l = byId[id]; l.x += move[0]; l.y += move[1]; l.el.classList.add("instant"); place(l); requestAnimationFrame(() => l.el.classList.remove("instant")); }
        if (state.last) state.last.dirty = true;
    }
});

renderPanel();
fit();
</script>
</body>
</html>
`;

    return { html, layers };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { html, layers } = await renderDemo();
    console.log(layers.map((l) => `${l.id.padEnd(15)} visual ${(l.visual.x * 100).toFixed(1)}%, ${(l.visual.y * 100).toFixed(1)}%  ink x ${(l.ink.x0 * 100).toFixed(1)}–${(l.ink.x1 * 100).toFixed(1)}% y ${(l.ink.y0 * 100).toFixed(1)}–${(l.ink.y1 * 100).toFixed(1)}%  faint ${l.faint}%`).join("\n"));
    writeFileSync(join(HERE, "dist/demo.html"), html);
    console.log(`wrote dist/demo.html (${(html.length / 1024).toFixed(0)} KB, ${layers.length} measured layers)`);
}
