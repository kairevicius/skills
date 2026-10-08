// Deterministic, read-only git evidence extraction for the proof skill.
// Zero npm dependencies — this must run in any repo with nothing but git installed.
//
// Design note: the previous bash extractor (scripts/git-evidence.sh, now retired) ran a
// separate `git log` traversal per report section — 21 full-history walks. This module
// runs ONE `git log --raw --numstat` traversal for the subject's own commits and derives
// every per-commit metric (lines, files, tests, directories, largest commits, scopes,
// PRs-by-subject) from that single parsed record set. Two more traversals stay unavoidably
// separate because they need different scope: merge commits (PR detection) and the
// whole-repo, all-authors context used for `subject_rank`.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir, devNull } from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readProofVersion() {
  try {
    const schemaPath = path.join(__dirname, "..", "..", "schema", "proof.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    return schema?.properties?.proof_version?.default ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const PROOF_VERSION = readProofVersion();

// The schema is the single source of truth for what an identity looks like;
// reading its pattern here (same file readProofVersion just read) means this
// module can never drift from schema/proof.schema.json's own validation.
function readIdentityEmailPattern() {
  const fallback = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  try {
    const schemaPath = path.join(__dirname, "..", "..", "schema", "proof.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const pattern = schema?.properties?.subject?.properties?.identities?.items?.pattern;
    return pattern ? new RegExp(pattern) : fallback;
  } catch {
    return fallback;
  }
}

const IDENTITY_EMAIL_RE = readIdentityEmailPattern();

export class EvidenceError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
  }
}

// Thrown by runGit for a non-zero git exit — carries the machine-readable bits
// (status, stderr) a caller needs to branch on, distinct from EvidenceError's
// human-facing exit-code contract for the CLI.
export class GitError extends Error {
  constructor(message, { status = null, stderr = "", timedOut = false } = {}) {
    super(message);
    this.name = "GitError";
    this.status = status;
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

// The old script's 16 exclusions, plus 8 more path classes observed to pollute line
// stats in JS/TS monorepos and Python-adjacent tooling (coverage reports, turbo/cache
// scratch dirs, storybook's static export, bun's binary lockfile, tsc's incremental
// build cache, __pycache__).
export const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/generated/**",
  "**/vendor/**",
  "**/__snapshots__/**",
  "**/*.generated.*",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/yarn.lock",
  "**/*.lock",
  "**/*.snap",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/coverage/**",
  "**/out/**",
  "**/.turbo/**",
  "**/storybook-static/**",
  "**/.cache/**",
  "**/*.lockb",
  "**/*.tsbuildinfo",
  "**/__pycache__/**",
];

export const AI_VENDORS = ["claude", "copilot", "cursor", "codex", "chatgpt", "devin", "aider", "gemini"];

export const TEST_PATH_RE = /(^|\/)(__tests__|tests?|e2e|evals?)\/|\.(test|spec|eval)\.[a-z]+$/i;

// %P/%cn/%ce (parents, committer name/email) ride along on every record so
// commitFacts() can reuse this exact format + parseMainLog, rather than a
// second per-purpose format string the main traversal and commitFacts could
// silently drift out of sync on. The main traversal ignores the three fields.
const FORMAT =
  "%x1e%H%x1f%ae%x1f%an%x1f%aI%x1f%s%x1f%(trailers:key=Co-authored-by,valueonly,separator=|)%x1f%P%x1f%cn%x1f%ce";

// ---------------------------------------------------------------------------
// glob matching — one hand-rolled, dependency-free engine for every Node version.
// Always matched in posix style: git paths are forward-slash regardless of host OS.
//
// No regex is used anywhere in this engine, on purpose. A single regex compiled
// across an entire multi-segment glob (the previous approach) can backtrack
// exponentially on an adversarial pattern — and a glob here is untrusted input
// (a proof.json scope or measure key an unknown candidate wrote), not a literal
// the skill's own author typed. Matching is instead segment-by-segment dynamic
// programming (each `**` explored as "consume zero" or "consume one more
// segment, stay put", memoized in a table indexed by glob-segment x path-segment
// position) and, within a segment, the classic linear two-pointer `*`/`?`
// matcher — both bounded to O(glob segments x path segments), never exponential,
// regardless of how many `**` or `*` runs the pattern repeats.
//
// Contract: `**` matches zero or more whole segments only when it IS a whole
// segment (`a/**/b`, `**/b`, `a/**`); `*` and `?` never cross `/`; every path
// segment matches by plain character comparison, so a leading `.` is never
// special-cased (dot-segments always participate, unlike shell glob defaults);
// matching is case-sensitive and anchored to the full path. `{a,b,c}` expands
// one non-nested alternation group (or more, cartesian-combined) up to 64
// concrete variants; nested `{`, or a group containing `{`, `[`, `]`, `!`, is
// left as literal text rather than expanded.

// Linear (amortized) wildcard match of one path segment against one glob
// segment containing only literal characters, `*`, and `?` — no `/`, so no
// regex escaping is needed: every non-wildcard character is compared as-is.
function segmentMatch(pat, text) {
  const n = pat.length;
  const m = text.length;
  let pi = 0;
  let ti = 0;
  let starPi = -1;
  let starTi = -1;
  while (ti < m) {
    if (pi < n && (pat[pi] === "?" || pat[pi] === text[ti])) {
      pi++;
      ti++;
    } else if (pi < n && pat[pi] === "*") {
      starPi = pi;
      starTi = ti;
      pi++;
    } else if (starPi !== -1) {
      pi = starPi + 1;
      starTi++;
      ti = starTi;
    } else {
      return false;
    }
  }
  while (pi < n && pat[pi] === "*") pi++;
  return pi === n;
}

// Finds the `}` that closes the `{` at `open`, counting nesting depth so a
// nested brace pair is skipped as a unit rather than ending the scan early.
// Returns -1 when unmatched.
function findMatchingBrace(glob, open) {
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const MAX_BRACE_EXPANSIONS = 64;

// Cartesian-expands every top-level, non-nested `{a,b,c}` group in `glob` into
// up to 64 concrete glob strings. A group that is unmatched, has no comma, or
// contains a nested `{`, `[`, `]`, or `!` is left as literal text — its whole
// span (not just its opening brace) is skipped as a unit, so an inner brace
// inside a rejected outer group is never independently re-read as a fresh
// group. A glob with no valid group expands to itself.
function expandBraces(glob) {
  let variants = [""];
  let cursor = 0;
  let i = 0;
  let expanded = false;
  while (i < glob.length) {
    if (glob[i] === "{") {
      const close = findMatchingBrace(glob, i);
      if (close !== -1) {
        const inner = glob.slice(i + 1, close);
        const alts = /[{}[\]!]/.test(inner) ? null : inner.split(",");
        if (alts && alts.length > 1) {
          expanded = true;
          const prefix = glob.slice(cursor, i);
          const next = [];
          outer: for (const base of variants) {
            for (const alt of alts) {
              if (next.length >= MAX_BRACE_EXPANSIONS) break outer;
              next.push(base + prefix + alt);
            }
          }
          variants = next;
          cursor = close + 1;
        }
        i = close + 1; // past the whole matched span either way — never re-enter it
        continue;
      }
    }
    i++;
  }
  if (!expanded) return [glob];
  const suffix = glob.slice(cursor);
  return variants.map((v) => v + suffix);
}

const globSegmentsCache = new Map();

function compileGlobVariants(glob) {
  let variants = globSegmentsCache.get(glob);
  if (!variants) {
    variants = expandBraces(glob).map((g) => g.split("/"));
    globSegmentsCache.set(glob, variants);
  }
  return variants;
}

// dp[gi][pi] = do globSegs[gi:] and pathSegs[pi:] match. Filled bottom-up (gi
// and pi both descending) so every cell a transition reads is already final —
// O(|globSegs| * |pathSegs|) regardless of how many `**` segments repeat, which
// is what keeps "a/a/a/…(200 deep)…/a" against "**/a/**/a/**/b" fast: a single
// backtracking regex over the whole joined path re-explores the same
// alignment exponentially; this table computes each alignment exactly once.
function segmentsMatch(globSegs, pathSegs) {
  const gn = globSegs.length;
  const pn = pathSegs.length;
  const dp = Array.from({ length: gn + 1 }, () => new Array(pn + 1).fill(false));
  dp[gn][pn] = true;
  for (let gi = gn - 1; gi >= 0; gi--) {
    const seg = globSegs[gi];
    if (seg === "**") {
      dp[gi][pn] = dp[gi + 1][pn];
      for (let pi = pn - 1; pi >= 0; pi--) {
        dp[gi][pi] = dp[gi + 1][pi] || dp[gi][pi + 1];
      }
    } else {
      // dp[gi][pn] stays false: a non-`**` glob segment needs a path segment.
      for (let pi = pn - 1; pi >= 0; pi--) {
        dp[gi][pi] = segmentMatch(seg, pathSegs[pi]) && dp[gi + 1][pi + 1];
      }
    }
  }
  return dp[0][0];
}

export function matchesGlob(filePath, glob) {
  const pathSegs = filePath.split("/");
  for (const globSegs of compileGlobVariants(glob)) {
    if (segmentsMatch(globSegs, pathSegs)) return true;
  }
  return false;
}

export function matchesAnyGlob(filePath, globs) {
  return globs.some((g) => matchesGlob(filePath, g));
}

export function keptFiles(record, exclude) {
  return record.files.filter((f) => !matchesAnyGlob(f.path, exclude));
}

export function depth2Dir(p) {
  const parts = p.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

function sortByCountDesc(map, limit) {
  const arr = [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return limit === Infinity ? arr : arr.slice(0, limit);
}

function round(x, n) {
  const f = 10 ** n;
  return Math.round(x * f) / f;
}

function toUtcDayMs(day) {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// Calendar-day arithmetic in UTC — never local-time epoch subtraction. The retired
// bash script divided a local-time `date +%s` delta by 86400, which silently drops or
// adds an hour across a DST transition and mis-counts the span by a day.
function daysBetweenCalendar(a, b) {
  return Math.round((toUtcDayMs(b) - toUtcDayMs(a)) / 86400000);
}

function isAiCoauthored(coauthors) {
  return coauthors.some((c) => AI_VENDORS.some((v) => c.includes(v)));
}

export function firstLastDay(records) {
  const days = [...new Set(records.map((r) => r.day))].sort();
  return { first: days[0] ?? null, last: days[days.length - 1] ?? null, days };
}

// ---------------------------------------------------------------------------
// git plumbing — every git invocation in this file (and in git-evidence.mjs)
// goes through runGit/tryGit, so a proof re-derives the same numbers on any
// machine regardless of the operator's own git config, aliases, or repo-local
// settings. Three defenses, in order:
//   1. a sanitized environment — every ambient GIT_* variable and SSH_ASKPASS
//      dropped, HOME/XDG_CONFIG_HOME pointed at an empty sandbox so no global
//      gitconfig, attributes, or mailmap file is ever consulted;
//   2. a pinned set of `-c` config values, so a repo-local .git/config cannot
//      change rename detection, quoting, mailmap, or blame behavior underneath
//      the extractor;
//   3. --literal-pathspecs and --attr-source=<the analyzed commit>, so a path
//      argument is never magic-glob-expanded and attribute-driven behavior
//      (line-ending, filters) reads the COMMIT being analyzed, never whatever
//      happens to be checked out in the working tree.
// ---------------------------------------------------------------------------

let sandboxHomeDir = null;

// One empty HOME/XDG_CONFIG_HOME per process. Needed even with GIT_CONFIG_GLOBAL
// pointed at /dev/null: git reads $XDG_CONFIG_HOME/git/attributes (or
// $HOME/.config/git/attributes) as a SEPARATE lookup from the global config file,
// and GIT_CONFIG_GLOBAL only overrides the latter.
function getSandboxHomeDir() {
  if (!sandboxHomeDir) sandboxHomeDir = mkdtempSync(path.join(tmpdir(), "proof-git-home-"));
  return sandboxHomeDir;
}

function sanitizedBaseEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") || key === "SSH_ASKPASS") delete env[key];
  }
  const home = getSandboxHomeDir();
  env.HOME = home;
  env.XDG_CONFIG_HOME = home;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_TERMINAL_PROMPT = "0";
  env.LC_ALL = "C";
  return env;
}

// Every value pinned as `-c key=value`; a trailing `=` (mailmap.blob,
// blame.ignoreRevsFile, credential.helper) deliberately unsets whatever a
// repo-local config would otherwise supply.
const PINNED_GIT_CONFIG = [
  "core.quotePath=false",
  `core.bigFileThreshold=512m`,
  `core.attributesFile=${devNull}`,
  "diff.renames=true",
  "diff.renameLimit=1000",
  "diff.algorithm=myers",
  "diff.relative=false",
  "diff.ignoreSubmodules=none",
  "log.mailmap=false",
  "log.showRoot=true",
  "log.follow=false",
  "log.showSignature=false",
  `mailmap.file=${devNull}`,
  "mailmap.blob=",
  "blame.ignoreRevsFile=",
  "credential.helper=",
  "i18n.logOutputEncoding=UTF-8",
  "color.ui=false",
];

let gitVersionInfo = null;

// Detected once per process against the sanitized environment. `raw` feeds
// gitEnvironment()'s provenance field; major/minor gate --attr-source, added
// in git 2.40.
function detectGitVersion(env) {
  if (gitVersionInfo) return gitVersionInfo;
  let raw = "";
  try {
    raw = execFileSync("git", ["--version"], { encoding: "utf8", env }).trim();
  } catch {
    raw = "";
  }
  const m = /git version (\d+)\.(\d+)/.exec(raw);
  gitVersionInfo = {
    raw: raw.replace(/^git version\s*/, "") || "unknown",
    major: m ? Number(m[1]) : 0,
    minor: m ? Number(m[2]) : 0,
  };
  return gitVersionInfo;
}

function supportsAttrSource(env) {
  const v = detectGitVersion(env);
  return v.major > 2 || (v.major === 2 && v.minor >= 40);
}

// True when this process's git is new enough for --attr-source (2.40+). collect()
// uses this to warn when an attribute-dependent command had to fall back to
// reading the working tree's current .gitattributes instead of head_sha's.
export function gitSupportsAttrSource() {
  return supportsAttrSource(sanitizedBaseEnv());
}

// The git and Node versions that produced a proof's numbers — carried in
// provenance.environment so a reader can tell a real number from a tool-version
// artifact when a recount differs.
export function gitEnvironment() {
  return { git: detectGitVersion(sanitizedBaseEnv()).raw, node: process.version };
}

function buildGitArgs(args, attrSource, env) {
  const globalFlags = ["--literal-pathspecs", "--no-replace-objects"];
  if (attrSource && supportsAttrSource(env)) globalFlags.push(`--attr-source=${attrSource}`);
  const config = PINNED_GIT_CONFIG.flatMap((kv) => ["-c", kv]);
  return [...globalFlags, ...config, ...args];
}

// Thrown by execFileSync for a non-zero exit, ENOENT (git missing), or a
// timeout — normalized to one error shape so every caller branches on
// `.status`/`.stderr` rather than child_process's several failure shapes.
// `input`, when given, is written to the child's stdin — used by `git
// cat-file --batch-check` to validate many object names in one process. This
// needs stdio[0] to actually be a pipe: an explicit "ignore" silently drops
// `input` instead of erroring, so it is NOT the unconditional default below.
export function runGit(repo, args, { attrSource, timeout, env: callerEnv, input } = {}) {
  const env = { ...sanitizedBaseEnv(), ...(callerEnv || {}) };
  const fullArgs = buildGitArgs(args, attrSource, env);
  try {
    return execFileSync("git", fullArgs, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 1 << 30,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      input,
      timeout,
      env,
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new GitError("git is not installed or not on PATH", { status: null, stderr: "" });
    }
    const stderr = err.stderr ? String(err.stderr) : "";
    throw new GitError(stderr.trim() || err.message, {
      status: typeof err.status === "number" ? err.status : null,
      stderr,
      timedOut: err.code === "ETIMEDOUT",
    });
  }
}

export function tryGit(repo, args, opts) {
  try {
    return runGit(repo, args, opts);
  } catch {
    return null;
  }
}

// Lowercases ONLY ASCII A-Z. String.prototype.toLowerCase() is Unicode case
// folding, which collapses look-alike characters onto ASCII letters — most
// infamously U+212A KELVIN SIGN -> "k" — so two visibly-different raw author
// emails could compare equal. Identity matching must never do that: an email
// is either byte-for-byte (mod ASCII case) the one the subject claimed, or it
// isn't.
export function asciiLower(s) {
  let out = "";
  for (const ch of String(s ?? "")) {
    const code = ch.codePointAt(0);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
  }
  return out;
}

// Exact match only: no substring ("@" must never match every author), no
// name match, no mailmap, no Unicode case folding. `email` is the raw `%ae` —
// mailmap is pinned off (log.mailmap=false) everywhere this is read, so it is
// never a mailmap-rewritten address.
export function isSubject(email, identities) {
  const lowered = asciiLower(email);
  return identities.some((id) => asciiLower(id) === lowered);
}

// Reads a small SVG blob from a commit's tree via `cat-file`, never the
// working tree — so it behaves identically against a bare clone. Refuses
// anything that isn't an ordinary regular-file blob at that exact path: no
// absolute path, no `..`/`./`-prefixed traversal, no symlink entry (mode
// 120000, which could point outside the repo when checked out), no path
// missing a `.svg` extension, and no blob over 64 KB.
export function readLogoSvg(repo, rev, relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  if (relPath.startsWith("/") || relPath.startsWith(":") || relPath.startsWith("./")) return null;
  if (relPath.includes("..") || relPath.includes("\\")) return null;
  if (!relPath.toLowerCase().endsWith(".svg")) return null;

  const entry = tryGit(repo, ["ls-tree", rev, "--", relPath], { attrSource: rev });
  const firstLine = (entry || "").split("\n").find(Boolean);
  if (!firstLine) return null;
  // "<mode> <type> <sha>\t<path>" — one line per ls-tree entry.
  const m = /^(\d{6}) (blob|tree|commit) [0-9a-f]{40}\t/.exec(firstLine);
  if (!m) return null;
  const [, mode, type] = m;
  if (type !== "blob") return null;
  if (mode !== "100644" && mode !== "100755") return null; // never 120000 (symlink)

  const sizeRaw = tryGit(repo, ["cat-file", "-s", `${rev}:${relPath}`], { attrSource: rev });
  if (sizeRaw === null) return null;
  const size = Number(sizeRaw.trim());
  if (!Number.isFinite(size) || size > 65536) return null;

  return tryGit(repo, ["cat-file", "blob", `${rev}:${relPath}`], { attrSource: rev });
}

function assertGitRepo(repo) {
  try {
    runGit(repo, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    throw new EvidenceError(`not a git repository (or git is not installed): ${repo}`, 1);
  }
}

function assertNotShallow(repo) {
  let out;
  try {
    out = runGit(repo, ["rev-parse", "--is-shallow-repository"]).trim();
  } catch (err) {
    throw new EvidenceError(`failed to check shallow-clone status: ${err.message}`, 1);
  }
  if (out === "true") {
    throw new EvidenceError(
      `refusing to analyze a shallow clone at ${repo} — history is incomplete. Run 'git fetch --unshallow' first.`,
      4
    );
  }
}

function defaultIdentity(repo) {
  try {
    const v = runGit(repo, ["config", "user.email"]).trim();
    return v || null;
  } catch {
    return null;
  }
}

function validateSince(since) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since ?? "");
  if (!m) throw new EvidenceError(`--since must be YYYY-MM-DD, got: ${since}`, 2);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new EvidenceError(`--since is not a real calendar date: ${since}`, 2);
  }
}

// git C-quotes a path that contains a tab, quote, backslash, or control character,
// wrapping it in double quotes with \t / \n / \" / \\ / octal-byte escapes.
function dequotePath(raw) {
  if (!(raw.length >= 2 && raw[0] === '"' && raw[raw.length - 1] === '"')) return raw;
  const inner = raw.slice(1, -1);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = inner[++i];
    switch (n) {
      case "t":
        out += "\t";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "a":
        out += "\x07";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "v":
        out += "\v";
        break;
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      default:
        if (n >= "0" && n <= "7") {
          let oct = n;
          for (let k = 0; k < 2 && /[0-7]/.test(inner[i + 1] || ""); k++) oct += inner[++i];
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += n ?? "";
        }
    }
  }
  return out;
}

// git prints --raw and --numstat as two representations of the SAME diff, in the SAME
// file order, for every commit that has both flags set. Zipping them by index avoids a
// second traversal just to learn each file's status letter.
//
// Rename detection stays ON (git's default since 2.9, diff.renames=true) rather than
// passing --no-renames: a reader re-deriving these numbers with a plain `git log` gets
// the same rename-collapsed counts we do, and a proof that a spot-check contradicts is
// worthless regardless of which number is "more complete". This means a renamed path
// shows up as one status-R raw line with TWO tab-separated paths (old, new) instead of
// one — the file is attributed to the NEW path only, and counts as a touch, never as
// new_files (that stays A-only; a rename is not an addition). numstat's own path field
// for a rename can be abbreviated ("dir/{old => new}/file" or "old => new" in full) —
// rather than parse that notation, we take the path from the unambiguous raw line and
// use numstat only for the added/removed counts, ignoring its path field entirely.
export function parseMainLog(raw) {
  const records = [];
  const chunks = raw.split("\x1e").slice(1);
  for (const chunk of chunks) {
    const nlIdx = chunk.indexOf("\n");
    const metaLine = nlIdx === -1 ? chunk : chunk.slice(0, nlIdx);
    const bodyRaw = nlIdx === -1 ? "" : chunk.slice(nlIdx + 1);
    const [sha, ae, an, aI, subject, trailersRaw, parentsRaw, cn, ce] = metaLine.split("\x1f");

    const rawLines = [];
    const numstatLines = [];
    for (const line of bodyRaw.split("\n")) {
      if (line.length === 0) continue;
      if (line[0] === ":") rawLines.push(line);
      else if (/^(?:\d+|-)\t(?:\d+|-)\t/.test(line)) numstatLines.push(line);
    }

    const files = [];
    const n = Math.max(rawLines.length, numstatLines.length);
    for (let i = 0; i < n; i++) {
      const rl = rawLines[i];
      const nl = numstatLines[i];
      let status = "M";
      let pathFromRaw = null;
      if (rl) {
        const tabIdx = rl.indexOf("\t");
        const metaPart = rl.slice(0, tabIdx);
        const fields = metaPart.trim().split(/\s+/);
        status = (fields[4] || "M")[0];
        const afterFirstTab = rl.slice(tabIdx + 1);
        if (status === "R" || status === "C") {
          // ":...  R### \t old-path \t new-path" — keep the new path only.
          const tab2 = afterFirstTab.indexOf("\t");
          pathFromRaw = dequotePath(tab2 === -1 ? afterFirstTab : afterFirstTab.slice(tab2 + 1));
        } else {
          pathFromRaw = dequotePath(afterFirstTab);
        }
      }
      let added = null;
      let removed = null;
      if (nl) {
        const t1 = nl.indexOf("\t");
        const t2 = nl.indexOf("\t", t1 + 1);
        const a = nl.slice(0, t1);
        const r = nl.slice(t1 + 1, t2);
        added = a === "-" ? null : Number(a);
        removed = r === "-" ? null : Number(r);
      }
      files.push({ status, path: pathFromRaw, added, removed });
    }

    const day = (aI || "").slice(0, 10);
    records.push({
      sha,
      authorEmail: ae || "",
      authorName: an || "",
      authorDate: new Date(aI),
      day,
      month: day.slice(0, 7),
      subject: subject || "",
      coauthors: (trailersRaw || "")
        .split("|")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
      parents: (parentsRaw || "").split(" ").filter(Boolean),
      committerName: cn || "",
      committerEmail: ce || "",
      files,
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// pure aggregations over a parsed record set
// ---------------------------------------------------------------------------

export function computeSummary(records, opts = {}) {
  const exclude = opts.exclude ?? DEFAULT_EXCLUDES;
  const since = opts.since ?? null;
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date(opts.asOf ?? Date.now());

  const authored_commits = records.length;
  let lines_added = 0;
  let lines_removed = 0;
  const touchedFiles = new Set();
  let test_touches = 0;
  const testFiles = new Set();
  const monthCounts = new Map();
  let ai_coauthored_commits = 0;

  for (const r of records) {
    monthCounts.set(r.month, (monthCounts.get(r.month) ?? 0) + 1);
    if (isAiCoauthored(r.coauthors)) ai_coauthored_commits++;
    for (const f of keptFiles(r, exclude)) {
      touchedFiles.add(f.path);
      if (typeof f.added === "number") lines_added += f.added;
      if (typeof f.removed === "number") lines_removed += f.removed;
      if (TEST_PATH_RE.test(f.path)) {
        test_touches++;
        testFiles.add(f.path);
      }
    }
  }

  const { first, last, days } = firstLastDay(records);
  const span_days = first && last ? daysBetweenCalendar(first, last) : 0;
  const recent = computeRecentWindow(records, since, asOf, exclude, 5);

  return {
    authored_commits,
    lines_added,
    lines_removed,
    files_touched: touchedFiles.size,
    active_days: days.length,
    span_days,
    ai_coauthored_commits,
    ai_assisted_commit_share: authored_commits ? round(ai_coauthored_commits / authored_commits, 2) : 0,
    test_touches,
    test_files: testFiles.size,
    recent_commits_90d: recent.commits,
    activity_by_month: [...monthCounts.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([month, commits]) => ({ month, commits })),
  };
}

export function computeTopDirectories(records, exclude, limit = 20) {
  const counts = new Map();
  for (const r of records) {
    for (const f of keptFiles(r, exclude)) {
      const dir = depth2Dir(f.path);
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  return sortByCountDesc(counts, limit).map(([p, touches]) => ({ path: p, touches }));
}

export function buildChurnMap(records, exclude) {
  const counts = new Map();
  for (const r of records) {
    for (const f of keptFiles(r, exclude)) {
      const churn = (typeof f.added === "number" ? f.added : 0) + (typeof f.removed === "number" ? f.removed : 0);
      counts.set(f.path, (counts.get(f.path) ?? 0) + churn);
    }
  }
  return counts;
}

export function computeTopFiles(records, exclude, limit = 20) {
  return sortByCountDesc(buildChurnMap(records, exclude), limit).map(([p, churn]) => ({ path: p, churn }));
}

export function computeFileTypes(records, exclude, limit = 15) {
  const counts = new Map();
  for (const r of records) {
    for (const f of keptFiles(r, exclude)) {
      const base = f.path.split("/").pop();
      const parts = base.split(".");
      if (parts.length > 1) {
        const ext = parts[parts.length - 1].toLowerCase();
        counts.set(ext, (counts.get(ext) ?? 0) + 1);
      }
    }
  }
  return sortByCountDesc(counts, limit).map(([ext, touches]) => ({ ext, touches }));
}

export function computeLargestCommits(records, exclude, limit = 10) {
  const rows = records.map((r) => {
    let insertions = 0;
    for (const f of keptFiles(r, exclude)) if (typeof f.added === "number") insertions += f.added;
    return { sha: r.sha, date: r.day, insertions, subject: r.subject };
  });
  rows.sort((a, b) => b.insertions - a.insertions || (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0));
  return rows.slice(0, limit);
}

export function computeRecentWindow(records, since, asOf, exclude, limit = 5) {
  const asOfDate = asOf instanceof Date ? asOf : new Date(asOf ?? Date.now());
  const asOfMs = asOfDate.getTime();
  const sinceMs = since ? toUtcDayMs(since) : -Infinity;
  const winStart = Math.max(sinceMs, asOfMs - 90 * 86400000);
  const inWindow = records.filter((r) => {
    const t = r.authorDate.getTime();
    return t > winStart && t <= asOfMs;
  });
  const dirCounts = new Map();
  for (const r of inWindow) {
    for (const f of keptFiles(r, exclude)) {
      const dir = depth2Dir(f.path);
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
  }
  return {
    since: new Date(winStart).toISOString().slice(0, 10),
    commits: inWindow.length,
    top_directories: sortByCountDesc(dirCounts, limit).map(([p, touches]) => ({ path: p, touches })),
  };
}

export function computeScopeStats(records, glob, exclude) {
  let commits = 0;
  let touches = 0;
  let new_files = 0;
  const files = new Set();
  for (const r of records) {
    let matched = false;
    for (const f of keptFiles(r, exclude)) {
      if (!matchesAnyGlob(f.path, [glob])) continue;
      matched = true;
      touches++;
      files.add(f.path);
      if (f.status === "A") new_files++;
    }
    if (matched) commits++;
  }
  return { commits, touches, files: files.size, new_files };
}

function buildIdentityRows(records) {
  const map = new Map();
  for (const r of records) {
    const key = `${r.authorName} ${r.authorEmail}`;
    if (!map.has(key)) map.set(key, { name: r.authorName, email: r.authorEmail, commits: 0 });
    map.get(key).commits++;
  }
  return [...map.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
}

function computePrs(records, mergeLogRaw) {
  const byNumber = new Map();
  for (const r of records) {
    const m = /\(#(\d+)\)\s*$/.exec(r.subject);
    if (m) byNumber.set(Number(m[1]), { number: Number(m[1]), sha: r.sha, date: r.day });
  }
  for (const line of mergeLogRaw.split("\n")) {
    if (!line) continue;
    const [sha, aI, subject] = line.split("\x1f");
    const m = /^Merge pull request #(\d+)\b/.exec(subject || "");
    if (m) {
      const num = Number(m[1]);
      if (!byNumber.has(num)) byNumber.set(num, { number: num, sha, date: (aI || "").slice(0, 10) });
    }
  }
  return [...byNumber.values()].sort((a, b) => b.number - a.number);
}

function computeContext(repo, rev, since, identities) {
  // Same reasoning as the main traversal: filter on each commit's own %as calendar day
  // in JS rather than passing --since to git, which would make the cutoff depend on
  // the wall-clock time the tool happens to run at (see the comment in collect()).
  // No --attr-source: plain metadata, no diff, nothing here reads a .gitattributes file.
  const args = ["log", "--no-merges", "--format=%ae%x1f%as", rev];
  const rows = runGit(repo, args)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [email, day] = line.split("\x1f");
      return { email: email || "", day: day || "" };
    })
    .filter((r) => !since || r.day >= since);
  // Grouped by ASCII-lowercase email so plain case variants of the same address
  // count once (RFC-conventional, harmless for a popularity count) without the
  // Unicode confusable-folding risk isSubject/asciiLower are built to avoid.
  const counts = new Map();
  for (const r of rows) {
    const key = asciiLower(r.email);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let mine = 0;
  for (const [key, c] of counts) if (isSubject(key, identities)) mine += c;
  let rank = 1;
  for (const [key, c] of counts) if (!isSubject(key, identities) && c > mine) rank++;
  return { total_commits: rows.length, total_authors: counts.size, subject_rank: rank, since };
}

// All-time: unlike total_commits/total_authors above, first_commit is never bounded by
// --since — it is the project's own age, not the subject's tenure in it.
function computeRepoFirstCommit(repo, rev) {
  const roots = runGit(repo, ["rev-list", "--max-parents=0", rev])
    .split("\n")
    .filter(Boolean);
  let min = null;
  for (const sha of roots) {
    const d = runGit(repo, ["log", "-1", "--format=%as", sha]).trim();
    if (!min || d < min) min = d;
  }
  return min;
}

function fileExistsAtRev(repo, rev, p) {
  try {
    runGit(repo, ["cat-file", "-e", `${rev}:${p}`]);
    return true;
  } catch {
    return false;
  }
}

// Matches a `--porcelain` blame line-header — present on EVERY blamed line,
// whether or not that line also carries the full commit-metadata block (which
// `--porcelain` prints only the first time a commit appears). Matching this
// header rather than tracking "have I seen this commit's block yet" state
// gives exactly one match per file line, unconditionally.
const BLAME_HEADER_RE = /^([0-9a-f]{40}) \d+ \d+(?: \d+)?$/;

// Attribution is membership in `subjectShas` (the subject's own commit SHAs),
// never the blamed line's printed author-mail. author-mail is mailmap-rewritten
// by whatever mailmap the working tree currently has checked out (even with
// log.mailmap=false pinned — that config gates `git log`, not `git blame`'s
// porcelain metadata), so trusting it would let an unrelated mailmap silently
// re-attribute lines. A commit's SHA is immutable; membership in the subject's
// own (exact-email-matched) commit set is not.
function blamePathStats(repo, rev, relPath, subjectShas) {
  const out = tryGit(repo, ["blame", "--porcelain", rev, "--", relPath], { attrSource: rev });
  if (out === null) return null;
  let total = 0;
  let mine = 0;
  for (const line of out.split("\n")) {
    const m = BLAME_HEADER_RE.exec(line);
    if (!m) continue;
    total++;
    if (subjectShas.has(m[1])) mine++;
  }
  if (total === 0) return null;
  return { total, subject: mine, share: round(mine / total, 3) };
}

// The subject's commit SHAs across the WHOLE history reachable from `rev` —
// never bounded by --since. Ownership of a line present today is about who
// wrote the line that survives, not whether that commit falls inside whatever
// --since window this particular report happens to use. Merges are included
// (unlike the main traversal's --no-merges): blame can attribute a line to a
// hand-resolved merge commit, and excluding merges here would under-count
// exactly that case.
function collectSubjectShas(repo, rev, identities) {
  const args = ["log", "--format=%H%x1f%ae", "-F", "-i", ...identities.map((id) => `--author=${id}`), rev];
  const shas = new Set();
  for (const line of runGit(repo, args).split("\n")) {
    if (!line) continue;
    const sepIdx = line.indexOf("\x1f");
    const sha = line.slice(0, sepIdx);
    const email = line.slice(sepIdx + 1);
    if (isSubject(email, identities)) shas.add(sha);
  }
  return shas;
}

// Strips userinfo from a "scheme://user[:pass]@host/…" remote. An scp-style
// remote ("git@host:org/repo.git", no "://") is left alone — that "git@" is a
// fixed system login, not a secret, and the schema explicitly allows it
// (its pattern only rejects "://…@").
function stripRemoteUserinfo(url) {
  if (!url) return url;
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/, "$1");
}

// ---------------------------------------------------------------------------
// collect() — the one entry point the CLI calls
// ---------------------------------------------------------------------------

export function collect(opts = {}) {
  const repo = opts.repo ? path.resolve(opts.repo) : process.cwd();
  const rev = opts.rev || "HEAD";
  const scopes = opts.scopes ?? [];
  const blameTop = Number.isFinite(opts.blameTop) ? opts.blameTop : 10;
  const blamePathsOpt = Array.isArray(opts.blamePaths) ? [...new Set(opts.blamePaths)] : [];
  const exclude = opts.exclude ?? DEFAULT_EXCLUDES;
  const redacted = !!opts.redacted;

  const asOf = opts.asOf ? new Date(opts.asOf) : new Date();
  if (Number.isNaN(asOf.getTime())) throw new EvidenceError(`invalid --as-of value: ${opts.asOf}`, 1);

  assertGitRepo(repo);
  assertNotShallow(repo);

  const since = opts.since ?? null;
  if (since !== null) validateSince(since);

  let identities = opts.identities && opts.identities.length ? opts.identities.slice() : null;
  if (!identities) {
    const d = defaultIdentity(repo);
    identities = d ? [d] : [];
  }
  if (identities.length === 0) {
    throw new EvidenceError("no identity email given and git config user.email is empty", 1);
  }
  const badIdentity = identities.find((id) => !IDENTITY_EMAIL_RE.test(id));
  if (badIdentity !== undefined) {
    throw new EvidenceError(
      `identity '${badIdentity}' is not an exact email address. Matching is exact-email-only ` +
        `(no name, no substring, no "@") — run 'git-evidence.mjs --discover <text>' to find the exact emails to use.`,
      1
    );
  }

  let headSha;
  try {
    headSha = runGit(repo, ["rev-parse", `${rev}^{commit}`]).trim();
  } catch (err) {
    throw new EvidenceError(`could not resolve rev '${rev}' in ${repo}: ${err.message}`, 5);
  }

  const warnings = [];
  if (!gitSupportsAttrSource()) {
    warnings.push(
      `git ${gitEnvironment().git} is older than 2.40 — --attr-source is unavailable, so attribute-dependent ` +
        `commands (diff, blame) read whatever .gitattributes the working tree currently has checked out, ` +
        `not ${headSha}'s`
    );
  }

  // -F -i: fixed-string, case-insensitive matching against "Name <email>", used ONLY as a
  // cheap superset prefilter (a fixed-string substring search is guaranteed to find every
  // commit whose exact author email is one of `identities`, plus possibly others — e.g. an
  // identity that is itself a substring of some other contributor's email). The exact
  // filter below (isSubject, byte-equality mod ASCII case) is what actually decides
  // authorship; the prefilter only keeps the traversal from reading commits that can't
  // possibly match.
  const mainArgs = [
    "log",
    "--no-merges",
    "--raw",
    "--numstat",
    "--no-textconv",
    "--no-ext-diff",
    "-M50%",
    "--date=iso-strict",
    `--format=${FORMAT}`,
    "-F",
    "-i",
    ...identities.map((id) => `--author=${id}`),
    headSha,
  ];
  let records = parseMainLog(runGit(repo, mainArgs, { attrSource: headSha }));
  records = records.filter((r) => isSubject(r.authorEmail, identities));
  // --since is deliberately NOT passed to git here. Given a bare YYYY-MM-DD, git's
  // approxidate fills in the missing time-of-day from the CURRENT wall-clock time
  // instead of midnight — so "--since=2026-03-30" run at 23:50 excludes a commit made
  // at 09:00 on that same date, while the identical run at 08:00 would include it. That
  // makes the cutoff depend on when the tool happens to run. Filtering on each record's
  // own calendar `day` (already computed from %aI in its own recorded offset) is exact
  // and time-of-day-independent.
  if (since) records = records.filter((r) => r.day >= since);

  if (records.length === 0) {
    throw new EvidenceError(
      `zero commits matched identity email(s) [${identities.join(", ")}]` +
        (since ? ` since ${since}` : "") +
        ` in ${repo}. Stop — do not fabricate a proof.`,
      3
    );
  }

  const identityRows = buildIdentityRows(records);

  const summary = computeSummary(records, { since, asOf, exclude });
  const { first, last } = firstLastDay(records);

  // %ae rides along only to exact-filter in JS (same prefilter-then-exact-match
  // discipline as the main traversal), then is stripped back off: computePrs expects
  // exactly the 3-field sha/date/subject shape it always has.
  const mergeArgs = [
    "log",
    "--merges",
    "-F",
    "-i",
    ...identities.map((id) => `--author=${id}`),
    "--format=%H%x1f%aI%x1f%s%x1f%ae",
    headSha,
  ];
  const mergeLines = runGit(repo, mergeArgs)
    .split("\n")
    .filter((line) => line && isSubject(line.slice(line.lastIndexOf("\x1f") + 1), identities))
    .map((line) => line.slice(0, line.lastIndexOf("\x1f")));
  const prs = computePrs(records, mergeLines.join("\n"));

  const context = computeContext(repo, headSha, since, identities);
  const repoFirstCommit = computeRepoFirstCommit(repo, headSha);

  // Bare-clone safe: --show-toplevel fails outright with no working tree (exit 128,
  // "fatal: this operation must be run in a work tree"), which is exactly the shape of
  // repository a recipient verifies against (git fetches into a bare clone — nobody
  // checks out a candidate's history to re-derive a proof). opts.repoName is the CLI's
  // escape hatch for that case; redacted still nulls whichever value is picked.
  const toplevel = tryGit(repo, ["rev-parse", "--show-toplevel"]);
  const repoName = toplevel ? path.basename(toplevel.trim()) : (opts.repoName ?? null);
  const repoRemoteRaw = tryGit(repo, ["remote", "get-url", "origin"]);
  const repoRemote = repoRemoteRaw ? stripRemoteUserinfo(repoRemoteRaw.trim()) : null;

  const churnMap = buildChurnMap(records, exclude);
  const needsBlame = blameTop > 0 || blamePathsOpt.length > 0;
  const subjectShas = needsBlame ? collectSubjectShas(repo, headSha, identities) : new Set();

  const blame = [];
  const blamed = new Set();
  for (const [p] of sortByCountDesc(churnMap, Infinity)) {
    if (blame.length >= blameTop) break;
    blamed.add(p);
    if (!fileExistsAtRev(repo, headSha, p)) continue;
    const stats = blamePathStats(repo, headSha, p, subjectShas);
    if (stats) blame.push({ path: p, ...stats });
  }
  for (const p of blamePathsOpt) {
    if (blamed.has(p)) continue;
    blamed.add(p);
    if (!fileExistsAtRev(repo, headSha, p)) continue;
    const stats = blamePathStats(repo, headSha, p, subjectShas);
    if (stats) blame.push({ path: p, ...stats });
  }

  const scopesResult = {};
  for (const g of scopes) scopesResult[g] = computeScopeStats(records, g, exclude);

  return {
    generated_by: `proof-skill/${PROOF_VERSION}`,
    analyzed_at: asOf.toISOString(),
    head_sha: headSha,
    environment: gitEnvironment(),
    repo: {
      name: redacted ? null : repoName,
      remote: redacted ? null : repoRemote,
      first_commit: repoFirstCommit,
    },
    subject: {
      patterns: identities,
      identities: identityRows,
      since,
    },
    summary: { ...summary, first_authored_commit: first, last_authored_commit: last },
    context,
    top_directories: computeTopDirectories(records, exclude, 20),
    top_files: sortByCountDesc(churnMap, 20).map(([p, churn]) => ({ path: p, churn })),
    file_types: computeFileTypes(records, exclude, 15),
    largest_commits: computeLargestCommits(records, exclude, 10),
    recent: computeRecentWindow(records, since, asOf, exclude, 5),
    scopes: scopesResult,
    blame,
    prs,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// commitFacts() / pathFacts() — batched, on-demand facts for a specific set of
// commits or paths, used to check a claim's citations rather than to build the
// whole report. Both take identities/shas as explicit input; neither re-derives
// them, so a caller (checks.mjs, verify-proof.mjs) controls exactly what is
// looked up.
// ---------------------------------------------------------------------------

// One process for the whole set either way: cat-file --batch-check narrows
// `shas` down to the ones that actually resolve to a commit (a single bad sha
// would otherwise fail the ENTIRE --no-walk batch below with "fatal: bad
// object", losing every valid sha in the same call, not just the bad one).
function resolveExistingCommits(repo, shas) {
  if (shas.length === 0) return [];
  const out = tryGit(repo, ["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    input: shas.join("\n") + "\n",
  });
  const existing = [];
  for (const line of (out || "").split("\n")) {
    if (!line) continue;
    const spaceIdx = line.indexOf(" ");
    const sha = line.slice(0, spaceIdx);
    const type = line.slice(spaceIdx + 1);
    if (type === "commit") existing.push(sha);
  }
  return existing;
}

export function commitFacts(repo, shas, { exclude = DEFAULT_EXCLUDES } = {}) {
  const result = new Map();
  const uniqueShas = [...new Set((shas || []).filter(Boolean))];
  const existingShas = resolveExistingCommits(repo, uniqueShas);
  if (existingShas.length === 0) return result;

  const statsArgs = [
    "log",
    "--no-walk=unsorted",
    "--raw",
    "--numstat",
    "--no-textconv",
    "--no-ext-diff",
    "-M50%",
    `--format=${FORMAT}`,
    ...existingShas,
  ];
  const records = parseMainLog(runGit(repo, statsArgs));

  // %b (body, excluding the subject line) fetched separately from %s (subject, already
  // in FORMAT above): jamming raw multi-line body text into the same %x1f-delimited,
  // one-line-per-commit record would corrupt the diff-line classification that record
  // parsing depends on (an ordinary body line can itself start with ":" or "N\tN\t...").
  const bodyRaw = runGit(repo, ["log", "--no-walk=unsorted", "--format=%x1e%H%x1f%b", ...existingShas]);
  const bodies = new Map();
  for (const chunk of bodyRaw.split("\x1e").slice(1)) {
    const sepIdx = chunk.indexOf("\x1f");
    const sha = chunk.slice(0, sepIdx);
    let body = chunk.slice(sepIdx + 1);
    if (body.endsWith("\n")) body = body.slice(0, -1); // git log's own per-record newline
    bodies.set(sha, body);
  }

  for (const r of records) {
    let insertions = 0;
    let deletions = 0;
    const files = [];
    for (const f of keptFiles(r, exclude)) {
      if (typeof f.added === "number") insertions += f.added;
      if (typeof f.removed === "number") deletions += f.removed;
      files.push(f.path);
    }
    result.set(r.sha, {
      parents: r.parents,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      committerName: r.committerName,
      committerEmail: r.committerEmail,
      subject: r.subject,
      body: bodies.get(r.sha) ?? "",
      insertions,
      deletions,
      files,
    });
  }
  return result;
}

function pathTypeAtRev(repo, rev, p) {
  const t = tryGit(repo, ["cat-file", "-t", `${rev}:${p}`], { attrSource: rev });
  return t ? t.trim() : null;
}

export function pathFacts(repo, rev, paths, identities) {
  const result = new Map();
  const subjectShas = collectSubjectShas(repo, rev, identities);
  for (const p of paths) {
    const raw = runGit(repo, ["log", "--no-merges", "--format=%H%x1f%ae", rev, "--", p], { attrSource: rev });
    let totalCommits = 0;
    let subjectCommits = 0;
    const otherIdentities = new Set();
    for (const line of raw.split("\n")) {
      if (!line) continue;
      totalCommits++;
      const sepIdx = line.indexOf("\x1f");
      const email = line.slice(sepIdx + 1);
      if (isSubject(email, identities)) subjectCommits++;
      else otherIdentities.add(asciiLower(email));
    }
    const isFile = pathTypeAtRev(repo, rev, p) === "blob";
    const blameStats = isFile ? blamePathStats(repo, rev, p, subjectShas) : null;
    result.set(p, {
      blame_share: blameStats ? blameStats.share : null,
      subject_commits: subjectCommits,
      total_commits: totalCommits,
      other_identities: otherIdentities.size,
    });
  }
  return result;
}
