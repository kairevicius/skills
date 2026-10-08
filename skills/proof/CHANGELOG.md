# Changelog

One entry per `proof_version`. Only schema and rule changes are listed: what a
document must contain, what the validator rejects, what the scripts emit.
`schema/proof.schema.json` holds the accepted range (`proof_version.pattern`)
and the current version (`proof_version.default`); nothing else does.

## 0.3.0

A proof's author is a candidate who wants the job, so the document can no longer
carry a verification claim about itself. Trust moves to a recipient-side
`verification.json`, bound to the exact bytes received by SHA-256 and produced by the
recipient's own copy of the skill against the public repository — never by anything
the candidate sent. **0.2.x proofs do not validate under this schema and must be
regenerated.**

Schema

- `provenance.verification` is removed. `provenance.environment {git, node}` is added.
- `subject.identities` are exact ASCII emails (1–10), matched by ASCII-lowercase
  equality on the raw author email: no mailmap, no name match, no Unicode case
  folding, no substrings, no wildcards. An entry like `"@"` is now a schema violation,
  not a permissive pattern that happens to match everyone.
- `subject.account {host, login}` (host: github.com, gitlab.com, or codeberg.org)
  replaces `subject.profile_url`. Verify checks a signature against it and binds every
  identity email to it; the renderer derives the profile link from it, and it is
  omitted from display when the document is redacted.
- `evidence[].measures[] {token, source, key?, field}` binds each number an evidence
  description states to the value verify re-derives (`source`: summary, context,
  scope, or blame).
- Path references may not be empty, `.`, or `./`, may not start with `/` or `:`, and
  may not contain `..`. `repository.remote` may not carry userinfo (a credential
  embedded in the URL).
- No evidence `ref` may start with `-`. A commit ref such as `--output=<path>` reached
  git as an option, and `git log --output` writes a file wherever the path points,
  with content the repository controls. The checks now also validate every commit and
  range ref before any git call, and the audit pack passes only full SHAs.
- New caps: 30 claims, 100 evidence items, 5 measures per evidence item, 400-character
  evidence and narrative descriptions.
- New `schema/verification.schema.json`: a recipient's verification document —
  outcome, identity, counts, signals, per-evidence and per-claim results, notes.

Validator and checks (logic now lives in `scripts/lib/checks.mjs`, shared by
`validate-proof.mjs` and `verify-proof.mjs`)

- **Link 1** (claim → evidence): every number in a claim's `claim` and `short` must
  appear in the description of evidence it cites — and so must every number in
  `subject.headline`, `project.subject_slice`, and `narrative.authorship`. A count
  word (`tripled`, `doubled`, `halved`, `tenfold`, `dozen`, `hundred`, and the rest) in
  a claim is rejected outright: counts must be digits so they can be traced.
- **Link 2** (evidence → git): every number in an evidence description must be
  *re-derived* (a `measures` entry, a commit's own insertions/deletions/files, a
  range's commit count, or a PR number), *self-reported* (found in a cited commit's
  subject line — never its body), or the evidence fails as *unbacked*. A measure whose
  scope matches 90% or more of the subject's commits is flagged as too broad to be
  meaningful.
- **Ownership facts**: for every cited file, directory, PR, or range, the subject's
  blame share at `head_sha`, their share of commits touching the path, and a count of
  other identities. Exclusivity words (`sole`, `solely`, `entire`, `only`, `owns`,
  `single-handedly`, `from scratch`, `architected`) are flagged when the facts fall
  below half; words git cannot check (`led`, `managed`, `mentored`) always get a
  required interview question instead of a verdict.
- Repository facts (`context.*`, `project.first_commit`, first/last authored commit)
  are re-derived and must match, the same as `summary` already was.
- Summary drift has two codes. `diff_stat_drift` covers the diff-derived fields
  (`lines_added`, `lines_removed`, `files_touched`, `test_touches`, `test_files`), which
  rename detection can shift between git versions. `summary_drift` covers the
  history-derived fields, which cannot. An evidence item fails only on a trust
  finding; its hygiene findings still list under its problems.
- `provenance.verification = git_verified` is gone along with the field: there is
  nothing left for the candidate's own run to assert about trust.

Verify mode (new: `scripts/verify-proof.mjs`, `scripts/lib/identity.mjs`)

- Four outcomes: **reproduced** (every mechanical check passed against the public
  repository), **contradicted** (something in the evidence register is false,
  reported as "k of n items"), **inconclusive** (a network failure or timeout, git
  older than 2.40, a signature that could not be checked here, or only diff-derived
  counts differing under a recorded, different git version — re-run or ask),
  **not_reproducible** (redacted, no remote, a disallowed host, a refused clone, or
  `head_sha` on no public branch or tag — neutral, since most professional work is
  private). A proof that records no git version gets no version allowance.
- Identity binding, shown separately from the outcome: **bound** (a valid signature by
  a key on `subject.account`, every identity email belongs to it), **unbound** (no
  signature, or an email can't be bound), **conflict** (a bad signature, or an email
  belongs to another account). GitHub/GitLab noreply emails bind offline from the
  address itself; another GitHub email binds through one commit lookup's
  `author.login`. `ssh-keygen -Y verify`/`-Y sign` do the cryptography; an account's
  public keys come from `https://<host>/<login>.keys` or a local `--keys-file`
  override.
