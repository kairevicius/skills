#!/usr/bin/env node
// Builds a small, deterministic synthetic git repository used by
// scripts/test/extractor.test.mjs to assert exact numbers out of scripts/lib/evidence.mjs.
// Every commit pins GIT_AUTHOR_DATE/GIT_COMMITTER_DATE and an explicit --author so the
// fixture is identical on every machine and every run, regardless of local git config.
//
// Usage: make-fixture-repo.mjs --out <dir> [--shallow-out <dir>] [--design-out <dir>]
//        [--bare-out <dir>] [--adversarial-out <dir>] [--solo-out <dir>]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "--shallow-out") opts.shallowOut = argv[++i];
    else if (argv[i] === "--design-out") opts.designOut = argv[++i];
    else if (argv[i] === "--bare-out") opts.bareOut = argv[++i];
    else if (argv[i] === "--adversarial-out") opts.adversarialOut = argv[++i];
    else if (argv[i] === "--solo-out") opts.soloOut = argv[++i];
  }
  if (!opts.out) {
    console.error(
      "usage: make-fixture-repo.mjs --out <dir> [--shallow-out <dir>] [--design-out <dir>] " +
        "[--bare-out <dir>] [--adversarial-out <dir>] [--solo-out <dir>]"
    );
    process.exit(2);
  }
  return opts;
}

function git(repo, args, env = {}) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function writeRepoFile(repo, relPath, content) {
  const abs = path.join(repo, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function linesOf(n, prefix) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`${prefix} ${i}`);
  return out.join("\n") + "\n";
}

// The subject: two display names, one email — the fixture case for "several emails
// collapse to one identity" (here: several NAMES, one email) that subject.identities
// must report as two distinct rows sharing one email.
const ADA_EXAMPLE = { name: "Ada Example", email: "100+ada@users.noreply.github.com" };
const ADA_LOWER = { name: "ada", email: "100+ada@users.noreply.github.com" };
const OTHER = { name: "Other Person", email: "other@example.com" };

