/**
 * Optical alignment core: measure where the eye sees an element's center and
 * how large it reads, then place or scale it from those numbers.
 *
 * Every function works on a raster. SVG input is rasterized first, so vector
 * artwork measures exactly like the PNG a browser would paint from it.
 */
import sharp from "sharp";

/** Rec.601 luma of an sRGB pixel, 0..255. */
export const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Ink below this contrast against the background is a candidate accent: the
 * eye registers it, but faintly next to the mark's dominant tone.
 */
export const ACCENT_CONTRAST = 0.6;
/**
 * The accent discount applies only while faint ink stays a minority of the
 * mark. Above this share it is a second tone the eye reads together with the
 * first, and discounting it swings the whole mark off center (PayPal's two
 * blues), instead of letting an accent hang off the mass (Amazon's smile).
 */
export const ACCENT_MAX_SHARE = 1 / 3;
/**
 * How far the visual center moves from the extent center toward the mass
 * centroid. The eye reads extent as well as mass: a solid triangle placed by
 * its centroid floats a sixth of its height above its neighbours, while a
 * box-centered play icon reads left-heavy. The midpoint settles both, and it
 * is the same weighting the sizing rule uses (geometric mean of ink size and
 * height). A two-tone mark is unaffected: its extent is the box of the ink the
 * eye reads, so a discounted accent moves neither center.
 */
export const CENTER_BLEND = 0.5;
/** Longest edge, in px, an SVG is rasterized to before measuring. */
export const DEFAULT_RASTER_EDGE = 1024;
/** Alpha pixels at or below this are treated as margin when trimming. */
const TRIM_THRESHOLD = 10;
/**
 * A pixel within this contrast of the background is background, not ink, so
 * an opaque export measures correctly against its real background: the plate
 * pixels neither pull the alpha centroid to the box center nor count as faint
 * ink for the accent guard.
 */
export const BACKGROUND_CONTRAST = 0.02;
/**
 * A pixel at least this opaque defines extent. Resampling leaves nearly
 * transparent fringe pixels whose colour is noise after unpremultiplying, and
 * a box that included them would stretch to the fringe of a discounted accent.
 */
export const EXTENT_ALPHA = 128;

const NAMED = { white: "#ffffff", black: "#000000", transparent: null };

/**
 * Parse a background given as a luminance ("255"), a hex color ("#1a1a1a"),
 * or "white" / "black". Returns { r, g, b, lum }.
 */
