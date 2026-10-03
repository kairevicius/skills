#!/usr/bin/env node
/**
 * optical — measure and correct optical alignment.
 *
 *   node optical.mjs measure  <image...> [--bg 255|#hex] [--trim] [--blend 0.5] [--tolerance 0.02] [--json]
 *   node optical.mjs frame    <photo> --out avatar.png [--size 256] [--bg #hex] [--tolerance 0.15] [--zoom 1] [--centering visual|box] [--circle]
 *   node optical.mjs equalize <image...> [--height 40] [--max-width N] [--bg #hex] [--strength 0.5] [--metric contrast|alpha|visual] [--target fit|median|<file>] [--grow] [--json]
 *   node optical.mjs tile     <image> --out tile.png [--size 256] [--art 0.76] [--plate #fff] [--centering visual|mass|alpha|box] [--blend 0.5]
 *   node optical.mjs strip    <image...> --out strip.png [--height 40] [--gap 48] [--bg #fff] [--strength 0.5] [--sizing visual|height] [--centering visual|box] [--target fit|median|<file>]
 *
 * Run it from any directory; sharp resolves from this file's folder.
 */
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { equalize, formatMeasure, measureFile, renderFrame, renderStrip, renderTile } from "./lib.mjs";

const { values: o, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        bg: { type: "string" }, plate: { type: "string" }, out: { type: "string" },
        trim: { type: "boolean", default: false }, json: { type: "boolean", default: false },
        height: { type: "string" }, "max-width": { type: "string" }, strength: { type: "string" }, target: { type: "string" },
        size: { type: "string" }, art: { type: "string" }, gap: { type: "string" },
        centering: { type: "string" }, sizing: { type: "string" }, metric: { type: "string" }, grow: { type: "boolean", default: false },
        blend: { type: "string" }, tolerance: { type: "string" }, zoom: { type: "string" }, circle: { type: "boolean", default: false },
    },
});
const [command, ...files] = positionals;
const num = (v, d) => (v === undefined ? d : Number(v));
const usage = () => {
    console.error("usage: optical <measure|equalize|tile|strip|frame> <image...> [options]  (see the file header)");
    process.exit(2);
};
if (!command || files.length === 0) usage();

const round = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const strip = (m) => JSON.parse(JSON.stringify(m, (k, v) => (k === "png" || k === "raw" || k === "data" ? undefined : round(v))));

if (command === "measure") {
    const results = [];
    for (const file of files) {
        const m = await measureFile(file, { bg: o.bg, trim: o.trim, blend: o.blend === undefined ? undefined : Number(o.blend), tolerance: o.tolerance === undefined ? undefined : Number(o.tolerance) });
        results.push(m);
        if (!o.json) console.log(formatMeasure(m, files.length > 1 ? `\n${basename(file)}` : ""));
    }
    if (o.json) console.log(JSON.stringify(results.map(strip), null, 2));
} else if (command === "equalize") {
    const measured = [];
    for (const file of files) measured.push(await measureFile(file, { bg: o.bg, trim: true }));
    const rows = equalize(measured, {
        height: num(o.height, 40), maxWidth: num(o["max-width"], Infinity),
        strength: num(o.strength, 0.5), target: o.target ?? "fit", metric: o.metric ?? "contrast", grow: o.grow,
    });
    if (o.json) {
        console.log(JSON.stringify(rows.map(strip), null, 2));
    } else {
        console.log(`target visual size ${rows[0].target.toFixed(1)}px at row height ${num(o.height, 40)}px`);
        console.log("file".padEnd(18) + "equal-height".padStart(14) + "visual size".padStart(13) + "correction".padStart(12) + "render (w x h)".padStart(18));
        for (const r of rows) {
            const eq = `${Math.round(r.inkBox.width * r.baseline)}x${Math.round(r.inkBox.height * r.baseline)}`;
            const rd = `${r.rendered.width.toFixed(1)}x${r.rendered.height.toFixed(1)}`;
            console.log(basename(r.file).padEnd(18) + eq.padStart(14) + r.baselineSize.toFixed(1).padStart(13) + `x${r.correction.toFixed(3)}${r.clamped ? "*" : ""}`.padStart(12) + rd.padStart(18));
        }
        if (rows.some((r) => r.clamped)) console.log("* clamped: would have to grow past its cell to match, so it stays at equal height");
    }
} else if (command === "tile") {
    if (!o.out) usage();
    const t = await renderTile(files[0], {
        size: num(o.size, 256), art: num(o.art, 0.76), plate: o.plate ?? o.bg ?? "#ffffff", centering: o.centering ?? "visual",
        blend: o.blend === undefined ? undefined : Number(o.blend),
    });
    writeFileSync(o.out, t.png);
    console.log(formatMeasure(t.artwork, `artwork inside the art box (${o.centering ?? "visual"} centering)`));
    console.log("\n" + formatMeasure(t.result, `baked tile ${o.out}`));
} else if (command === "strip") {
    if (!o.out) usage();
    const s = await renderStrip(files, {
        height: num(o.height, 40), gap: num(o.gap, 48), bg: o.bg ?? "#ffffff", strength: num(o.strength, 0.5),
        maxWidth: num(o["max-width"], Infinity), sizing: o.sizing ?? "visual", centering: o.centering ?? "visual",
        target: o.target ?? "fit", metric: o.metric ?? "contrast", grow: o.grow,
    });
    writeFileSync(o.out, s.png);
    console.log(`wrote ${o.out} (${s.width}x${s.height})`);
    for (const r of s.rows) console.log(`${basename(r.file).padEnd(18)} ${r.placed.width}x${r.placed.height} at ${r.placed.left},${r.placed.top}  correction x${r.correction.toFixed(3)}`);
} else if (command === "frame") {
    if (!o.out) usage();
    const f = await renderFrame(files[0], {
        size: num(o.size, 256), bg: o.bg ?? "0", tolerance: num(o.tolerance, 0.15), zoom: num(o.zoom, 1), centering: o.centering ?? "visual", circle: o.circle,
    });
    writeFileSync(o.out, f.png);
    console.log(formatMeasure(f.source, `source photo (${o.centering ?? "visual"} framing)`));
    console.log(`crop             ${f.crop.side}x${f.crop.side} at ${f.crop.left},${f.crop.top}`);
    console.log("\n" + formatMeasure(f.result, `framed ${o.out}`));
} else {
    usage();
}
