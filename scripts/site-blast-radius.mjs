import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const root = resolve(new URL('../', import.meta.url).pathname);
const baseline = process.argv[2];
assert.ok(baseline, 'Pass the baseline checkout root after running its optical site build');
const measurements = name => {
    const log = readFileSync(join(root, 'docs/evidence/site-redesign', `${name}-build.txt`), 'utf8');
    return JSON.parse(log.slice(log.indexOf('\n{\n'), log.lastIndexOf('\n}') + 2));
};
assert.deepEqual(measurements('after'), measurements('before'));
console.log('Blast radius PASS: all build-derived measurements match the before build');

const assetDir = checkout => join(checkout, 'sites/optical-balance/dist/assets');
const assets = readdirSync(assetDir(baseline)).sort();
assert.deepEqual(readdirSync(assetDir(root)).sort(), assets);
for (const name of assets) {
    const hash = checkout => createHash('sha256').update(readFileSync(join(assetDir(checkout), name))).digest('hex');
    assert.equal(hash(root), hash(baseline), `measurement figure changed: ${name}`);
}
console.log(`Blast radius PASS: ${assets.length} generated assets are byte-identical to the baseline`);

const prose = html => {
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
    return [...main.matchAll(/<(h1|h2|h3|p|pre|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(match => match[2]
        .replace(/<span class="section-mark"[^>]*>[\s\S]*?<\/span>/g, '')
        .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
};
for (const name of ['index.html', 'write-up.html']) {
    const page = checkout => readFileSync(join(checkout, 'sites/optical-balance/dist', name), 'utf8');
    assert.deepEqual(prose(page(root)), prose(page(baseline)), `article content changed: ${name}`);
    console.log(`Blast radius PASS: existing headings, paragraphs, code examples, and lists preserved in ${name}`);
}
