import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, measureFile, equalize, sizeSpread, renderPlacement, renderStrip, renderFrame, toRaw, offCenter } from './lib.mjs';
const tmp = mkdtempSync(join(tmpdir(), 'optical-v2-'));
const svg = (body, w=100, h=100) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
const file = (name, body) => { const p=join(tmp,name); writeFileSync(p,body); return p; };
const play=file('play.svg',svg('<path d="M0 0L100 50L0 100Z" fill="currentColor"/>'));
const blank=file('blank.svg',svg(''));
const cli=(...args)=>spawnSync(process.execPath,[fileURLToPath(new URL('./optical.mjs',import.meta.url)),...args],{encoding:'utf8'});
test('blank inputs and invalid raw sizes fail clearly',async()=>{
 assert.throws(()=>measure({width:0,height:0,data:Buffer.alloc(0)},255),/positive/);
 assert.throws(()=>sizeSpread([0,1]),/positive/);
 assert.throws(()=>sizeSpread([NaN]),/positive/);
 assert.throws(()=>sizeSpread([1e308,1e-300]),/non-finite/);
 for(const cmd of ['measure','equalize','check','place','strip','tile','frame']){
  const r=cli(cmd,blank,'--container','100','--element','60','--out',join(tmp,'blank.png'));
  assert.notEqual(r.status,0,cmd); assert.match(r.stderr,/no ink/); assert.doesNotMatch(r.stdout,/NaN|Infinity|null/);
 }
 await assert.rejects(measureFile(blank),/no ink/);
});
test('invalid CLI values, enums, extra positionals, and offset arity are rejected',()=>{
 for(const args of [['--scale','0'],['--height','-1'],['--gap','-1'],['--scale','NaN'],['--blend','2'],['--shape','triangle'],['--metric','bogus'],['--sizing','bogus'],['--centering','bogus'],['--offset','1,2,3']]){
  const r=cli('place',play,'--container','100','--element','60',...args); assert.notEqual(r.status,0,args.join(' '));
 }
 assert.notEqual(cli('tile',play,play,'--out',join(tmp,'bad.png')).status,0);
});
test('help is usable in an isolated folder with no sharp',()=>{
 const p=join(tmp,'optical.mjs');copyFileSync(new URL('./optical.mjs',import.meta.url),p);
 const r=spawnSync(process.execPath,[p,'--help'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/measure/);
});
test('near one-third two-tone readings assert numerical centroid and extent',()=>{
 for(const faint of [32,34]){
  const data=Buffer.alloc(100*4);for(let x=0;x<100;x++){data.set([x<100-faint?0:153,x<100-faint?0:153,x<100-faint?0:153,255],x*4);}
  const m=measure({data,width:100,height:1},255);
  const strong=100-faint;
  const expectedMass=faint===32?(strong*(strong/2)+faint*.16*(strong+faint/2))/(strong+faint*.16):50;
  assert.ok(Math.abs(m.mass.x-expectedMass)<1e-9);assert.equal(m.extent.x,faint===32?42:50);
  assert.ok(Math.abs(m.visual.x-((faint===32?42:50)+expectedMass)/2)<1e-9);
 }
});
test('linear visual size and alpha compositing have explicit numerical contracts',async()=>{
 const raw={data:Buffer.from([0,0,0,64]),width:1,height:1}; const a=measure(raw,255);
 assert.ok(Math.abs(a.massArea-64/255)<1e-9);assert.equal(a.visualSize,a.sizes.contrast);
 const png=await sharp(raw.data,{raw:{width:1,height:1,channels:4}}).flatten({background:'#fff'}).png().toBuffer();
 const b=measure(await toRaw(png),255);assert.ok(Math.abs(b.massArea-(64/255)**2)<1e-9);
});
test('circle scores match masked returned pixels and placement clamps',async()=>{
 const p=await renderPlacement(play,{container:100,element:100,shape:'circle',offset:{x:50,y:-50}});
 const actual=offCenter(measure(await toRaw(p.after.png),255));assert.equal(p.after.pct,actual.pct);
 assert.equal(p.offset.x,0);assert.ok(p.offset.y===0);
 const white=await renderPlacement(play,{container:100,element:60,plate:'#111',fg:'#fff'});
 assert.ok(white.after.pct<=1);assert.equal(white.after.m.bgLum,17);
});
test('width-limited unequal baselines equalize and refinement respects width',async()=>{
 const bar=file('bar.svg',svg('<rect width="400" height="10" fill="#000"/>',400,10));
 const square=file('square.svg',svg('<rect width="100" height="100" fill="#000"/>'));
 const ms=await Promise.all([bar,square].map(f=>measureFile(f,{trim:true})));
 const rows=equalize(ms,{height:40,maxWidth:50});
 assert.ok(sizeSpread(rows.map(r=>r.perceivedSize*r.scale))<1e-8);
 const s=await renderStrip([bar,square],{height:40,maxWidth:50,scale:4});
 assert.ok(s.rows.every(r=>r.css.ink.width<=50));
 for(const r of s.rows){const p=r.placed;const part=await sharp(s.png).extract({left:p.left,top:p.top,width:p.width,height:p.height}).png().toBuffer();assert.equal(r.perceived,measure(await toRaw(part),255).perceivedSize/4);}
});
test('photo crop measures final circle and clamps at the source edge',async()=>{
 const photo=file('photo.svg',svg('<rect width="200" height="100" fill="#000"/><rect x="170" y="20" width="30" height="60" fill="#fff"/>',200,100));
 const f=await renderFrame(photo,{size:128,bg:'#000',zoom:.6,circle:true});
 assert.ok(f.clamped);assert.ok(f.crop.left>=0&&f.crop.left+f.crop.side<=2048);assert.equal(f.crop.side,614);
 assert.equal(f.result.visual.x,measure(await toRaw(f.png),0,{backgroundContrast:.15,forceDiscount:true}).visual.x);
});
test('all render commands return nonzero for failed gates',()=>{
 for(const [cmd,args] of [['place',['--container','100','--element','60','--offset','0,0']],['tile',['--centering','box']],['strip',['--sizing','height']],['frame',['--centering','box','--bg','#fff']]]){
  const inputs=cmd==='strip'?[play,file('full.svg',svg('<rect width="100" height="100"/>'))]:[play];
  const r=cli(cmd,...inputs,'--out',join(tmp,cmd+'.png'),...args);assert.equal(r.status,1,r.stdout+r.stderr);
 }
});
test('median, named targets, alternate metrics, and growth respect constraints',async()=>{
 const ms=await Promise.all([play,file('solid.svg',svg('<rect width="100" height="100" fill="#000"/>'))].map(f=>measureFile(f,{trim:true})));
 const median=equalize(ms,{height:32,target:'median'});assert.ok(median.some(r=>r.clamped));
 const named=equalize(ms,{height:32,target:ms[1].file,grow:true,maxWidth:32});assert.ok(named.every(r=>r.rendered.width<=32));assert.ok(named.some(r=>r.clamped));
 for(const metric of ['alpha','contrast','mass']){
  const rows=equalize(ms,{height:32,metric,strength:1,grow:true});assert.ok(sizeSpread(rows.map(r=>r.sizes[metric]*r.scale))<1e-8);
 }
 assert.throws(()=>equalize(ms,{target:'missing'}),/no element/);
 const s=await renderStrip(ms.map(m=>m.file),{height:32,target:ms[1].file,maxWidth:32,scale:4,grow:true});
 assert.ok(s.rows.every(r=>r.css.ink.width<=32));
 if(s.verify.spread>3) assert.match(s.verify.reason,/incompatible constraints/);
});
test('very faint ink fails below tolerance and warns when measurable',async()=>{
 const faint=file('faint.svg',svg('<rect x="20" y="20" width="60" height="60" fill="#f0f0f0"/>'));
 const m=await measureFile(faint);assert.ok(m.warnings.some(w=>w.includes('barely shows')));assert.ok(m.visualSize>0);
 await assert.rejects(measureFile(faint,{tolerance:.1}),/no ink/);
 const invisible=file('invisible.svg',svg('<rect width="100" height="100" fill="#fefefe"/>'));
 assert.notEqual(cli('measure',invisible,'--json').status,0);
 const output=cli('measure',play,'--json');assert.equal(output.status,0);assert.doesNotMatch(output.stdout,/NaN|Infinity|null/);
 assert.equal(JSON.parse(output.stdout)[0].visualSize,JSON.parse(output.stdout)[0].sizes.contrast);
});
test('incompatible width-limited anchor is explicitly reported',async()=>{
 const bar=file('constraint-bar.svg',svg('<rect width="400" height="10" fill="#000"/>',400,10));
 const square=file('constraint-square.svg',svg('<rect width="100" height="100" fill="#000"/>'));
 const ms=await Promise.all([bar,square].map(f=>measureFile(f,{trim:true})));
 const rows=equalize(ms,{height:40,maxWidth:50,target:square,grow:true});
 assert.ok(sizeSpread(rows.map(r=>r.perceivedSize*r.scale))>3);
 assert.match(rows[0].constraints,/incompatible constraints/);
 const r=cli('equalize',bar,square,'--height','40','--max-width','50','--target',square,'--grow');
 assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/incompatible constraints/);
});
test('tile and frame JSON expose finite readings and failed gate status',()=>{
 for(const cmd of ['tile','frame']){
  const r=cli(cmd,play,'--out',join(tmp,'json-'+cmd+'.png'),'--centering','box','--bg','#fff','--json');
  assert.equal(r.status,1,r.stdout+r.stderr);const parsed=JSON.parse(r.stdout);assert.equal(parsed.pass,false);assert.ok(Number.isFinite(parsed.result.visualSize));
 }
 assert.notEqual(cli('place',play,'--container','100','--element','60','--offset',',').status,0);
});