- URL policy: `https` only (`file://` behind `--allow-file-remote`, testing only), no
  userinfo, no leading `-`, host in {github.com, gitlab.com, bitbucket.org,
  codeberg.org} plus any `--allow-host`. The fetch is always
  `+refs/heads/*:refs/heads/* +refs/tags/*:refs/tags/*` — **never a raw SHA refspec**
  — and the outcome is Not reproducible when `head_sha` is not reachable from what was
  fetched.
- `verify-proof.mjs <proof.json> --work <dir>` copies the exact bytes and the signature
  (`<proof.json>.sig` by default), hashes them, clones, and writes
  `<dir>/verification.json` (every claim's `audit: null`) plus an audit pack under
  `<dir>/pack/`: an escaped copy of the proof, the cited commits and the commits inside
  cited ranges, file excerpts, and directory listings. Hidden characters (bidi, tag
  characters, zero-width) are escaped and counted, and text addressed to a reviewer or
  an AI is flagged on the commit and on every claim that cites it.
- `verify-proof.mjs --finalize <dir>` takes the same flags as the first pass. It
  re-fetches into the kept clone with `--prune`, re-checks the signature against keys
  fetched again, re-derives every mechanical field, and takes only `claims[].audit`
  from `<dir>/verification.json`. Then it renders `verified.md`/`verified.html` and
  deletes the clone.

Reproducibility (`scripts/lib/evidence.mjs`)

- Every git call now runs through a sanitized environment: `GIT_*` and `SSH_ASKPASS`
  dropped, `GIT_CONFIG_NOSYSTEM=1`, an empty temp `HOME`/`XDG_CONFIG_HOME`,
  `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, and pinned `-c` values (rename detection on at
  50%, Myers diff, mailmap off, blame ignore-revs off, no credential helper). A local
  `diff.renames=false`, a stray working-tree `.mailmap`, or `GIT_CONFIG_PARAMETERS`
  can no longer change what a proof reports.
- `--attr-source=<head_sha>` reads `.gitattributes` from the analysed commit, not the
  working tree. On git older than 2.40 (which lacks the flag) the extractor omits it,
  warns, and records the git version in `environment`, so a recipient can tell a real
  discrepancy from a tool-version difference.
- One in-house, linear-time glob engine replaces `node:path`'s `matchesGlob`, so scope
  matching is identical on every supported Node version.
- Blame attribution keys off membership in the subject's own commit-SHA set, not name
  matching, and works against a bare clone.

Renderer

- The candidate's own report carries no seal and no "Verification:" line. The seal
  now appears only in a recipient's `verified.html`, only when the outcome is
  Reproduced and identity is bound: "Verified by {by} · {date}".
- New shared trust-note language: the report says a recipient can re-derive its
  numbers and claims with `/proof verify`, rather than asserting anything about the
  run that produced it.
- A recipient view (outcome, identity, counts, signals, problems, notes, environment,
  a per-claim verdict glyph, reasons, questions, ownership facts, and an interview
  questions section) is layered onto the same claim/evidence rows.
- The logo is always an inert `<img src="data:image/svg+xml;base64,…" alt="">`; a CSP
  meta tag (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`) is now on
  every render.
- `--accent-text` moved to `#0b78bc` (4.62:1 contrast; was 4.49:1).

Signing (new: `scripts/sign-proof.mjs`)

- Picks a local key that appears in the target account's public keys, signs with
  `ssh-keygen -Y sign -n proof-skill`, writes `proof.json.sig`, and self-verifies.
  `--key` names a specific local key; `--keys-file` substitutes a local file for the
  network fetch (tests, and accounts without discoverable keys). Exits 1 when no
  local key matches the account; exits 2 when the matching key isn't loaded in
  `ssh-agent`.

Skill

