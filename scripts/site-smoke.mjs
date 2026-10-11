import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium } from '../skills/optical-balance/scripts/node_modules/playwright-core/index.mjs';

const root = resolve(new URL('../_site/', import.meta.url).pathname);
const evidence = new URL('../docs/evidence/site-redesign/', import.meta.url);
const axeSource = process.env.SITE_AXE_PATH ? readFileSync(process.env.SITE_AXE_PATH, 'utf8') : null;
const capture = process.argv.includes('--screenshots');
const types = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const server = createServer((req, res) => {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith('/skills/')) { res.writeHead(404); res.end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(root, pathname.slice('/skills/'.length));
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    try {
        const body = readFileSync(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/skills/`;
let browser;
try {
    browser = await chromium.launch({ executablePath: process.env.OPTICAL_CHROMIUM, args: ['--no-sandbox'] });
    if (capture) mkdirSync(evidence, { recursive: true });
    for (const width of [390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        for (const [name, path, title] of [
            ['home', '', 'Skills · Measure and verify'],
            ['optical-balance', 'optical-balance/', 'Optical balance'],
            ['write-up', 'optical-balance/write-up.html', 'The box is not the ink'],
            ['demo', 'optical-balance/demo.html', 'Optical align'],
            ['proof', 'proof/', 'Proof · Claims a reader can check'],
        ]) {
            const response = await page.goto(base + path, { waitUntil: 'networkidle' });
            assert.equal(response.status(), 200);
            assert.equal(await page.title(), title);
            await page.evaluate(async () => {
                for (const image of document.images) image.loading = 'eager';
                await Promise.all([...document.images].map(image => image.decode()));
            });
            const state = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                width: innerWidth,
                background: getComputedStyle(document.body).backgroundColor,
                scheme: getComputedStyle(document.documentElement).colorScheme,
                current: [...document.querySelectorAll('.site-nav a[aria-current="page"]')].map(a => a.textContent),
                mains: document.querySelectorAll('main').length,
            }));
            assert.equal(state.scrollWidth, state.width, `${name} overflows at ${width}`);
            assert.equal(state.background, 'rgb(250, 250, 250)');
            assert.equal(state.scheme, 'light');
            assert.equal(state.mains, 1);
            for (const frame of page.frames()) {
                const typography = await frame.evaluate(() => {
                    const bodyFont = getComputedStyle(document.body).fontFamily;
                    const elements = [...document.querySelectorAll('body *')];
                    return {
                        headings: [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(el => el.textContent),
                        alternateFonts: elements.filter(el => {
                            const font = getComputedStyle(el).fontFamily;
                            return font !== bodyFont && !font.includes('monospace');
                        }).map(el => `${el.tagName}.${el.className}: ${getComputedStyle(el).fontFamily}`),
                        bodyFont,
                    };
                });
                assert.ok(typography.bodyFont.startsWith('system-ui'), `${name} must use the body sans`);
                assert.deepEqual(typography.alternateFonts, [], `${name} has alternate fonts @ ${width}`);
                assert.ok(typography.headings.every(title => !/[§¶#↗🔗]\s*$/.test(title)), `${name} has heading anchor marks`);
            }
            console.log(`Typography PASS: ${name} @ ${width}, body sans throughout, no heading anchor marks`);
            assert.ok(state.current.length > 0, `${name} has no current navigation item`);
            if (axeSource) {
                await page.addScriptTag({ content: axeSource });
                const audit = await page.evaluate(async () => {
                    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
                    return result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
                });
                assert.deepEqual(audit, [], `Accessibility violations on ${name} @ ${width}: ${JSON.stringify(audit)}`);
                console.log(`Accessibility PASS: ${name} @ ${width}, WCAG A/AA automated checks`);
            }
            const links = await page.locator('a[href]').evaluateAll(anchors => anchors.map(a => a.href));
            for (const href of new Set(links)) {
                const url = new URL(href);
                if (url.origin !== new URL(base).origin) continue;
                const linked = await page.request.get(href);
                assert.equal(linked.status(), 200, `broken internal link ${href}`);
                if (url.hash) assert.ok((await linked.text()).includes(`id="${url.hash.slice(1)}"`), `missing anchor ${href}`);
            }
            await page.locator('.skip-link').focus();
            await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'content');
            await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
            if (name === 'write-up') {
                const frame = page.frameLocator('iframe.demo');
                await frame.locator('#layerPicker').selectOption('play');
                await frame.locator('[data-mode="geometric"]').click();
                await frame.locator('[data-align="hcenter"]').click();
                assert.equal(await frame.locator('.layer[data-id="play"]').evaluate(el => el.style.left), '44px');
                await frame.locator('[data-mode="optical"]').click();
                assert.ok(await frame.locator('.layer[data-id="play"]').evaluate(el => parseFloat(el.style.left) > 44));
                await frame.locator('#reset').click();
                await frame.locator('#layerPicker').selectOption('');
                await frame.locator('.guide.on').waitFor({ state: 'hidden' });
                console.log(`Embedded demo PASS: geometric/optical alignment and layer picker @ ${width}`);
            }
            if (name === 'demo') {
                await page.locator('#layerPicker').selectOption('play');
                assert.equal(await page.locator('#selTitle').textContent(), 'Play');
                await page.locator('[data-mode="geometric"]').click();
                await page.locator('[data-align="hcenter"]').click();
                const play = page.locator('.layer[data-id="play"]');
                assert.equal(await play.evaluate(el => el.style.left), '44px');
                await page.locator('[data-mode="optical"]').click();
                assert.equal(await page.locator('[data-mode="optical"]').getAttribute('aria-pressed'), 'true');
                const optical = await play.evaluate(el => parseFloat(el.style.left));
                assert.ok(optical > 44, `play should shift right, got ${optical}`);
                console.log(`Demo alignment PASS: geometric x=44px; optical x=${optical}px; keyboard layer picker selects Play`);
                await page.locator('#reset').click();
                assert.equal(await play.evaluate(el => el.style.left), '44px');
                assert.equal(await page.locator('#selTitle').textContent(), 'Play');
                await page.locator('#layerPicker').selectOption('');
                await page.locator('.guide.on').waitFor({ state: 'hidden' });
            }
            await page.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
            if (capture) await page.screenshot({ path: new URL(`after-${name}-${width}.png`, evidence).pathname, fullPage: true });
            await page.emulateMedia({ colorScheme: 'dark' });
            assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light');
            await page.emulateMedia({ colorScheme: 'light' });
            console.log(`Site smoke PASS: ${name} @ ${width}, title="${title}", light, no overflow, images, links, skip link`);
        }
        assert.deepEqual(errors, []);
        await page.close();
    }
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
}