test('held-out manifest renders every archived shape with reproducible readings', async () => {
 const { readFile } = await import('node:fs/promises');
 const { createHash } = await import('node:crypto');
 const dir = new URL('../fixtures/validation/', import.meta.url);
 const manifest = JSON.parse(await readFile(new URL('manifest.json', dir), 'utf8'));
 const recorded = JSON.parse(await readFile(new URL('recorded.json', dir), 'utf8'));
 assert.ok(manifest.files.length >= 10);
 assert.equal(new Set(manifest.files).size, manifest.files.length);
 assert.deepEqual(recorded.results.map(r => r.file), manifest.files);
 for (const name of manifest.files) {
  assert.ok(!['square-fill.svg','circle-fill.svg','diamond-fill.svg','star-fill.svg','triangle-fill.svg','heart-fill.svg'].includes(name), name);
  const path = new URL('../icons/'+name, dir);
  const expected = recorded.results.find(r => r.file === name);
  assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'), expected.sha256);
  const placed = await renderPlacement(fileURLToPath(path), { container: manifest.container, element: manifest.element, plate: manifest.background, fg: manifest.foreground, scale: manifest.scale });
  assert.equal(placed.before.pct, expected.beforePct);
  assert.equal(placed.after.pct, expected.afterPct);
  assert.deepEqual(placed.offset, expected.offset);
  assert.equal(expected.pass, true);
  assert.ok(placed.after.pct <= 1, name);
 }
});

