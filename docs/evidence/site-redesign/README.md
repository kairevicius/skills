# Site redesign evidence

Light screenshots of the home page, optical-balance landing page, write-up, demo, and new proof page.

## Reference study

The reference was [Anatomy](https://skills.wheresryan.sh/anatomy). Its HTML and stylesheet were fetched with:

```bash
curl -L --fail https://skills.wheresryan.sh/anatomy -o /tmp/site-reference.html
curl -L --fail https://skills.wheresryan.sh/anatomy/_next/static/css/3e834ea919116876.css -o /tmp/site-reference.css
```

The stylesheet defines a narrow reading column, a sticky desktop rail, a pale light background, compact sans-serif text,
serif details, horizontal section rules, and white rounded code cards with soft shadows.
The redesign uses those patterns with our existing figures and copy. Review fixes use the body sans throughout,
with monospace for code and measurements, and remove trailing section glyphs. No reference text, brand, or assets were copied.
Reduced motion stops decorative animation. Cards and current navigation items have no left accent bars.

## Screenshots

Before screenshots were captured from baseline commit `a0504164216d6fb1f0e1ff6b81d6f7c684ed360d` before edits.
Proof had no site: its before screenshots record the missing route, rather than an invented earlier design.
After screenshots come from the built `_site/` served over HTTP at the `/skills/` deployment prefix.
The browser uses light colour scheme, reduced motion, and a viewport height of 900.
The width and phase are encoded in each filename. These are full-page captures.

| Page | Before, 390 | After, 390 | Before, 1280 | After, 1280 |
| --- | --- | --- | --- | --- |
| Home | [PNG](before-home-390.png) | [PNG](after-home-390.png) | [PNG](before-home-1280.png) | [PNG](after-home-1280.png) |
| Optical balance | [PNG](before-optical-balance-390.png) | [PNG](after-optical-balance-390.png) | [PNG](before-optical-balance-1280.png) | [PNG](after-optical-balance-1280.png) |
| Write-up | [PNG](before-write-up-390.png) | [PNG](after-write-up-390.png) | [PNG](before-write-up-1280.png) | [PNG](after-write-up-1280.png) |
| Demo | [PNG](before-demo-390.png) | [PNG](after-demo-390.png) | [PNG](before-demo-1280.png) | [PNG](after-demo-1280.png) |
| Proof | [PNG](before-proof-390.png) | [PNG](after-proof-390.png) | [PNG](before-proof-1280.png) | [PNG](after-proof-1280.png) |

## Reproduce the build and browser proof

From the repository root, after installing each skill's dependencies:

```bash
flock /workspace/codex/b2/box-heavy.lock bash -c \
  'node sites/optical-balance/build-docs.mjs && node sites/build-docs.mjs'
flock /workspace/codex/b2/box-heavy.lock node scripts/site-smoke.mjs --screenshots
```

Use Playwright's installed Chromium or set `OPTICAL_CHROMIUM` to an executable.
These captures used `/home/box/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`.
The shared lock path is specific to this box; other environments can run the commands directly.

The accessibility audit uses axe-core installed outside the repository:

```bash
npm install --prefix /tmp/site-redesign-a11y --no-audit --no-fund axe-core@4.14.0
SITE_AXE_PATH=/tmp/site-redesign-a11y/node_modules/axe-core/axe.min.js \
  flock /workspace/codex/b2/box-heavy.lock node scripts/site-smoke.mjs --screenshots
```

Automated WCAG A/AA checks supplement screenshot inspection and keyboard checks; they do not prove every accessibility requirement.
The smoke script checks titles, image decoding, internal links and anchors, overflow, light mode under a dark preference,
skip-link focus, heading glyph removal, computed font families, and actual geometric/optical alignment in both the standalone and embedded demos.

## Blast radius

The safety fact is that the site layout does not change the skill algorithms, measurements, or figure assets.
A fresh baseline build uses the same installed dependencies as the redesigned build:

```bash
mkdir -p /tmp/skills-site-baseline
git archive a0504164216d6fb1f0e1ff6b81d6f7c684ed360d | tar -x -C /tmp/skills-site-baseline
ln -s "$PWD/skills/optical-balance/scripts/node_modules" \
  /tmp/skills-site-baseline/skills/optical-balance/scripts/node_modules
(cd /tmp/skills-site-baseline && \
  flock /workspace/codex/b2/box-heavy.lock node sites/optical-balance/build-docs.mjs)
node scripts/site-blast-radius.mjs /tmp/skills-site-baseline
```

[The comparison](blast-radius.txt) checks every build-derived value, hashes every generated asset, and compares existing headings,
paragraphs, code examples, and lists. The running site checks prove that Pages paths and both demo contexts still work.
No skill implementation, package lock, report schema, wire format, or installer folder was changed.
There is no server, database, or i18n layer in the site. Styles are embedded in generated HTML, so there is no separate stylesheet cache to invalidate.

## Test output

| Check | Output | Reproduce |
| --- | --- | --- |
| Repository structure | [Log](structure.txt) | `node scripts/check-repo.mjs` |
| Skills CLI discovery | [Log](discovery.txt) | `npx -y -p node@22 -p skills@latest skills add . --list` |
| Optical skill unit tests | [Log](optical-tests.txt) | `cd skills/optical-balance/scripts && npm ci && npm test` |
| Proof skill tests | [Log](proof-tests.txt) | `cd skills/proof/scripts && npm ci && npm test` |
| Colour figures | [Log](colour-tests.txt) | `node sites/optical-balance/colour-test.mjs` |
| Existing browser checks | [Log](browser-tests.txt) | `node sites/optical-balance/browser-test.mjs`, then `cd skills/optical-balance/scripts && npm run test:browser` |
| Site smoke and accessibility | [Log](smoke.txt) | Commands above |
| Measurements, assets, content | [Log](blast-radius.txt) | `node scripts/site-blast-radius.mjs /tmp/skills-site-baseline` |
| README optical quick start | [Log](quick-start.txt) | README's `place` command, with `--out /tmp/site-redesign-readme-pair.png` |
| Site builds | [Before](before-build.txt), [after](after-build.txt) | Build command above |

Initial proof tests exposed the box's missing `ssh-keygen`. Installing the declared OpenSSH prerequisite made the full suite pass.
The current skills CLI requires a newer Node than this box's default; discovery was rerun with Node 22, matching the Pages workflow.
