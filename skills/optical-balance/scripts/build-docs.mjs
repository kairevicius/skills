/**
 * Builds the docs site from the skill's own measurement code, so each number on
 * a page is a real measurement of the image beside it. Re-run after any change to lib.mjs:
 *
 *   npm run docs          # docs/index.html (landing), write-up.html, demo.html, and docs/assets
 *   npm run docs:inline   # the same pages with every figure embedded, one file each
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import renderWriteUp from "./page-write-up.mjs";
import { renderDemo } from "./build-demo.mjs";
import renderLanding from "./page-landing.mjs";
import { equalize, measure, measureFile, loadRaster, luminance, parseColor, rasterizeSvg, renderFrame, renderStrip, renderTile, toRaw, ACCENT_CONTRAST, ACCENT_MAX_SHARE, BACKGROUND_CONTRAST, CENTER_BLEND, EXTENT_ALPHA, DEFAULT_RASTER_EDGE } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "docs/sources");
const OUT = join(ROOT, "docs/assets");
mkdirSync(OUT, { recursive: true });

const ACCENT = "#06b6d4";
const LINK = "#0e7490";
const GUIDE = "#dcdcdc";
/** Display width of one figure in a side-by-side pair; renders are at least 2x this. */
const PAIR_W = 392;
/** Tile render size: 2x the pair width. */
const TILE = 768;
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const signed = (n, d = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;
const pctOf = (n, total) => `${signed((n / total) * 100)}%`;
const save = async (name, png) => { writeFileSync(join(OUT, name), png); return `assets/${name}`; };

/**
 * A figure is a clean PNG plus the marker geometry the page draws over it as
 * an SVG layer: the guide lines through the box center and a ring on each
 * visual center. Keeping the markers out of the PNG leaves the asset pure
 * output that anyone can re-measure, and lets the page toggle them.
 */
/** `unit` is render px per labelled px, so measurement labels use the same units as the captions; `cell` is the per-element container of a row. */
const record = (src, rw, rh, { box, boxes, marks = [], bboxes = [], dark = false, lines = "cross", unit = 1, cell, noMeasure = false, hLines, baselines, refH, ref, scoreText }) => ({ src, rw, rh, box, boxes, marks, bboxes, dark, lines, unit, cell, noMeasure, hLines, baselines, refH, ref, scoreText });
const inkRect = (m) => ({ x: m.inkBox.left, y: m.inkBox.top, w: m.inkBox.width, h: m.inkBox.height });

/**
 * Re-measure a built figure and nudge the element until its own visual center sits on
 * the container center. Integer placement and anti-aliased edges blending into the plate
 * mean one pass lands close but not on it.
 */
const converge = async (build, bgLum, { dx = 0, dy = 0, passes = 4, opts = {} } = {}) => {
    let png = await build(dx, dy);
    for (let i = 0; i < passes; i++) {
        const m = measure(await toRaw(png), bgLum, opts);
        const nx = dx - (m.visual.x - m.box.x), ny = dy - (m.visual.y - m.box.y);
        if (Math.round(nx) === Math.round(dx) && Math.round(ny) === Math.round(dy)) break;
        dx = nx;
        dy = ny;
        png = await build(dx, dy);
    }
    return { png, dx, dy };
};

/**
 * A one-pixel asymmetry in a box-centered figure is parity, not a finding: an integer
 * placement cannot split an odd remainder evenly, so `container - inkBox` must be even for
 * the geometric case to measure exactly equal on both sides. Nudge the artwork a pixel at a
 * time until it is. The ink box is measured rather than assumed, because an anti-aliased edge
 * column can fall below EXTENT_ALPHA and make the ink box a pixel narrower than the image.
 *
 * Only for figures whose geometric variant centers the INK. The pill and the initials are
 * centered by the em box instead, and their asymmetry is the point of those examples.
 */
const snapToParity = async (png, container, bgLum) => {
    const base = await sharp(png).metadata();
    // Search candidate sizes rather than nudging: resampling can move the ink box by 0 or 2
    // pixels for a 1-pixel change in the image, so an iterative nudge oscillates instead of
    // converging. Each axis is chosen independently, smallest change first.
    const offsets = [0, 1, -1, 2, -2, 3, -3];
    let best = null;
    for (const dw of offsets) {
        for (const dh of offsets) {
            const img = dw === 0 && dh === 0
                ? png
                : await sharp(png).resize(base.width + dw, base.height + dh, { fit: "fill" }).png().toBuffer();
            const m = measure(await toRaw(img), bgLum);
            if ((container.w - m.inkBox.width) % 2 === 0 && (container.h - m.inkBox.height) % 2 === 0) {
                return img;
            }
            best = best ?? img;
        }
    }
    return best;
};

/** Composite a transparent element onto a plate at an offset from centered placement. */
async function place(elementPng, { width, height, plate, dx = 0, dy = 0, shape = "rect", radius = 0 }) {
    const meta = await sharp(elementPng).metadata();
    const left = Math.round((width - meta.width) / 2 + dx);
    const top = Math.round((height - meta.height) / 2 + dy);
    const bgSvg = shape === "circle"
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 2}" fill="${plate}"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="${plate}"/></svg>`;
    return sharp(Buffer.from(bgSvg)).composite([{ input: elementPng, left, top }]).png().toBuffer();
}

const figures = {};
const numbers = {};

