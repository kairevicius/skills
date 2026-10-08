# proof sources

Material for the [proof skill](../../skills/proof/SKILL.md) that the installer does not copy. The skill has no site yet.

- `evals.json`: prompts and checkable expectations for evaluating the skill with and without it loaded. Build the fixtures first with `node skills/proof/scripts/make-fixture-repo.mjs --out <fixture> --design-out <design-fixture>`, and add `--bare-out <bare>` when an eval needs a remote that `verify-proof.mjs` can fetch over `file://`.
