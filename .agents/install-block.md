# The canonical install block

One install story, one wording. `README.md` and every site page use these blocks and nothing else. Change them here first. The site builds read this file, and `scripts/check-repo.mjs` checks `README.md` against it.

The commands name no agent. The skills CLI asks which agents to install for, and it supports Claude Code, Codex, Cursor, OpenCode, Gemini CLI, and many more.

## The whole set

<canonical-block name="whole-set">

```bash
npx skills@latest add kairevicius/skills
```

</canonical-block>

## One skill

Replace `<skill>` with the skill's folder name.

<canonical-block name="one-skill">

```bash
npx skills@latest add kairevicius/skills --skill <skill>
```

</canonical-block>

## Options to mention in prose

- `-a <agent>` picks agents up front, for example `-a codex -a cursor`.
- `-g` installs for the user instead of the current project.
- Without the CLI, copy a folder from `skills/` into the agent's skills folder.