function commit(repo, { author, date, subject, body, trailer, files = [], deletes = [] }) {
  for (const p of deletes) rmSync(path.join(repo, p));
  for (const f of files) writeRepoFile(repo, f.path, f.content);
  git(repo, ["add", "-A"]);
  const message = [subject, body, trailer].filter(Boolean).join("\n\n");
  const env = { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  git(
    repo,
    [
      "-c",
      `user.name=${author.name}`,
      "-c",
      `user.email=${author.email}`,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--author",
      `${author.name} <${author.email}>`,
      "-m",
      message,
    ],
    env
  );
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

// --- file content at each stage (full contents; git computes the diff itself) ---

const INDEX_V1 = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "export function sub(a, b) {",
  "  return a - b;",
  "}",
  "export function mul(a, b) {",
  "  return a * b;",
  "}",
  "",
].join("\n");

const INDEX_V2 = [
  "export function add(a, b) {",
  "  return a + b;",
  "}",
  "export function sub(a, b) {",
  "  return a - b;",
  "}",
  "export function mul(a, b) {",
  "  return a * b; // multiply",
  "}",
  "export function div(a, b) {",
  "  return a / b;",
  "}",
  "",
].join("\n");

const INDEX_V3 = INDEX_V2.replace(/\n$/, "\n") + 'export const VERSION = "1.0.0";\n';

const INDEX_TEST_V1 = [
  'import { add, sub } from "./index.js";',
  "",
  'test("adds numbers", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "  expect(sub(3, 1)).toBe(2);",
  "});",
  "",
].join("\n");

const INDEX_TEST_V2 = [
  'import { add, sub, mul } from "./index.js";',
  "// updated import for mul",
  "",
  'test("adds numbers", () => {',
  "  expect(add(1, 2)).toBe(3);",
  "  expect(sub(3, 1)).toBe(2);",
  "});",
  "",
].join("\n");

const RELEASE_NOTES = [
  "# Release Notes",
  "",
  "Initial release notes.",
  "More details here.",
  "",
].join("\n");

const UNRELATED_V1 = ["# unrelated", "", "not part of the subject's work.", ""].join("\n");
const UNRELATED_V2 = UNRELATED_V1 + "one more unrelated line.\n";

// Renamed with a small edit in the same commit, so the rename is pinned together with
// a non-trivial content delta (git's default similarity threshold is 50%; keeping every
// original line and only appending one keeps this comfortably above it).
const RELEASE_NOTES_RENAMED = RELEASE_NOTES.replace(/\n$/, "\n") + "Thanks for reading.\n";

export function buildFixture(out) {
  mkdirSync(out, { recursive: true });
  git(out, ["init", "-q", "-b", "main"]);

  const shas = {};

  shas.s1 = commit(out, {
    author: ADA_EXAMPLE,
    date: "2026-03-28T09:00:00+01:00",
    subject: "feat: add index module",
    files: [{ path: "src/index.js", content: INDEX_V1 }],
  });

  shas.s2 = commit(out, {
    author: ADA_EXAMPLE,
    date: "2026-03-28T11:00:00+01:00",
    subject: "docs: add release notes",
    // Path with a space, exercised by the "path with a space or tab" parser test.
    files: [{ path: "notes/release notes.md", content: RELEASE_NOTES }],
  });

  shas.o1 = commit(out, {
    author: OTHER,
    date: "2026-03-28T12:00:00+01:00",
    subject: "chore: unrelated tweak",
    files: [{ path: "other/unrelated.md", content: UNRELATED_V1 }],
  });

  shas.s3 = commit(out, {
    author: ADA_LOWER,
    date: "2026-03-29T09:00:00+02:00",
    subject: "test: add index tests",
    files: [{ path: "src/index.test.js", content: INDEX_TEST_V1 }],
  });

  shas.s4 = commit(out, {
    author: ADA_LOWER,
    date: "2026-03-29T11:00:00+02:00",
    subject: "fix: adjust index and tests",
    files: [
      { path: "src/index.js", content: INDEX_V2 },
      { path: "src/index.test.js", content: INDEX_TEST_V2 },
    ],
  });

  shas.o2 = commit(out, {
    author: OTHER,
    date: "2026-03-29T12:00:00+02:00",
    subject: "chore: another unrelated tweak",
    files: [{ path: "other/unrelated.md", content: UNRELATED_V2 }],
  });

  shas.s5 = commit(out, {
    author: ADA_LOWER,
    date: "2026-03-30T09:00:00+02:00",
    subject: "feat: widget (#7)",
    trailer: "Co-authored-by: Claude <noreply@anthropic.com>",
    files: [
      { path: "package-lock.json", content: linesOf(1000, '  "line":') },
      { path: "dist/bundle.js", content: linesOf(500, "//") },
      { path: "src/index.js", content: INDEX_V3 },
      // Tab in the filename forces git to C-quote the path in --raw/--numstat output
      // (a plain space does not). Matches the **/*.lock exclude glob so it never
      // perturbs lines_added/files_touched/etc. — it only exercises the dequoter.
      { path: "tmp\tnote.lock", content: "irrelevant\n" },
    ],
  });

  // Pins rename handling: git's default rename detection (on since 2.9) reports this as
  // one status-R raw line with old+new paths, not a plain delete+add. The extractor must
  // attribute the touch and the +1/-0 delta to the NEW path only, and must not count it
  // as a new_files addition (that stays A-only).
  shas.s6 = commit(out, {
    author: ADA_LOWER,
    date: "2026-03-30T10:00:00+02:00",
    subject: "chore: rename release notes",
    deletes: ["notes/release notes.md"],
    files: [{ path: "notes/RELEASE.md", content: RELEASE_NOTES_RENAMED }],
  });

  return shas;
}

// --- a second, tiny fixture for the non-engineer role families (subject.role_family,
// the design/documentation/content claim categories, and document/asset evidence types).
// Deliberately minimal: enough for the extractor's counts to be pinned by a test and for
// an eval to run /proof against a repository that reads as design work, nothing more.

const DANA = { name: "Dana Example", email: "dana@example.design" };
const OTHER_DESIGNER = { name: "Other Contributor", email: "other-contributor@example.com" };

const COLORS_CSS = [
  ":root {",
  "  --color-primary: #4f46e5;",
  "  --color-secondary: #14b8a6;",
  "  --color-background: #ffffff;",
  "  --color-text: #111827;",
  "}",
  "",
].join("\n");

// A small, well-formed SVG (~260 bytes) — the HTML renderer embeds an in-tree logo like
// this when repository.project.logo_path points at it, so it must be valid and tiny.
const LOGO_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
  '  <circle cx="32" cy="32" r="28" fill="#4f46e5"/>',
  '  <path d="M20 34l8 8 16-16" stroke="#ffffff" stroke-width="4" fill="none"',
  '        stroke-linecap="round" stroke-linejoin="round"/>',
  "</svg>",
  "",
].join("\n");

const BUTTON_STORIES = [
  'import type { Meta, StoryObj } from "@storybook/react";',
  'import { Button } from "./button";',
  "",
  "const meta: Meta<typeof Button> = {",
  '  title: "Components/Button",',
  "  component: Button,",
  "};",
  "export default meta;",
  "",
  "export const Primary: StoryObj<typeof Button> = {",
  '  args: { variant: "primary", children: "Click me" },',
  "};",
  "",
].join("\n");

const DESIGN_NOTES = ["# Design Notes", "", "Draft notes for the design system.", ""].join("\n");
const MISC_DOC = ["# Misc", "", "Not part of the subject's work.", ""].join("\n");

