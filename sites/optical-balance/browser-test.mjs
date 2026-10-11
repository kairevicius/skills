import { chromium } from '../../skills/optical-balance/scripts/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
console.log('Site browser acquired shared lock.');
const browser = await chromium.launch({ executablePath: process.env.OPTICAL_CHROMIUM, args: ['--no-sandbox'], timeout: 15000 });
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of ['index.html', 'write-up.html', 'demo.html']) {
        await page.goto(new URL(`dist/${name}`, import.meta.url).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.evaluate(async () => {
            const images = [...document.images];
            for (const image of images) image.loading = 'eager';
            await Promise.race([
                Promise.all(images.map(image => image.decode())),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Site images did not decode')), 15000)),
            ]);
        });
        assert.ok((await page.title()).length > 0);
        if (name === 'demo.html') {
            await page.locator('[data-mode="geometric"]').click();
            assert.equal(await page.locator('[data-mode="geometric"]').getAttribute('aria-pressed'), 'true');
            await page.locator('[data-mode="optical"]').click();
            assert.equal(await page.locator('[data-mode="optical"]').getAttribute('aria-pressed'), 'true');
            await page.locator('#reset').click();
            assert.ok(await page.locator('.layer').count() > 0);
        }
        console.log(`Site browser PASS: ${name}`);
    }
    assert.deepEqual(errors, []);
} finally {
    await browser.close();
}