// ---------------------------------------------------------------- 0. The problem, step by step
{
    const TOTAL = 880, SCALE = 2, GAP = 14 * SCALE, PLATE_HEX = "#f0f0f0";
    const plateLum = parseColor(PLATE_HEX).lum;
    const INK = "#1a1a1a", ACCENT_INK = "#f0a500";
    const shapeSvg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">${body}</svg>`;
    const trimmedSvg = async (svg) => sharp(await rasterizeSvg(svg, { scale: 4 })).trim({ threshold: 10 }).png().toBuffer();

    /**
     * A row of square plates, one element each, placed by the rule named in
     * `anchor`: its bounding box, its plain centroid (all ink equal), or its
     * contrast-weighted mass. Returns the figure plus each element's offset
     * from its plate center, in display px.
     */
    const plates = async (items, cellW) => {
        const outer = Math.round(cellW * SCALE), plate = outer - GAP;
        const comps = [], boxes = [], bboxes = [], marks = [], out = [];
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            const box = Math.round(plate * (it.art ?? 0.58));
            const fitted = await sharp(it.png).resize(box, box, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
            const m = measure(await toRaw(fitted), plateLum);
            const cx = i * outer + GAP / 2 + plate / 2, cy = GAP / 2 + plate / 2;
            const anchor = it.anchor === "mass" ? m.massCentroid : it.anchor === "alpha" ? m.alphaCentroid : m.box;
            const left = Math.round(cx - anchor.x), top = Math.round(cy - anchor.y);
            comps.push({ input: fitted, left, top });
            boxes.push({ x: cx, y: cy });
            bboxes.push({ x: left + m.inkBox.left, y: top + m.inkBox.top, w: m.inkBox.width, h: m.inkBox.height });
            marks.push({ x: left + m.visual.x, y: top + m.visual.y });
            out.push({ id: it.id, dy: f1((top + m.visual.y - cy) / SCALE), dx: f1((left + m.visual.x - cx) / SCALE) });
        }
        const rowW = outer * items.length, rowH = outer;
        const bg = await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${rowW}" height="${rowH}">${items.map((_, i) => `<rect x="${i * outer + GAP / 2}" y="${GAP / 2}" width="${plate}" height="${plate}" rx="${10 * SCALE}" fill="${PLATE_HEX}"/>`).join("")}</svg>`);
        const png = await sharp(bg).composite(comps).png().toBuffer();
        return { png, rowW, rowH, out, rec: { boxes, marks, bboxes, cell: { w: plate, h: plate }, unit: SCALE } };
    };

    const triangle = await trimmedSvg(shapeSvg(`<path d="M60 4 L116 116 L4 116 Z" fill="${INK}"/>`));
    const twoTone = await trimmedSvg(shapeSvg(`<rect x="6" y="26" width="108" height="36" rx="7" fill="${INK}"/><path d="M14 78 Q60 106 106 78" stroke="${ACCENT_INK}" stroke-width="13" fill="none" stroke-linecap="round"/>`));
    const amazon = (await loadRaster(join(SRC, "amazon.svg"), { trim: true })).png;

    // The test: five marks, all box-centered, two of them symmetric.
    const introItems = [
        { id: "triangle", png: triangle },
        { id: "circle", png: await trimmedSvg(shapeSvg(`<circle cx="60" cy="60" r="54" fill="${INK}"/>`)) },
        { id: "amazon", png: amazon, art: 0.74 },
        { id: "play", png: await trimmedSvg(shapeSvg(`<path d="M20 6 L112 60 L20 114 Z" fill="${INK}"/>`)) },
        { id: "diamond", png: await trimmedSvg(shapeSvg(`<path d="M60 4 L116 60 L60 116 L4 60 Z" fill="${INK}"/>`)) },
    ];
    const test = await plates(introItems, TOTAL / 5);
    figures["intro-test"] = record(await save("intro-test.png", test.png), test.rowW, test.rowH, { ...test.rec, noMeasure: true });
    figures.introTest = { w: TOTAL, h: Math.round((test.rowH / test.rowW) * TOTAL) };

    /**
     * The same row as separate layers, so a page can move each shape from geometric to optical
     * centering. The move is the integer difference between the box-centered placement and the
     * converged optical placement on the same plate, so the end state is a real composite.
     */
    {
        // Only the shapes that need a correction: a symmetric shape stays still, which shows nothing.
        const MOTION_IDS = ["triangle", "amazon", "play"];
        const motionItems = introItems.filter((it) => MOTION_IDS.includes(it.id));
        const outer = Math.round((TOTAL / motionItems.length) * SCALE), plate = outer - GAP;
        const layers = [];
        for (const it of motionItems) {
            const box = Math.round(plate * (it.art ?? 0.58));
            const fitted = await sharp(it.png).resize(box, box, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
            const m = measure(await toRaw(fitted), plateLum);
            const build = (dx, dy) => place(fitted, { width: plate, height: plate, plate: PLATE_HEX, dx, dy });
            const { png, dx, dy } = await converge(build, plateLum, { dx: m.offset.x, dy: m.offset.y });
            const settled = measure(await toRaw(png), plateLum);
            const baseLeft = Math.round((plate - m.width) / 2), baseTop = Math.round((plate - m.height) / 2);
            layers.push({
                id: it.id,
                src: await save(`intro-layer-${it.id}.png`, fitted),
                left: layers.length * outer + GAP / 2 + baseLeft, top: GAP / 2 + baseTop, w: m.width, h: m.height,
                ink: inkRect(m),
                moveX: Math.round((plate - m.width) / 2 + dx) - baseLeft, moveY: Math.round((plate - m.height) / 2 + dy) - baseTop,
                residualPx: Math.hypot(settled.visual.x - settled.box.x, settled.visual.y - settled.box.y),
            });
        }
        const rowW = outer * motionItems.length, rowH = outer;
        const bg = await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${rowW}" height="${rowH}">${motionItems.map((_, i) => `<rect x="${i * outer + GAP / 2}" y="${GAP / 2}" width="${plate}" height="${plate}" rx="${10 * SCALE}" fill="${PLATE_HEX}"/>`).join("")}</svg>`);
        figures.introMotion = { src: await save("intro-plates.png", bg), rowW, rowH, w: TOTAL, h: Math.round((rowH / rowW) * TOTAL), unit: SCALE, layers };
        numbers.introMotion = layers.map((l) => ({ id: l.id, moveX: f1(l.moveX / SCALE), moveY: f1(l.moveY / SCALE), residualPx: f1(l.residualPx / SCALE) }));
    }

    // The three causes, one plate each.
    const STEP_W = 280;
    const steps = {
        "step-box": { png: triangle, anchor: "box" },
        "step-mass": { png: triangle, anchor: "mass" },
        "step-ink": { png: twoTone, anchor: "alpha", art: 0.66 },
    };
    numbers.intro = { test: test.out };
    for (const [id, item] of Object.entries(steps)) {
        const r = await plates([{ id, ...item }], STEP_W);
        figures[id] = record(await save(`${id}.png`, r.png), r.rowW, r.rowH, r.rec);
        numbers.intro[id] = r.out[0];
    }
    figures.stepSize = { w: STEP_W, h: STEP_W };
}

// ---------------------------------------------------------------- 1. Amazon on a plate
{
    const file = join(SRC, "amazon.svg");
    const variants = {};
    for (const centering of ["box", "alpha", "visual"]) {
        const t = await renderTile(file, { size: TILE, centering });
        variants[centering] = t;
        if (centering === "alpha") continue; // measured for the numbers, not shown
        figures[`amazon-${centering}`] = record(await save(`amazon-${centering}.png`, t.png), TILE, TILE, { box: t.result.box, marks: [t.result.visual], bboxes: [inkRect(t.result)] });
    }
    const art = variants.visual.artwork;
    const vres = variants.visual.result;
    numbers.amazonClamp = {
        artWidth: art.width, artBox: Math.round(TILE * 0.76), tile: TILE,
        pinned: art.width >= Math.round(TILE * 0.76),
        dx: f1(Math.abs(vres.visual.x - TILE / 2)), dy: (Math.abs(vres.visual.y - TILE / 2)).toFixed(2),
        onePx: (100 / TILE).toFixed(2),
    };
    numbers.amazon = {
        art: `${art.width}x${art.height}`,
        artBox: f1(art.box.y), alphaY: f1(art.alphaCentroid.y), visualY: f1(art.visual.y), massY: f1(art.massCentroid.y), extentY: f1(art.extent.y),
        dy: f1(art.offset.y), dyPct: f1(art.offsetPct.y), dx: f1(art.offset.x),
        accentShare: Math.round(art.accentShare * 100),
        result: Object.fromEntries(Object.entries(variants).map(([k, t]) => [k, {
            dy: f1(t.result.visual.y - TILE / 2), dx: f1(t.result.visual.x - TILE / 2),
            pct: f1(Math.hypot(t.result.visual.x - TILE / 2, t.result.visual.y - TILE / 2) / TILE * 100),
        }])),
    };
    // Same mark, wrong background
    const wrong = await measureFile(file, { bg: "0", trim: true });
    numbers.amazonWrongBg = { visualY: f1(wrong.visual.y), boxY: f1(wrong.box.y), dyPct: f1(wrong.offsetPct.y), discounted: wrong.discounted, accentShare: Math.round(wrong.accentShare * 100) };
}

// ---------------------------------------------------------------- 2. PayPal: the accent guard
{
    // A wordmark fills a square tile's art box, so a horizontal correction has
    // no room there; a wide plate (a partner card) is where the guard shows.
    const file = join(SRC, "paypal.svg");
    const PW = PAIR_W * 2, PH = PAIR_W;
    const { png } = await loadRaster(file, { trim: true });
    const artwork = await snapToParity(
        await sharp(png).resize(Math.round(PW * 0.6), Math.round(PH * 0.6), { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
        { w: PW, h: PH },
        255,
    );
    const raw = await toRaw(artwork);
    const a = measure(raw, 255);
    const fa = measure(raw, 255, { forceDiscount: true });
    const plain = await place(artwork, { width: PW, height: PH, plate: "#ffffff" });
    const onePass = await place(artwork, { width: PW, height: PH, plate: "#ffffff", dx: a.offset.x, dy: a.offset.y });
    const balanced = (await converge((dx, dy) => place(artwork, { width: PW, height: PH, plate: "#ffffff", dx, dy }), 255, { dx: a.offset.x, dy: a.offset.y })).png;
    const mp = measure(await toRaw(plain), 255);
    const mb = measure(await toRaw(balanced), 255);
    const m1 = measure(await toRaw(onePass), 255);
    figures["paypal-box"] = record(await save("paypal-box.png", plain), PW, PH, { box: mp.box, marks: [mp.visual], bboxes: [inkRect(mp)] });
    figures["paypal-visual"] = record(await save("paypal-visual.png", balanced), PW, PH, { box: mb.box, marks: [mb.visual], bboxes: [inkRect(mb)] });
    numbers.paypal = {
        accentShare: Math.round(a.accentShare * 100),
        art: `${a.width}x${a.height}`,
        alphaX: f1(a.alphaCentroid.x), extentX: f1(a.extent.x), visualX: f1(a.visual.x), forcedX: f1(fa.visual.x), boxX: f1(a.box.x),
        shiftPct: f1(((a.box.x - a.visual.x) / a.width) * 100),
        massShiftPct: f1(((fa.visual.x - a.visual.x) / a.width) * 100),
        onePassPx: f1(Math.hypot(m1.visual.x - PW / 2, m1.visual.y - PH / 2)),
        convergedPx: f1(Math.hypot(mb.visual.x - PW / 2, mb.visual.y - PH / 2)),
        plainDx: f1(mp.visual.x - PW / 2),
        keptDx: f1(mb.visual.x - PW / 2),
        dx: f1(a.offset.x),
    };
}

// ---------------------------------------------------------------- 3. Icons in round buttons
{
    // The same grey plate the pill uses, so every plated figure on the page shares one surface.
    const BUTTON = 64, ICON = 24, SCALE = 12, PLATE = "#e8e8e8", INK = "#1a1a1a";
    const plateLum = parseColor(PLATE).lum;
    const icons = {
        play: `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 24 24"><path d="M4.25 3.5 L19.75 12 L4.25 20.5 Z" fill="${INK}"/></svg>`,
        arrow: `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.25 12h15.5"/><path d="M13.25 5.5 L19.75 12 L13.25 18.5"/></svg>`,
    };
    numbers.icons = {};
    for (const [name, svg] of Object.entries(icons)) {
        const iconPng = await rasterizeSvg(svg, { scale: SCALE });
        const m = measure(await toRaw(iconPng), plateLum);
        const size = BUTTON * SCALE;
        const before = await place(iconPng, { width: size, height: size, plate: PLATE, shape: "circle" });
        const after = await place(iconPng, { width: size, height: size, plate: PLATE, shape: "circle", dx: m.offset.x, dy: m.offset.y });
        const mb = measure(await toRaw(before), plateLum);
        const ma = measure(await toRaw(after), plateLum);
        figures[`${name}-before`] = record(await save(`${name}-before.png`, before), size, size, { box: mb.box, marks: [mb.visual], bboxes: [inkRect(mb)], unit: SCALE });
        figures[`${name}-after`] = record(await save(`${name}-after.png`, after), size, size, { box: ma.box, marks: [ma.visual], bboxes: [inkRect(ma)], unit: SCALE });
        numbers.icons[name] = {
            dx: f1(m.offset.x / SCALE), dy: f1(m.offset.y / SCALE),
            dxPctIcon: f1(m.offsetPct.x), dxPctButton: f1((m.offset.x / SCALE / BUTTON) * 100),
            beforeOff: f1((mb.visual.x - mb.box.x) / SCALE), afterOff: f1((ma.visual.x - ma.box.x) / SCALE),
        };
    }
}

// ---------------------------------------------------------------- 4. Caps label in a pill
{
    const W = 104, H = 32, FONT = 13, SCALE = 8, PLATE = "#e8e8e8", INK = "#1a1a1a";
    const plateLum = measure(await toRaw(await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${PLATE}" fill-opacity="1"/></svg>`)), 0).bgLum;
    const lum = 0.299 * 0xe8 + 0.587 * 0xe6 + 0.114 * 0xe1;
    const text = (dy = 0) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><text x="${W / 2}" y="${H / 2 + dy}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${FONT}" letter-spacing="${FONT * 0.08}" fill="${INK}">BETA</text></svg>`;
    const textPng = await rasterizeSvg(text(0), { scale: SCALE });
    const m = measure(await toRaw(textPng), lum);
    const dx = m.offset.x / SCALE, dy = m.offset.y / SCALE;
    const pill = async (t) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${H / 2}" fill="${PLATE}"/></svg>`), { density: 72 * SCALE })
        .composite([{ input: await rasterizeSvg(t, { scale: SCALE }), left: 0, top: 0 }]).png().toBuffer();
    const before = await pill(text(0));
    const after = await pill(text(dy).replace(`x="${W / 2}"`, `x="${W / 2 + dx}"`));
    const mb = measure(await toRaw(before), lum);
    const ma = measure(await toRaw(after), lum);
    figures["pill-before"] = record(await save("pill-before.png", before), W * SCALE, H * SCALE, { box: mb.box, marks: [mb.visual], bboxes: [inkRect(mb)], unit: SCALE });
    figures["pill-after"] = record(await save("pill-after.png", after), W * SCALE, H * SCALE, { box: ma.box, marks: [ma.visual], bboxes: [inkRect(ma)], unit: SCALE });
    numbers.pill = { dx: f1(dx), dy: f1(dy), dyEm: (dy / FONT).toFixed(2), dxEm: (dx / FONT).toFixed(2), font: FONT, afterDy: f1((ma.visual.y - ma.box.y) / SCALE) };
}

// ---------------------------------------------------------------- 6. Logo strip
{
    const names = ["amazon", "google", "stripe", "slack", "shopify", "apple", "mastercard", "netflix", "airbnb"];
    const files = names.map((n) => join(SRC, `${n}.svg`));
    const layout = { height: 80, gap: 88, padding: 48, paddingY: 104, rowGap: 88, columns: 5 };
    // Both strips must render at the same on-screen scale, and the page shows every figure
    // at one width, so the wider of the two canvases sets the width for both.
    const natural = await Promise.all([
        renderStrip(files, { ...layout, sizing: "height", centering: "box" }),
        renderStrip(files, layout),
    ]);
    const canvasWidth = Math.max(natural[0].width, natural[1].width);
    const before = await renderStrip(files, { ...layout, sizing: "height", centering: "box", canvasWidth });
    const after = await renderStrip(files, { ...layout, canvasWidth });
    // Nine logos on one 40px row leave no room for annotation: per-logo padding
    // labels repeat one number nine times, and nine outlines read as a grid rather
    // than as a strip. The table below carries the sizes.
    /** Perceived size of every logo as rendered, so the spread is measured and not asserted. */
    const perceivedOf = async (strip) => {
        const out = [];
        for (const r of strip.rows) {
            const crop = await sharp(strip.png).extract({ left: r.placed.left, top: r.placed.top, width: r.placed.width, height: r.placed.height }).png().toBuffer();
            out.push(measure(await toRaw(crop), 255).perceivedSize / 2);
        }
        return out;
    };
    const spreadOf = (sizes) => ((Math.max(...sizes) - Math.min(...sizes)) / Math.min(...sizes)) * 100;
    const perceivedBefore = await perceivedOf(before);
    const perceivedAfter = await perceivedOf(after);

    const stripRec = (s, spread) => ({
        box: { x: s.width / 2, y: s.rowHeight / 2 },
        hLines: [...new Set(s.baselines)],
        baselines: s.baselines,
        refH: s.rowHeight,
        marks: s.rows.map((r) => r.placed.visual),
        unit: 2,
        noMeasure: true,
        // This pair changes SIZE, so it reports how far apart the logos read, not how far
        // any one of them sits from a centerline.
        scoreText: `Size spread ${Math.round(spread)}%`,
    });
    figures["strip-before"] = record(await save("strip-before.png", before.png), before.width, before.height, stripRec(before, spreadOf(perceivedBefore)));
    figures["strip-after"] = record(await save("strip-after.png", after.png), after.width, after.height, stripRec(after, spreadOf(perceivedAfter)));
    figures.stripSize = { width: canvasWidth / 2, height: before.height / 2 };
    const measured = [];
    for (const f of files) measured.push(await measureFile(f, { trim: true }));
    numbers.strip = equalize(measured, { height: 40 }).map((r, i) => ({
        name: names[i], equal: `${Math.round(r.inkBox.width * r.baseline)} × 40`, size: f1(r.baselineSize),
        correction: r.correction.toFixed(2), rendered: `${Math.round(r.rendered.width)} × ${Math.round(r.rendered.height)}`, clamped: r.clamped,
    }));
    numbers.stripTarget = f1(numbers.strip[0] ? equalize(measured, { height: 40 })[0].target : 0);
    numbers.stripVerify = {
        min: f1(Math.min(...perceivedAfter)), max: f1(Math.max(...perceivedAfter)),
        spreadBefore: Math.round(spreadOf(perceivedBefore)), spreadAfter: Math.round(spreadOf(perceivedAfter)),
    };
}

// ---------------------------------------------------------------- 8. Icon beside a label
{
    const W = 140, H = 48, R = 12, SCALE = 8, DARK = "#141414", ICON = 20, GAP = 8, FONT = 15;
    const darkLum = parseColor(DARK).lum;
    // Content rendered alone on transparency, then trimmed to its ink box, so
    // "box centered" means equal padding on both sides of the content.
    const contentSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<g transform="translate(8 ${(H - ICON) / 2}) scale(${ICON / 24})" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M6.5 10.5 12 16l5.5-5.5"/><path d="M4 20h16"/></g>
<text x="${8 + ICON + GAP}" y="${H / 2}" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="${FONT}" fill="#fff">Download</text></svg>`;
    const content = await sharp(await rasterizeSvg(contentSvg, { scale: SCALE })).trim({ threshold: 10 }).png().toBuffer();
    const cm = measure(await toRaw(content), darkLum);
    const before = await place(content, { width: W * SCALE, height: H * SCALE, plate: DARK, radius: R * SCALE });
    const after = await place(content, { width: W * SCALE, height: H * SCALE, plate: DARK, radius: R * SCALE, dx: cm.offset.x, dy: cm.offset.y });
    const mb = measure(await toRaw(before), darkLum);
    const ma = measure(await toRaw(after), darkLum);
    figures["button-before"] = record(await save("button-before.png", before), W * SCALE, H * SCALE, { box: mb.box, marks: [mb.visual], bboxes: [inkRect(mb)], dark: true, unit: SCALE });
    figures["button-after"] = record(await save("button-after.png", after), W * SCALE, H * SCALE, { box: ma.box, marks: [ma.visual], bboxes: [inkRect(ma)], dark: true, unit: SCALE });
    const pad = (W * SCALE - cm.width) / 2 / SCALE;
    numbers.button = {
        dx: f1(cm.offset.x / SCALE), dy: f1(cm.offset.y / SCALE),
        pad: f1(pad), padIcon: f1(pad + cm.offset.x / SCALE), padText: f1(pad - cm.offset.x / SCALE),
        beforeOff: f1((mb.visual.x - mb.box.x) / SCALE), afterOff: f1((ma.visual.x - ma.box.x) / SCALE),
        content: `${Math.round(cm.width / SCALE)}x${Math.round(cm.height / SCALE)}`,
    };
}

// ---------------------------------------------------------------- 9. The same mark in dark mode
{
    const inverted = Buffer.from(readFileSync(join(SRC, "amazon.svg"), "utf8").replaceAll("fill:#221f1f", "fill:#ffffff"));
    const plain = await renderTile(inverted, { size: TILE, plate: "#000000", centering: "box" });
    const balanced = await renderTile(inverted, { size: TILE, plate: "#000000", centering: "visual" });
    figures["amazon-dark-box"] = record(await save("amazon-dark-box.png", plain.png), TILE, TILE, { box: plain.result.box, marks: [plain.result.visual], bboxes: [inkRect(plain.result)], dark: true });
    figures["amazon-dark-visual"] = record(await save("amazon-dark-visual.png", balanced.png), TILE, TILE, { box: balanced.result.box, marks: [balanced.result.visual], bboxes: [inkRect(balanced.result)], dark: true });
    const a = balanced.artwork;
    const orange = luminance(0xff, 0x99, 0x00);
    numbers.amazonDark = {
        dyPct: f1(a.offsetPct.y), dy: f1(a.offset.y), accentShare: Math.round(a.accentShare * 100), discounted: a.discounted,
        smileContrastLight: (Math.abs(orange - 255) / 255).toFixed(2), smileContrastDark: (orange / 255).toFixed(2),
        boxDy: f1(plain.result.visual.y - TILE / 2), visualDy: f1(balanced.result.visual.y - TILE / 2),
        alphaY: f1(a.alphaCentroid.y), extentY: f1(a.extent.y), visualY: f1(a.visual.y), boxY: f1(a.box.y),
    };
}

// ---------------------------------------------------------------- 10. Initials in an avatar disc
{
    const D = 96, GAP = 40, SCALE = 8, FILL = "#4c6ef5", FONT = 44, letters = ["J", "L", "A"];
    const fillLum = parseColor(FILL).lum;
    const glyph = (letter) => `<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}"><text x="${D / 2}" y="${D / 2}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="${FONT}" fill="#fff">${letter}</text></svg>`;
    const disc = await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="${FILL}"/></svg>`, { scale: SCALE });
    const rowW = (letters.length * D + (letters.length - 1) * GAP) * SCALE, rowH = D * SCALE;
    const build = async (corrected) => {
        const comps = [], marks = [], boxes = [], bboxes = [], per = [];
        for (let i = 0; i < letters.length; i++) {
            const g = await rasterizeSvg(glyph(letters[i]), { scale: SCALE });
            const gm = measure(await toRaw(g), fillLum);
            const left = i * (D + GAP) * SCALE;
            const dx = corrected ? Math.round(gm.offset.x) : 0, dy = corrected ? Math.round(gm.offset.y) : 0;
            const avatar = await sharp(disc).composite([{ input: g, left: dx, top: dy }]).png().toBuffer();
            comps.push({ input: avatar, left, top: 0 });
            boxes.push({ x: left + rowH / 2, y: rowH / 2 });
            marks.push({ x: left + gm.visual.x + dx, y: gm.visual.y + dy });
            bboxes.push({ x: left + gm.inkBox.left + dx, y: gm.inkBox.top + dy, w: gm.inkBox.width, h: gm.inkBox.height });
            per.push({ letter: letters[i], dx: f1(gm.offset.x / SCALE), dy: f1(gm.offset.y / SCALE), dxEm: (gm.offset.x / SCALE / FONT).toFixed(2), dyEm: (gm.offset.y / SCALE / FONT).toFixed(2) });
        }
        const png = await sharp({ create: { width: rowW, height: rowH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toBuffer();
        return { png, marks, boxes, bboxes, per };
    };
    const before = await build(false), after = await build(true);
    figures["initials-before"] = record(await save("initials-before.png", before.png), rowW, rowH, { boxes: before.boxes, marks: before.marks, bboxes: before.bboxes, unit: SCALE, cell: { w: D * SCALE, h: D * SCALE } });
    figures["initials-after"] = record(await save("initials-after.png", after.png), rowW, rowH, { boxes: after.boxes, marks: after.marks, bboxes: after.bboxes, unit: SCALE, cell: { w: D * SCALE, h: D * SCALE } });
    numbers.initials = { per: before.per, font: FONT, disc: D };
    figures.initialsSize = { w: rowW / SCALE, h: rowH / SCALE };
}

// ---------------------------------------------------------------- 11. Framing a portrait
{
    // The painting is composed around its subject already, so it is extended
    // with its own backdrop (edge pixels copied, both edge columns are plain
    // backdrop) to stand in for the casual upload this rule is for: a wide
    // frame, the person off to one side, room on both sides.
    const EXTEND = 1000, EXTEND_RIGHT = 500;
    const wide = await sharp(join(SRC, "vermeer-girl.jpg")).extend({ left: EXTEND, right: EXTEND_RIGHT, extendWith: "copy" }).jpeg({ quality: 92 }).toBuffer();
    const BG = "#0a0a08", TOL = 0.15, ZOOM = 0.9, SIZE = PAIR_W * 2;
    const plain = await renderFrame(wide, { size: SIZE, bg: BG, tolerance: TOL, zoom: ZOOM, centering: "box", circle: true });
    const balanced = await renderFrame(wide, { size: SIZE, bg: BG, tolerance: TOL, zoom: ZOOM, centering: "visual", circle: true });
    figures["frame-box"] = record(await save("frame-box.png", plain.png), SIZE, SIZE, { box: plain.result.box, marks: [plain.result.visual] });
    figures["frame-visual"] = record(await save("frame-visual.png", balanced.png), SIZE, SIZE, { box: balanced.result.box, marks: [balanced.result.visual] });
    const sm = balanced.source;
    const dir = (v, pos, neg) => (v === 0 ? "" : `${Math.abs(v)}px ${v > 0 ? pos : neg}`);
    numbers.frame = {
        source: `${sm.width}x${sm.height}`, zoom: Math.round(ZOOM * 100), tolerance: TOL, extend: EXTEND, extendRight: EXTEND_RIGHT,
        visual: `${f1(sm.visual.x)}, ${f1(sm.visual.y)}`, box: `${f1(sm.box.x)}, ${f1(sm.box.y)}`,
        shiftXPct: f1(((sm.visual.x - sm.box.x) / sm.width) * 100), shiftYPct: f1(((sm.visual.y - sm.box.y) / sm.height) * 100),
        cropBox: `${plain.crop.side}px at ${plain.crop.left},${plain.crop.top}`, cropVisual: `${balanced.crop.side}px at ${balanced.crop.left},${balanced.crop.top}`,
        moved: [dir(balanced.crop.left - plain.crop.left, "right", "left"), dir(balanced.crop.top - plain.crop.top, "down", "up")].filter(Boolean).join(" and ") || "nowhere",
        beforeOffPct: f1(Math.hypot(plain.result.visual.x - SIZE / 2, plain.result.visual.y - SIZE / 2) / SIZE * 100),
        afterOffPct: f1(Math.hypot(balanced.result.visual.x - SIZE / 2, balanced.result.visual.y - SIZE / 2) / SIZE * 100),
    };
}

// ---------------------------------------------------------------- 12. A symbol beside a wordmark
{
    // Split a lockup at the widest empty column run between symbol and wordmark.
    const splitLockup = async (file) => {
        const { png, raw } = await loadRaster(file, { trim: true });
        const occ = new Array(raw.width).fill(false);
        for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) if (raw.data[(y * raw.width + x) * 4 + 3] > 20) occ[x] = true;
        let best = { start: 0, len: 0 }, run = 0;
        for (let x = 0; x <= raw.width; x++) {
            if (x < raw.width && !occ[x]) run++;
            else { if (run > best.len) best = { start: x - run, len: run }; run = 0; }
        }
        const firstInk = (x0, x1) => { for (let y = 0; y < raw.height; y++) for (let x = x0; x < x1; x++) if (raw.data[(y * raw.width + x) * 4 + 3] > 20) return y; return 0; };
        const symEnd = best.start, wordStart = best.start + best.len;
        // sharp runs trim before extract inside one pipeline, so trim in a second pass.
        const cut = async (left, width) => sharp(await sharp(png).extract({ left, top: 0, width, height: raw.height }).png().toBuffer()).trim({ threshold: 10 }).png().toBuffer();
        const sym = await cut(0, symEnd), word = await cut(wordStart, raw.width - wordStart);
        const symM = measure(await toRaw(sym), 255), wordM = measure(await toRaw(word), 255);
        const symTop = firstInk(0, symEnd), wordTop = firstInk(wordStart, raw.width);
        const lastInk = (x0, x1) => { for (let y = raw.height - 1; y >= 0; y--) for (let x = x0; x < x1; x++) if (raw.data[(y * raw.width + x) * 4 + 3] > 20) return y; return raw.height; };
        return {
            sym, word, symM, wordM, gap: best.len,
            // the brand's own placement, in raster px; positive means the symbol sits lower
            brand: {
                boxDiff: symTop + symM.height / 2 - (wordTop + wordM.height / 2),
                visualDiff: symTop + symM.visual.y - (wordTop + wordM.visual.y),
                crossDiff: symTop + symM.height / 2 - (wordTop + wordM.visual.y),
                bottomDiff: lastInk(0, symEnd) - lastInk(wordStart, raw.width),
                wordHeight: wordM.height, symHeight: symM.height,
            },
        };
    };
    const brands = {};
    for (const name of ["slack", "shopify", "airbnb"]) brands[name] = await splitLockup(join(SRC, `${name}.svg`));
    const L = brands.slack;
    const PW = PAIR_W * 2, PH = PAIR_W;
    const scale = (0.72 * PW) / (L.symM.width + L.gap + L.wordM.width);
    const rs = async (png) => sharp(png).resize({ width: Math.max(1, Math.round((await sharp(png).metadata()).width * scale)) }).png().toBuffer();
    const sym = await rs(L.sym), word = await rs(L.word);
    const sm = measure(await toRaw(sym), 255), wm = measure(await toRaw(word), 255);
    const gap = Math.round(L.gap * scale);
    const total = sm.width + gap + wm.width;
    const wordLeft = Math.round((PW - total) / 2 + sm.width + gap), symLeft = Math.round((PW - total) / 2);
    const wordTop = Math.round(PH / 2 - wm.visual.y);
    const build = async (aligned) => {
        const symTop = Math.round(aligned ? wordTop + wm.visual.y - sm.visual.y : wordTop + wm.box.y - sm.box.y);
        const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}"><rect width="${PW}" height="${PH}" fill="#ffffff"/></svg>`);
        const png = await sharp(plate).composite([{ input: sym, left: symLeft, top: symTop }, { input: word, left: wordLeft, top: wordTop }]).png().toBuffer();
        return {
            png,
            mark: { x: symLeft + sm.visual.x, y: symTop + sm.visual.y },
            bboxes: [{ x: symLeft, y: symTop, w: sm.width, h: sm.height }, { x: wordLeft, y: wordTop, w: wm.width, h: wm.height }],
            symTop,
        };
    };
    const before = await build(false), after = await build(true);
    const rec = (r) => ({ box: { x: PW / 2, y: PH / 2 }, lines: "h", marks: [r.mark], bboxes: r.bboxes, noMeasure: true });
    figures["lockup-before"] = record(await save("lockup-before.png", before.png), PW, PH, rec(before));
    figures["lockup-after"] = record(await save("lockup-after.png", after.png), PW, PH, rec(after));
    const pct = (v, h) => f1((v / h) * 100);
    numbers.lockup = {
        wordBoxVsVisual: f1(wm.visual.y - wm.box.y), wordBoxVsVisualPct: pct(wm.visual.y - wm.box.y, wm.height),
        defaultOff: f1(before.mark.y - PH / 2), defaultOffPct: pct(before.mark.y - PH / 2, wm.height),
        afterOff: f1(after.mark.y - PH / 2),
        wordHeight: Math.round(wm.height), symHeight: Math.round(sm.height),
        brands: Object.entries(brands).map(([name, b]) => ({
            name, box: pct(b.brand.boxDiff, b.brand.wordHeight), visual: pct(b.brand.visualDiff, b.brand.wordHeight),
            cross: pct(b.brand.crossDiff, b.brand.wordHeight), bottom: pct(b.brand.bottomDiff, b.brand.wordHeight), symShare: pct(b.brand.symHeight, b.brand.wordHeight),
        })),
    };
}

// ---------------------------------------------------------------- 8. Vercel's mark on a tile
{
    const TILE = 768;
    // The triangle is Vercel's icon. Split it from the wordmark by column ink count, not by
    // an empty column: its base corner and the V's stroke leave a two-pixel bridge, so no
    // column between them is ever empty and a widest-empty-run split takes "▲Ve".
    const { png: mark } = await loadRaster(join(SRC, "vercel.svg"), { trim: true });
    const wm = await toRaw(mark);
    const MIN_COLUMN_INK = 5;
    const columnInk = [];
    for (let x = 0; x < wm.width; x++) {
        let ink = 0;
        for (let y = 0; y < wm.height; y++) if (wm.data[(y * wm.width + x) * 4 + 3] > 20) ink++;
        columnInk.push(ink);
    }
    // Enter the mark first: a triangle's own base corner is a one-pixel column, so scanning
    // from x = 0 for a thin column stops inside the triangle instead of after it.
    const start = columnInk.findIndex((ink) => ink > MIN_COLUMN_INK);
    let end = columnInk.findIndex((ink, x) => x > start && ink <= MIN_COLUMN_INK);
    if (end < 0) end = wm.width;
    const triangle = await sharp(await sharp(mark).extract({ left: 0, top: 0, width: end, height: wm.height }).png().toBuffer())
        .trim({ threshold: 10 }).png().toBuffer();
    const triM = measure(await toRaw(triangle), 255);

    // Vercel ships this mark as a white triangle on a black disc, so the container the
    // correction has to satisfy is the disc, not the tile: the disc is centered on the white
    // tile geometrically, and the triangle is placed inside the disc.
    const DISC = Math.round(TILE * 0.5);
    const white = await sharp(triangle).ensureAlpha().negate({ alpha: false }).png().toBuffer();
    const art = Math.round(DISC * 0.6);
    const fitted = await snapToParity(
        await sharp(white).resize(art, art, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(),
        { w: DISC, h: DISC },
        0,
    );
    const fm = measure(await toRaw(fitted), 0);
    const discSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><rect width="${TILE}" height="${TILE}" fill="#ffffff"/><circle cx="${TILE / 2}" cy="${TILE / 2}" r="${DISC / 2}" fill="#000000"/></svg>`;
    const disc = await rasterizeSvg(discSvg);
    const tiles = {};
    for (const centering of ["box", "visual"]) {
        // Box centering anchors the INK box, not the image: an anti-aliased edge column can
        // fall below EXTENT_ALPHA, so the ink box sits a pixel off inside its own image and
        // centering the image would leave the mark visibly off inside the disc.
        const inkCenter = { x: fm.inkBox.left + fm.inkBox.width / 2, y: fm.inkBox.top + fm.inkBox.height / 2 };
        const anchor = centering === "visual" ? fm.visual : inkCenter;
        const left = Math.round(TILE / 2 - anchor.x);
        const top = Math.round(TILE / 2 - anchor.y);
        const png = await sharp(disc).composite([{ input: fitted, left, top }]).flatten({ background: "#ffffff" }).png().toBuffer();
        // Scored against the disc alone: measuring the whole tile would count the disc's own
        // ink, which is centered by construction and would swamp the triangle's offset.
        const inner = await sharp(png).extract({ left: Math.round((TILE - DISC) / 2), top: Math.round((TILE - DISC) / 2), width: DISC, height: DISC }).png().toBuffer();
        const im = measure(await toRaw(inner), 0);
        tiles[centering] = { png, result: im, mark: { x: left + fm.visual.x, y: top + fm.visual.y } };
        figures[`vercel-${centering}`] = record(await save(`vercel-${centering}.png`, png), TILE, TILE, {
            box: { x: TILE / 2, y: TILE / 2 },
            marks: [tiles[centering].mark],
            bboxes: [{ x: left + fm.inkBox.left, y: top + fm.inkBox.top, w: fm.inkBox.width, h: fm.inkBox.height }],
            // The disc is the container, so the padding is measured to ITS bounds, not the
            // tile's. A cell of the disc's size puts every arrow inside the black, where the
            // screen blend the dark figures use can be seen.
            boxes: [{ x: TILE / 2, y: TILE / 2 }],
            cell: { w: DISC, h: DISC },
            dark: true,
        });
    }
    const offOf = (t) => Math.hypot(t.mark.x - TILE / 2, t.mark.y - TILE / 2);
    numbers.vercel = {
        mark: `${triM.width}x${triM.height}`,
        extentY: f1(triM.extent.y), massY: f1(triM.mass.y), visualY: f1(triM.visual.y),
        gap: f1(triM.mass.y - triM.extent.y),
        dy: f1(triM.offset.y), dyPct: f1(Math.abs(triM.offsetPct.y)),
        beforePct: (offOf(tiles.box) / DISC * 100).toFixed(2), afterPct: (offOf(tiles.visual) / DISC * 100).toFixed(2),
        disc: DISC,
        beforePx: f1(offOf(tiles.box)), afterPx: f1(offOf(tiles.visual)),
        tile: TILE,
    };
    figures.vercelTriangle = triangle;
}

// ---------------------------------------------------------------- 7. Method diagrams
{
    // The method section's own figures: what the per-pixel weight looks like, and where
    // the three readings sit. Their annotation is baked in, because a diagram should not
    // blink with the marker loop the before-and-after figures use.
    const W = 280, SCALE = 4, PLATE = "#ffffff";
    const plateLum = parseColor(PLATE).lum;
    const artBox = Math.round(W * SCALE * 0.86);
    const { png: trimmed } = await loadRaster(join(SRC, "amazon.svg"), { trim: true });
    const art = await sharp(trimmed).resize(artBox, artBox, { fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const raw = await toRaw(art);
    const m = measure(raw, plateLum);
    const panelH = Math.round(raw.height + 64 * SCALE);
    const onPlate = async (input) => sharp({ create: { width: raw.width, height: panelH, channels: 4, background: PLATE } })
        .composite([{ input, left: 0, top: Math.round((panelH - raw.height) / 2) }])
        .flatten({ background: PLATE })
        .png()
        .toBuffer();

    /** Render each pixel's weight as ink: full weight is black, no weight is the plate. */
    const weightMap = async (squared) => {
        const out = Buffer.alloc(raw.width * raw.height * 4, 0);
        for (let i = 0; i < raw.width * raw.height; i++) {
            const o = i * 4;
            const a = raw.data[o + 3];
            if (a === 0) continue;
            const contrast = Math.abs(luminance(raw.data[o], raw.data[o + 1], raw.data[o + 2]) - plateLum) / 255;
            if (contrast <= BACKGROUND_CONTRAST) continue;
            const w = (a / 255) * (squared ? contrast * contrast : 1);
            const v = Math.round(255 * (1 - w));
            out[o] = out[o + 1] = out[o + 2] = v;
            out[o + 3] = 255;
        }
        return sharp(out, { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toBuffer();
    };

    figures["weight-mark"] = record(await save("weight-mark.png", await onPlate(art)), raw.width, panelH, { box: { x: raw.width / 2, y: panelH / 2 } });
    figures["weight-alpha"] = record(await save("weight-alpha.png", await onPlate(await weightMap(false))), raw.width, panelH, { box: { x: raw.width / 2, y: panelH / 2 } });
    figures["weight-contrast"] = record(await save("weight-contrast.png", await onPlate(await weightMap(true))), raw.width, panelH, { box: { x: raw.width / 2, y: panelH / 2 } });
    figures.methodPanel = { w: W, h: Math.round((panelH / raw.width) * W) };

    // The three readings on one artwork. Vercel's triangle, because its extent center and
    // mass centroid sit far apart; on the Amazon mark they agree within a few pixels and the
    // labels would collide on a point the diagram is trying to separate.
    const DIAG_W = 520, ds = DIAG_W * 2, dh = Math.round(ds * 0.62);
    const diagArt = await sharp(figures.vercelTriangle).resize(null, Math.round(dh * 0.76), { fit: "inside" }).png().toBuffer();
    const dRaw = await toRaw(diagArt);
    const dm = measure(dRaw, plateLum);
    const top = Math.round((dh - dRaw.height) / 2);
    const left = Math.round((ds - dRaw.width) / 2);
    const at = (pt) => ({ x: left + pt.x, y: top + pt.y });
    const ext = at(dm.extent), mass = at(dm.mass), vis = at(dm.visual);
    const eb = dm.extentBox;
    const fs = 22, rail = left + dRaw.width + 40;
    const dot = (p, visual) => visual
        ? `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="8" fill="#06b6d4" stroke="#fff" stroke-width="3"/>`
        : `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="7" fill="#fff" stroke="#6b6b6b" stroke-width="3"/>`;
    // Each reading is called out on a rail to the right, so no label sits on the artwork.
    const callout = (p, text, bold) => `<line x1="${f1(p.x)}" y1="${f1(p.y)}" x2="${rail - 8}" y2="${f1(p.y)}" stroke="#c9c9c9" stroke-width="2" stroke-dasharray="5 4"/>`
        + `<text x="${rail}" y="${f1(p.y + fs * 0.36)}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="${fs}" font-weight="${bold ? 600 : 400}" fill="${bold ? "#0e7490" : "#1a1a1a"}">${text}</text>`;
    const overlaySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ds}" height="${dh}">
<rect x="${f1(left + eb.left)}" y="${f1(top + eb.top)}" width="${eb.width}" height="${eb.height}" fill="none" stroke="#a6a6a6" stroke-width="2" stroke-dasharray="8 6"/>
<line x1="${f1(ext.x)}" y1="${f1(ext.y)}" x2="${f1(mass.x)}" y2="${f1(mass.y)}" stroke="#6b6b6b" stroke-width="2.5"/>
${callout(ext, "extent")}${callout(vis, "visual center", true)}${callout(mass, "mass")}
${dot(ext)}${dot(mass)}${dot(vis, true)}</svg>`;
    const diagram = await sharp({ create: { width: ds, height: dh, channels: 4, background: PLATE } })
        .composite([{ input: diagArt, left, top }, { input: Buffer.from(overlaySvg), left: 0, top: 0 }])
        .flatten({ background: PLATE })
        .png()
        .toBuffer();
    figures["method-centers"] = record(await save("method-centers.png", diagram), ds, dh, { box: { x: ds / 2, y: dh / 2 } });
    figures.methodDiagram = { w: DIAG_W, h: Math.round(dh / 2) };
    numbers.method = {
        letterWeight: (Math.pow(Math.abs(luminance(0x22, 0x1f, 0x1f) - 255) / 255, 2)).toFixed(2),
        smileWeight: (Math.pow(Math.abs(luminance(0xff, 0x99, 0x00) - 255) / 255, 2)).toFixed(2),
        extentY: f1(dm.extent.y), massY: f1(dm.mass.y), visualY: f1(dm.visual.y),
        gapPct: f1(((dm.mass.y - dm.extent.y) / dm.height) * 100),
    };
}

// ---------------------------------------------------------------- 7. Sizing experiment sheet (evidence for the defaults)
{
    const names = ["amazon", "google", "stripe", "slack", "shopify", "apple", "mastercard", "netflix", "airbnb"];
    const files = names.map((n) => join(SRC, `${n}.svg`));
    const variants = [
        { label: "equal height (geometric)", sizing: "height" },
        { label: "alpha area, power 1", metric: "alpha", strength: 1 },
        { label: "alpha area, power 0.5", metric: "alpha", strength: 0.5 },
        { label: "linear-contrast area, power 1", metric: "contrast", strength: 1 },
        { label: "linear-contrast area, power 0.5 (default)", metric: "contrast", strength: 0.5 },
        { label: "squared-contrast area, power 1", metric: "visual", strength: 1 },
        { label: "squared-contrast area, power 0.5", metric: "visual", strength: 0.5 },
    ];
    const parts = [];
    let y = 0, maxW = 0;
    for (const v of variants) {
        const s = await renderStrip(files, { height: 64, gap: 56, padding: 40, sizing: v.sizing ?? "visual", metric: v.metric, strength: v.strength });
        const heights = s.rows.map((r) => Math.round(r.rendered.height)).join(" / ");
        const label = await rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="28"><text x="40" y="20" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="#6b6b6b">${v.label}   ·   heights ${heights}</text></svg>`);
        parts.push({ input: label, left: 0, top: y }, { input: s.png, left: 0, top: y + 28 });
        y += 28 + s.height;
        maxW = Math.max(maxW, s.width);
    }
    const sheet = await sharp({ create: { width: maxW, height: y, channels: 4, background: "#ffffff" } }).composite(parts).png().toBuffer();
    figures["sizing-experiment"] = await save("sizing-experiment.png", sheet);
}

