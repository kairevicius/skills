/**
 * Builds docs/index.html and every figure under docs/assets from the skill's
 * own measurement code, so each number on the page is a real measurement of
 * the image beside it. Re-run after any change to lib.mjs:
 *
 *   node scripts/build-docs.mjs   # writes docs/assets/*.png, then docs/index.html with them embedded
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import renderV2 from "./page-v2.mjs";
import { renderDemo } from "./build-demo.mjs";
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

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Optical balance</title>
<style>
:root { --paper: #fbfbfb; --ink: #1a1a1a; --muted: #6b6b6b; --faint: #a3a3a3; --hair: #e4e4e4; --accent: ${ACCENT}; --link: ${LINK}; --guide: ${GUIDE}; }
* { box-sizing: border-box; }
html { color-scheme: light; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 880px; margin: 0 auto; padding: 72px 32px 96px; }
h1 { font-size: 28px; font-weight: 600; line-height: 1.2; margin: 0 0 12px; letter-spacing: -0.01em; }
h2 { font-size: 20px; font-weight: 600; line-height: 1.3; margin: 72px 0 8px; letter-spacing: -0.005em; }
h3 { font-size: 16px; font-weight: 600; margin: 40px 0 8px; }
p { margin: 0 0 14px; max-width: 640px; }
.lede { font-size: 20px; line-height: 1.45; color: var(--ink); max-width: 680px; margin-bottom: 8px; }
.muted { color: var(--muted); }
small, figcaption, .caption, pre, table { font-size: 13px; }
figcaption { color: var(--muted); margin-top: 8px; line-height: 1.45; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; align-items: start; margin: 40px 0 16px; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; align-items: start; margin: 48px 0 40px; }
.steps figure { min-width: 0; }
.steps figcaption { max-width: none; }
@media (max-width: 720px) { .steps { grid-template-columns: 1fr; } }
.pair figure { min-width: 0; }
.pair.stack { grid-template-columns: minmax(0, ${PAIR_W * 2}px); row-gap: 28px; }
figure { margin: 0; }
figure.wide { margin: 40px 0 16px; }
/* Two stacked strips are tall blocks; the pair needs a clear break, not a hairline. */
figure.wide + figure.wide { margin-top: 64px; }
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
/* The markers cycle in and out on their own, so the figure is readable bare and
   then annotated without the reader operating anything. */
