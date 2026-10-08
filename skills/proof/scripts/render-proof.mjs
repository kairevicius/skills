#!/usr/bin/env node
// Renders proof.md / proof.html (or, with --verification, verified.md /
// verified.html) from a validated proof.json. Thin CLI over
// scripts/lib/render.mjs — all formatting decisions live there so the
// validator's --rendered check can call the same two functions directly.
//
// Usage: node render-proof.mjs <proof.json> [--out <dir>] [--md] [--html] [--stdout] [--repo <path>] [--verification <file>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderMarkdown, renderHtml } from "./lib/render.mjs";
import { readLogoSvg } from "./lib/evidence.mjs";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const USAGE = "usage: render-proof.mjs <proof.json> [--out <dir>] [--md] [--html] [--stdout] [--repo <path>] [--verification <file>]";

function parseArgs(argv) {
  const args = { _: [] };
  const withValue = { "--out": "out", "--repo": "repo", "--verification": "verification" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a in withValue) {
      const value = argv[++i];
      if (value === undefined) fail(`${a} requires a value`);
      args[withValue[a]] = value;
    } else if (a === "--md" || a === "--html" || a === "--stdout") {
      args[a.slice(2)] = true;
    } else if (a.startsWith("--")) {
      fail(`Unknown flag: ${a}`);
    } else {
      args._.push(a);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const input = args._[0];
if (!input) {
  fail(USAGE);
}

let doc;
try {
  doc = JSON.parse(readFileSync(input, "utf8"));
} catch (e) {
  fail(`Could not read or parse ${input}: ${e.message}`);
}

let verification = null;
if (args.verification) {
  try {
    verification = JSON.parse(readFileSync(args.verification, "utf8"));
  } catch (e) {
    fail(`Could not read or parse ${args.verification}: ${e.message}`);
  }
}

const wantMd = args.md === true;
const wantHtml = args.html === true;
const bothByDefault = !wantMd && !wantHtml;

if (args.stdout && (wantMd === wantHtml)) {
  // true === true (both given) or false === false (neither given) are both ambiguous for a single stream.
  fail("--stdout requires exactly one of --md or --html");
}

// The logo is read from the committed tree at the proof's head, never the working tree: the
// report describes that commit, and a working-tree path could name any file on the machine.
const repoDir = resolve(args.repo || process.cwd());
const logoPath = doc?.repository?.project?.logo_path;
const headSha = doc?.repository?.head_sha;
const logoSvg =
  logoPath && headSha && doc?.repository?.redacted !== true ? readLogoSvg(repoDir, headSha, logoPath) : null;

try {
  if (args.stdout) {
    process.stdout.write(wantMd ? renderMarkdown(doc, { verification }) : renderHtml(doc, { logoSvg, verification }));
  } else {
    const outDir = resolve(args.out || dirname(resolve(input)));
    mkdirSync(outDir, { recursive: true });
    const doMd = bothByDefault || wantMd;
    const doHtml = bothByDefault || wantHtml;
    // A recipient's verified.* never overwrites the candidate's own
    // proof.*: the two live side by side in the same directory so both the
    // original claim and its verification stay inspectable.
    const baseName = verification ? "verified" : "proof";
    if (doMd) writeFileSync(join(outDir, `${baseName}.md`), renderMarkdown(doc, { verification }));
    if (doHtml) writeFileSync(join(outDir, `${baseName}.html`), renderHtml(doc, { logoSvg, verification }));
  }
} catch (e) {
  fail(`Render failed: ${e.message}`);
}
