import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { measureFile } from '../../skills/optical-balance/scripts/lib.mjs';
const snapshots = JSON.parse(await readFile(new URL('colour-snapshots.json', import.meta.url), 'utf8'));
for (const expected of snapshots) {
    const m = await measureFile(new URL(`sources/${expected.name}.svg`, import.meta.url).pathname, { bg: '#fff' });
    assert.ok(Math.abs(m.offsetPct.x - expected.x) < 1e-8, expected.name + ' x');
    assert.ok(Math.abs(m.offsetPct.y - expected.y) < 1e-8, expected.name + ' y');
    assert.equal(m.discounted, expected.discounted, expected.name + ' minority guard');
    if (expected.name === 'mastercard') assert.ok(Math.abs(m.offsetPct.x) < 0.1, 'symmetric Mastercard');
    if (expected.name === 'paypal') assert.equal(m.discounted, false, 'PayPal keeps both tones');
}
console.log(`PASS: ${snapshots.length} colour-logo snapshots, symmetric Mastercard, PayPal guard.`);