// ---------------------------------------------------------------- page
const N = numbers, F = figures;
/** 1/3 reads better than its decimal in prose and in the constants table. */
const ACCENT_SHARE_LABEL = "1/3";
/**
 * Marker layer in the image's render units; strokes are CSS px via
 * non-scaling-stroke. Measurement labels are not boxed: a mask on the line
 * layer cuts a hole under each number, so the figure's own background shows
 * through on any plate colour. The holes render only while measurements are on.
 */
let overlayCount = 0;
const overlay = (rec, w) => {
    const id = `ov${++overlayCount}`;
    const r = (4.5 * rec.rw) / w;
    const lines = [];
    if (rec.hLines) {
        // A wrapped strip has one centerline per row and no vertical center at all.
        for (const y of rec.hLines) lines.push(`<line class="guide" x1="0" y1="${f1(y)}" x2="${rec.rw}" y2="${f1(y)}"/>`);
    } else if (rec.boxes) {
        lines.push(`<line class="guide" x1="0" y1="${f1(rec.boxes[0].y)}" x2="${rec.rw}" y2="${f1(rec.boxes[0].y)}"/>`);
        for (const b of rec.boxes) lines.push(`<line class="guide" x1="${f1(b.x)}" y1="0" x2="${f1(b.x)}" y2="${rec.rh}"/>`);
    } else {
        if (rec.lines === "cross" || rec.lines === "h") lines.push(`<line class="guide" x1="0" y1="${f1(rec.box.y)}" x2="${rec.rw}" y2="${f1(rec.box.y)}"/>`);
        if (rec.lines === "cross" || rec.lines === "v") lines.push(`<line class="guide" x1="${f1(rec.box.x)}" y1="0" x2="${f1(rec.box.x)}" y2="${rec.rh}"/>`);
    }
    const rings = rec.marks.map((m) => `<circle class="mark" cx="${f1(m.x)}" cy="${f1(m.y)}" r="${f1(r)}"/>`);
    const boxes = (rec.bboxes ?? []).map((b) => `<rect class="bbox" x="${f1(b.x)}" y="${f1(b.y)}" width="${f1(b.w)}" height="${f1(b.h)}"/>`);
    // Padding between each bounding box and its container, labelled in the caption's units.
    const fs = (11 * rec.rw) / w;
    const num = (v) => (v / rec.unit).toFixed(1).replace(/\.0$/, "");
    // Cap: 7px long with a 5.6px base at display size, chosen from a side-by-side
    // render of 4.5 to 9px; smaller reads as a tick, larger competes with the label.
    const cap = (x, y, dx, dy) => {
        const t = (7 * rec.rw) / w, bw = t * 0.8, px = -dy, py = dx;
        return `<polygon class="measure-cap" points="${f1(x)},${f1(y)} ${f1(x - dx * t + (px * bw) / 2)},${f1(y - dy * t + (py * bw) / 2)} ${f1(x - dx * t - (px * bw) / 2)},${f1(y - dy * t - (py * bw) / 2)}"/>`;
    };
    const tick = (x1, y1, x2, y2) => {
        const len = Math.hypot(x2 - x1, y2 - y1) || 1, dx = (x2 - x1) / len, dy = (y2 - y1) / len;
        return `<line class="measure-line" x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}"/>${cap(x1, y1, -dx, -dy)}${cap(x2, y2, dx, dy)}`;
    };
    const holes = [], texts = [];
    const text = (x, y, v) => {
        const label = num(v), hw = fs * (0.62 * label.length + 1.0), hh = fs * 1.4;
        holes.push(`<rect x="${f1(x - hw / 2)}" y="${f1(y - hh / 2)}" width="${f1(hw)}" height="${f1(hh)}"/>`);
        texts.push(`<text class="measure-text" x="${f1(x)}" y="${f1(y)}" font-size="${f1(fs)}" text-anchor="middle" dominant-baseline="central">${label}</text>`);
    };
    const ticks = (rec.noMeasure ? [] : rec.bboxes ?? []).flatMap((b, i) => {
        let x0 = 0, x1 = rec.rw, y0 = 0, y1 = rec.rh;
        if (rec.boxes && rec.cell) { const c = rec.boxes[i]; x0 = c.x - rec.cell.w / 2; x1 = c.x + rec.cell.w / 2; y0 = c.y - rec.cell.h / 2; y1 = c.y + rec.cell.h / 2; }
        const sideways = !(rec.lines === "h" && !rec.cell);
        const mx = b.x + b.w / 2, my = b.y + b.h / 2, bottom = b.y + b.h, right = b.x + b.w;
        const out = [tick(mx, y0, mx, b.y), tick(mx, bottom, mx, y1)];
        text(mx, (y0 + b.y) / 2, b.y - y0); text(mx, (bottom + y1) / 2, y1 - bottom);
        if (sideways) { out.push(tick(x0, my, b.x, my), tick(right, my, x1, my)); text((x0 + b.x) / 2, my, b.x - x0); text((right + x1) / 2, my, x1 - right); }
        return out;
    });
    // Two layers: the lines multiply onto the figure (screen on dark plates), so
    // they darken the plate and disappear over the ink; rings and numbers stay opaque.
    const vb = `viewBox="0 0 ${rec.rw} ${rec.rh}" aria-hidden="true"`;
    return `<svg class="overlay overlay-lines" ${vb}><defs><mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${rec.rw}" height="${rec.rh}"><rect width="${rec.rw}" height="${rec.rh}" fill="#fff"/><g class="measure-hole" fill="#000">${holes.join("")}</g></mask></defs><g mask="url(#${id})">${lines.join("")}${boxes.join("")}<g class="measure">${ticks.join("")}</g></g></svg><svg class="overlay overlay-marks" ${vb}><g class="measure">${texts.join("")}</g>${rings.join("")}</svg>`;
};
/** The label above each figure: Default is what geometric placement gives, Balanced is the skill's result. */
const LABELS = {
    "step-box": "The box misses the mass", "step-mass": "Mass alone overshoots", "step-ink": "Not all ink weighs the same",
    "amazon-box": "Geometric", "amazon-visual": "Optical",
    "paypal-box": "Geometric", "paypal-visual": "Optical",
    "play-before": "Geometric", "play-after": "Optical", "arrow-before": "Geometric", "arrow-after": "Optical",
    "pill-before": "Geometric", "pill-after": "Optical",
    "button-before": "Geometric", "button-after": "Optical",
    "lockup-before": "Geometric", "lockup-after": "Optical",
    "amazon-dark-box": "Geometric", "amazon-dark-visual": "Optical",
    "initials-before": "Geometric", "initials-after": "Optical",
    "frame-box": "Geometric", "frame-visual": "Optical",
    "strip-before": "Equal height", "strip-after": "Equal visual size",
    "vercel-box": "Geometric", "vercel-visual": "Optical",
    "weight-mark": "the mark", "weight-alpha": "counted equally", "weight-contrast": "weighted by contrast²",
};
const labelOf = (rec) => LABELS[rec.src.split("/").pop().replace(/\.png$/, "")];
/**
 * How far the element's visual center sits from its container's center, as a share of
 * the container's shorter side, averaged over the elements in a row. A figure that only
 * claims vertical alignment (a lockup on a plate, a row on one baseline) is scored on
 * that axis alone and says so, because its horizontal position is set by the layout
 * rather than by centering.
 */