export function buildDesignFixture(out) {
  mkdirSync(out, { recursive: true });
  git(out, ["init", "-q", "-b", "main"]);

  const shas = {};

  shas.d1 = commit(out, {
    author: DANA,
    date: "2026-05-01T09:00:00Z",
    subject: "feat: add design tokens and button story",
    files: [
      { path: "tokens/colors.css", content: COLORS_CSS },
      { path: "components/button.stories.tsx", content: BUTTON_STORIES },
    ],
  });

  shas.d2 = commit(out, {
    author: DANA,
    date: "2026-05-01T10:00:00Z",
    subject: "feat: add the logo mark",
    files: [{ path: "assets/logo.svg", content: LOGO_SVG }],
  });

  shas.other = commit(out, {
    author: OTHER_DESIGNER,
    date: "2026-05-01T11:00:00Z",
    subject: "chore: unrelated doc",
    files: [{ path: "docs/misc.md", content: MISC_DOC }],
  });

  shas.d3 = commit(out, {
    author: DANA,
    date: "2026-05-02T09:00:00Z",
    subject: "docs: draft design notes",
    files: [{ path: "docs/design-notes.md", content: DESIGN_NOTES }],
  });

  // Pure rename (identical content, 0 added/0 removed) — complements the main fixture's
  // rename-with-edit case. git's rename detection needs no flag to fire on 100% similarity.
  shas.d4 = commit(out, {
    author: DANA,
    date: "2026-05-02T10:00:00Z",
    subject: "docs: promote design notes to the design system doc",
    deletes: ["docs/design-notes.md"],
    files: [{ path: "docs/design-system.md", content: DESIGN_NOTES }],
  });

  return shas;
}

// --- a third, adversarial fixture — one small repo carrying five distinct
// attacks in one place, each documented here (not just in the test file) so a
// reader of this fixture alone can see what every commit is for.

export const ADVERSARIAL_SUBJECT = { name: "Subject Example", email: "subject@example.dev" };
// U+212A KELVIN SIGN, not ASCII "K" — renders identically to "Kada@example.dev"
// but is a different code point. isSubject/asciiLower must never fold it onto
// "kada@example.dev": ASCII-only case-folding leaves it untouched, so the two
// stay distinct; String.prototype.toLowerCase() would collapse them.
const KELVIN_SIGN = String.fromCharCode(0x212a); // U+212A KELVIN SIGN, not ASCII "K" — a literal or \u212A source escape would just look like plain text "K" to a future editor/diff, so this uses fromCharCode instead.
export const KELVIN_LOOKALIKE = { name: "Kelvin Lookalike", email: `${KELVIN_SIGN}ada@example.dev` };

const CACHE_JS_V1 = ["export function cached(fn) {", "  const store = new Map();", "  return fn;", "}", ""].join("\n");
const CACHE_JS_V2 = CACHE_JS_V1.replace("return fn;", "return (...a) => store.get(a) ?? fn(...a);");
const KELVIN_DOC = ["# lookalike", "", "not the subject.", ""].join("\n");

// Remaps the subject's real, committed identity to a fake one. Pinned
// log.mailmap=false / mailmap.file=<devnull> / mailmap.blob= must make the
// extractor ignore this even though it is COMMITTED (reachable at head_sha
// via --attr-source, unlike an untracked mailmap) — subject.identities must
// still report "Subject Example <subject@example.dev>", never "Fake Name".
const MAILMAP_CONTENT = "Fake Name <fake@example.com> <subject@example.dev>\n";

// *.js marked binary-for-diff. Combined with a subject-authored .js edit
// AFTER this is committed, this is what --attr-source=<head_sha> must pin
// identically between a working tree and its --bare-out clone (a bare clone
// has no working tree to fall back to, and without --attr-source git's
// attribute source for the two is not guaranteed to agree).
const GITATTRIBUTES_CONTENT = "*.js -diff\n";

