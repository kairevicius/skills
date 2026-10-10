import { chromium } from 'playwright-core';
import { renderPlacement, measureFile, offCenter } from './lib.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const fixture = new URL('fixtures/icons/triangle-fill.svg', root).pathname;
const placement = await renderPlacement(fixture, { container: 96, element: 60, plate: '#fff', fg: '#111', scale: 2 });
const icon = await readFile(fixture, 'utf8');
const css = `translate(${placement.offset.x}%, ${placement.offset.y}%)`;
const executablePath = process.env.OPTICAL_CHROMIUM;
let browser;
try {
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
} catch (error) {
    if (!/executable.*(doesn.t exist|not found)|ENOENT/i.test(error.message)) throw error;
    throw new Error(`Chromium was not found${executablePath ? ` at OPTICAL_CHROMIUM=${executablePath}` : ' by playwright-core'}. Run npx playwright-core install chromium from this scripts folder, or set OPTICAL_CHROMIUM to an installed browser.`, { cause: error });
}
try {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 500, height: 300 } });
    const page = await context.newPage();
    await page.setContent(`<style>body{margin:0;background:white}#container{width:96px;height:96px;display:flex;align-items:center;justify-content:center;background:#fff;color:#111}svg{width:60px;height:60px;flex:none}#text{width:160px;height:60px;display:flex;align-items:center;justify-content:center;background:white;color:#111;font:24px sans-serif}</style><div id="container">${icon}</div><div id="text"><span>Ag</span></div><img width="1" height="1" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3C/svg%3E">`);
    await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(image => image.decode()));
    });
    const out = process.env.OPTICAL_PROOF_DIR || join(tmpdir(), 'optical-browser-proof');
    await mkdir(out, { recursive: true });
    const container = page.locator('#container');
    await container.screenshot({ path: join(out, 'before.png'), animations: 'disabled' });
    await page.locator('#container svg').evaluate((el, transform) => { el.style.transform = transform; }, css);
    await container.screenshot({ path: join(out, 'after.png'), animations: 'disabled' });
    const before = offCenter(await measureFile(join(out, 'before.png'), { bg: '#fff' }));
    const after = offCenter(await measureFile(join(out, 'after.png'), { bg: '#fff' }));
    assert.ok(before.pct > 1, JSON.stringify(before));
    assert.ok(after.pct <= 1, JSON.stringify(after));
    const check = spawnSync(process.execPath, [new URL('./optical.mjs', import.meta.url).pathname, 'check', join(out, 'after.png'), '--bg', '#fff', '--json'], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.equal(JSON.parse(check.stdout)[0].pass, true);
    const text = page.locator('#text');
    await text.screenshot({ path: join(out, 'text-before.png') });
    const textMeasure = await measureFile(join(out, 'text-before.png'), { bg: '#fff' });
    await page.locator('#text span').evaluate((el, offset) => { el.style.transform = `translate(${offset.x / 2}px, ${offset.y / 2}px)`; }, textMeasure.offset);
    await text.screenshot({ path: join(out, 'text-after.png') });
    const textAfter = offCenter(await measureFile(join(out, 'text-after.png'), { bg: '#fff' }));
    assert.ok(textAfter.pct <= 1, JSON.stringify(textAfter));
    const values = await container.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, foreground: getComputedStyle(el).color, dpr: devicePixelRatio }));
    const report = { css, before, after, textAfter, ...values };
    await writeFile(join(out, 'browser-proof.json'), JSON.stringify(report, null, 2)+'\n');
    console.log('Browser PASS: '+JSON.stringify(report));
} finally {
    await browser.close();
}