test('colour Amazon keeps the mono placement direction without a large downward fix', async () => {
 const path = name => fileURLToPath(new URL('../fixtures/colour/'+name, import.meta.url));
 const options = {container:200, element:112, plate:'#ffffff', shape:'rect'};
 const colour = await renderPlacement(path('amazon-color.svg'), options);
 const mono = await renderPlacement(path('amazon.svg'), options);
 assert.ok(Math.abs(colour.offset.y) < 4, JSON.stringify(colour.offset));
 assert.ok(colour.offset.x < 0 && mono.offset.x < 0);
 assert.ok(colour.offset.y > 0 && mono.offset.y > 0);
 assert.ok(Math.abs(colour.offset.y-mono.offset.y) < 3);
 assert.ok(colour.after.pct <= 1);
});

test('saturated orange contributes mass and stays in the strong-ink extent', () => {
 const m = measure({width:2,height:1,data:Buffer.from([0,0,0,255,255,153,0,255])},255);
 assert.equal(m.extentBox.width,2);
 assert.ok(m.massCentroid.x > .8 && m.massCentroid.x < 1);
 assert.ok(m.contrastArea > 1.6);
});

test('all neutral greys retain their original mass and size weights including alpha', () => {
 for (const bg of [0,1e-7,17,17.5,128,255]) for (let grey=0;grey<=255;grey++) {
  const contrast = Math.abs((.299*grey+.587*grey+.114*grey)-bg)/255;
  if (contrast <= .02) continue;
  const m = measure({width:1,height:1,data:Buffer.from([grey,grey,grey,128])},bg);
  assert.ok(Math.abs(m.massArea-128/255*contrast*contrast)<1e-12);
  assert.ok(Math.abs(m.contrastArea-128/255*contrast)<1e-12);
 }
});