export function buildAdversarialFixture(out) {
  mkdirSync(out, { recursive: true });
  git(out, ["init", "-q", "-b", "main"]);

  const shas = {};

  // a1: "100" appears ONLY in the body, never the subject line. Self-reported
  // number classification (the trust model's "link 2") reads the SUBJECT line
  // only — bodies never count — so this must NOT classify as self-reported.
  shas.a1 = commit(out, {
    author: ADVERSARIAL_SUBJECT,
    date: "2026-07-01T09:00:00Z",
    subject: "feat: add memoizing cache",
    body: "Benchmarks show a 100ms drop in p95 latency under load.",
    files: [{ path: "src/cache.js", content: CACHE_JS_V1 }],
  });

  // a2: committed detached from "main", then pointed at by refs/pull/1/head
  // only — reachable from no branch. Exercises "a head on refs/pull/*" (Not
  // reproducible: verify never fetches a SHA, only branches/tags) and the
  // --check-remote warning ("head_sha is on no refs/remotes/* ref").
  git(out, ["checkout", "-q", "--detach"]);
  shas.a2 = commit(out, {
    author: ADVERSARIAL_SUBJECT,
    date: "2026-07-01T10:00:00Z",
    subject: "chore: pr-only tweak, never merged to main",
    files: [{ path: "src/pr-only.txt", content: "only on the PR ref\n" }],
  });
  git(out, ["update-ref", "refs/pull/1/head", shas.a2]);
  git(out, ["checkout", "-q", "main"]); // back to a1 — a2 is not an ancestor of main

  shas.a3 = commit(out, {
    author: ADVERSARIAL_SUBJECT,
    date: "2026-07-01T11:00:00Z",
    subject: "chore: add a mailmap the extractor must ignore",
    files: [{ path: ".mailmap", content: MAILMAP_CONTENT }],
  });

  shas.a4 = commit(out, {
    author: ADVERSARIAL_SUBJECT,
    date: "2026-07-01T12:00:00Z",
    subject: "chore: mark .js paths binary-for-diff",
    files: [{ path: ".gitattributes", content: GITATTRIBUTES_CONTENT }],
  });

  // a5: a real subject-authored edit to a path the just-committed .gitattributes
  // now covers, so the attribute is live (not merely present) at head_sha.
  shas.a5 = commit(out, {
    author: ADVERSARIAL_SUBJECT,
    date: "2026-07-01T13:00:00Z",
    subject: "feat: memoize cache lookups by argument list",
    files: [{ path: "src/cache.js", content: CACHE_JS_V2 }],
  });

  // a6: a Kelvin-sign author, reachable from main — a query for identity
  // "kada@example.dev" or "ada@example.dev" must never match this commit.
  shas.a6 = commit(out, {
    author: KELVIN_LOOKALIKE,
    date: "2026-07-01T14:00:00Z",
    subject: "docs: add a note that looks like the subject but is not",
    files: [{ path: "docs/kelvin.md", content: KELVIN_DOC }],
  });

  return shas;
}

// --- a fourth fixture: one author for the whole history (the "solo
// repository" signal — unauthenticated because the repository owner alone
// controls it — needs a repo where that signal is actually true).

const SOLO_AUTHOR = { name: "Solo Author", email: "solo@example.dev" };
const SOLO_README_V1 = ["# solo project", ""].join("\n");
const SOLO_README_V2 = SOLO_README_V1 + "one contributor, start to finish.\n";

export function buildSoloFixture(out) {
  mkdirSync(out, { recursive: true });
  git(out, ["init", "-q", "-b", "main"]);

  const shas = {};
  shas.o1 = commit(out, {
    author: SOLO_AUTHOR,
    date: "2026-08-01T09:00:00Z",
    subject: "feat: initial commit",
    files: [{ path: "README.md", content: SOLO_README_V1 }],
  });
  shas.o2 = commit(out, {
    author: SOLO_AUTHOR,
    date: "2026-08-01T10:00:00Z",
    subject: "docs: expand readme",
    files: [{ path: "README.md", content: SOLO_README_V2 }],
  });

  return shas;
}

const args = parseArgs(process.argv.slice(2));
const out = path.resolve(args.out);
const shas = buildFixture(out);

if (args.shallowOut) {
  const shallowOut = path.resolve(args.shallowOut);
  mkdirSync(path.dirname(shallowOut), { recursive: true });
  execFileSync("git", ["clone", "--depth", "1", `file://${out}`, shallowOut], { encoding: "utf8" });
}

let designShas;
if (args.designOut) {
  const designOut = path.resolve(args.designOut);
  designShas = buildDesignFixture(designOut);
}

if (args.bareOut) {
  const bareOut = path.resolve(args.bareOut);
  mkdirSync(path.dirname(bareOut), { recursive: true });
  execFileSync("git", ["clone", "--bare", "-q", `file://${out}`, bareOut], { encoding: "utf8" });
}

let adversarialShas;
if (args.adversarialOut) {
  const adversarialOut = path.resolve(args.adversarialOut);
  adversarialShas = buildAdversarialFixture(adversarialOut);
}

let soloShas;
if (args.soloOut) {
  const soloOut = path.resolve(args.soloOut);
  soloShas = buildSoloFixture(soloOut);
}

console.log(
  JSON.stringify(
    {
      out,
      shas,
      ...(designShas ? { designOut: path.resolve(args.designOut), designShas } : {}),
      ...(args.bareOut ? { bareOut: path.resolve(args.bareOut) } : {}),
      ...(adversarialShas ? { adversarialOut: path.resolve(args.adversarialOut), adversarialShas } : {}),
      ...(soloShas ? { soloOut: path.resolve(args.soloOut), soloShas } : {}),
    },
    null,
    2
  )
);
