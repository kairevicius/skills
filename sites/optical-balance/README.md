# Optical balance site

Measured examples, a write-up, and an interactive alignment demo for the optical-balance skill.

[Site](https://kairevicius.github.io/skills/optical-balance/) · [Skill](../../skills/optical-balance/SKILL.md)

## Build and check

Run from the repository root:

```bash
export SKILL_ROOT="$PWD/skills/optical-balance"
(cd "$SKILL_ROOT/scripts" && npm ci && npm test)
node sites/optical-balance/build-docs.mjs
node sites/build-docs.mjs
node sites/optical-balance/colour-test.mjs
node scripts/site-smoke.mjs
```

Every figure and measurement comes from the skill's real code. The optical build writes `dist/`; the site assembly writes `_site/`.
Use `node sites/optical-balance/build-docs.mjs --inline` for pages with embedded figures.

The shared layout lives in `../site.mjs` and `../style.css`. Change generators rather than generated HTML.
`sources/` holds the larger test artwork and never installs with the skill.

Smoke checks use Playwright's Chromium or the executable in `OPTICAL_CHROMIUM`.
On the shared box, wrap builds and browsers with `flock /workspace/codex/b2/box-heavy.lock`.

## License

[MIT](../../LICENSE). Logos are their owners' trademarks. The portrait is public domain.