const offCenterOf = (rec) => {
    let pairs, ref, vertical = false;
    if (rec.baselines) {
        // Each logo is scored against its OWN row's centerline, over that row's height.
        pairs = rec.marks.map((m, i) => [{ x: m.x, y: rec.baselines[i] }, m]);
        ref = rec.refH;
        vertical = true;
    } else if (rec.boxes) {
        pairs = rec.boxes.map((b, i) => [b, rec.marks[i]]);
        ref = rec.cell ? Math.min(rec.cell.w, rec.cell.h) : Math.min(rec.rw / rec.boxes.length, rec.rh);
    } else if (rec.lines === "h") {
        pairs = rec.marks.map((m) => [{ x: m.x, y: rec.box.y }, m]);
        ref = rec.rh;
        vertical = true;
    } else {
        pairs = rec.marks.map((m) => [rec.box, m]);
        // `ref` names the real container when it is smaller than the figure, as with a mark
        // inside a disc drawn on a tile: dividing by the figure would understate the offset.
        ref = rec.ref ?? Math.min(rec.rw, rec.rh);
    }
    const offs = pairs.map(([b, m]) => Math.hypot(m.x - b.x, m.y - b.y));
    const px = offs.reduce((a, b) => a + b, 0) / offs.length;
    return { pct: (px / ref) * 100, px: px / (rec.unit ?? 1), vertical };
};
const NO_OFFSET = new Set(["weight-mark", "weight-alpha", "weight-contrast", "method-centers"]);
const label = (rec, name = labelOf(rec)) => {
    if (!name) return "";
    const id = rec.src.split("/").pop().replace(/\.png$/, "");
    if (NO_OFFSET.has(id)) return `<span class="label"><span class="label-name">${name}</span></span>`;
    // A figure whose variable is size, not position, states its own metric: an off-center
    // reading there would quote a quantity the section is not arguing about.
    if (rec.scoreText) return `<span class="label"><span class="label-name">${name}</span><span class="score">${rec.scoreText}</span></span>`;
    const { pct, px, vertical } = offCenterOf(rec);
    const shown = `${pct < 0.05 ? "0" : pct.toFixed(1)}%${vertical ? " vertical" : ""}`;
    return `<span class="label"><span class="label-name">${name}</span><span class="score" title="${px.toFixed(1)}px, as a share of the container's shorter side">Off center ${shown}</span></span>`;
};
const img = (rec, w, h, alt, cls = "") => `<span class="fig ${cls}${rec.dark ? " dark" : ""}"><img src="${rec.src}" width="${w}" height="${h}" alt="${alt}" loading="lazy">${overlay(rec, w)}</span>`;
/** The caption is not rendered: the label, the measurements and the section prose carry it. It stays as the image's alt text. */
const fig = (rec, w, h, caption, alt, cls = "") => `<figure>${label(rec)}${img(rec, w, h, caption || alt, cls)}</figure>`;

