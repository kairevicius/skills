import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { sitePage } from './site.mjs';
import { installCommand } from './optical-balance/page-parts.mjs';

const document = (title, description, content) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#fafafa"><title>${title}</title><meta name="description" content="${description}"></head><body><main>${content}</main></body></html>`;

const home = sitePage(document('Skills · Measure and verify', 'Agent skills for optical balance and evidence from git history.', `
<h1>Skills <span class="subtitle">· for agents that measure and verify</span></h1>
<p>Make a design decision you can repeat. Turn a claim into <em>evidence you can check</em>.</p>
<div class="preview-strip">
<a href="optical-balance/" aria-label="Optical logo centering"><img src="optical-balance/assets/amazon-visual.webp" alt="Amazon wordmark centered optically on a tile"></a>
<a href="optical-balance/write-up.html" aria-label="Read the optical balance method"><img src="optical-balance/assets/play-after.webp" alt="Play icon centered optically in a button"></a>
<a href="optical-balance/demo.html" aria-label="Try the optical alignment demo"><img src="optical-balance/assets/vercel-visual.webp" alt="Triangle centered optically in a disc"></a>
</div>
<p class="meta"><span>Any agent that reads skills</span><a href="#install">Install ↓</a><a href="https://github.com/kairevicius/skills">Source ↗</a></p>
<h2>Choose a skill</h2>
<p>Each skill has one job, a repeatable workflow, and scripts that check its output.</p>
<ul class="skill-list">
<li><a href="optical-balance/"><strong>Optical balance <span aria-hidden="true">↗</span></strong><span>Center and size logos and icons by what the eye sees. Get the CSS offset and check the rendered result.</span></a></li>
<li><a href="proof/"><strong>Proof <span aria-hidden="true">↗</span></strong><span>Turn one person's git history into claims backed by commits and files. Re-derive a received proof before trusting it.</span></a></li>
</ul>
<h2 id="install">Install</h2>
<p>Use the skills CLI. It asks which skills and agents to install for.</p>
<pre><code>${installCommand('whole-set')}</code></pre>
<p>Add <code>-a &lt;agent&gt;</code> to choose agents, such as <code>-a codex -a cursor</code>. Add <code>-g</code> for a user install.</p>
<p>Without the CLI, copy a folder from <code>skills/</code> into your agent's skills folder. Follow its <code>SKILL.md</code> for setup.</p>
<h2>Use it</h2>
<p>Ask your agent to run a skill against your actual asset or repository.</p>
<pre class="prompt"><code>Use optical-balance to center this logo in its tile.
Use proof to turn my work in this repository into evidence.</code></pre>
<h2>Read the method</h2>
<p><a href="optical-balance/write-up.html">The box is not the ink</a> walks through the optical measurements. The <a href="optical-balance/demo.html">live demo</a> lets you compare the alignment rules.</p>
<footer><p>MIT · <a href="https://github.com/kairevicius/skills/blob/main/LICENSE">License</a> · <a href="https://github.com/kairevicius/skills">GitHub</a></p></footer>
`), 'home');

const proof = sitePage(document('Proof · Claims a reader can check', 'Turn git history into evidence and independently verify a received proof.', `
<h1>Proof <span class="subtitle">· an agent skill</span></h1>
<p>Turn your work in a repository into <em>claims a reader can check</em>.</p>
<p class="meta"><span>Generate · Verify</span><a href="#install">Install ↓</a><a href="https://github.com/kairevicius/skills/tree/main/skills/proof">Skill source ↗</a></p>
<h2>What it does</h2>
<p>A CV names a skill. A proof points to the commits and files that show it. The agent extracts one person's work, writes evidence-backed claims, and renders Markdown and HTML reports.</p>
<p>A recipient runs Verify in their own copy of the public repository. The scripts re-derive the evidence; they do not trust a candidate's report.</p>
<p class="editorial">Every claim has a reference. Every gap stays visible.</p>
<h2>Generate a proof</h2>
<p>Ask your agent:</p>
<pre class="prompt"><code>Use proof to turn my work in this repository into evidence.
My author email is me@example.com.
Write the gaps as well as the claims.</code></pre>
<p>The skill extracts git evidence, guides the agent's judgment, validates the claims, and renders <code>proof.md</code> and <code>proof.html</code>. Reports contain no source code.</p>
<h2>Verify a received proof</h2>
<pre class="prompt"><code>Use proof to verify this candidate's proof.json.
Re-derive the evidence from the public repository.</code></pre>
<p>The audit reports Reproduced, Contradicted, Inconclusive, or Not reproducible. Identity is checked separately from the claims.</p>
<h2 id="install">Install</h2>
<pre><code>${installCommand('one-skill', 'proof')}</code></pre>
<p>The skill needs git, Node, and OpenSSH for signing and verification. Its scripts have no dependencies.</p>
<p>Set <code>SKILL_ROOT</code> to the installed proof folder. Run the commands from the target repository.</p>
<pre><code>node "$SKILL_ROOT/scripts/git-evidence.mjs" --print --author me@example.com
node "$SKILL_ROOT/scripts/verify-proof.mjs" --help</code></pre>
<p>Extraction is the first step. Follow <a href="https://github.com/kairevicius/skills/blob/main/skills/proof/SKILL.md">SKILL.md</a> to write, validate, render, and optionally sign the proof.</p>
<h2>Limits</h2>
<p>Git cannot show design files, planning, work outside the repository, or inaccessible history. Proof does not rank people or decide a hire.</p>
<p>A report names paths and commit subjects. You decide whether to share it.</p>
<footer><p>MIT · <a href="https://github.com/kairevicius/skills/blob/main/LICENSE">License</a> · <a href="https://github.com/kairevicius/skills">GitHub</a></p></footer>
`), 'proof');

mkdirSync(new URL('./proof/dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./index.html', import.meta.url), home);
writeFileSync(new URL('./proof/dist/index.html', import.meta.url), proof);
mkdirSync(new URL('../_site/', import.meta.url), { recursive: true });
writeFileSync(new URL('../_site/index.html', import.meta.url), home);
cpSync(new URL('./optical-balance/dist/', import.meta.url), new URL('../_site/optical-balance/', import.meta.url), { recursive: true });
cpSync(new URL('./proof/dist/', import.meta.url), new URL('../_site/proof/', import.meta.url), { recursive: true });
console.log('Site assembly PASS: home, optical-balance, write-up, demo, proof');
