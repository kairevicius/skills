#!/usr/bin/env node
// The gate for proof.json. Zero dependencies so the skill runs in any repository
// without an install step.
//
// Usage: node validate-proof.mjs <proof.json> [--git] [--rendered <dir>] [--repo <path>]
//
//   (no flags)        schema + semantic checks: the candidate's self-check before sending.
//                     Passing it proves nothing to a recipient, who re-derives the proof
//                     with verify-proof.mjs and their own copy of the skill.
//   --git             every commit, path, and pull-request reference is resolved against
//                     the repository at repository.head_sha, the summary is re-derived from
//                     git, and every narrative string is swept for other contributors.
//   --rendered <dir>  <dir>/proof.md and <dir>/proof.html must be byte-identical to a fresh
//                     render of this document.
//   --repo <path>     the repository to check against (default: the current directory).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadSchema, checkSchema } from "./lib/schema-check.mjs";
import { runChecks } from "./lib/checks.mjs";
import { readLogoSvg } from "./lib/evidence.mjs";

const USAGE = "usage: validate-proof.mjs <proof.json> [--git] [--rendered <dir>] [--repo <path>]";
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !["--rendered", "--repo"].includes(args[i - 1]));
const file = positional[0];
const gitMode = flag("--git");
const renderedDir = option("--rendered");
const repo = path.resolve(option("--repo") ?? process.cwd());

if (!file) {
  console.error(USAGE);
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`FAIL: not valid JSON: ${e.message}`);
  process.exit(1);
}

// Phase 1: the schema. Everything after this relies on the shapes it guarantees, so
// a structural failure ends the run before the semantic checks can throw on them.
const schema = loadSchema();
const structural = checkSchema(schema, doc);
if (structural.length > 0) {
  console.error(`FAIL: ${structural.length} schema problem(s)`);
  for (const f of structural) console.error(`  - ${f.path || "/"}: ${f.message}`);
  process.exit(1);
}

// Phases 2-3: semantics, and (with --git) the repository at repository.head_sha.
const { findings, stats } = await runChecks(doc, { repo, gitMode });
const notes = findings.filter((f) => f.class === "info").map((f) => f.message);
const errors = findings.filter((f) => f.class !== "info").map((f) => f.message);

// Phase 4: the rendered reports must be exactly what the renderer produces.
const r = doc.repository;
let renderedMatch = null;
if (renderedDir) {
  const { renderMarkdown, renderHtml } = await import("./lib/render.mjs");
  // Read from the committed tree at head_sha, never the working tree: the proof
  // describes that commit, and a bare clone (verify-proof.mjs's case) has no working tree.
  const logoSvg =
    r.project?.logo_path && !r.redacted ? readLogoSvg(repo, r.head_sha, r.project.logo_path) : null;
  const expected = { "proof.md": renderMarkdown(doc), "proof.html": renderHtml(doc, { logoSvg }) };
  renderedMatch = true;
  for (const [name, want] of Object.entries(expected)) {
    const p = path.join(renderedDir, name);
    if (!existsSync(p)) { errors.push(`rendered: ${p} is missing — run render-proof.mjs`); renderedMatch = false; continue; }
    const have = readFileSync(p, "utf8");
    if (have === want) continue;
    renderedMatch = false;
    const a = have.split("\n"), b = want.split("\n");
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    errors.push(`rendered: ${name} differs from a fresh render at line ${i + 1}:\n      - ${a[i] ?? "<end of file>"}\n      + ${b[i] ?? "<end of file>"}`);
  }
}

for (const n of notes) console.error(`note: ${n}`);
if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const parts = [`${doc.claims.length} claims`, `${doc.evidence.length} evidence items`, `${doc.skills.length} skills`, `${doc.gaps.length} gaps`];
if (gitMode)
  parts.push(
    `git: ${stats.gitResolved} resolved, ${stats.gitSkipped} skipped (metric/pattern)`,
    `summary re-derived: ${stats.summaryRederived ? "match" : "not checked"}`,
    `numbers: ${stats.numbersRederived} re-derived, ${stats.numbersSelfReported} self-reported`,
  );
if (renderedDir) parts.push(`rendered: ${renderedMatch ? "match" : "mismatch"}`);
console.log(`PASS: ${parts.join(", ")}`);