// The pages link their figures from docs/assets, which suits a site. `--inline` embeds every
// figure instead, so a page renders on its own wherever it is opened or sent.
const INLINE = process.argv.includes("--inline");
const MIME = { png: "image/png", webp: "image/webp" };
const inline = (page) => page.replace(/(src|href)="assets\/([^"]+)"/g, (_, attr, name) => `${attr}="data:${MIME[name.split(".").pop()]};base64,${readFileSync(join(OUT, name)).toString("base64")}"`);
const finish = (page) => (INLINE ? inline(page) : page);

// A phone loads the landing page, so its figures ship as WebP at a fraction of the PNG size.
const LANDING_FIGURES = ["amazon-box", "amazon-visual", "play-before", "play-after", "vercel-box", "vercel-visual", "button-before", "button-after", "strip-before", "strip-after"];
const webp = {};
for (const id of LANDING_FIGURES) {
    const name = F[id].src.replace(/^assets\//, "").replace(/\.png$/, ".webp");
    await sharp(join(OUT, name.replace(/\.webp$/, ".png"))).webp({ quality: 88, effort: 6 }).toFile(join(OUT, name));
    webp[id] = `assets/${name}`;
}

// The README shows one picture made from the same figures: two pairs, geometric beside optical.
{
    const PANEL = 260, GAP = 16, LABEL = 30, PAD = 24, SPLIT = 24;
    const ids = ["amazon-box", "amazon-visual", "play-before", "play-after"];
    const W = PAD * 2 + PANEL * 4 + GAP * 3 + SPLIT, H = PAD * 2 + LABEL + PANEL;
    const comps = [];
    let text = "";
    for (const [i, id] of ids.entries()) {
        const x = PAD + i * (PANEL + GAP) + (i >= 2 ? SPLIT : 0);
        comps.push({ input: await sharp(join(OUT, F[id].src.replace(/^assets\//, ""))).resize(PANEL, PANEL).png().toBuffer(), left: x, top: PAD + LABEL });
        text += `<text x="${x}" y="${PAD + 18}" font-family="Helvetica, Arial, sans-serif" font-size="15" font-weight="600" fill="#1a1a1a">${i % 2 ? "Optical" : "Geometric"}</text>`;
    }
    mkdirSync(join(ROOT, "media"), { recursive: true });
    await sharp({ create: { width: W, height: H, channels: 4, background: "#fbfbfb" } })
        .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${text}</svg>`), left: 0, top: 0 }, ...comps])
        .png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(join(ROOT, "media/preview.png"));
}

// The GitHub Pages workflow sets GITHUB_REPOSITORY, which turns on the repository links.
const repo = process.env.GITHUB_REPOSITORY || process.env.OPTICAL_REPO || "";
const demo = await renderDemo();
writeFileSync(join(ROOT, "docs/index.html"), finish(renderLanding({ F, N, label, webp, repo, ACCENT, LINK })));
writeFileSync(join(ROOT, "docs/write-up.html"), finish(renderWriteUp({ F, N, img, label, labelOf, offCenterOf, demo, PAIR_W, ACCENT, LINK, GUIDE, ACCENT_SHARE_LABEL })));
writeFileSync(join(ROOT, "docs/demo.html"), demo.html);
console.log(`wrote docs/index.html, docs/write-up.html and docs/demo.html${INLINE ? " (self-contained)" : ""}, and ${Object.keys(figures).length - 1} figures under docs/assets`);
console.log(JSON.stringify(numbers, null, 1));
