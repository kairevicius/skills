#!/usr/bin/env node
/**
 * optical: measure and correct optical alignment and size.
 *
 *   node optical.mjs measure  <image...> [--bg 255|#hex|auto] [--trim] [--blend 0.5] [--tolerance 0.02] [--json]
 *   node optical.mjs place    <image> --container 96[x40] --element 72[x24] [--plate #hex] [--shape rect|circle]
 *                             [--offset auto|<x%>,<y%>] [--scale 4] [--out pair.png] [--json]
 *   node optical.mjs check    <rendered.png> --bg <#hex|lum|auto> [--max 1] [--json]
 *   node optical.mjs check    --spread <image...> [--bg #hex] [--max 3] [--json]
 *   node optical.mjs equalize <image...> [--height 40] [--max-width N] [--bg #hex] [--strength 0.5]
 *                             [--target fit|median|<file>] [--grow] [--json]
 *   node optical.mjs strip    <image...> --out strip.png [--height 40] [--gap 48] [--bg #fff] [--scale 2]
 *                             [--max-width N] [--sizing visual|height] [--centering visual|box] [--target ...] [--json]
 *   node optical.mjs tile     <image> --out tile.png [--size 256] [--art 0.76] [--plate #fff] [--centering visual|box]
 *   node optical.mjs frame    <photo> --out avatar.png [--size 256] [--bg #hex] [--tolerance 0.15] [--zoom 1] [--circle]
 *
 * Run it from any directory: sharp resolves from this file's folder. Warnings go to
 * stderr, results to stdout. `check` exits with code 1 when the gate fails.
 */
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import sharp from "sharp";
import {
    equalize, formatMeasure, measureFile, offCenter, renderFrame, renderPlacement, renderStrip, renderTile, sizeSpread, GATES,
} from "./lib.mjs";

const fail = (message, code = 2) => {
    console.error(`optical: ${message}`);
    process.exit(code);
};

let parsed;
try {
    parsed = parseArgs({
        allowPositionals: true,
        options: {
            bg: { type: "string" }, plate: { type: "string" }, out: { type: "string" },
            trim: { type: "boolean", default: false }, json: { type: "boolean", default: false },
            height: { type: "string" }, "max-width": { type: "string" }, strength: { type: "string" }, target: { type: "string" },
            size: { type: "string" }, art: { type: "string" }, gap: { type: "string" }, scale: { type: "string" },
            centering: { type: "string" }, sizing: { type: "string" }, metric: { type: "string" }, grow: { type: "boolean", default: false },
            blend: { type: "string" }, tolerance: { type: "string" }, zoom: { type: "string" }, circle: { type: "boolean", default: false },
            container: { type: "string" }, element: { type: "string" }, shape: { type: "string" }, offset: { type: "string" },
            max: { type: "string" }, spread: { type: "boolean", default: false },
        },
    });
} catch (error) {
    fail(`${error.message}. See the usage at the top of scripts/optical.mjs.`);
}
const { values: o, positionals } = parsed;
const [command, ...files] = positionals;
const usage = () => fail("usage: optical <measure|place|check|equalize|strip|tile|frame> <image...> [options] (see the top of scripts/optical.mjs)");
if (!command || files.length === 0) usage();

