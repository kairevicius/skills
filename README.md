# Skills

Agent skills that turn design decisions and git history into results you can check.

[Browse the site](https://kairevicius.github.io/skills/) · [Optical balance write-up](https://kairevicius.github.io/skills/optical-balance/write-up.html) · [Live demo](https://kairevicius.github.io/skills/optical-balance/demo.html)

## What they do

- **Optical balance** estimates the visual center and perceived size of logos and icons, gives you a CSS offset, and checks the rendered result. Its heuristic does not prove human preference.
- **Proof** turns one person's git history into evidence-backed claims and reports. A recipient can re-derive a received proof from the public repository.

They work with any agent that reads skills, including Claude Code, Codex, Cursor, OpenCode, and Gemini CLI.

## Install

Use Node 22.20 or later for the skills CLI.

```bash
npx skills@latest add kairevicius/skills
```

The CLI asks which skills and agents to install for. To choose one skill:

```bash
npx skills@latest add kairevicius/skills --skill optical-balance
```

Add `-a <agent>` to pick agents, for example `-a codex -a cursor`. Add `-g` for a user install.
Without the CLI, copy a folder from `skills/` into your agent's skills folder.

## Quick start

Ask your agent:

```text
Use optical-balance to center this logo in its tile and check the result.
Use proof to turn my work in this repository into evidence. Include the gaps.
Use proof to verify this candidate's proof.json from the public repository.
```

For scripts, set `SKILL_ROOT` to the folder containing the installed skill's `SKILL.md`.
The following optical example runs from a checkout of this repository:

```bash
export SKILL_ROOT="$PWD/skills/optical-balance"
(cd "$SKILL_ROOT/scripts" && npm ci)
node "$SKILL_ROOT/scripts/optical.mjs" place \
  "$SKILL_ROOT/fixtures/icons/triangle-fill.svg" \
  --container 96 --element 60 --plate '#111' --fg '#fff' --out pair.png
```

Optical balance needs Node compatible with sharp; see its [package.json](skills/optical-balance/scripts/package.json).
Proof needs git 2.40+, Node 18.17+, and OpenSSH 8+ for signing and verification. It has no npm dependencies.
Set `SKILL_ROOT` to the proof folder, then run extraction from the target repository:

```bash
node "$SKILL_ROOT/scripts/git-evidence.mjs" --print --author me@example.com
```

Extraction starts the workflow. Follow the skill to write claims, validate, render, and optionally sign the report.

## Reference

- [optical-balance](./skills/optical-balance/SKILL.md) — measurement workflow, commands, and limits. [Site](https://kairevicius.github.io/skills/optical-balance/).
- [proof](./skills/proof/SKILL.md) — generation, validation, signing, and independent verification. [Site](https://kairevicius.github.io/skills/proof/).

## Develop

Read [AGENTS.md](AGENTS.md). Only `skills/<name>/` installs; websites and larger sources stay under `sites/`.

```bash
node scripts/check-repo.mjs
(cd skills/optical-balance/scripts && npm ci && npm test)
(cd skills/proof/scripts && npm ci && npm test)
node sites/optical-balance/build-docs.mjs
node sites/build-docs.mjs
node scripts/site-smoke.mjs
```

Smoke checks require Playwright's Chromium, installed with `npx playwright-core install chromium` from `skills/optical-balance/scripts`.
Set `OPTICAL_CHROMIUM` to use another Chromium executable. Pages runs the checks before publishing pushes to `main`.

## License

[MIT](LICENSE). Brand logos are their owners' trademarks and appear as test material.
[Bootstrap Icons](https://icons.getbootstrap.com/) fixtures use the MIT license.
Vermeer's *Girl with a Pearl Earring* is in the public domain.
