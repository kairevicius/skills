import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderPlacement } from './lib.mjs';
const dir = new URL('../fixtures/validation/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
const results = [];
for (const name of manifest.files) {
    const file = new URL('../icons/'+name, dir);
    const sha256 = createHash('sha256').update(await readFile(file)).digest('hex');
    const p = await renderPlacement(file.pathname, { container: manifest.container, element: manifest.element, plate: manifest.background, fg: manifest.foreground, scale: manifest.scale });
    results.push({ file: name, sha256, beforePct: p.before.pct, afterPct: p.after.pct, offset: p.offset, pass: p.after.pct <= 1 });
}
await writeFile(new URL('recorded.json', dir), JSON.stringify({ command: 'cd scripts && npm run validate', model: 'same-model implementation check; circular for perception', results }, null, 2)+'\n');
console.log(JSON.stringify(results, null, 2));
if (results.some(r => !r.pass)) process.exitCode = 1;