@keyframes marker-cycle {
    0%, 4% { opacity: 0; filter: blur(10px); }
    16%, 52% { opacity: 1; filter: blur(0); }
    64%, 100% { opacity: 0; filter: blur(10px); }
}
.overlay { animation: marker-cycle 7s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
@media (prefers-reduced-motion: reduce) {
    .overlay { animation: none; opacity: 1; filter: none; }
}
.legend { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
.legend .legend-box { vertical-align: middle; margin: 0 6px 0 0; }
.label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; font-size: 13px; font-weight: 600; color: var(--ink); margin: 0 0 8px; letter-spacing: 0.01em; }
.label .score { font-weight: 500; color: var(--faint); font-variant-numeric: tabular-nums; }
pre { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: transparent; margin: 14px 0; padding: 0; white-space: pre; overflow-x: auto; color: var(--ink); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; }
table { border-collapse: collapse; margin: 16px 0; width: 100%; max-width: 640px; }
th, td { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--hair); vertical-align: top; font-variant-numeric: tabular-nums; }
th { font-weight: 600; color: var(--muted); }
td.num, th.num { text-align: right; padding-right: 0; padding-left: 12px; }
/* A right-aligned column that is not the last one still needs a gutter. */
td.num:not(:last-child), th.num:not(:last-child) { padding-right: 20px; }
.scroll { overflow-x: auto; }
ul { padding-left: 20px; max-width: 640px; }
li { margin: 4px 0; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
<h1>Optical balance</h1>
<p class="lede">Center and size by what the eye sees, not by the bounding box. This is how the method works, which constants it uses and why each was chosen, and the measured evidence for every claim. Each figure is real output of the script, and each number beside it is a measurement of that image.</p>

<h2>The box is not the ink</h2>
<p>Five marks, each centered by its bounding box, the way a layout system does it. All five sit on their plate's exact center, and the outlines fade in to show it. Two of them look centered: the circle and the diamond are symmetric, so their ink is where their box says it is. The other three are not, and each misses for a different reason.</p>
<figure class="wide">${img(F["intro-test"], F.introTest.w, F.introTest.h, "Five marks centered by their bounding boxes")}</figure>

<p>A triangle centered by its box reads ${Math.abs(Number(N.intro["step-box"].dy))}px below the plate center, because most of its ink sits low. The same triangle placed on its center of mass floats ${Math.abs(Number(N.intro["step-mass"].dy))}px high, because the eye reads where a shape ends and not only where its weight is. And a dark mark with a faint accent, centered on all its ink counted equally, still sits ${Math.abs(Number(N.intro["step-ink"].dy))}px high.</p>
<div class="steps">
${fig(F["step-box"], F.stepSize.w, F.stepSize.h, `A triangle centered by its box. Most of its ink sits low, so the shape reads ${Math.abs(Number(N.intro["step-box"].dy))}px below the plate center.`, "Triangle centered by its bounding box")}
${fig(F["step-mass"], F.stepSize.w, F.stepSize.h, `The same triangle on its center of mass. Now it floats ${Math.abs(Number(N.intro["step-mass"].dy))}px high: the eye reads where a shape ends, not only where its weight is.`, "Triangle centered on its center of mass")}
${fig(F["step-ink"], F.stepSize.w, F.stepSize.h, `A dark mark with a faint accent, centered on all its ink counted equally. The dark part still sits ${Math.abs(Number(N.intro["step-ink"].dy))}px high; the accent should hang off it.`, "Two-tone mark centered on its plain centroid")}
</div>

<p>The answer follows from the three. The visual center is the midpoint of the extent center and the mass centroid, where mass weights each pixel by the square of its contrast against the background it sits on. The skill measures it, applies the offset where placement is decided, and re-measures the result. It never nudges by eye.</p>

<p class="legend"><svg class="legend-box" width="20" height="12" viewBox="0 0 20 12" aria-hidden="true"><rect x="0.5" y="0.5" width="19" height="11" fill="none" stroke="#a6a6a6" stroke-dasharray="3 2"/></svg>the element's bounding box, what the code centered, with the space around it measured in the figure's own pixels</p>
<p class="legend">Above each figure, <strong>Geometric</strong> is what centering the bounding box gives and <strong>Optical</strong> is what the eye reads as centered. <strong>Off center</strong> is how far the element's visual center sits from its container's center, as a share of the container's shorter side; a corrected figure lands within a pixel or two, which is as close as whole-pixel placement gets. Each figure cycles on its own between the plain render and its measurements, so nothing has to be switched on to read it.</p>
<h2>Centering</h2>

<h3>A two-tone mark on a plate</h3>
<p>The Amazon wordmark is black; its smile is orange. On a white plate the smile has a third of the wordmark's contrast, so the eye reads the letters and lets the smile hang below. Centering the bounding box puts the letters too high. Centering the alpha centroid counts the smile at full strength and still leaves them ${Math.abs(N.amazon.result.alpha.dy)}px high on this tile. Weighting each pixel by the square of its contrast, and taking the extent from the letters alone, lands the letters on the center line.</p>
<div class="pair">
${fig(F["amazon-box"], PAIR_W, PAIR_W, `Box centered. The ink's visual center sits ${Math.abs(N.amazon.result.box.dy)}px above the tile center.`, "Amazon wordmark box-centered on a white tile", "tile")}
${fig(F["amazon-visual"], PAIR_W, PAIR_W, `Visual center on the tile center, ${Math.abs(N.amazon.result.visual.dy)}px off. The letters sit on the line, the smile hangs below.`, "Amazon wordmark optically centered", "tile")}
</div>
<p>Nineteen percent down is the "the logo should sit a bit lower" instinct with a number attached. The fix lives in the tile bake, so every future asset gets it for free.</p>

<h3>The same mark in dark mode</h3>
<p>The background is an input, not a detail. On a white plate the smile has a contrast of ${N.amazonDark.smileContrastLight} and is discounted as an accent. On a black plate the inverted mark's smile has a contrast of ${N.amazonDark.smileContrastDark}, above the accent threshold of ${ACCENT_CONTRAST}, so it counts as part of the mark and the letters move down only ${N.amazonDark.dyPct}% instead of ${N.amazon.dyPct}%. One logo, two themes, two offsets: bake a tile per theme, or store the offset per theme in the component.</p>
<div class="pair">
${fig(F["amazon-dark-box"], PAIR_W, PAIR_W, `Box centered on black. The visual center sits ${Math.abs(Number(N.amazonDark.boxDy))}px above the tile center.`, "Inverted Amazon wordmark box-centered on a black tile", "tile")}
${fig(F["amazon-dark-visual"], PAIR_W, PAIR_W, `Visual center on the tile center, ${Math.abs(Number(N.amazonDark.visualDy))}px off. The smile counts, so the letters sit higher than on white.`, "Inverted Amazon wordmark optically centered on a black tile", "tile")}
</div>

<h3>When not to discount</h3>
<p>The discount exists for accents. PayPal's lighter blue is not an accent: it is ${N.paypal.accentShare}% of the mark, a second tone the eye reads together with the first. Discounting it would move the visual center ${Math.abs(Number(N.paypal.massShiftPct))}% of the width toward the darker monogram and push the wordmark off its plate. The skill keeps the discount only while faint ink stays under a third of the mark (${Math.round(ACCENT_MAX_SHARE * 100)}%, below contrast ${ACCENT_CONTRAST}); above that, all ink is the mark, and the balanced plate moves the wordmark only ${Math.abs(Number(N.paypal.shiftPct))}% of its width toward the heavier monogram. Shown on a wide plate: a wordmark fills a square tile's width, so a horizontal correction has room only on a plate wider than the mark.</p>
<div class="pair">
${fig(F["paypal-box"], PAIR_W, Math.round(PAIR_W / 2), `Box centered on a wide plate. The visual center sits ${Math.abs(Number(N.paypal.plainDx))}px left of the plate center: the monogram is heavier than the letters.`, "PayPal wordmark box-centered on a white plate", "tile")}
${fig(F["paypal-visual"], PAIR_W, Math.round(PAIR_W / 2), `Moved ${Math.abs(Number(N.paypal.dx))}px right. Visual center ${Math.abs(Number(N.paypal.keptDx))}px from the plate center. Both blues count; the guard kept the discount off.`, "PayPal wordmark optically centered on a white plate", "tile")}
</div>

<h3>Icons in round buttons</h3>
<p>A play triangle has two thirds of its area in its left half. Box-centered, it looks pushed left, so designers nudge it right and argue about how much. Placing its center of mass on the button center is too much: the eye also sees where the triangle ends. Halfway between the two, the answer is ${N.icons.play.dx}px for a 24px icon, ${N.icons.play.dxPctIcon}% of the icon. An arrow is the mirror case: its head is heavier than its shaft, so it moves ${Math.abs(Number(N.icons.arrow.dx))}px left.</p>
<div class="pair">
${fig(F["play-before"], PAIR_W, PAIR_W, `Play, box centered. Visual center ${Math.abs(Number(N.icons.play.beforeOff))}px left of the button center.`, "Play icon box-centered in a round button")}
${fig(F["play-after"], PAIR_W, PAIR_W, `Play, moved ${N.icons.play.dx}px right. Visual center ${Math.abs(Number(N.icons.play.afterOff))}px from the button center.`, "Play icon optically centered")}
</div>
<div class="pair">
${fig(F["arrow-before"], PAIR_W, PAIR_W, `Arrow, box centered. Visual center ${Math.abs(Number(N.icons.arrow.beforeOff))}px right of the button center.`, "Arrow icon box-centered in a round button")}
${fig(F["arrow-after"], PAIR_W, PAIR_W, `Arrow, moved ${Math.abs(Number(N.icons.arrow.dx))}px left. Visual center ${Math.abs(Number(N.icons.arrow.afterOff))}px from the button center.`, "Arrow icon optically centered")}
</div>
<p class="muted">Enlarged; the button is 64px and the icon 24px.</p>
<p>Put the offset in the icon component, keyed by icon name, and every button that renders a play icon is fixed. The percentages carry to any render size.</p>

<h3>A caps label in a pill</h3>
<p>Line-height centering centers the em box, which has room for descenders. Capitals have none, so they ride high in a pill or a tag. Here, at ${N.pill.font}px, the label sits ${Math.abs(Number(N.pill.dy))}px above the visual center, ${Math.abs(Number(N.pill.dyEm))}em. Letter-spacing adds the same gap after the last letter as between letters, so the text also sits ${Math.abs(Number(N.pill.dx))}px left of center. Both are measured at once.</p>
<div class="pair">
${fig(F["pill-before"], PAIR_W, Math.round(PAIR_W * 32 / 104), `Centered by the em box. The capitals ride ${Math.abs(Number(N.pill.dy))}px high and ${Math.abs(Number(N.pill.dx))}px left.`, "Caps label centered by em box in a pill")}
${fig(F["pill-after"], PAIR_W, Math.round(PAIR_W * 32 / 104), `Moved ${Math.abs(Number(N.pill.dy))}px down and ${Math.abs(Number(N.pill.dx))}px right. Re-measured: ${Math.abs(Number(N.pill.afterDy))}px from center.`, "Caps label optically centered in a pill")}
</div>
<p class="muted">Enlarged; the pill is 32px tall.</p>
<p>Express the correction in em in the tag component, and it holds at every font size. Measure once per typeface: the metric that causes it belongs to the font, not the label.</p>

<h3>Initials in an avatar disc</h3>
<p>When there is no logo, the product draws initials on a colored disc. A letter centered by its em box and its advance width is not visually centered: J leans right and hangs low, L is all stem and foot on the left, A is bottom heavy with a thin apex. At ${N.initials.font}px semibold the corrections are mostly vertical and run to about ${Math.max(...N.initials.per.map((r) => Math.abs(Number(r.dyEm)))).toFixed(2)}em; the figure carries each letter's own. Each letter needs its own offset, so measure the glyph set once per typeface and store the offsets by letter.</p>
<div class="pair stack">
${fig(F["initials-before"], PAIR_W * 2, Math.round((PAIR_W * 2) * F.initialsSize.h / F.initialsSize.w), `Em box and advance width centered: the letters ride high and J and L lean.`, "Initials centered by em box in colored discs")}
${fig(F["initials-after"], PAIR_W * 2, Math.round((PAIR_W * 2) * F.initialsSize.h / F.initialsSize.w), `Each letter moved by its own offset.`, "Initials optically centered in colored discs")}
</div>

<h3>Vercel's mark on a tile</h3>
<p>A real mark, measured as it ships and then corrected. Vercel's icon is a white triangle on a black disc, so the container the correction has to satisfy is the disc: the disc is centered on its tile geometrically, and the triangle is placed inside the disc. A triangle keeps its weight along the base, so its box center and its mass centroid disagree by ${N.vercel.gap}px on a ${N.vercel.mark} mark, and the correction is ${Math.abs(Number(N.vercel.dy))}px upward, ${N.vercel.dyPct}% of the height. Box centered in a ${N.vercel.disc}px disc the triangle reads ${N.vercel.beforePct}% off its center. Corrected it reads ${N.vercel.afterPct}%.</p>
<div class="pair">
${fig(F["vercel-box"], PAIR_W, PAIR_W, `Box centered in the disc: the triangle's visual center sits ${N.vercel.beforePx}px low, so the mark hangs toward the bottom of the circle.`, "Vercel's triangle box-centered in a black disc", "tile")}
${fig(F["vercel-visual"], PAIR_W, PAIR_W, `Moved up. Visual center ${N.vercel.afterPx}px from the disc center.`, "Vercel's triangle optically centered in a black disc", "tile")}
</div>
<p>The disc is worth noticing on its own. It is a self-backgrounded shape, symmetric on both axes, so it needs no correction and gets none: the skill's decision points say to skip an element like it. Only what sits inside it is measured. Nothing here is specific to Vercel either. Any mark whose weight sits away from its box center behaves the same way, and a triangle is simply the clearest case: an app icon, a favicon and an avatar all place it in a circle or a square, and all of them inherit the same error until the placement rule is fixed rather than the instance.</p>

<h2>Side by side</h2>

<h3>An icon beside a label</h3>
<p>A button's content is an icon and a word. Equal padding centers the content box, but the word is heavier than the icon, so the eye sees the content sitting toward the text. The measured fix is asymmetric padding: ${N.button.padIcon}px on the icon side and ${N.button.padText}px on the text side instead of ${N.button.pad}px each, a ${Math.abs(Number(N.button.dx))}px move. This is the case designers describe as "slightly less padding on the icon side"; here it has a number.</p>
<div class="pair">
${fig(F["button-before"], PAIR_W, Math.round(PAIR_W * 48 / 140), `Equal padding, ${N.button.pad}px each side. The content's visual center sits ${Math.abs(Number(N.button.beforeOff))}px right of the button center.`, "Button with icon and label, content box centered")}
${fig(F["button-after"], PAIR_W, Math.round(PAIR_W * 48 / 140), `Padding ${N.button.padIcon}px left, ${N.button.padText}px right. Visual center ${Math.abs(Number(N.button.afterOff))}px from the button center.`, "Button with icon and label, content optically centered")}
</div>
<p>Measure once per icon-and-label pattern and put the asymmetry in the button component. Krehel's rule, fix it in the SVG or the component and never in the instance, applies unchanged.</p>

<h3>A symbol beside a wordmark</h3>
<p>A logo lockup is the same problem at brand scale. The wordmark has ascenders, so its box center sits above the lowercase mass; align the symbol to that box center and it rides high. Slack's own lockup does not: its symbol sits within ${N.lockup.brands[0].visual}% of the word's height from the word's visual center, while box centers would be ${N.lockup.brands[0].box}% apart. Rebuilt here from the brand's parts at the brand's gap: Default aligns the two boxes, Balanced aligns the two visual centers, and the second is the one the brand shipped.</p>
<div class="pair">
${fig(F["lockup-before"], PAIR_W, Math.round(PAIR_W / 2), `Box centers aligned. The symbol's visual center sits ${Math.abs(Number(N.lockup.defaultOff))}px above the word's, ${Math.abs(Number(N.lockup.defaultOffPct))}% of the word's height.`, "Slack symbol box-aligned to the wordmark", "tile")}
${fig(F["lockup-after"], PAIR_W, Math.round(PAIR_W / 2), `Visual centers aligned, ${Math.abs(Number(N.lockup.afterOff))}px apart. The symbol sits on the lowercase mass, where Slack put it.`, "Slack symbol visually aligned to the wordmark", "tile")}
</div>
<p>Slack and Airbnb sit their symbols on the word's visual center: Slack within ${N.lockup.brands[0].visual}%, Airbnb within ${Math.abs(Number(N.lockup.brands[2].cross))}% using the symbol's box, because the Bélo's mass sits low in its own box. Shopify follows another rule: the bag is ${N.lockup.brands[1].symShare}% of the word's height and its base sits near the descender line, so neither center matches, and that is a choice, not an error. When a brand has no rule yet, align visual centers and store the offset in the lockup asset, not in each placement.</p>

<h2>Sizing</h2>

<h3>A logo strip</h3>
<p>Give nine logos the same height and the strip is uneven: a solid mark reads huge, all-caps wordmarks shout, lowercase wordmarks look bigger than mixed marks. The size rule shrinks each logo to the visual size of the lightest one, measured across the whole set so wrapping the row cannot change a logo's scale. No logo has to grow past its cell, and every logo is placed by its visual center, so the Amazon letters sit on the line while the smile hangs below. Both strips are drawn on one canvas width, because the page shows every figure at the same width and a wider canvas would shrink its contents against the other.</p>
<figure class="wide">${label(F["strip-before"])}${img(F["strip-before"], F.stripSize.width, F.stripSize.height, "Nine logos on two rows at equal height, box centered")}</figure>
<figure class="wide">${label(F["strip-after"])}${img(F["strip-after"], F.stripSize.width, F.stripSize.height, "Nine logos on two rows at equal visual size, visually centered")}</figure>
<div class="scroll"><table>
<tr><th>logo</th><th class="num">equal height</th><th class="num">visual size</th><th class="num">scale</th><th class="num">rendered</th></tr>
${N.strip.map((r) => `<tr><td>${r.name}</td><td class="num">${r.equal}</td><td class="num">${r.size}</td><td class="num">×${r.correction}</td><td class="num">${r.rendered}</td></tr>`).join("\n")}
</table></div>
<p>The rule raises the size difference to a half power rather than equalizing ink area outright, because the eye reads extent as well as mass and full equalization overshoots. That default was chosen by rendering seven variants of this strip side by side: <a href="${F["sizing-experiment"]}">the experiment sheet</a> shows equal height, then alpha, linear-contrast and squared-contrast ink area at powers 1 and 0.5.</p>
<p class="muted">Sizes in px at a 40px row. Visual size is the square root of the contrast-weighted ink area at equal height; the target is the smallest, ${N.stripTarget}px. Set the rendered heights as the strip's per-logo sizes, or pass the scale factors to the layout.</p>

<h2>Framing</h2>

<h3>Cropping a portrait for an avatar</h3>
<p>An uploaded photo is rarely framed for a circle: a wide frame, the person off to one side, and a center crop shows mostly wall. The same measurement frames it. The subject is whatever contrasts with the backdrop, weighted by contrast squared and with no accent guard, because a photograph is a continuous field and the eye settles on its brightest, highest-contrast region. The crop square is placed around that visual center, as far as the image has room. For a person that center sits at the chest and collar, so the face lands in the upper part of the circle, where a portrait wants it.</p>
<div class="pair">
${fig(F["frame-box"], PAIR_W, PAIR_W, `Center crop at ${N.frame.zoom}% of the short side: backdrop and half a figure. The visual center sits ${N.frame.beforeOffPct}% of the avatar off its center.`, "Portrait center-cropped into a round avatar")}
${fig(F["frame-visual"], PAIR_W, PAIR_W, `Crop moved ${N.frame.moved} in the source. Visual center ${N.frame.afterOffPct}% off the avatar center.`, "Portrait cropped around its visual center into a round avatar")}
</div>
<p>This works for a plain backdrop: casual portraits against a wall, product shots on white, scans. It centers a subject, not a face: a studio portrait that is already composed tightly gains nothing, and a busy scene needs a face or subject detector, with the rule placing the crop around what the detector returns. The source here is Vermeer's <em>Girl with a Pearl Earring</em> (public domain), extended by ${N.frame.extend}px on the left and ${N.frame.extendRight}px on the right with its own backdrop to stand in for a wide upload.</p>

<h2>The method</h2>
<p>Three stages, in this order: measure the element against the background it renders on, apply the measured offset where placement is decided, then re-measure the rendered result. The third stage is not a formality. Compositing changes an element's own measurement, so a correction that is right in the source can still land wrong in the output.</p>

<h3>What is measured</h3>
<p>One pass over the pixels of a raster. Vector input is rasterized first, at a ${DEFAULT_RASTER_EDGE}px longest edge, so an SVG measures exactly like the bitmap a browser would paint from it. Each pixel contributes two weights, because position and size do not want the same one.</p>
<pre>luma      = 0.299 R + 0.587 G + 0.114 B        Rec. 601
contrast  = |luma − background luma| / 255     0 to 1
                                               at or below ${BACKGROUND_CONTRAST} the pixel IS the background
mass weight    w = alpha × contrast²           position
size weight    s = alpha × contrast            size</pre>
<div class="steps">
${fig(F["weight-mark"], F.methodPanel.w, F.methodPanel.h, `The mark as it renders on the plate.`, "The Amazon wordmark on a white plate")}
${fig(F["weight-alpha"], F.methodPanel.w, F.methodPanel.h, `Every visible pixel at full strength: the smile weighs as much as the letters.`, "Weight map counting every visible pixel equally")}
${fig(F["weight-contrast"], F.methodPanel.w, F.methodPanel.h, `Weighted by contrast squared: the letters keep ${N.method.letterWeight} and the smile drops to ${N.method.smileWeight}.`, "Weight map weighted by contrast squared")}
</div>
<p>The middle panel is the previous method and the right one is this one. Both are the same pixels; only the weight differs. Squaring the contrast for position is how ink competes for the eye: at half contrast a pixel earns a quarter of the weight, so a faint accent hangs off the dominant tone instead of dragging it. Size uses linear contrast, because the squared form exaggerates colour differences into size differences, and a coral wordmark would read a third smaller than a black one of the same shape.</p>
<p>Skipping near-background pixels is what lets an opaque export measure like a transparent one. Without it, a baked-in white plate pulls every centroid toward the box center.</p>

<h3>Where the eye sees the center</h3>
<p>Two readings, then their midpoint. Mass is where the weight is; extent is where the shape ends. Each alone is wrong, and wrong in opposite directions.</p>
<pre>alpha centroid   Σ(alpha · p) / Σ alpha
mass centroid    Σ(w · p) / Σ w
accent share     Σ alpha where contrast &lt; ${ACCENT_CONTRAST}  ÷  Σ alpha
mass             accent share ≤ ${ACCENT_SHARE_LABEL} ? mass centroid : alpha centroid
extent           center of the ink box, counting pixels with alpha ≥ ${EXTENT_ALPHA}
                 (the dominant tone alone, while the discount applies)
visual center    extent + ${CENTER_BLEND} × (mass − extent)
offset           container center − visual center     positive y moves down</pre>
<figure class="wide">${img(F["method-centers"], F.methodDiagram.w, F.methodDiagram.h, "The extent center, the mass centroid and the visual center on one mark")}</figure>
<p>Vercel's triangle, because its two readings disagree by ${N.method.gapPct}% of its height. The dashed box is the extent and its center sits at y ${N.method.extentY}; the mass centroid sits at y ${N.method.massY}, low, where a triangle keeps its weight. The visual center is the midpoint at y ${N.method.visualY}, and placement moves the element until that point lands on the container's center. On the Amazon mark above the same two readings agree within a few pixels, which is why this diagram uses a triangle.</p>
<p>The accent guard is the conditional on the mass line. A discount exists for an accent, not for a second tone: above a third of the mark, faint ink is something the eye reads together with the rest, and discounting it swings the whole mark off center. Two fallbacks close the chain. With no weight at all the alpha centroid stands in, and with no visible ink the box center is kept.</p>
<p>Extent takes only pixels at least half opaque. Resampling leaves nearly transparent fringe pixels whose colour is noise once unpremultiplied, and a box that counted them would stretch to the fringe of an accent that was just discounted.</p>

<h3>How large it reads</h3>
<p>Ink size is a length, so it scales linearly with the element and two elements can be compared directly. Perceived size adds the extent reading, for the same reason the center does.</p>
<pre>ink size         √ Σ s
perceived size   √( ink size × ink height )
baseline         min( row height ÷ ink height , max width ÷ ink width )
correction       ( target size ÷ baseline size ) ^ 0.5</pre>
<p>Every element in a set is first fitted to the row, then compared against a target: the smallest baseline size, so nothing has to grow past its cell, or a named element when the set has a keyline to anchor on. The half power is the same weighting as the center's midpoint. Equalizing ink area outright overshoots, because it ignores that the eye reads extent too.</p>

<h3>The constants</h3>
<p>Six numbers decide everything above. None was picked by taste; each is listed with the measurement that set it.</p>
<div class="scroll"><table>
<tr><th>constant</th><th class="num">value</th><th>decides</th><th>set by</th></tr>
<tr><td>background contrast</td><td class="num">${BACKGROUND_CONTRAST}</td><td>what is background rather than ink</td><td>low enough that an opaque export measures like a transparent one</td></tr>
<tr><td>extent alpha</td><td class="num">${EXTENT_ALPHA}</td><td>which pixels define extent</td><td>half opaque, so a resampling fringe cannot stretch the box</td></tr>
<tr><td>accent contrast</td><td class="num">${ACCENT_CONTRAST}</td><td>what counts as faint ink</td><td>the Amazon smile measures ${N.amazonDark.smileContrastLight} on white and ${N.amazonDark.smileContrastDark} inverted on black, so the threshold separates the two</td></tr>
<tr><td>accent max share</td><td class="num">${ACCENT_SHARE_LABEL}</td><td>when a second tone stops being an accent</td><td>PayPal's lighter blue is ${N.paypal.accentShare}% of its mark and must not be discounted</td></tr>
<tr><td>center blend</td><td class="num">${CENTER_BLEND}</td><td>how far from extent toward mass</td><td>box centering and mass centering miss a triangle by ${Math.abs(Number(N.intro["step-box"].dy))}px and ${Math.abs(Number(N.intro["step-mass"].dy))}px in opposite directions</td></tr>
<tr><td>size power</td><td class="num">0.5</td><td>how hard a set is equalized</td><td>chosen from seven variants rendered side by side, in the experiment sheet linked from the logo strip above</td></tr>
</table></div>

<h3>The procedure</h3>
<ol>
<li>Confirm the case wants a correction. A disc badge, a full-bleed image and anything else that carries its own background has no placement to fix.</li>
<li>Measure the element against the luminance of the surface it renders on. The background is an input, not a detail: the same mark on white and on black gives different answers.</li>
<li>Apply the offset where placement is decided, which is the asset bake, the shared component, the icon set or the layout, and never the instance.</li>
<li>Re-measure the rendered result and correct the residual until it stops moving.</li>
<li>Accept on a tolerance rather than a zero, and record what the output measured.</li>
</ol>

<h2>Why zero is not reachable</h2>
<p>Every corrected figure above lands within a pixel or two of its container's center rather than exactly on it. Three things account for the gap, and only one of them is worth fixing.</p>
<p><strong>Whole-pixel placement.</strong> An element is composited at integer coordinates, so up to half a pixel of the correction is rounded away. On a ${N.amazonClamp.tile}px tile one pixel is ${N.amazonClamp.onePx}% of the width, so a figure reading 0.1% is sub-pixel and nothing a reader can see.</p>
<p><strong>Edges take the plate's colour.</strong> An anti-aliased edge pixel is part artwork and part background, so compositing changes its contrast and moves the baked result's own visual center slightly off where the artwork measured alone. This part is correctable, by re-measuring the finished figure and shifting by the residual until it stops moving. Every path on this page does it, which took the PayPal plate from ${N.paypal.onePassPx}px to ${N.paypal.convergedPx}px.</p>
<p><strong>A clamp.</strong> The correction may spend the artwork's slack inside its safe area and no more. The Amazon wordmark is ${N.amazonClamp.artWidth}px wide in a ${N.amazonClamp.artBox}px art box, so horizontally it is pinned and its ${N.amazonClamp.dx}px residual has nowhere to go. Vertically, where it has room, it converges to ${N.amazonClamp.dy}px.</p>
<p>So accept a correction on a tolerance rather than on a zero. Within about 1% of the container is the gate this skill uses, and a residual under one pixel is below what the grid can express.</p>

<h2>Verification</h2>
<p>A correction is done when the output measures right, not when the arithmetic looks right. Four gates, in the order they catch things.</p>
<ul>
<li><strong>Re-measure the rendered result.</strong> Measure the baked asset or a settled screenshot against its real background, not the source. Verifying the source hides clamping, rounding and any interference from the layer that draws it.</li>
<li><strong>Converge rather than assume.</strong> One pass lands close, because compositing and a round mask both change the element's own measurement. Every path here re-measures its own output and shifts until the placement stops moving.</li>
<li><strong>Check a set on perceived size.</strong> Re-measuring an equalized set is the only proof the sizes match; the corrections that produced it prove nothing on their own.</li>
<li><strong>Regenerate.</strong> One command rebuilds every figure and every number on this page from the source artwork. A number that cannot be regenerated is not evidence, and prose is where stale numbers hide.</li>
</ul>

<h2>Apply it where placement is decided</h2>
<p>The offset is a translation of the element, positive y down. Put it in the rule, never in the instance, so every future asset inherits it.</p>
<pre>/* CSS: a component that knows its own optical offset */
.icon-play { transform: translateX(${N.icons.play.dxPctIcon}%); }

/* SVG: bake the shift into the symbol */
&lt;g transform="translate(${N.icons.play.dx} 0)"&gt;…&lt;/g&gt;

/* Asset bake (sharp): place by the measured visual center */
left = round(tile / 2 - visual.x); top = round(tile / 2 - visual.y);

/* Figma or Paper: nudge the layer by the px value at the measured size,
   or type the % into a constraint. Scale px with the render size; % is free. */</pre>

<h2>Run it</h2>
<pre>cd optical-balance/scripts &amp;&amp; npm install        # once: sharp

node optical.mjs measure  logo.svg --bg 255           # where the eye sees the center
node optical.mjs measure  logo.png --bg "#141414"     # against the real background
node optical.mjs equalize a.svg b.svg c.svg --height 40   # equal visual size at a 40px row
node optical.mjs tile     logo.svg --out tile.png     # bake an optically centered plate
node optical.mjs strip    a.svg b.svg c.svg --out strip.png   # render the equalized row
node optical.mjs frame    photo.jpg --out avatar.png --bg "#0a0a08" --tolerance 0.15 --zoom 0.72 --circle   # crop around the visual center</pre>
<p>Measure accepts PNG, JPEG, WebP and SVG. An opaque export is fine when it is measured against the background it was exported on: pixels within 2% of that background count as background, not ink. Verify on the output, not the source: measure the baked asset or a cropped screenshot of the settled UI, and accept when the visual center lands within about 1% of the container. For a set, measure each rendered logo and compare the <code>perceived size</code> line, the geometric mean of visual size and ink height that the size rule holds constant; the nine logos above re-measure at ${N.stripVerify.min} to ${N.stripVerify.max}px.</p>

<h2>Related rules</h2>
<p>Designers already apply these corrections by eye. The skill measures them.</p>
<ul>
<li><strong>Align optically, not geometrically.</strong> Jakub Krehel's polish list gives the icon side of a button slightly less padding and fixes icon shapes in the SVG itself, so no margin is needed. Measure the button's content (icon and label together) against its box and the asymmetric padding is a number. <a href="https://jakub.kr/writing/details-that-make-interfaces-feel-better">jakub.kr</a></li>
<li><strong>Optical centre.</strong> "A play button centred by coordinates looks left-heavy. Nudge it right and it sits." The play button above is that nudge, measured. <a href="http://index.how/to/articulate">index.how</a></li>
<li><strong>Weight is surface times contrast.</strong> Refactoring UI: bold text feels emphasized because it covers more surface; icons are heavy, so soften their colour, or thicken thin strokes while keeping the colour soft. That product is the sizing weight used here.</li>
<li><strong>Dots larger than the stroke.</strong> Helena Zhang's icon series: a dot drawn at the stroke weight looks too small; draw it slightly larger. The same class of correction at the glyph level. <a href="https://minoraxis.medium.com/advanced-icon-design-dots-590cf96bf279">minoraxis</a></li>
</ul>

<h2>Failure modes</h2>
<ul>
<li><strong>Wrong background.</strong> The same Amazon mark measured against black instead of white loses its letters to the background; what remains is edge pixels and the smile, ${N.amazonWrongBg.accentShare}% of it faint, and the offset comes out as ${N.amazonWrongBg.dyPct}% instead of ${N.amazon.dyPct}%. A confident, wrong number. Always pass the luminance of the surface the element renders on.</li>
<li><strong>Alpha-only weighting</strong> under-corrects two-tone marks. It counts faint ink at full strength; this was the original Amazon bug.</li>
<li><strong>Discounting a second tone.</strong> Above a third of the mark, faint ink is a tone, not an accent. The guard is the difference between Amazon and PayPal above.</li>
<li><strong>Centering on mass alone.</strong> A solid triangle placed on its centroid floats a sixth of its height above its neighbours; the eye reads extent too. The visual center is the midpoint of extent and mass, and the same half weighting drives the size rule.</li>
<li><strong>Equalizing ink area alone</strong> shrinks wide wordmarks until they read smaller than a compact solid mark of the same ink. Keep the half power unless a measured reference says otherwise.</li>
<li><strong>Verifying the source</strong> instead of the output hides clamping, rounding and CSS interference.</li>
<li><strong>Hand-nudged instances</strong> are unrepeatable, and every new asset re-imports the bug. Fix the rule.</li>
<li><strong>Self-backgrounded elements</strong> (a disc mark, a full-bleed image) have nothing to correct. Skip them.</li>
<li><strong>Busy photographs.</strong> Framing reads the subject as whatever contrasts with a plain backdrop. A scene with a patterned background has no backdrop to contrast with, and the visual center lands on the busiest region. Use a face or subject detector there and let the rule place the crop around its result.</li>
<li><strong>Hue salience is not modeled.</strong> Contrast here is luminance contrast. A saturated red and a grey of the same luminance weigh the same, and the red reads heavier; equal lightness does not make hues equally salient. Treat the size of a strongly coloured mark as a starting point and confirm it in context.</li>
</ul>

</main>
</body>
</html>
`;
// One deliverable: the figures are embedded, so the page renders wherever it is
// opened or sent. docs/assets keeps the PNGs as inspectable build output.
const inline = (page) => page.replace(/(src|href)="assets\/([^"]+)"/g, (_, attr, name) => `${attr}="data:image/png;base64,${readFileSync(join(OUT, name)).toString("base64")}"`);
writeFileSync(join(ROOT, "docs/index.html"), inline(html));
// The candidate rewrite reads the same figures and numbers, so the two pages differ in prose only.
const demo = await renderDemo();
writeFileSync(join(ROOT, "docs/align-demo.html"), demo.html);
writeFileSync(join(ROOT, "docs/index-v2.html"), inline(renderV2({ F, N, img, label, labelOf, offCenterOf, demo, PAIR_W, ACCENT, LINK, GUIDE, ACCENT_SHARE_LABEL })));
console.log(`wrote docs/index.html, docs/index-v2.html and docs/align-demo.html (self-contained) and ${Object.keys(figures).length - 1} figures under docs/assets`);
console.log(JSON.stringify(numbers, null, 1));
