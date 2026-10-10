// Regression tests for the measurement core and the CLI. Run with `npm test` in scripts/.
// Fixtures are SVG strings built here, plus the MIT-licensed icons in fixtures/icons, so the tests
// run in an installed copy of the skill with no other files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
    measure, measureFile, toRaw, cropToInk, detectBackground, renderPlacement, renderStrip, renderTile, equalize, offCenter, GATES,
} from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ICONS = join(HERE, "..", "fixtures", "icons");
const TMP = mkdtempSync(join(tmpdir(), "optical-test-"));
const file = (name, svg) => { const p = join(TMP, name); writeFileSync(p, svg); return p; };
const svg = (body, w = 120, h = 120) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const cli = (...args) => spawnSync(process.execPath, [join(HERE, "optical.mjs"), ...args], { encoding: "utf8" });
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual.toFixed(3)} is not within ${tolerance} of ${expected}`);

// Solid shapes that fill their own box, so the box center is the ink box center.
const TRIANGLE_UP = file("triangle-up.svg", svg(`<path d="M60 0 L120 120 L0 120 Z" fill="#111"/>`));
const PLAY = file("play.svg", svg(`<path d="M0 0 L120 60 L0 120 Z" fill="#111"/>`));
// Wide and flat like a wordmark, so a tile has room to move it.
const TWO_TONE = file("two-tone.svg", svg(`<rect x="0" y="0" width="240" height="44" fill="#111"/><path d="M40 76 Q120 104 200 76" stroke="#f0a500" stroke-width="12" fill="none" stroke-linecap="round"/>`, 240, 100));

test("a symmetric shape needs no offset", async () => {
    for (const name of ["circle", "square", "diamond"]) {
        const m = await measureFile(join(ICONS, `${name}-fill.svg`), { bg: "255" });
        near(m.offsetPct.x, 0, 0.3, `${name} x`);
        near(m.offsetPct.y, 0, 0.3, `${name} y`);
    }
});

test("a solid triangle moves up by a twelfth of its height", async () => {
    // Box center at 1/2, mass centroid at 2/3 of the height from the apex, visual center halfway: 7/12.
    const m = await measureFile(TRIANGLE_UP, { bg: "255" });
    near(m.offsetPct.y, -100 / 12, 0.5, "offset y %");
    near(m.offsetPct.x, 0, 0.3, "offset x %");
});

test("a play triangle moves right by a twelfth of its width", async () => {
    const m = await measureFile(PLAY, { bg: "255" });
    near(m.offsetPct.x, 100 / 12, 0.5, "offset x %");
    near(m.offsetPct.y, 0, 0.3, "offset y %");
});

test("the accent discount applies to a minority of faint ink and not to a second tone", async () => {
    const accent = file("accent.svg", svg(`<rect x="0" y="0" width="120" height="70" fill="#111"/><rect x="20" y="96" width="80" height="12" fill="#f0a500"/>`));
    const tone = file("tone.svg", svg(`<rect x="0" y="0" width="120" height="60" fill="#111"/><rect x="0" y="60" width="120" height="60" fill="#8fb5ff"/>`));
    const a = await measureFile(accent, { bg: "255" }), t = await measureFile(tone, { bg: "255" });
    assert.equal(a.discounted, true, "a small faint bar is an accent");
    assert.ok(a.accentShare <= 1 / 3);
    assert.equal(t.discounted, false, "half the ink in a light tone is a second tone");
    assert.ok(t.accentShare > 1 / 3);
});

test("an opaque export measures like the transparent artwork", async () => {
    const transparent = await sharp(Buffer.from(svg(`<path d="M30 20 L100 60 L30 100 Z" fill="#111"/>`))).png().toBuffer();
    const opaque = await sharp(transparent).flatten({ background: "#ffffff" }).png().toBuffer();
    const a = measure(await toRaw(transparent), 255), b = measure(await toRaw(opaque), 255);
    near(b.visual.x, a.visual.x, 0.6, "visual x");
    near(b.visual.y, a.visual.y, 0.6, "visual y");
});

test("a white icon on the default white background warns instead of passing silently", async () => {
    const white = file("white.svg", svg(`<path d="M30 20 L100 60 L30 100 Z" fill="#fff"/>`));
    await assert.rejects(measureFile(white), /no ink/);
    const dark = await measureFile(white, { bg: "#111111" });
    assert.equal(dark.warnings.length, 0);
    const black = await measureFile(file("black.svg", svg(`<path d="M30 20 L100 60 L30 100 Z" fill="#000"/>`)), { bg: "255" });
    near(dark.offsetPct.x, black.offsetPct.x, 0.2, "white on dark measures like black on white");
    assert.ok(Math.abs(dark.offsetPct.x) > 0.3, "the offset is not the silent zero");
});

test("an image with its own background warns, and --bg auto reads that background", async () => {
    const tile = join(TMP, "blue-tile.png");
    await sharp({ create: { width: 200, height: 200, channels: 3, background: "#2b5cff" } })
        .composite([{ input: Buffer.from(svg(`<path d="M60 40 L160 100 L60 160 Z" fill="#fff"/>`, 200, 200)) }]).png().toFile(tile);
    const plain = await measureFile(tile);
    assert.ok(plain.warnings.some((w) => w.includes("its own opaque background")), plain.warnings.join(" | "));
    const own = detectBackground(plain.raw);
    assert.equal(own.opaque, true);
    const auto = await measureFile(tile, { bg: "auto" });
    near(auto.color.lum, own.color.lum, 1, "auto background luminance");
    assert.ok(auto.inkBox.width < 120, "against its own background, only the glyph is ink");
});

test("cropping keeps an opaque tile whole and removes background-colored padding", async () => {
    const png = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
        .composite([{ input: Buffer.from(svg(`<rect x="20" y="30" width="60" height="40" fill="#3a57fc"/><rect x="40" y="45" width="20" height="10" fill="#fff"/>`, 100, 100)) }]).png().toBuffer();
    const { crop } = await cropToInk(png, await toRaw(png), 255);
    assert.deepEqual(crop, { left: 20, top: 30, width: 60, height: 40 }, "the crop is the blue tile, not the white glyph inside it");
});

test("place finds an offset that passes the gate, and verifies a given offset", async () => {
    const auto = await renderPlacement(TRIANGLE_UP, { container: 96, element: 60, plate: "#f2f2f2" });
    assert.ok(auto.before.pct > GATES.offCenterPct, `geometric should fail: ${auto.before.pct}`);
    assert.ok(auto.after.pct <= GATES.offCenterPct, `optical should pass: ${auto.after.pct}`);
    near(auto.offset.y, -100 / 12, 0.8, "offset y % of the element box");
    const given = await renderPlacement(TRIANGLE_UP, { container: 96, element: 60, plate: "#f2f2f2", offset: { x: auto.offset.x, y: auto.offset.y } });
    assert.ok(given.after.pct <= GATES.offCenterPct);
});

test("a baked tile passes the gate", async () => {
    const t = await renderTile(TWO_TONE, { size: 256 });
    assert.ok(offCenter(t.result).pct <= GATES.offCenterPct, `off center ${offCenter(t.result).pct}`);
    assert.equal(t.artwork.discounted, true, "the faint orange curve is an accent on white");
});

test("a logo strip equalizes perceived size within the gate", async () => {
    const logos = [
        file("bar.svg", svg(`<rect x="0" y="40" width="240" height="40" fill="#111"/>`, 240, 120)),
        file("block.svg", svg(`<rect x="10" y="10" width="100" height="100" fill="#111"/>`)),
        file("ring.svg", svg(`<circle cx="60" cy="60" r="52" fill="none" stroke="#111" stroke-width="8"/>`)),
        file("word.svg", svg(`<rect x="0" y="30" width="60" height="60" fill="#2b5cff"/><rect x="80" y="30" width="60" height="60" fill="#2b5cff"/><rect x="160" y="30" width="60" height="60" fill="#2b5cff"/>`, 220, 120)),
    ];
    const s = await renderStrip(logos, { height: 40, scale: 2 });
    assert.ok(s.verify.spread <= GATES.sizeSpreadPct, `size spread ${s.verify.spread}`);
    const before = await renderStrip(logos, { height: 40, sizing: "height" });
    assert.ok(before.verify.spread > 20, `equal height should be uneven: ${before.verify.spread}`);
});

test("the documented icon calibration still holds", async () => {
    const icons = ["square", "circle", "diamond", "star"].map((n) => join(ICONS, `${n}-fill.svg`));
    const measured = [];
    for (const f of icons) measured.push(await measureFile(f, { trim: true }));
    const rows = equalize(measured, { height: 16, target: icons[0], grow: true });
    const expected = [1, 1.059, 1.146, 1.173];
    rows.forEach((r, i) => near(r.correction, expected[i], 0.01, `${icons[i].split("/").pop()} correction`));
});

test("the CLI exits 1 on a failed check and 0 on a pass", async () => {
    const pass = join(TMP, "tile-visual.png"), failing = join(TMP, "tile-box.png");
    assert.equal(cli("tile", TWO_TONE, "--out", pass).status, 0);
    assert.equal(cli("tile", TWO_TONE, "--out", failing, "--centering", "box").status, 1);
    assert.equal(cli("check", pass, "--bg", "255").status, 0);
    const r = cli("check", failing, "--bg", "255");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL at 1%/);
});

test("the CLI reports a missing file and a bad option without a stack trace", () => {
    const missing = cli("measure", join(TMP, "nope.png"));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^optical: file not found/);
    const bad = cli("measure", PLAY, "--bogus");
    assert.equal(bad.status, 2);
    assert.doesNotMatch(bad.stderr, /at .*node:internal/);
});

/** A small padded raster logo, the kind that ships in a logo wall. */
async function paddedLogo(name, body, size = 48) {
    const p = join(TMP, name);
    await sharp(Buffer.from(svg(body, size, size))).png().toFile(p);
    return p;
}

test("strip reports the size spread of its final composited pixels", async () => {
    const logos = [
        await paddedLogo("wide.png", `<rect x="4" y="18" width="40" height="12" fill="#2b5cff"/>`),
        await paddedLogo("tall.png", `<rect x="18" y="6" width="12" height="36" fill="#111"/>`),
        await paddedLogo("dot.png", `<circle cx="24" cy="24" r="14" fill="#e33"/>`),
    ];
    const s = await renderStrip(logos, { height: 32, scale: 2 });
    const sizes = [];
    for (const r of s.rows) {
        const p = r.placed;
        const png = await sharp(s.png).extract({ left: p.left, top: p.top, width: p.width, height: p.height }).png().toBuffer();
        sizes.push(measure(await toRaw(png), 255).perceivedSize / 2);
    }
    const independent = (Math.max(...sizes) - Math.min(...sizes)) / Math.min(...sizes) * 100;
    near(s.verify.spread, independent, 0.05, "strip spread against an independent as-placed check");
});

test("place measures the artwork inside a file that has its own backdrop", async () => {
    const tile = join(TMP, "badge.png");
    await sharp({ create: { width: 96, height: 96, channels: 3, background: "#0061fe" } })
        .composite([{ input: Buffer.from(svg(`<path d="M30 20 L80 48 L30 76 Z" fill="#fff"/>`, 96, 96)) }]).png().toFile(tile);
    const p = await renderPlacement(tile, { container: 96, element: 72, plate: "#f2f2f2" });
    assert.ok(p.inside, "the backdrop is detected");
    assert.ok(p.inside.pct > 1, `the triangle inside the badge is off center: ${p.inside.pct}`);
});

test("a tinted backdrop close to the plate's lightness still warns", async () => {
    const tile = join(TMP, "warm.png");
    await sharp({ create: { width: 48, height: 48, channels: 3, background: { r: 248, g: 243, b: 240 } } })
        .composite([{ input: Buffer.from(svg(`<circle cx="24" cy="24" r="12" fill="#111"/>`, 48, 48)) }]).png().toFile(tile);
    const m = await measureFile(tile, { bg: "#f2f2f2" });
    assert.ok(m.warnings.some((w) => w.includes("close to the background")), m.warnings.join(" | "));
});

test("the CLI accepts a negative offset without '=' and prints its usage with --help", () => {
    const r = cli("place", TRIANGLE_UP, "--container", "96", "--element", "60", "--offset", "-0.5,-8.3");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /given offset/);
    const help = cli("--help");
    assert.equal(help.status, 0);
    assert.match(help.stdout, /node optical\.mjs place/);
});

test("a solid shape that fills its frame is not mistaken for a backdrop", async () => {
    const m = await measureFile(join(ICONS, "square-fill.svg"), { bg: "255" });
    assert.ok(!m.warnings.some((w) => w.includes("own opaque background")), m.warnings.join(" | "));
});