const num = (v, d) => {
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n)) fail(`"${v}" is not a number`);
    return n;
};
/** "96" → 96; "96x40" → [96, 40]. */
const dims = (v, name) => {
    if (v === undefined) fail(`${command} needs --${name}`);
    const parts = String(v).toLowerCase().split("x").map(Number);
    if (parts.some((n) => !Number.isFinite(n) || n <= 0) || parts.length > 2) fail(`--${name} must look like 96 or 96x40, not "${v}"`);
    return parts.length === 1 ? parts[0] : parts;
};
const round = (v) => (typeof v === "number" ? Math.round(v * 1e4) / 1e4 : v);
const plain = (m) => JSON.parse(JSON.stringify(m, (k, v) => (["png", "raw", "data"].includes(k) ? undefined : round(v))));
const warn = (file, warnings = []) => warnings.forEach((w) => console.error(`warning: ${basename(file)}: ${w}`));
const verdict = (pct, max) => `${pct <= max ? "PASS" : "FAIL"} at ${max}%`;
const sign = (v, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

try {
    if (command === "measure") {
        const results = [];
        for (const file of files) {
            const m = await measureFile(file, { bg: o.bg, trim: o.trim, blend: o.blend === undefined ? undefined : num(o.blend), tolerance: o.tolerance === undefined ? undefined : num(o.tolerance) });
            warn(file, m.warnings);
            results.push(m);
            if (!o.json) console.log(formatMeasure(m, files.length > 1 ? `\n${basename(file)}` : ""));
        }
        if (o.json) console.log(JSON.stringify(results.map(plain), null, 2));
    } else if (command === "place") {
        let offset = "auto";
        if (o.offset && o.offset !== "auto") {
            const [x, y] = o.offset.split(",").map((s) => Number(s.replace("%", "")));
            if (!Number.isFinite(x) || !Number.isFinite(y)) fail(`--offset must be auto or two percentages like -0.5%,3.4%, not "${o.offset}"`);
            offset = { x, y };
        }
        const plate = o.plate ?? o.bg ?? "#ffffff";
        const p = await renderPlacement(files[0], {
            container: dims(o.container, "container"), element: dims(o.element, "element"), plate,
            shape: o.shape ?? (o.circle ? "circle" : "rect"), offset, scale: num(o.scale, 4), blend: o.blend === undefined ? undefined : num(o.blend),
        });
        warn(files[0], p.warnings);
        if (o.out) {
            const { width: w, height: h } = await sharp(p.before.png).metadata();
            const gap = Math.round(8 * p.scale);
            await sharp({ create: { width: w * 2 + gap, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
                .composite([{ input: p.before.png, left: 0, top: 0 }, { input: p.after.png, left: w + gap, top: 0 }]).png().toFile(o.out);
        }
        const label = offset === "auto" ? "optical" : "given offset";
        if (o.json) {
            console.log(JSON.stringify(plain({ ...p, before: { pct: p.before.pct, px: p.before.px }, after: { pct: p.after.pct, px: p.after.px }, css: `transform: translate(${p.offset.x.toFixed(2)}%, ${p.offset.y.toFixed(2)}%);` }), null, 2));
        } else {
            console.log(`element          ${p.element.width.toFixed(1)}x${p.element.height.toFixed(1)}px in a ${p.container.width}x${p.container.height}px container, plate ${plate}, rendered at ${p.scale}x`);
            console.log(`geometric        off center ${p.before.pct.toFixed(2)}% (${p.before.px.toFixed(2)}px)  ${verdict(p.before.pct, GATES.offCenterPct)}`);
            console.log(`${label.padEnd(16)} off center ${p.after.pct.toFixed(2)}% (${p.after.px.toFixed(2)}px)  ${verdict(p.after.pct, GATES.offCenterPct)}`);
            console.log(`offset           x ${sign(p.offset.x)}% (${sign(p.offset.px.x)}px), y ${sign(p.offset.y)}% (${sign(p.offset.px.y)}px) of the element box`);
            // A placement that already passes needs no offset: a sub-pixel value here is rounding, not a correction.
            if (offset === "auto" && p.before.pct <= GATES.offCenterPct) console.log("css              none needed: geometric centering is already within the gate. Leave the layout as it is.");
            else console.log(`css              transform: translate(${p.offset.x.toFixed(2)}%, ${p.offset.y.toFixed(2)}%);`);
            if (o.out) console.log(`wrote ${o.out}  (left: geometric, right: ${label})`);
        }
    } else if (command === "check") {
        if (o.spread) {
            const max = num(o.max, GATES.sizeSpreadPct);
            const ms = [];
            for (const file of files) { const m = await measureFile(file, { bg: o.bg }); warn(file, m.warnings); ms.push(m); }
            const sizes = ms.map((m) => m.perceivedSize), spread = sizeSpread(sizes), ok = spread <= max;
            if (o.json) console.log(JSON.stringify({ sizes: sizes.map(round), spread: round(spread), max, pass: ok }, null, 2));
            else {
                ms.forEach((m) => console.log(`${basename(m.file).padEnd(24)} perceived size ${m.perceivedSize.toFixed(2)}px`));
                console.log(`size spread      ${spread.toFixed(2)}%  ${verdict(spread, max)}`);
            }
            process.exit(ok ? 0 : 1);
        }
        const max = num(o.max, GATES.offCenterPct);
        let failed = false;
        const out = [];
        for (const file of files) {
            const m = await measureFile(file, { bg: o.bg });
            warn(file, m.warnings);
            // With no ink against the background there is nothing to verify, so it cannot pass.
            const off = offCenter(m), ok = m.alphaArea > 0 && off.pct <= max;
            failed ||= !ok;
            out.push({ file, pct: round(off.pct), px: round(off.px), max, pass: ok, residual: { x: round(m.offset.x), y: round(m.offset.y) } });
            if (o.json) continue;
            if (m.alphaArea === 0) console.log(`${basename(file).padEnd(24)} not measurable: no ink against this background  FAIL`);
            else console.log(`${basename(file).padEnd(24)} off center ${off.pct.toFixed(2)}% (${off.px.toFixed(2)}px)  ${verdict(off.pct, max)}${ok ? "" : `  residual to correct: x ${sign(m.offset.x, 1)}px, y ${sign(m.offset.y, 1)}px`}`);
        }
        if (o.json) console.log(JSON.stringify(out, null, 2));
        process.exit(failed ? 1 : 0);
    } else if (command === "equalize") {
        const measured = [];
        for (const file of files) { const m = await measureFile(file, { bg: o.bg, trim: true }); warn(file, m.warnings); measured.push(m); }
        const rows = equalize(measured, {
            height: num(o.height, 40), maxWidth: num(o["max-width"], Infinity),
            strength: num(o.strength, 0.5), target: o.target ?? "fit", metric: o.metric ?? "contrast", grow: o.grow,
        });
        if (o.json) {
            console.log(JSON.stringify(rows.map((r) => plain({ ...r, path: r.file, css: { ink: r.rendered, file: { width: r.full.width * r.scale, height: r.full.height * r.scale } } })), null, 2));
        } else {
            const fmt = (w, h) => `${w.toFixed(1)}x${h.toFixed(1)}`;
            console.log(`target visual size ${rows[0].target.toFixed(1)}px at row height ${num(o.height, 40)}px`);
            console.log("file".padEnd(20) + "equal-height".padStart(14) + "visual size".padStart(13) + "correction".padStart(12) + "ink (w x h)".padStart(16) + "file (w x h)".padStart(16));
            for (const r of rows) {
                const eq = `${Math.round(r.inkBox.width * r.baseline)}x${Math.round(r.inkBox.height * r.baseline)}`;
                console.log(basename(r.file).padEnd(20) + eq.padStart(14) + r.baselineSize.toFixed(1).padStart(13) + `x${r.correction.toFixed(3)}${r.clamped ? "*" : ""}`.padStart(12)
                    + fmt(r.rendered.width, r.rendered.height).padStart(16) + fmt(r.full.width * r.scale, r.full.height * r.scale).padStart(16));
            }
            console.log("ink: the visible artwork at its new size. file: the whole file at the same scale, padding included; use it to size an <img> of the file as it is.");
            if (rows.some((r) => r.clamped)) console.log("* clamped: it would have to grow past its cell to match, so it stays at equal height (pass --grow to allow it)");
        }
    } else if (command === "strip") {
        if (!o.out) fail("strip needs --out <file.png>");
        const s = await renderStrip(files, {
            height: num(o.height, 40), gap: num(o.gap, 48), bg: o.bg ?? "#ffffff", strength: num(o.strength, 0.5),
            maxWidth: num(o["max-width"], Infinity), sizing: o.sizing ?? "visual", centering: o.centering ?? "visual",
            target: o.target ?? "fit", metric: o.metric ?? "contrast", grow: o.grow, scale: num(o.scale, 1),
        });
        s.rows.forEach((r) => warn(r.file, r.warnings));
        writeFileSync(o.out, s.png);
        const ok = s.verify.spread <= GATES.sizeSpreadPct;
        // The vertical move that puts each logo's visual center on the row centerline, in CSS px.
        const shift = (r, i) => (r.placed.top + r.placed.height / 2 - s.baselines[i]) / s.scale;
        if (o.json) {
            console.log(JSON.stringify(plain({ out: o.out, scale: s.scale, spread: s.verify.spread, pass: ok, logos: s.rows.map((r, i) => ({ file: r.file, css: r.css, translateY: shift(r, i), perceived: s.verify.perceived[i], correction: r.correction })) }), null, 2));
        } else {
            console.log(`wrote ${o.out} (${s.width}x${s.height}px at ${s.scale}x)`);
            console.log("file".padEnd(20) + "ink css (w x h)".padStart(18) + "file css (w x h)".padStart(18) + "translateY".padStart(12) + "perceived".padStart(11));
            s.rows.forEach((r, i) => console.log(basename(r.file).padEnd(20) + `${r.css.ink.width.toFixed(1)}x${r.css.ink.height.toFixed(1)}`.padStart(18)
                + `${r.css.file.width.toFixed(1)}x${r.css.file.height.toFixed(1)}`.padStart(18) + `${shift(r, i).toFixed(2)}px`.padStart(12) + s.verify.perceived[i].toFixed(2).padStart(11)));
            console.log("translateY: the move from a box-centered row to the visual centerline. Negative moves up.");
            console.log(`size spread      ${s.verify.spread.toFixed(2)}% measured on the rendered logos  ${verdict(s.verify.spread, GATES.sizeSpreadPct)}`);
            if (!ok && s.scale === 1) console.log("At 1x, whole-pixel rounding is about 4% of a 24px logo. Render with --scale 2 to check what a 2x screen shows.");
        }
    } else if (command === "tile") {
        if (!o.out) fail("tile needs --out <file.png>");
        const t = await renderTile(files[0], {
            size: num(o.size, 256), art: num(o.art, 0.76), plate: o.plate ?? o.bg ?? "#ffffff", centering: o.centering ?? "visual",
            blend: o.blend === undefined ? undefined : num(o.blend),
        });
        warn(files[0], t.warnings);
        writeFileSync(o.out, t.png);
        console.log(formatMeasure(t.artwork, `1. artwork cropped to its ink and fitted into the art box (${o.centering ?? "visual"} centering): the offset to apply is here`));
        console.log("\n" + formatMeasure(t.result, `2. baked tile ${o.out}: its off center line is the gate`, { verdict: true }));
    } else if (command === "frame") {
        if (!o.out) fail("frame needs --out <file.png>");
        const f = await renderFrame(files[0], {
            size: num(o.size, 256), bg: o.bg ?? "0", tolerance: num(o.tolerance, 0.15), zoom: num(o.zoom, 1), centering: o.centering ?? "visual", circle: o.circle,
        });
        writeFileSync(o.out, f.png);
        console.log(formatMeasure(f.source, `source photo (${o.centering ?? "visual"} framing)`));
        console.log(`crop             ${f.crop.side}x${f.crop.side} at ${f.crop.left},${f.crop.top}${f.clamped ? "  (clamped at the image edge)" : ""}`);
        console.log("\n" + formatMeasure(f.result, `framed ${o.out}`));
    } else {
        usage();
    }
} catch (error) {
    fail(error.message.replace(/^Input file is missing/, "file not found"), 1);
}