- `SKILL.md` gains a "Workflow: Verify" section (for recipients), an "Identity"
  section, exit code 5 (`--rev` names a revision that doesn't exist), and
  `Bash(ssh-keygen:*)` in `allowed-tools`. Paths are written against "the skill
  folder" so the instructions read the same outside Claude Code.
- `README.md` gains "Using proofs in hiring": what each outcome means, why a person
  must make the decision, and why a recipient never accepts a candidate-supplied
  `verified.html` or `verification.json`.
- `evals/evals.json` fixture expectations follow the current fixture (6 subject
  commits, not 5); every `git_verified` expectation is gone; new evals cover a signed
  proof reproducing and binding, a tampered number ending Contradicted, an unsigned
  proof ending unbound with no seal, a claim that must use a digit instead of a count
  word, and a commit message that tries to instruct the auditing agent directly.
- The skill moves into the kairevicius/skills repository and follows its layout.
  The reference files are `VERIFY.md`, `HIRING.md` (formerly the README's hiring
  section), `ROLE-BASELINES.md`, `REPORT-TEMPLATE.md`, and `HTML-REPORT.md`. The
  worked examples are in `fixtures/`, the evals are in `sites/proof/`, and
  `npm test` in `scripts/` runs the suite. `SKILL.md` drops `allowed-tools` and
  `argument-hint` and names no single agent's paths.

Known limits

Deferred past 0.3.0, and listed here rather than silently absent: an independence
badge and a repo-age check (need a forge API); a fork-upstream check and `patch-id`
cherry-pick detection; PR ownership share; GitHub web-flow signature verification;
scripted-history heuristics (all-`:00` timestamps); generic or shared email detection;
a co-authored attribution class; per-minor exclusion tables; partial clones and
streamed git output for very large repositories (a 1 GiB buffer exceeds Node's string
limit); credentialed private-repo verification; email binding for non-noreply GitLab
and Codeberg addresses; the previous ≤ 1% cross-version tolerance, replaced outright
by the Inconclusive outcome pending a real drift measurement.

## 0.2.0

Deterministic pipeline: evidence extraction, validation, and rendering are
scripts; the model drafts claims and nothing else.

Schema

- `summary.ai_coauthored_commits` is required; `ai_assisted_commit_share` must
  equal it divided by `authored_commits` (within 0.005).
- New optional fields: `summary.test_touches`, `summary.test_files`,
  `repository.context.since`, `repository.project.subject_slice`,
  `repository.project.logo_path` (in-tree SVG), `subject.role_family`,
  `claims[].short`, top-level `capabilities[]` and `narrative.authorship`.
- `gaps` requires at least one entry.
- `claims[].category` gains `design`, `documentation`, `content`,
  `data_science`, `accessibility`, `localization`, `tooling`.
- `evidence[].type` gains `document` and `asset` (path references, like `file`).
- Accepted range is `0.1.x` and `0.2.x`; 0.1.x documents still validate
  structurally and fail only on defects the new rules catch.

Validator

- Validates against the schema file (so unknown fields fail) instead of
  hand-rolled shape checks; non-array `claims`/`evidence`/`skills` fail.
- `provenance.verification = git_verified` is rejected unless the run uses
  `--git` and passes.
- Skill `level` must match the score band; a claim with a single commit,
  file, or test reference caps at confidence 0.6.
- Arithmetic consistency: monthly activity sums to `authored_commits`, the
  recent window never exceeds it, `span_days` is the UTC day difference of the
  authored dates, `active_days` fits the span, ranks and totals are coherent.
- Redaction is checked both ways; `profile_url` must match a noreply identity
  and is forbidden when redacted.
- Narrative fields reject code-like text, secret shapes, and emails that are
  not the subject's.
- `--git` pins every check to `head_sha`: commits must be authored by the
  subject and reachable; paths must exist at `head_sha` and have been touched
  by the subject; pull-request numbers must resolve to the subject's commits;
  `summary` is re-derived from the repository and must match; a privacy sweep
  fails on any other contributor's name or email. The PASS line reports
  resolved and skipped counts.
- `--rendered <dir>` byte-compares `proof.md` and `proof.html` with a fresh
  render.

Scripts

- `scripts/git-evidence.mjs` replaces `git-evidence.sh`: one git traversal,
  literal author matching (a `+` in a noreply address is not a regex), UTC day
  arithmetic, both test metrics, a `--since`-aware recent window, exit codes
  for malformed dates (2), zero commits (3), and shallow clones (4), and
  machine-readable `proof/evidence.json` with scoped counts, blame shares, and
  a pull-request table. Only the subject's identities appear in it.
- `scripts/render-proof.mjs` renders `proof.md` and `proof.html` from
  `proof.json`; the skill bar is `floor(score * 10)`; forge links normalise
  the remote and cover GitHub and GitLab; pull requests link too.
- `node --test scripts/test/*.mjs` builds a fixture repository with known
  numbers and exercises the extractor, validator, and renderer.
- Path counts follow git's default rename detection, so a reader who runs
  `git log --name-only` on the same exclusions reproduces them.
- `--since` is applied in the extractor rather than passed to `git log`: git
  fills a bare date's missing time-of-day from the current wall clock, which
  made the same command return different counts at different times of day.

Skill

- Bundled files are referenced through `${CLAUDE_SKILL_DIR}`; `allowed-tools`
  pre-approves the read-only git subcommands and `node`.
- The report reads "this file contains no source code"; the previous "no
  source code left the machine" overstated what the pipeline guarantees.
- `argument-hint` is a Claude Code extension; drop it before uploading the
  skill to claude.ai or the Skills API, which accept only the six spec fields.

## 0.1.2

- `repository.project` (name, description, first_commit, structure) for the
  report title and "The project" section.
- Report title names the project; levels render as evidence-strength words.

## 0.1.1

- `subject.headline`, `subject.profile_url`, `repository.context`,
  `summary.recent_commits_90d`, `summary.activity_by_month`, top-level `stack`
  (every entry must carry evidence).

## 0.1.0

- Initial format: subject, repository, summary, skills, claims, evidence,
  gaps, provenance. Claims reference a deduplicated evidence register by id;
  confidence floors at 0.5; authorship is classified, never penalised;
  `git_verified` is earned by a passing `--git` run.
