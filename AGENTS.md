# Working on this repository

These rules are for any agent or person who changes this repository. `CLAUDE.md` imports this file, so every agent reads the same rules.

## Layout

- `skills/<name>/` is the folder that the installer copies. Put only what the skill needs at run time in it: `SKILL.md`, reference files in UPPERCASE such as `METHOD.md`, `agents/openai.yaml`, `scripts/`, and small licensed `fixtures/`.
- `sites/<name>/` holds the skill's website and its larger sources. It never installs.
- `.agents/install-block.md` holds the only install wording.
- `scripts/check-repo.mjs` checks the structure. The Pages workflow runs it on every push.

## Every skill

1. The folder name equals the `name` in the frontmatter.
2. The `description` is in double quotes. An unquoted colon followed by a space makes the frontmatter invalid YAML, and the skills CLI then skips the skill without an error.
3. `agents/openai.yaml` gives `interface.display_name` and `interface.short_description` for the Codex skill picker.
4. `README.md` has a line in **Reference** that links the skill name to its `SKILL.md`, and `sites/index.html` lists the skill.
5. Its tests run from its own `scripts` folder and need no file outside the skill folder.
6. It works for any agent that reads skills. Name a harness only as an example, and never hard-code one harness's install path or flag.

## Invocation

Each skill is model-invoked or user-invoked. Decide it on purpose: could an agent usefully reach for this skill on its own?

- **Model-invoked** (the default): the agent or the user can start it. The `description` is for the model: what the skill does, then quoted trigger phrases. Add no invocation flags.
- **User-invoked**: only the user can start it, by typing its name. Add `disable-model-invocation: true` to the frontmatter, and add `policy: { allow_implicit_invocation: false }` to `agents/openai.yaml`. Set both or neither. The `description` becomes a one-line summary for a person.

When a skill needs another skill, write `Call the Skill tool with "<name>"`, one call for each skill. Do this only for a model-invoked skill. For a user-invoked one, tell the user to run it.

## SKILL.md house style

Use one skeleton: quoted triggers in the description, **Scope** ("It does ONE thing"), numbered **Hard rules**, a **Workflow** in phases, **Decision points**, **Verification gates**, **Known limits**, and **Files**. Load reference files on demand. Write plain sentences of 25 words or fewer, and use one term for each concept.

Every number in a skill or on a site is a measurement, and it comes with the command that reproduces it. A site page is build output: change its generator, never the HTML.

## Install wording

Copy install commands from [.agents/install-block.md](.agents/install-block.md) without changes. The site generators read that file at build time.

## Before you push

```bash
node scripts/check-repo.mjs
cd skills/<name>/scripts && npm ci && npm test
node sites/<name>/build-docs.mjs
```