export function parseColor(input) {
    if (input === undefined || input === null || input === "") return parseColor("255");
    const s = String(input).trim().toLowerCase();
    if (s in NAMED && NAMED[s]) return parseColor(NAMED[s]);
    if (/^\d+(\.\d+)?$/.test(s)) {
        const v = Math.max(0, Math.min(255, Number(s)));
        return { r: v, g: v, b: v, lum: v };
    }
    const hex = s.replace(/^#/, "");
    const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
    if (!/^[0-9a-f]{6}$/.test(full)) throw new Error(`Cannot parse color "${input}" (use a luminance 0..255 or #rrggbb)`);
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return { r, g, b, lum: luminance(r, g, b) };
}

const toHex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Raw RGBA pixels of a PNG buffer. */
export async function toRaw(png) {
    const { data, info } = await sharp(png, { failOn: "none" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
}

/**
 * Load an image file as a PNG buffer plus raw pixels. An SVG is rasterized so
 * its longest edge is `maxEdge`. `trim` removes the transparent (or flat
 * background) margin so the box is the ink box.
 */
export async function loadRaster(file, { maxEdge = DEFAULT_RASTER_EDGE, trim = false } = {}) {
    const meta = await sharp(file, { failOn: "none" }).metadata();
    let pipeline;
    if (meta.format === "svg") {
        const edge = Math.max(meta.width || 1, meta.height || 1);
        pipeline = sharp(file, { failOn: "none", density: (72 * maxEdge) / edge });
    } else {
        pipeline = sharp(file, { failOn: "none" });
    }
    if (trim) pipeline = pipeline.trim({ threshold: TRIM_THRESHOLD });
    const png = await pipeline.ensureAlpha().png().toBuffer();
    return { png, raw: await toRaw(png), format: meta.format };
}

/** Rasterize an SVG string at `scale` times its intrinsic size. */
export async function rasterizeSvg(svg, { scale = 1 } = {}) {
    return sharp(Buffer.from(svg), { density: 72 * scale }).ensureAlpha().png().toBuffer();
}

/**
 * Measure an element against the background luminance it renders on.
 *
 * For each pixel: contrast = |luma - bgLum| / 255 and weight = alpha *
 * contrast^2. The mass centroid is the weighted centroid. Squaring the
 * contrast is how ink competes for the eye: at half contrast a pixel earns a
 * quarter of the weight, so a faint accent hangs off the dominant mass instead
 * of dragging it. Equal-contrast marks reduce to the plain alpha centroid.
 *
 * The accent discount is kept only while faint ink is a minority
 * (ACCENT_MAX_SHARE); otherwise the alpha centroid is the mass. Pixels within
 * BACKGROUND_CONTRAST of the background are not ink, so an opaque export
 * measures like a transparent one. With no visible ink at all the box center
 * is kept.
 *
 * The visual center is the extent center moved `blend` (CENTER_BLEND) of the
 * way toward the mass. The extent is the bounding box of the ink the eye
 * reads: the dominant tone while the discount applies, all ink otherwise.
 * `forceDiscount` applies the accent discount regardless of the guard, for
 * demonstrating what the guard prevents. `backgroundContrast` widens the band
 * of pixels treated as background; a photograph on a plain backdrop needs
 * 0.1 to 0.2, because a backdrop carries grain and gradient that a flat plate
 * does not.
 *
 * Visual size is sqrt of the contrast-weighted ink area, a length in px that
 * scales linearly with the element. Perceived size is the geometric mean of
 * the linear-contrast visual size and the ink height: the quantity the
 * default equalize() rule holds constant across a set, so re-measuring
 * rendered elements and comparing perceived sizes verifies a strip.
 */
export function measure(raw, bgLum, { blend = CENTER_BLEND, forceDiscount = false, backgroundContrast = BACKGROUND_CONTRAST } = {}) {
    const { data, width, height } = raw;
    let w = 0, wx = 0, wy = 0;
    let aw = 0, ax = 0, ay = 0;
    let cw = 0;
    let accent = 0;
    let left = width, top = height, right = -1, bottom = -1;
    let dLeft = width, dTop = height, dRight = -1, dBottom = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const a = data[i + 3];
            if (a === 0) continue;
            const contrast = Math.abs(luminance(data[i], data[i + 1], data[i + 2]) - bgLum) / 255;
            if (contrast <= backgroundContrast) continue;
            const alpha = a / 255;
            const weight = alpha * contrast * contrast;
            w += weight; wx += weight * x; wy += weight * y;
            aw += alpha; ax += alpha * x; ay += alpha * y;
            cw += alpha * contrast;
            if (contrast < ACCENT_CONTRAST) accent += alpha;
            if (a < EXTENT_ALPHA) continue;
            if (contrast >= ACCENT_CONTRAST) {
                if (x < dLeft) dLeft = x;
                if (x > dRight) dRight = x;
                if (y < dTop) dTop = y;
                if (y > dBottom) dBottom = y;
            }
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    const box = { x: width / 2, y: height / 2 };
    const alphaCentroid = aw > 0 ? { x: ax / aw + 0.5, y: ay / aw + 0.5 } : { ...box };
    const massCentroid = w > 0 ? { x: wx / w + 0.5, y: wy / w + 0.5 } : { ...alphaCentroid };
    const accentShare = aw > 0 ? accent / aw : 0;
    const discounted = w > 0 && (forceDiscount || accentShare <= ACCENT_MAX_SHARE);
    const mass = discounted ? massCentroid : alphaCentroid;
    const inkBox = right >= 0
        ? { left, top, width: right - left + 1, height: bottom - top + 1 }
        : { left: 0, top: 0, width, height };
    const dominantBox = dRight >= 0
        ? { left: dLeft, top: dTop, width: dRight - dLeft + 1, height: dBottom - dTop + 1 }
        : inkBox;
    const extentBox = discounted ? dominantBox : inkBox;
    const extent = right >= 0
        ? { x: extentBox.left + extentBox.width / 2, y: extentBox.top + extentBox.height / 2 }
        : { ...box };
    const visual = { x: extent.x + blend * (mass.x - extent.x), y: extent.y + blend * (mass.y - extent.y) };
    return {
        width,
        height,
        bgLum,
        box,
        alphaCentroid,
        massCentroid,
        mass,
        extent,
        extentBox,
        visual,
        blend,
        accentShare,
        discounted,
        alphaArea: aw,
        visualArea: w,
        contrastArea: cw,
        visualSize: Math.sqrt(w),
        sizes: { alpha: Math.sqrt(aw), contrast: Math.sqrt(cw), visual: Math.sqrt(w) },
        perceivedSize: Math.sqrt(Math.sqrt(cw) * inkBox.height),
        inkBox,
        offset: { x: box.x - visual.x, y: box.y - visual.y },
        offsetPct: { x: ((box.x - visual.x) / width) * 100, y: ((box.y - visual.y) / height) * 100 },
    };
}

/** Measure a file against a background. */
export async function measureFile(file, { bg = "255", trim = false, maxEdge, blend, tolerance } = {}) {
    const color = parseColor(bg);
    const { raw, png } = await loadRaster(file, { trim, maxEdge });
    return { file, color, png, raw, ...measure(raw, color.lum, { blend, backgroundContrast: tolerance }) };
}

/**
 * Frame a photograph for a square or round avatar: crop a square of `zoom`
 * times the shorter side around its visual center instead of around the image
 * center. The subject is whatever contrasts with the backdrop (`bg`, with
 * `tolerance` for grain), weighted by contrast squared with no accent guard:
 * a photograph is a continuous field, and the eye settles on its brightest,
 * highest-contrast region (a face, a collar), not on the silhouette's center
 * of mass, which sits in the torso. This suits portraits and product shots on
 * a plain backdrop; a busy scene needs a face or subject detector instead.
 * The square is clamped inside the image, so the crop moves only as far as
 * the image has room.
 */
export async function renderFrame(file, { size = 256, bg = "0", tolerance = 0.15, zoom = 1, centering = "visual", circle = false, passes = 4 } = {}) {
    const color = parseColor(bg);
    const { png, raw } = await loadRaster(file, { maxEdge: 2048 });
    const options = { backgroundContrast: tolerance, forceDiscount: true };
    const source = measure(raw, color.lum, options);
    const side = Math.round(Math.min(raw.width, raw.height) * Math.min(Math.max(zoom, 0.1), 1));
    const clampX = (v) => Math.round(Math.min(Math.max(v, 0), raw.width - side));
    const clampY = (v) => Math.round(Math.min(Math.max(v, 0), raw.height - side));
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
    const build = async (left, top) => {
        let out = sharp(png).extract({ left, top, width: side, height: side }).resize(size, size);
        if (circle) out = out.composite([{ input: mask, blend: "dest-in" }]);
        return out.png().toBuffer();
    };

    let left = clampX(centering === "visual" ? source.visual.x - side / 2 : (raw.width - side) / 2);
    let top = clampY(centering === "visual" ? source.visual.y - side / 2 : (raw.height - side) / 2);
    let clamped = false;
    if (centering === "visual") {
        // Cropping changes what is inside the frame, and a round mask discards the
        // corners, so one pass does not land the FRAMED result's own visual center on
        // its center. Re-measure the output and correct until the crop stops moving.
        const want = { x: source.visual.x - side / 2, y: source.visual.y - side / 2 };
        clamped = clampX(want.x) !== Math.round(want.x) || clampY(want.y) !== Math.round(want.y);
        for (let i = 0; i < passes; i++) {
            const m = measure(await toRaw(await build(left, top)), color.lum, options);
            const dx = ((m.visual.x - size / 2) * side) / size;
            const dy = ((m.visual.y - size / 2) * side) / size;
            const nextLeft = clampX(left + dx), nextTop = clampY(top + dy);
            if (nextLeft === left && nextTop === top) break;
            if (Math.abs(nextLeft - left - dx) > 0.5 || Math.abs(nextTop - top - dy) > 0.5) clamped = true;
            left = nextLeft;
            top = nextTop;
        }
    }
    const framed = await build(left, top);
    const result = measure(await toRaw(framed), color.lum, options);
    return { png: framed, source, crop: { left, top, side }, clamped, result, bg: color };
}

const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Scale a set of measured elements so they read the same size.
 *
 * Each element first gets its equal-height baseline: the scale that fits its
 * ink box in `height` (and `maxWidth`). Its baseline visual size is then
 * compared with the target (`fit`: the smallest baseline size, so nothing has
 * to grow past its cell; `median`: the middle one, growth clamped at the
 * cell; a file name: that element's size, so an icon set can anchor on its
 * keyline square). The correction is (target / size) ^ strength: 1 equalizes
 * the ink measure exactly, 0 leaves equal heights. The default 0.5 equalizes
 * the geometric mean of ink size and height, because the eye reads extent as
 * well as mass: pure ink equalization shrinks a wide wordmark until it reads
 * smaller than a compact solid mark of the same ink area. The default metric
 * is linear contrast (ink weighted by how strongly it registers); the squared
 * weighting that anchors centering exaggerates colour differences in size.
 * `grow` lets an element exceed its cell to match; otherwise it is clamped.
 */
export function equalize(items, { height = 40, maxWidth = Infinity, strength = 0.5, target = "fit", metric = "contrast", grow = false } = {}) {
    const rows = items.map((m) => {
        const baseline = Math.min(height / m.inkBox.height, maxWidth / m.inkBox.width);
        const size = m.sizes?.[metric] ?? m.visualSize;
        return { ...m, baseline, baselineSize: size * baseline };
    });
    const sizes = rows.map((r) => r.baselineSize);
    let goal;
    if (target === "fit") goal = Math.min(...sizes);
    else if (target === "median") goal = median(sizes);
    else {
        const anchor = rows.find((r) => r.file === target || (r.file && r.file.endsWith("/" + target)) || r.name === target);
        if (!anchor) throw new Error(`equalize: no element named "${target}" to anchor on`);
        goal = anchor.baselineSize;
    }
    return rows.map((r) => {
        let correction = Math.pow(goal / r.baselineSize, strength);
        let clamped = false;
        if (correction > 1 && !grow) { correction = 1; clamped = true; }
        const scale = r.baseline * correction;
        return {
            ...r,
            target: goal,
            correction,
            clamped,
            scale,
            rendered: { width: r.inkBox.width * scale, height: r.inkBox.height * scale },
            renderedSize: r.baselineSize * correction,
        };
    });
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Bake an element onto a square plate the way an avatar or app tile does:
 * trim, fit into an art box of `art` x the tile, then place it by its visual
 * center (or alpha center / box center for comparison). The offset may spend
 * the slack inside the art box and no more, so a skewed mass never pushes the
 * artwork flush to the tile edge.
 */
export async function renderTile(file, { size = 256, art = 0.76, plate = "#ffffff", centering = "visual", blend, passes = 4 } = {}) {
    const color = parseColor(plate);
    const { png } = await loadRaster(file, { trim: true });
    const artBox = Math.round(size * art);
    const artwork = await sharp(png).resize(artBox, artBox, { fit: "inside", background: TRANSPARENT }).png().toBuffer();
    const raw = await toRaw(artwork);
    const m = measure(raw, color.lum, { blend, forceDiscount: centering === "forced" });
    const anchor = centering === "visual" || centering === "forced" ? m.visual
        : centering === "mass" ? m.massCentroid
        : centering === "alpha" ? m.alphaCentroid
        : m.box;
    const inset = Math.round((size - artBox) / 2);
    const place = (c, extent) => Math.min(Math.max(Math.round(size / 2 - c), inset), Math.max(inset, inset + artBox - extent));
    const bake = async (left, top) => sharp({ create: { width: size, height: size, channels: 4, background: toHex(color) } })
        .composite([{ input: artwork, left, top }])
        .flatten({ background: toHex(color) })
        .png()
        .toBuffer();

    let left = place(anchor.x, raw.width);
    let top = place(anchor.y, raw.height);
    let tile = await bake(left, top);
    if (centering === "visual" || centering === "forced") {
        // Placement is integer, and the artwork's anti-aliased edges blend into the
        // plate once composited, so the BAKED tile's own visual center is not exactly
        // where the artwork measured alone put it. Re-measure the tile and correct
        // until the placement stops moving or the inset clamp holds it.
        for (let i = 0; i < passes; i++) {
            const r = measure(await toRaw(tile), color.lum, { blend, forceDiscount: centering === "forced" });
            const nextLeft = Math.min(Math.max(Math.round(left - (r.visual.x - r.box.x)), inset), Math.max(inset, inset + artBox - raw.width));
            const nextTop = Math.min(Math.max(Math.round(top - (r.visual.y - r.box.y)), inset), Math.max(inset, inset + artBox - raw.height));
            if (nextLeft === left && nextTop === top) break;
            left = nextLeft;
            top = nextTop;
            tile = await bake(left, top);
        }
    }
    const result = measure(await toRaw(tile), color.lum, { blend, forceDiscount: centering === "forced" });
    return { png: tile, artwork: m, placed: { left, top }, result, plate: color };
}

/**
 * Lay logos out on shared baselines. `sizing: "height"` gives every logo the same
 * ink-box height (the geometric default); `sizing: "visual"` equalizes visual size,
 * always across the WHOLE set so wrapping into rows cannot change a logo's scale.
 * `centering` places each logo's visual or box center on its row's centerline.
 *
 * `columns` wraps the set into rows of that many logos; each row is centered, so a
 * short last row does not read as left-aligned. `paddingY` sets the plate's own top and
 * bottom room, since the horizontal padding also decides the canvas width, and `rowGap`
 * sets the space BETWEEN rows independently of it. `canvasWidth` forces the output width,
 * which is how two strips meant to be compared render at the SAME on-screen scale: the
 * page shows every figure at one width, so a wider canvas would silently shrink its
 * contents relative to a narrower one.
 */
export async function renderStrip(files, {
    height = 40, gap = 48, padding = 32, paddingY = padding, rowGap = paddingY * 2, bg = "#ffffff", strength = 0.5, maxWidth = Infinity,
    sizing = "visual", centering = "visual", target = "fit", metric = "contrast", grow = false,
    columns = Infinity, canvasWidth,
} = {}) {
    const color = parseColor(bg);
    const loaded = await Promise.all(files.map(async (file) => {
        const { png, raw } = await loadRaster(file, { trim: true });
        return { file, png, ...measure(raw, color.lum) };
    }));
    const rows = equalize(loaded, { height, maxWidth, strength: sizing === "visual" ? strength : 0, target, metric, grow });
    // Vertical padding is separate: raising it gives the plate more room without widening
    // the canvas, which would shrink every logo once the page scales the figure to one width.
    // `rowGap` is separate again, because stacking uniform padded bands puts twice the outer
    // padding between two rows and the pair then reads as two plates rather than one group.
    const perRow = Math.max(1, Math.min(columns, rows.length));

    // Scale every logo first, so a row's width is known before it is placed.
    const scaled = [];
    for (const r of rows) {
        const w = Math.max(1, Math.round(r.rendered.width));
        const h = Math.max(1, Math.round(r.rendered.height));
        const png = await sharp(r.png).resize(w, h, { fit: "fill" }).png().toBuffer();
        scaled.push({ r, png, w, h, m: measure(await toRaw(png), color.lum) });
    }
    const groups = [];
    for (let i = 0; i < scaled.length; i += perRow) groups.push(scaled.slice(i, i + perRow));
    const groupWidth = (g) => g.reduce((sum, s) => sum + s.w, 0) + gap * (g.length - 1);
    const width = Math.round(canvasWidth ?? Math.max(...groups.map(groupWidth)) + padding * 2);

    const comps = [];
    const baselines = [];
    for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const centerY = paddingY + height / 2 + gi * (height + rowGap);
        let x = (width - groupWidth(g)) / 2;
        for (const s of g) {
            const anchorY = centering === "visual" ? s.m.visual.y : s.m.box.y;
            const top = Math.round(centerY - anchorY);
            const left = Math.round(x);
            comps.push({ input: s.png, left, top });
            s.r.placed = {
                left, top, width: s.w, height: s.h,
                box: { x: left + s.w / 2, y: top + s.h / 2 },
                visual: { x: left + s.m.visual.x, y: top + s.m.visual.y },
            };
            baselines.push(centerY);
            x += s.w + gap;
        }
    }
    const totalHeight = Math.round(paddingY * 2 + height * groups.length + rowGap * (groups.length - 1));
    const png = await sharp({ create: { width, height: totalHeight, channels: 4, background: toHex(color) } })
        .composite(comps)
        .flatten({ background: toHex(color) })
        .png()
        .toBuffer();
    return { png, rows, width, height: totalHeight, rowHeight: height + rowGap, baselines, bg: color };
}

const f1 = (n) => n.toFixed(1);
const pct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/** Human-readable report for one measurement. */
export function formatMeasure(m, label = "") {
    const lines = [];
    if (label) lines.push(label);
    lines.push(`image            ${m.width}x${m.height}, background luminance ${f1(m.bgLum)}`);
    lines.push(`ink box          ${m.inkBox.width}x${m.inkBox.height} at ${m.inkBox.left},${m.inkBox.top}`);
    lines.push(`box center       ${f1(m.box.x)}, ${f1(m.box.y)}`);
    lines.push(`alpha centroid   ${f1(m.alphaCentroid.x)}, ${f1(m.alphaCentroid.y)}`);
    lines.push(`mass centroid    ${f1(m.mass.x)}, ${f1(m.mass.y)}${m.discounted ? "  (contrast-weighted, accent discounted)" : "  (accent discount off: faint ink is " + Math.round(m.accentShare * 100) + "% of the mark, alpha centroid used)"}`);
    lines.push(`extent center    ${f1(m.extent.x)}, ${f1(m.extent.y)}  (box of the ink the eye reads, ${m.extentBox.width}x${m.extentBox.height})`);
    lines.push(`visual center    ${f1(m.visual.x)}, ${f1(m.visual.y)}  (extent moved ${m.blend} of the way to mass)`);
    lines.push(`faint-ink share  ${Math.round(m.accentShare * 100)}% below contrast ${ACCENT_CONTRAST}`);
    lines.push(`visual size      ${f1(m.sizes.contrast)}px (sqrt of contrast-weighted ink area)`);
    lines.push(`perceived size   ${f1(m.perceivedSize)}px (geometric mean of visual size and ink height; equal across an equalized set)`);
    lines.push(`offset to apply  x ${m.offset.x >= 0 ? "+" : ""}${f1(m.offset.x)}px (${pct(m.offsetPct.x)}), y ${m.offset.y >= 0 ? "+" : ""}${f1(m.offset.y)}px (${pct(m.offsetPct.y)})  (positive y moves the element down)`);
    return lines.join("\n");
}