test('equal-luminance colour remains ink against a grey background through trim and warnings', async () => {
 const cyan = file('equal-luminance.svg', svg('<rect x="20" y="20" width="60" height="60" fill="#00c2ff"/>'));
 const m = await measureFile(cyan, {bg:'#8f8f8f',trim:true});
 assert.equal(m.inkBox.width,614);
 assert.equal(m.warnings.length,0);
 assert.ok(m.massArea > 100000);
 const orange = file('orange-on-orange.svg',svg('<rect width="100" height="100" fill="#ff9900"/>'));
 await assert.rejects(measureFile(orange,{bg:'#ff9900'}),/no ink/);
 const transparent = measure({width:1,height:1,data:Buffer.from([255,153,0,128])},255);
 const opaque = measure({width:1,height:1,data:Buffer.from([255,153,0,255])},255);
 assert.ok(Math.abs(transparent.massArea/opaque.massArea-128/255)<1e-12);
});

test('every weighting command accepts colour and preserves finite JSON readings', () => {
 const amazon = fileURLToPath(new URL('../fixtures/colour/amazon-color.svg',import.meta.url));
 for (const cmd of ['measure','place','strip','equalize','tile','check','frame']) {
  const r = cli(cmd,amazon,'--container','200','--element','112','--bg','#fff','--plate','#fff','--scale','2','--out',join(tmp,'colour-'+cmd+'.png'),'--json');
  assert.ok([0,1].includes(r.status),cmd+': '+r.stderr);
  const result = JSON.parse(r.stdout);
  const reading = cmd==='place'?result.after.pct:cmd==='strip'?result.logos[0].perceived:cmd==='check'?result[0].pct:cmd==='tile'||cmd==='frame'?result.result.massArea:result[0].massArea;
  assert.ok(Number.isFinite(reading) && reading >= 0,cmd+': '+r.stdout);
  if (cmd==='place') assert.ok(Math.abs(result.offset.y)<4);
  if (cmd==='measure') assert.ok(result[0].accentShare<.1);
 }
});


