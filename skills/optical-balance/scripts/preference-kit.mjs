import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';
import { renderPlacement, measureFile } from './lib.mjs';
const out = process.argv[2] || 'preference-kit';
await mkdir(out, { recursive: true });
const manifest = JSON.parse(await readFile(new URL('../fixtures/validation/manifest.json', import.meta.url), 'utf8'));
const key = [], rows = [];
for (const [index, name] of manifest.files.entries()) {
    const file = new URL('../fixtures/icons/'+name, import.meta.url).pathname;
    const p = await renderPlacement(file, { container: 96, element: 60, plate: '#fff', fg: '#111', scale: 4 });
    const m = await measureFile(file, { bg: '#fff', fg: '#111' });
    const pure = await renderPlacement(file, { container: 96, element: 60, plate: '#fff', fg: '#111', scale: 4, offset: { x: (m.box.x-m.massCentroid.x)/m.width*100, y: (m.box.y-m.massCentroid.y)/m.height*100 } });
    for (const [alternative, image] of [['box',p.before.png],['mass',pure.after.png]]) {
        const swap = randomInt(2) === 1;
        const id = `pair-${index}-${alternative==='box'?'a':'b'}`;
        const inputs = swap ? [p.after.png,image] : [image,p.after.png];
        await sharp({create:{width:800,height:384,channels:4,background:'#fff'}}).composite(inputs.map((input,i)=>({input,left:i*416,top:0}))).png().toFile(join(out,id+'.png'));
        key.push({ id, left: swap?'heuristic':alternative, right: swap?alternative:'heuristic', fixture:name });
        rows.push(`${id},,,,`);
    }
}
await writeFile(join(out,'organizer-key.json'),JSON.stringify(key,null,2)+'\n');
await writeFile(join(out,'results.csv'),'pair,participant,preference(left|right|tie),confidence,notes\n'+rows.join('\n')+'\n');
console.log(`Generated stimuli and blank template in ${out}; no participant results.`);
