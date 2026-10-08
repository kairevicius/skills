# proof.html requirements

`scripts/render-proof.mjs` renders `proof.html` from the same validated
`proof.json` as `proof.md`, with the same section order and the same honesty
rules (see `report-template.md`); this file is the specification it
implements.
The HTML version exists for one reader: a recruiter who receives a link or a
file, skims for 30 seconds, and forwards a PDF. Every requirement below serves
that reader.

## Design language — a typeset audit paper

The document's identity is verification, so it is set like an audit paper,
not a web page. The rules:

- **One family, four sizes, two weights.** The system UI sans
  (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial,
  sans-serif`) carries everything — no monospace, no other family. The whole
  scale is five tokens, defined once on `:root` and used everywhere via the
  `font` shorthand:
  - `title` — 600 1.9rem, the document name only;
  - `body` — 400 1rem, all narrative prose (headline, claims, gaps, note);
  - `data` — 600 0.8125rem, everything checkable: ids, SHAs, refs, scores,
    fact values (with `tabular-nums` on aligned numbers);
  - `caption` — 400 0.8125rem, quiet support text: table cells, captions,
    the legend, the colophon;
  - `label` — 600 0.6875rem uppercase, 0.12em letterspacing, small
    wayfinding: section headings, fact labels, table heads, level tags.
  No element gets a bespoke size or weight outside these (a media query may
  scale the title). The reader learns the split once: regular is narrative,
  semibold is checkable data.
- **No chrome.** No cards, boxes, pills, chips, or filled tags anywhere.
  Hierarchy comes from the type scale, whitespace, and hairline rules only
  (table row separators, one rule under the header facts, one above the
  colophon). The trust note is a plain small-type paragraph with a bold
  run-in label, not a bordered callout.
- **One accent, one meaning.** A single accent hue — verification blue,
  the vernacular color of a verified badge (`#1DA1F2`) — appears only where
  something is verifiable or verified: evidence-id links, register ids, the
  skill-bar fill, the activity bars, the seal, the `:target` row highlight.
  Never decoratively. Graphics use the pure hue; small text links use a
  darker step of it (`#0B78BC`) to hold 4.62:1 contrast on the paper
  background (the prior `#0C7ABF` measured 4.49:1 — under the 4.5:1 floor).
  A verdict or an outcome word is never colored by this accent, or by red or
  green: see "Recipient view (verify mode)" below — meaning is carried by
  the word and a glyph, in ink or `--soft`, because color alone can't be
  trusted to carry a pass/fail distinction on this palette.
- **Minimal data graphics.** Each skill carries one measurement, at one
  place: on the title line, directly after the skill name — a fixed-width
  3px hairline bar, then the evidence-strength label. Exactly two elements
  after the name, nothing pinned to the far edge. No numeric score in the
  row — the precise confidence lives in the claims register. The activity
  strip is flat columns on a hairline baseline. No gradients, shadows, or
  rounding.
- **Claim bullets speak in one voice.** Real bullet markers (•, faint), no
  bold lead-ins or mixed colors inside a bullet — uniform regular text, with
  the evidence ids as the only accented element.
- Section headings are small letterspaced uppercase semibold labels. The
  single centered column (~700px) IS the reading measure: every text element
  runs the full column width — no per-element `max-width` caps that make
  some paragraphs wrap narrower than others.

## Self-containment

- One file. Inline CSS only; no external stylesheets, fonts, scripts, or
  images beyond inline SVG / data: URIs. Font stacks are system stacks (see
  the design language above).
- No JavaScript. Everything below works with CSS and anchors alone.

## Safety

The document embeds candidate-controlled text and a candidate-chosen logo,
and must be safe to open regardless of what either contains.

- `<meta http-equiv="Content-Security-Policy" content="default-src 'none';
  style-src 'unsafe-inline'; img-src data:">` sits in `<head>`, unconditionally,
  in both the candidate and the recipient view. It blocks everything except
  the page's own inline stylesheet and `data:` images — consistent with "no
  JavaScript" above, since nothing here needs a script-src allowance.
- Every candidate-controlled string (claims, descriptions, names, reasons,
  questions, paths, refs, notes) is HTML-escaped (`&<>"'`) before it reaches
  the page. Before that, Unicode bidi-override, zero-width, and tag
  characters (the ranges a right-to-left override, a zero-width space, or an
  invisible Unicode tag character fall in) are replaced with a visible
  `\u{XXXX}` escape — these can reorder or hide text, or smuggle a message to
  an AI reader, without any HTML syntax at all, so entity-escaping alone
  isn't enough. A payload like `</style><img src=x onerror=alert(1)>` renders
  as inert escaped text, never a live tag.
- The logo is always an `<img src="data:image/svg+xml;base64,…" alt="">`,
  never inline `<svg>` DOM — see "Project mark" below for why.

## Project mark

- When `repository.project.logo_path` names an in-tree SVG (at most 64 KB;
  prefer the full mark), the renderer embeds it in a masthead row above the
  title: the mark, then the repository name (linked to the forge), then —
  recipient view only — the outcome word. The mark is always an
  `<img src="data:image/svg+xml;base64,…" alt="">`, never inline `<svg>`
  DOM: an image loaded this way cannot execute script or be reached by page
  CSS, so a candidate-supplied logo can't hide the outcome or run anything,
  even though its bytes are untrusted. Set around 20px tall; prefer the full
  logo (mark + wordmark) over an icon-only mark when the tree carries both.
- Never fetch a logo from the network, at render time or generation time —
  the analysis is local; in-tree assets only. No logo found means no mark:
  the masthead keeps the repo name (and, in a recipient view, the outcome).
- When `redacted` is true, render no mark and no repository name.
- The seal (a scalloped eight-lobed badge with a white check, inline SVG in
  the accent color — this one small graphic stays inline DOM, since it is
  the renderer's own fixed markup, never candidate-supplied) appears only in
  a recipient view, and only when the outcome is `reproduced` **and**
  `identity.status` is `bound`. It is never present in the candidate's own
  `proof.html` — see "Recipient view (verify mode)" below.

## Theming

- The document is paper: one light palette, committed. Define it as custom
  properties on `:root` and do NOT add a `prefers-color-scheme: dark`
  override — the report renders light in every viewer, like the PDF it will
  become.
- Paint `body` with an explicit background token — never rely on the host's
  default canvas (a transparent body would inherit a dark host theme).

## Print (recruiters forward PDFs)

- `@media print`: pure white background, set `print-color-adjust: exact`
  (plus `-webkit-print-color-adjust`) on skill bars and activity bars so
  they survive "no background graphics".
- `tr { break-inside: avoid; }` on the registers; keep each skill block
  (`break-inside: avoid`) intact.
- Hyperlinks keep their text; do not inject URLs after links (SHAs and paths
  are already printed as text in the registers).

## Navigation and verification affordances

- Every evidence-id suffix on a bullet or register row is an anchor link
  (`href="#e7"`) to that row in the evidence register; give register rows
  `id="e7"` and style `tr:target` with a soft accent-tinted row background.
- When `repository.remote` is a known forge and `redacted` is false, deep-link
  the references so a reader with access can open them. The remote is
  normalised first: strip a `.git` suffix; `git@host:org/repo` and
  `ssh://git@host/org/repo` become `https://host/org/repo`. Then, by host:
  - GitHub: commit → `<forge>/commit/<full-sha>`, file/document/asset/test →
    `<forge>/blob/<head_sha>/<path>`, directory → `<forge>/tree/<head_sha>/<path>`,
    pull request → `<forge>/pull/<n>`
  - GitLab (host contains `gitlab.`): `-/commit/`, `-/blob/`, `-/tree/`,
    `-/merge_requests/<n>`
  - any other host: no links; refs render as text
  Pin file and directory links to `head_sha`, not a branch name — the proof
  refers to the analyzed state. When the repo is private, keep the links (the
  paths and SHAs still stand as evidence without access); when `redacted` is
  true, render no forge links and no repo name at all.
- `metric` and `pattern` evidence render as plain text refs — never invent a
  URL for them.

## Recruiter-first sections (mirror the md template)

- The title names the PROJECT, not the person — one proof per project, so
  the project is the distinguishing identity. {project} =
  `repository.project.name` when present, else `repository.name`.
  `<title>`: "Proof of work — {project} · {subject.name}" (when `redacted`:
  "Proof of work — {subject.name}"). The masthead row carries the mark +
  linked repository name; the h1 reads "Proof of work — {project}" with the
  document-kind prefix in the faint ink and the project in full ink. The
  subject renders as a semibold byline opening the headline sentence:
  "**{subject.name}** — {headline}".
- Header, after the h1: the headline sentence, then a labeled fact grid
  (profile, authored commits, contributor rank, last-90-days, lines, files,
  active days, AI co-authored share) — small uppercase labels over semibold
  values, never a dot-separated run-on line. The profile fact is derived
  from `subject.account {host, login}` as `https://{host}/{login}`, never
  taken as a URL from the document, and omitted when `redacted` is true or
  `account` is absent.
- The "How to read this" trust note renders directly under the header as a
  plain small-type paragraph with a bold run-in label (see the design
  language — no bordered callout). It carries the
  bounded-to-code sentence from the md template: off-repo work (design,
  product direction, planning, review) does not appear — a floor, not a
  ceiling.
- "The project" block renders directly under the trust note, before Skills,
  when `repository.project` is present: the description paragraph, then the
  facts line (project age from `first_commit`, total commits and contributors
  from `repository.context`, `structure`), then one sentence locating the
  subject's slice. Same content rules as the md template — it describes the
  project, never the subject.
- The Skills section carries the one-line bar legend ("the bar shows how
  strongly this repository's history backs the claims beneath it — evidence
  strength, not a skill rating. Scores and levels are self-assessed."), and
  levels render as the evidence-strength words from `report-template.md`
  ("Extensive evidence", "Strong evidence", …), never as bare proficiency
  adjectives. The claims register's confidence column header reads
  "self-assessed conf." for the same reason: a score or level the subject
  assigned is never presented as a mechanically-checked fact.
- Stack strip: a single wrapped text line, technologies separated by
  middots, each followed by its evidence-id links. Demonstrated capabilities
  render the same way with an accent check mark per item.
- Activity strip: when `summary.activity_by_month` is present, render one
  column per month with height proportional to commits (pure CSS heights,
  e.g. inline `style="height:NN%"` inside a fixed-height row). The strip
  spans the full content column and stands tall enough to read (~72px),
  month labels only where they fit (first month of each year is enough).
  This is the "is the work current?" answer at a glance.

## Layout

- Single centered column, `max-width` around 700px, generous line height.
- Wide tables scroll inside their own `overflow-x: auto` wrapper; the page
  body never scrolls horizontally.
- The registers are the appendix, not the pitch: everything a recruiter needs
  in the first screenful (who / what role / trust / recency), registers below.

## Recipient view (verify mode)

`renderHtml(doc, { logoSvg, verification })`, where `verification` is a
finalized `verification.json` a recipient produced with their own
`verify-proof.mjs`, run against the exact bytes of the candidate's
`proof.json`. With `verification` null or omitted (the default), the output
is byte-identical to the candidate `proof.html` described above — the same
stylesheet, the same hex-color set, no new chrome. `verification` adds three
things, all reusing existing tokens (never a new hex value, never a second
accent meaning):

- **Masthead outcome.** The masthead's right-hand slot (`.masthead .outcome`,
  colored `--soft`) carries the outcome in plain words: "Reproduced",
  "Contradicted", "Inconclusive", or "Not reproducible". Only when the
  outcome is `reproduced` **and** `identity.status` is `bound` does the slot
  switch to `.outcome.sealed` (colored `--accent-text`) and add the seal SVG
  plus "Verified by {verified_by} · {verified_at, date only}". Every other
  combination — including a `reproduced` outcome with an unbound identity —
  shows the bare word, no seal. Outcome words are never red or green: a
  verdict is carried by the word and, per claim, a glyph, never by color
  alone (this palette's accent is only 2.75:1 on the paper background, below
  the floor for meaning-bearing color).
- **A "Verification" section**, rendered between "Weak or no evidence" and
  the claims register (reusing the existing `h2`, `p.body`, `p.body.dim`,
  and `ul.gaps` styles — no new CSS beyond what's listed below): the reason;
  identity (status, account, signature, each email's status, and a standing
  note that an unbound identity means the applicant's ownership of these
  addresses was not proven); evidence counts; signals, when present,
  labelled "unauthenticated — whoever controls the repository controls
  these"; problems; notes; the tool/git/node environment; and, always, the
  closing line "A person makes the hiring decision; this report is evidence
  for it."
- **Per-claim verdicts.** Each skill bullet and each claims-register row is
  prefixed with a verdict glyph and word: `✓ supported`, `◐ partial`,
  `✗ unsupported`, or `? not assessable`. A claim carrying any mechanical
  `problems` always reads `✗ unsupported (mechanical)`, regardless of the
  audit verdict. The claims-register `<td>` additionally carries a second
  line, after a `<br>`, in a new `.claim-detail` rule (`color: var(--soft)`,
  never `--faint` — 3.40:1 is too low for small text): the audit's reason,
  its interview question, ownership facts per cited evidence item ("e1: 82%
  blame, 118 of 140 commits"), and any advisory flags. This lives inside the
  existing "claim" column, not a new column, so it doesn't overflow a narrow
  screen. The evidence-register `<td>` gets the same `.claim-detail` second
  line: status, then each number's class and source ("205 = subject commits
  touching apps/website/**", or "17: unbacked"). An **Interview questions**
  section, after the evidence register, lists each claim's audit question
  (reusing `ul.gaps`, each item linking back to its claim's register row).

Every claim register row carries `id="{claim.id}"` (candidate view too),
matching the existing evidence-row `id`/`:target` pattern, so a recipient's
tooling can deep-link to either register from outside the document.