test('orange variants on white and cream stay within 3px plus one raster step of mono Amazon', async () => {
 const { readFileSync } = await import('node:fs');
 const source = readFileSync(new URL('../fixtures/colour/amazon-color.svg', import.meta.url), 'utf8');
 for (const plate of ['#ffffff','#FFF8E7']) {
  const options = {container:200,element:112,plate,shape:'rect'};
  const mono = await renderPlacement(fileURLToPath(new URL('../fixtures/colour/amazon.svg',import.meta.url)),options);
  for (const orange of ['#FF9900','#FFB347']) {
   const variant = file(orange.slice(1)+plate.slice(1)+'.svg',source.replace(/#ff9900/gi,orange));
   const colour = await renderPlacement(variant,options);
   assert.ok(Math.hypot(colour.offset.px.x-mono.offset.px.x,colour.offset.px.y-mono.offset.px.y)<=3.25,JSON.stringify({orange,plate,colour:colour.offset,mono:mono.offset}));
   assert.ok(colour.after.pct<=1);
  }
 }
});
test('frame ignores a near-black tinted backdrop at photo tolerance', async () => {
 const photo=file('tinted-photo.svg',svg('<rect width="200" height="100" fill="#050414"/><rect x="80" y="20" width="40" height="60" fill="#fff"/>',200,100));
 const f=await renderFrame(photo,{size:128,bg:'#0a0a08',circle:true});
 assert.ok(f.source.inkBox.width < f.source.width/2,JSON.stringify(f.source.inkBox));
 assert.ok(f.source.inkBox.height < f.source.height*.7);
});


test('colour compositing uses the flattened RGB and derives background luma', async () => {
 const raw={width:1,height:1,data:Buffer.from([255,153,0,128])};
 const png=await sharp(raw.data,{raw:{width:1,height:1,channels:4}}).flatten({background:'#fff'}).png().toBuffer();
 const flattened=await toRaw(png);
 assert.deepEqual([...flattened.data],[255,203,127,255]);
 const m=measure(flattened,{r:255,g:255,b:255,lum:0});
 assert.equal(m.bgLum,255);
 assert.ok(Math.abs(m.massArea-0.2278458450124438)<0.00001);
 assert.throws(()=>measure(raw,{lum:255}),/invalid background/);
});
test('extent varies continuously across the former strong-ink threshold', () => {
 const sample=g=>measure({width:100,height:1,data:Buffer.from(Array.from({length:100},(_,x)=>x<80?[0,0,0,255]:[g,g,g,255]).flat())},255);
 assert.ok(Math.abs(sample(101).visual.x-sample(103).visual.x)<.1);
});

test('equal-luma cyan backdrop warns as a tile rather than a faint rectangle', async () => {
 const tile=file('cyan-backdrop.svg',svg('<rect width="100" height="100" fill="#00c2ff"/><rect x="20" y="20" width="60" height="60" fill="#000"/>'));
 const m=await measureFile(tile,{bg:'#8f8f8f'});
 assert.ok(m.warnings.some(w=>w.includes('tile or badge')),m.warnings.join('\n'));
 assert.ok(!m.warnings.some(w=>w.includes('faint rectangle')));
});

// Review fixes: strip follows the requested rule, inputs fail clearly, and the CLI text matches the code.
const ICONS = fileURLToPath(new URL('../fixtures/icons/', import.meta.url));
const icon = name => join(ICONS, name + '-fill.svg');
const SHAPES = ['square', 'circle', 'diamond', 'star'].map(icon);
test('strip honours --strength: 0 keeps equal heights, 1 matches equalize', async () => {
 const heights = async strength => (await renderStrip(SHAPES, { height: 64, scale: 2, strength })).rows.map(r => r.css.ink.height);
 const [none, half, full] = [await heights(0), await heights(0.5), await heights(1)];
 for (const h of none) assert.ok(Math.abs(h - 64) <= 1, `strength 0 height ${h}`);
 const measured = await Promise.all(SHAPES.map(f => measureFile(f, { trim: true })));
 const computed = equalize(measured, { height: 64, strength: 1 }).map(r => r.rendered.height);
 // The strip anchors on the anchor as rendered, so compare each height as a share of the tallest.
 const share = hs => hs.map(h => h / Math.max(...hs));
 share(full).forEach((h, i) => assert.ok(Math.abs(h - share(computed)[i]) <= 0.02, `strength 1: ${SHAPES[i]} is ${h}, equalize gives ${share(computed)[i]}`));
 assert.ok(half[0] - full[0] > 5, `the square shrinks more at strength 1: ${half[0]} vs ${full[0]}`);
});
test('strip honours --metric', async () => {
 const black = file('disc-black.svg', svg('<circle cx="50" cy="50" r="50" fill="#000"/>'));
 const grey = file('disc-grey.svg', svg('<circle cx="50" cy="50" r="50" fill="#999"/>'));
 const heights = async metric => (await renderStrip([black, grey], { height: 64, scale: 2, strength: 1, metric })).rows.map(r => r.css.ink.height);
 const alpha = await heights('alpha'), contrast = await heights('contrast');
 assert.ok(Math.abs(alpha[0] - alpha[1]) <= 0.5, `equal alpha area keeps equal heights: ${alpha}`);
 assert.ok(contrast[1] - contrast[0] > 5, `the black disc shrinks to the grey disc's contrast size: ${contrast}`);
});
test('strip renders at 2x by default, and a row that is not equalized says so', () => {
 const r = cli('strip', ...SHAPES, '--out', join(tmp, 'default-scale.png'));
 assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /at 2x\)/); assert.match(r.stdout, /flattened strip at 2x/);
 const flat = cli('strip', ...SHAPES, '--sizing', 'height', '--out', join(tmp, 'flat.png'));
 assert.equal(flat.status, 1); assert.match(flat.stdout, /not equalized/); assert.doesNotMatch(flat.stdout, /raster logos/);
});
test('a row smaller than one device pixel fails at once', () => {
 const r = spawnSync(process.execPath, [fileURLToPath(new URL('./optical.mjs', import.meta.url)), 'strip', ...SHAPES, '--out', join(tmp, 'tiny.png'), '--height', '0.4'], { encoding: 'utf8', timeout: 20000 });
 assert.equal(r.status, 1, String(r.signal)); assert.match(r.stderr, /at least 1 device pixel/);
});
test('no ink prints the background hint, and check goes on to the next file', async () => {
 const hint = cli('measure', icon('triangle'), '--bg', '#fff', '--fg', '#fff');
 assert.equal(hint.status, 1); assert.match(hint.stderr, /Pass the real background with --bg/); assert.match(hint.stderr, /no ink against this background/);
 const empty = join(tmp, 'empty.png'), good = join(tmp, 'good.png');
 await sharp({ create: { width: 40, height: 40, channels: 4, background: '#000' } }).png().toFile(empty);
 await sharp({ create: { width: 40, height: 40, channels: 4, background: '#000' } }).composite([{ input: Buffer.from(svg('<rect x="10" y="10" width="20" height="20" fill="#fff"/>', 40, 40)) }]).png().toFile(good);
 const text = cli('check', empty, good, '--bg', '#000');
 assert.equal(text.status, 1); assert.match(text.stdout, /empty\.png\s+not measurable: no ink against this background  FAIL/); assert.match(text.stdout, /good\.png\s+off center 0\.00%.*PASS/);
 const json = cli('check', empty, good, '--bg', '#000', '--json');
 assert.equal(json.status, 1);
 const rows = JSON.parse(json.stdout);
 assert.deepEqual(rows.map(r => [r.pass, r.measurable]), [[false, false], [true, true]]);
});
test('frame prints the gate verdict that its exit code follows', async () => {
 const photo = join(tmp, 'photo.png');
 await sharp({ create: { width: 300, height: 200, channels: 4, background: '#0a0a08' } }).composite([{ input: Buffer.from(svg('<circle cx="50" cy="50" r="40" fill="#d8c0a0"/>')), left: 150, top: 40 }]).png().toFile(photo);
 const r = cli('frame', photo, '--out', join(tmp, 'framed.png'), '--bg', '#0a0a08', '--zoom', '0.8');
 const line = r.stdout.split('\n').filter(l => l.startsWith('off center')).at(-1);
 assert.match(line, /(PASS|FAIL) at 1%$/); assert.doesNotMatch(r.stdout, /use check/);
 assert.equal(r.status, line.includes('PASS') ? 0 : 1, r.stdout);
});
test('--bg auto and bare numbers are explicit', () => {
 for (const command of ['place', 'strip', 'tile', 'frame']) {
  const r = cli(command, icon('circle'), '--container', '40', '--element', '20', '--out', join(tmp, 'auto.png'), '--bg', 'auto');
  assert.equal(r.status, 2, command); assert.match(r.stderr, /--bg auto works with measure, check, and equalize only/);
 }
 assert.equal(cli('measure', icon('circle'), '--bg', 'auto').status, 0);
 const lum = JSON.parse(cli('measure', icon('circle'), '--bg', '111', '--json').stdout)[0];
 assert.equal(lum.bgLum, 111);
 const six = cli('measure', icon('circle'), '--bg', '111111');
 assert.equal(six.status, 1); assert.match(six.stderr, /bare number.*leading #/);
 assert.match(cli('--help').stdout, /bare number, which is always a luminance/);
});
test('printed boxes are rounded, --target takes a relative path, and --help lists every strip flag', () => {
 const m = cli('measure', fileURLToPath(new URL('../fixtures/colour/amazon-color.svg', import.meta.url)));
 assert.match(m.stdout, /contrast-weighted, accent discounted/); assert.doesNotMatch(m.stdout, /\d\.\d{3,}/);
 const r = spawnSync(process.execPath, [fileURLToPath(new URL('./optical.mjs', import.meta.url)), 'strip', 'circle-fill.svg', 'star-fill.svg', 'square-fill.svg', '--target', './square-fill.svg', '--grow', '--out', join(tmp, 'target.png')], { encoding: 'utf8', cwd: ICONS });
 assert.equal(r.status, 0, r.stdout + r.stderr);
 const help = cli('--help').stdout;
 for (const flag of ['--export', '--metric', '--grow', '--blend', '--strength']) assert.ok(help.includes(flag), flag);
});
test('place --json says whether an offset is needed', () => {
 const none = JSON.parse(cli('place', icon('circle'), '--container', '40', '--element', '20', '--json').stdout);
 assert.equal(none.needed, false); assert.equal('css' in none, false);
 const some = JSON.parse(cli('place', icon('triangle'), '--container', '96', '--element', '60', '--json').stdout);
 assert.equal(some.needed, true); assert.match(some.css, /^transform: translate\(/);
});
test('no script reads a file path off a URL object, which breaks on a space in the install path', async () => {
 const { readdirSync, readFileSync } = await import('node:fs');
 const here = fileURLToPath(new URL('./', import.meta.url));
 for (const name of readdirSync(here).filter(n => n.endsWith('.mjs'))) assert.doesNotMatch(readFileSync(join(here, name), 'utf8'), new RegExp('\\.path' + 'name\\b'), name);
});
