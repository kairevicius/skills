# proof.md template

`scripts/render-proof.mjs` renders `proof.md` from the validated `proof.json`
in this shape; this file is the specification it implements, kept so the
output can be reviewed against intent. Keep the order. Every bullet ends with
its evidence ids in parentheses so a reader can jump from any statement to the
registers at the bottom. Strings from `proof.json` are emitted verbatim: the
headline, claim texts, stack names, gaps.

The first screenful is written for a recruiter, not an engineer: it must answer
who this is, what role the evidence supports, whether the document can be
trusted, and whether the work is current — before any register appears.

This template describes the **candidate view**: what `renderMarkdown(doc)`
produces with no `verification` argument. Nothing here is a self-attestation —
the document carries no seal and no "this was verified" line of its own. The
"How to read this" note says exactly that: a recipient re-derives the numbers
themselves. The **recipient view** — `renderMarkdown(doc, { verification })`,
built from a recipient's own `verify-proof.mjs` output — is the same document
with a verification layer added on top; see "Recipient view (verify mode)"
below. With `verification` omitted or null, the two renders are byte-identical.

Bar rendering: `floor(score * 10)` filled blocks (`█`), the rest empty (`░`) —
floor, so two scores in different bands never draw the same bar (0.74 → 7,
0.68 → 6).
Levels come from the score: `very_strong` ≥ 0.85, `strong` ≥ 0.70,
`moderate` ≥ 0.50, `weak` below. Render them as evidence-strength words,
never as bare proficiency adjectives — a reader must not mistake the level
for a skill rating: `very_strong` → "Extensive evidence", `strong` →
"Strong evidence", `moderate` → "Moderate evidence", `weak` → "Thin
evidence". Scores and levels are the subject's self-assessment, never
mechanically checked, so every place a score or level appears says so
("self-assessed confidence" in the claims register header; "Scores and
levels are self-assessed." in the Skills legend).

The title names the PROJECT, not the person: a subject runs one proof per
project, so the project is what distinguishes this page from their other
proofs. {project name} below is `repository.project.name` when present,
else `repository.name`. The subject opens the byline line instead.

```markdown
# Proof of work — {project name}

**{subject.name}** — {subject.headline, first letter lowercased}

{repository.name} · {summary.authored_commits} authored commits over
{span, humanized: "14 months"} · {when repository.context present:
"#`{subject_rank}` contributor of {total_authors}"} ·
{when summary.recent_commits_90d present: "{n} commits in the last 90 days"} ·
generated {analyzed_at, date only} · proof v{proof_version}
{when subject.account present and not redacted: a plain profile link line,
"{GitHub|GitLab|Codeberg}: https://{account.host}/{account.login}"}

> **How to read this.** The subject generated this report from the
> repository's git history. Every number and claim cites evidence in the
> registers below; a recipient with access to the repository can re-derive
> them with `/proof verify`. The gaps section lists what the repository does
> NOT show, on purpose. The report is also bounded to this repository's git
> history: work that happens outside code — design, product direction,
> planning, review — does not appear here. Read it as a floor, not a ceiling.

## The project

Rendered only from `repository.project` (plus `repository.context`); when the
object is absent, omit the whole section.

{repository.project.description}

{one facts line composed from project + context: "In development since
{project.first_commit, humanized: 'January 2025'}; {context.total_commits}
commits by {context.total_authors} contributors; {project.structure}." —
include only the parts that are present}
{repository.project.subject_slice — one sentence locating the subject's slice
of it; omitted when absent}

## Skills

The bar shows how strongly this repository's history backs the claims
beneath it — evidence strength, not a skill rating. Scores and levels are
self-assessed. (One line, rendered under this heading.)

### {skill.name}  {bar}  {Evidence-strength label}
- {claims[].short when present, else the full claim} ({evidence ids})
- {claim} ({evidence ids})

### TypeScript  █████████░  Strong evidence
- Designed the shared type system consumed by both apps (e4, e5)
- Migrated the ingestion layer from JavaScript to strict TypeScript (e2, e9)

In a recipient view, each bullet is prefixed by its verdict glyph and word
(see "Recipient view (verify mode)" below): `- ✓ supported — Designed the
shared type system... (e4, e5)`.

## Stack

Only when `stack` is present. One line per technology, comma-separated or as a
compact list, each name followed by its evidence ids:

TypeScript (e19) · React (e16, e19) · Three.js (e1) · Storybook (e22) · …

## Demonstrated capabilities

One line per entry of `capabilities[]` (its `label`). When the document has
no `capabilities`, one line per claim category that has at least one claim at
confidence ≥ 0.7, through the renderer's fixed label table.

✓ Product engineering
✓ Debugging
✓ Component architecture

## How the work was produced

`narrative.authorship`, only when summary.ai_assisted_commit_share > 0.1.
The paragraph states the share, then describes what the history shows the
subject doing around the generated code: specifying, reviewing, refactoring,
testing, shipping. Framed as the demonstrated capability it is — never as a
disclaimer. When the field is absent, the renderer emits one sentence built
from `ai_coauthored_commits` and the share.

## Weak or no evidence

At least one entry; the validator rejects an empty list.

– {gap}
– {gap}

## Verification

Recipient view only (omitted entirely from the candidate view — see below).

## Claims register

| id | claim | category | self-assessed confidence | authorship | evidence |
|----|-------|----------|-----------:|------------|----------|
| c1 | ... | architecture | 0.94 | hand_authored | e1, e4 |

## Evidence register

| id | type | ref | description |
|----|------|-----|-------------|
| e1 | commit | 8123abc... | ... |

## Interview questions

Recipient view only (omitted entirely from the candidate view — see below).

## Provenance

Generated locally by {provenance.generator} against commit {head_sha}.
This file contains paths, hashes, and metrics and no source code.
```

Rules that keep the report honest:

- Never render a skill bar without at least one claim behind it.
- The headline is written LAST, from the finished claims, and may assert
  nothing the claims don't back — no adjectives ("world-class", "expert")
  that no evidence id could support. Name the work, not the worth:
  "Frontend-focused product engineer who owns rendering-heavy UI and the
  marketing surface end to end" — not "exceptional React developer".
- Every `stack` entry carries evidence ids; a technology that appears in no
  claim and no metric does not appear in the strip.
- The project description asserts nothing about the subject — it exists so a
  stranger knows what the repository builds before reading the claims. No
  marketing language: the reader should learn what the project is, not be
  sold on it.
- Never soften a gap ("limited exposure to...") — name it plainly.
- The report is written for a stranger: no internal project codenames
  without a one-clause gloss, no acronyms the repo alone defines.
- If `repository.redacted` is true, the title is "Proof of work —
  {subject.name}" (no project or repo identity exists to show), the header
  says "a private repository" instead, and the profile line is omitted (an
  account link would identify the repository host account). The project
  section keeps only its domain-generic description.
- The candidate view carries no seal and no self-attestation: the colophon
  states the generator, the head commit, and "no source code" — never a
  verification level, since nothing the candidate's own file asserts is
  trusted. A recipient decides trust by running `/proof verify` themselves.

## Recipient view (verify mode)

`renderMarkdown(doc, { verification })`, where `verification` is a finalized
`verification.json` a recipient produced with their own `verify-proof.mjs`
against the same bytes. This is the same document above, with a verification
layer added; nothing candidate-authored changes meaning. Three additions:

1. **Masthead word**, rendered as the very first line of the document, before
   the title: the outcome in plain words — `**Reproduced**`,
   `**Contradicted**`, `**Inconclusive**`, or `**Not reproducible**`. Only
   when the outcome is `reproduced` **and** `identity.status` is `bound` does
   it also carry `— Verified by {verified_by} · {verified_at, date only}`.
   Every other combination — including `reproduced` with an unbound identity
   — renders the bare word and nothing else. This is the only place
   "verified" can be claimed, and it is never in the candidate's own file.
2. **A "Verification" section**, right after "Weak or no evidence" and before
   the claims register: the reason; identity (status, account, signature,
   each email's status, and a standing note that an unbound identity means
   the applicant's ownership of these addresses was not proven); evidence
   counts (`k of n evidence items failed`, numbers re-derived / self-reported
   / unbacked); signals, when present, labelled "unauthenticated — whoever
   controls the repository controls these"; problems; notes; the tool/git/
   node environment; and, always, the closing line "A person makes the
   hiring decision; this report is evidence for it."
3. **Per-claim verdicts.** Each skill bullet and each claims-register row is
   prefixed with a verdict word and glyph: `✓ supported`, `◐ partial`,
   `✗ unsupported`, or `? not assessable`. A claim carrying any mechanical
   `problems` always reads `✗ unsupported (mechanical)`, regardless of what
   the audit verdict says — a mechanical failure overrides judgment. The
   claims-register row additionally carries a second line (after `<br>`)
   with the audit's reason, its interview question, ownership facts per
   cited evidence item ("e1: 82% blame, 118 of 140 commits"), and any
   advisory flags. The evidence-register row gets its own second line:
   status, then each number's class and source ("205 = subject commits
   touching apps/website/**", or "17: unbacked"). An **Interview questions**
   section, after the evidence register, lists each claim's audit question.

With `verification` null or omitted, none of the above renders, and the
output is byte-identical to the candidate view described above.
