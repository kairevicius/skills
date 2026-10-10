import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measure, measureFile, equalize, sizeSpread, renderPlacement, renderStrip, renderFrame, toRaw, offCenter } from './lib.mjs';
const tmp = mkdtempSync(join(tmpdir(), 'optical-v2-'));
const svg = (body, w=100, h=100) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`;
const file = (name, body) => { const p=join(tmp,name); writeFileSync(p,body); return p; };
const play=file('play.svg',svg('<path d="M0 0L100 50L0 100Z" fill="currentColor"/>'));
const blank=file('blank.svg',svg(''));
const cli=(...args)=>spawnSync(process.execPath,[new URL('./optical.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
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
  assert.ok(Math.abs(m.mass.x-expectedMass)<1e-9);assert.equal(m.extent.x,faint===32?34:50);
  assert.ok(Math.abs(m.visual.x-((faint===32?34:50)+expectedMass)/2)<1e-9);
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
  const placed = await renderPlacement(path.pathname, { container: manifest.container, element: manifest.element, plate: manifest.background, fg: manifest.foreground, scale: manifest.scale });
  assert.equal(placed.before.pct, expected.beforePct);
  assert.equal(placed.after.pct, expected.afterPct);
  assert.deepEqual(placed.offset, expected.offset);
  assert.equal(expected.pass, true);
  assert.ok(placed.after.pct <= 1, name);
 }
});

test('colour Amazon keeps the mono placement direction without a large downward fix', async () => {
 const path = name => new URL('../fixtures/colour/'+name, import.meta.url).pathname;
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
 assert.ok(m.mass.x > .8 && m.mass.x < 1);
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
 const amazon = new URL('../fixtures/colour/amazon-color.svg',import.meta.url).pathname;
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
