#!/usr/bin/env node
// The recipient's re-derivation of a candidate's proof.json against a fresh, public
// checkout of the repository it names. Nothing the candidate's file asserts is trusted:
// every mechanical result here is recomputed from a clone this process fetches itself.
// VERIFY.md explains what each outcome means and how to audit the pack.
//
// Usage:
//   verify-proof.mjs <proof.json> --work <empty-dir> [--by <name>] [--sig <path>]
//                    [--allow-host <host>]... [--allow-file-remote] [--keys-file <path>]
//                    [--timeout <seconds>]
//   verify-proof.mjs --finalize <work> [the same flags, minus --work and --sig]
//
// --finalize trusts its own command line, the remote, and the account's published keys.
// From <work> it takes the claim audits and only what it can re-check: proof.json must
// still hash to the value the first pass recorded, the copied signature can only lose a
// binding (it must validate against keys fetched again), and the clone is re-fetched
// with --prune, so a ref added to it after the first pass is dropped before any check.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadSchema, checkSchema, acceptedVersion, currentVersion } from "./lib/schema-check.mjs";
import { runChecks } from "./lib/checks.mjs";
import { runGit, tryGit, commitFacts, isSubject, readLogoSvg, gitEnvironment, gitSupportsAttrSource, PROOF_VERSION } from "./lib/evidence.mjs";
import { bindIdentity, IdentityError } from "./lib/identity.mjs";
import { renderMarkdown, renderHtml } from "./lib/render.mjs";

const ALLOWED_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"]);
const PATH_REF_TYPES = new Set(["file", "directory", "test", "document", "asset"]);
const SHA_RE = /^[0-9a-f]{40}$/;
const SIG_NAME = "proof.json.sig";
const DEFAULT_TIMEOUT_SECONDS = 300;
const MAX_EXCERPT_CHARS = 4000;
const MAX_BLOB_BYTES = 1024 * 1024;
const MAX_LISTED = 100;
// Findings that mean a check could not run, not that the proof is wrong.
const TOOL_ERROR_CODES = new Set(["summary_rederive_error", "link2_facts_error"]);

const USAGE = [
  "usage: verify-proof.mjs <proof.json> --work <empty-dir> [--by <name>] [--sig <path>]",
  "                        [--allow-host <host>]... [--allow-file-remote] [--keys-file <path>]",
  "                        [--timeout <seconds>]",
  "       verify-proof.mjs --finalize <work> [--by <name>] [--allow-host <host>]...",
  "                        [--allow-file-remote] [--keys-file <path>] [--timeout <seconds>]",
  "",
  "The first form fetches the repository the proof names into <work>/repo.git, re-derives",
  "every mechanical check, and writes <work>/verification.json (audits empty) and the audit",
  "pack <work>/pack/. The signature defaults to <proof.json>.sig when that file exists.",
  "",
  "--finalize re-fetches and re-checks everything, takes only claims[].audit from",
  "<work>/verification.json, writes <work>/verified.md and verified.html, and deletes the",
  "clone. Pass it the same flags as the first run.",
].join("\n");

function usageExit() {
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { allowHosts: new Set() };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) usageExit();
      return v;
    };
    switch (a) {
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      case "--finalize":
        opts.finalize = value();
        break;
      case "--work":
        opts.work = value();
        break;
      case "--by":
        opts.by = value();
        break;
      case "--sig":
        opts.sigPath = value();
        break;
      case "--allow-host":
        opts.allowHosts.add(value().toLowerCase());
        break;
      case "--allow-file-remote":
        opts.allowFileRemote = true;
        break;
      case "--keys-file":
        opts.keysFile = value();
        break;
      case "--timeout":
        opts.timeoutSeconds = Number(value());
        if (!(opts.timeoutSeconds > 0)) usageExit();
        break;
      default:
        if (a.startsWith("-")) usageExit();
        positional.push(a);
    }
  }
  if (positional.length > 1) usageExit();
  opts.file = positional[0];
  if (opts.finalize ? opts.file || opts.work || opts.sigPath : !opts.file || !opts.work) usageExit();
  return opts;
}

// ---------------------------------------------------------------------------
// Untrusted text. Everything the pack holds was written by the candidate or their
// repository, so bidi controls, Unicode tag characters (which can spell out instructions
// invisibly), and zero-width characters are escaped to a visible code-point form and
// counted, never passed through. The class is built from code points so this file's own
// source never contains the characters it looks for.
// ---------------------------------------------------------------------------
const HIDDEN_CODEPOINTS = [
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, // zero-width space, joiners, directional marks
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // bidi embeddings and overrides
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064, // word joiner and invisible operators
  0x2066, 0x2067, 0x2068, 0x2069, // bidi isolates
  0xfeff, // zero-width no-break space
];
const fromCode = (cp) => String.fromCharCode(cp);
// Tag characters (U+E0000 to U+E007F) sit outside the Basic Multilingual Plane, so without
// the regex "u" flag they match only as a surrogate pair: the plane's fixed high surrogate,
// then a low surrogate in the block's range.
const TAG_PAIR = `${fromCode(0xdb40)}[${fromCode(0xdc00)}-${fromCode(0xdc7f)}]`;
const HIDDEN_CHAR_RE = new RegExp(`[${HIDDEN_CODEPOINTS.map(fromCode).join("")}]|${TAG_PAIR}`, "g");
const TAG_RE = new RegExp(TAG_PAIR, "g");
const BACKSLASH = fromCode(92);
const NUL = fromCode(0);

function scanHiddenChars(text) {
  let count = 0;
  const escaped = String(text).replace(HIDDEN_CHAR_RE, (m) => {
    count++;
    return `${BACKSLASH}u{${m.codePointAt(0).toString(16).toUpperCase()}}`;
  });
  return { escaped, count };
}

function escapeStrings(value) {
  let count = 0;
  const walk = (v) => {
    if (typeof v === "string") {
      const scan = scanHiddenChars(v);
      count += scan.count;
      return scan.escaped;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [walk(k), walk(x)]));
    return v;
  };
  return { value: walk(value), count };
}

const isControl = (c) => c < 0x20 || (c >= 0x7f && c <= 0x9f);
const hasControlChars = (s) => [...String(s)].some((ch) => isControl(ch.codePointAt(0)));

// Printed text derives from the proof, the repository, or git's error output, all
// untrusted: a terminal escape sequence is an injection surface of its own.
function sanitizePrint(s) {
  const kept = [...String(s)].filter((ch) => ch === "\n" || !isControl(ch.codePointAt(0)));
  return scanHiddenChars(kept.join("")).escaped;
}

const REVIEWER_ADDRESSED_RE =
  /\b(dear reviewer|to the (ai|assistant|model|llm)\b|ignore (all |any )?(previous|the above|prior) instructions|disregard (all |any )?(previous|prior) instructions|note to (the )?(ai|grader|reviewer)|you are an ai|as an ai\b)/i;

// Tag characters mirror ASCII (U+E0041 is an invisible "A"), which is how instructions get
// hidden in plain sight; revealing them lets the reviewer-addressed check read them too.
const revealTags = (text) =>
  String(text).replace(TAG_RE, (m) => {
    const cp = m.codePointAt(0) - 0xe0000;
    return cp >= 0x20 && cp <= 0x7e ? fromCode(cp) : "";
  });
const addressesReviewer = (text) => typeof text === "string" && REVIEWER_ADDRESSED_RE.test(revealTags(text));

function capText(text) {
  return text.length <= MAX_EXCERPT_CHARS ? text : `${text.slice(0, MAX_EXCERPT_CHARS)}\n(truncated at ${MAX_EXCERPT_CHARS} characters)`;
}

function fail(message) {
  console.error(`FAIL: ${sanitizePrint(message)}`);
  process.exit(1);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitVersion = (raw) => /\d+\.\d+\.\d+/.exec(String(raw ?? ""))?.[0] ?? null;

// ---------------------------------------------------------------------------
// URL policy: new URL(), https only (file: only with --allow-file-remote), no userinfo, no
// leading "-" (argument injection), and an allowed host or --allow-host. git@host:owner/repo
// and ssh://host/owner/repo are normalized to https first, so the same policy applies
// whatever shape the candidate wrote. GIT_ALLOW_PROTOCOL, set on every git call that
// touches the URL, is the second and independent layer: a URL that slipped past this
// check still cannot make git use a transport other than https (or file, with the flag).
// ---------------------------------------------------------------------------
function normalizeRemoteUrl(raw) {
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(raw);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return `https://${scp[1]}/${scp[2].replace(/\.git$/, "")}`;
  if (/^ssh:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return `https://${u.host}${u.pathname.replace(/\.git$/, "")}`;
    } catch {
      return raw;
    }
  }
  return raw;
}

function checkUrlPolicy(raw, { allowHosts, allowFileRemote }) {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, code: "remote_missing", message: "repository.remote is empty" };
  if (raw.startsWith("-")) return { ok: false, code: "remote_leading_dash", message: `repository.remote starts with "-", so git would read it as an option: ${raw}` };
  const normalized = normalizeRemoteUrl(raw);
  let u;
  try {
    u = new URL(normalized);
  } catch {
    return { ok: false, code: "remote_unparseable", message: `repository.remote is not a valid URL: ${raw}` };
  }
  if (u.username || u.password) return { ok: false, code: "remote_userinfo", message: "repository.remote carries credentials" };
  if (u.protocol === "file:") {
    if (!allowFileRemote) return { ok: false, code: "remote_file_not_allowed", message: "repository.remote is a file:// URL; pass --allow-file-remote to permit it" };
    return { ok: true, url: normalized };
  }
  if (u.protocol !== "https:") return { ok: false, code: "remote_scheme_not_allowed", message: `repository.remote scheme "${u.protocol}" is not allowed (https only)` };
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host) && !allowHosts.has(host))
    return { ok: false, code: "remote_not_allowed", message: `repository.remote host "${host}" is not on the allowed list; pass --allow-host ${host} to permit it` };
  return { ok: true, url: normalized };
}

// ---------------------------------------------------------------------------
// The clone. Both passes use the same function: it creates <work>/repo.git when it is
// missing, then fetches every published branch and tag with --prune, so the refs match
// the remote exactly. Never a SHA: a forge serves objects that no branch holds (pull
// request heads, fork objects), and a proof pinned to one of those is not public work.
// ---------------------------------------------------------------------------
function fetchClone(workDir, remote, { protocols, timeoutMs }) {
  const bareRepo = path.join(workDir, "repo.git");
  if (!existsSync(bareRepo)) runGit(workDir, ["init", "--bare", "--quiet", "repo.git"]);
  runGit(bareRepo, ["fetch", "--prune", "--no-tags", "--quiet", "--", remote, "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], {
    env: { GIT_ALLOW_PROTOCOL: protocols },
    timeout: timeoutMs,
  });
  return bareRepo;
}

// git exits 128 for every transport failure, so the one signal that separates "the
// network failed" (re-run: Inconclusive) from "the host refused" (private or missing: Not
// reproducible) is curl's error text, which runGit's LC_ALL=C keeps in English. Only the
// text after the quoted URL is read, so a repository named like an error cannot match.
const NETWORK_ERROR_RE =
  /^(Could not resolve host|Failed to connect|Connection timed out|Operation timed out|Connection reset|Recv failure|Send failure|Empty reply from server|SSL|TLS|OpenSSL|LibreSSL|gnutls|schannel|HTTP\/2 stream|The requested URL returned error: (429|5[0-9][0-9]))/i;

function fetchFailureKind(err) {
  if (err?.timedOut) return "timeout";
  const curlError = /unable to access '[^']*': (.*)$/m.exec(String(err?.stderr ?? ""))?.[1] ?? "";
  return NETWORK_ERROR_RE.test(curlError) ? "network" : "refused";
}

function remoteDefaultBranch(bareRepo, remote, { protocols, timeoutMs }) {
  const out = tryGit(bareRepo, ["ls-remote", "--symref", remote, "HEAD"], { env: { GIT_ALLOW_PROTOCOL: protocols }, timeout: timeoutMs });
  return (out && /^ref:\s+refs\/heads\/(\S+)\s+HEAD$/m.exec(out)?.[1]) ?? null;
}

// The published ref that holds head_sha: the default branch when it does, else the first
// branch that does, else the first tag.
function refContaining(bareRepo, sha, defaultBranch) {
  if (defaultBranch && tryGit(bareRepo, ["merge-base", "--is-ancestor", sha, `refs/heads/${defaultBranch}`]) !== null) return `refs/heads/${defaultBranch}`;
  for (const namespace of ["refs/heads/", "refs/tags/"]) {
    const refs = (tryGit(bareRepo, ["for-each-ref", "--contains", sha, "--format=%(refname)", namespace]) ?? "").split("\n").filter(Boolean);
    if (refs.length > 0) return refs[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// What the auditor reads. Range members are listed so a range's shape can be judged from
// its subjects; they are display only, and Link 2 still reads a range's endpoints.
// ---------------------------------------------------------------------------
function rangeMembers(bareRepo, doc) {
  const members = [];
  for (const e of doc.evidence) {
    if (e.type !== "commit_range") continue;
    const [a, b, ...rest] = e.ref.split("..");
    if (rest.length > 0 || !SHA_RE.test(a ?? "") || !SHA_RE.test(b ?? "")) continue;
    const listed = tryGit(bareRepo, ["rev-list", `--max-count=${MAX_LISTED}`, `${a}..${b}`]);
    if (listed === null) continue;
    const total = Number(tryGit(bareRepo, ["rev-list", "--count", `${a}..${b}`])?.trim() ?? 0);
    members.push({ evidence: e.id, ref: e.ref, commits: listed.split("\n").filter(Boolean), total });
  }
  return members;
}

function commitFlags(fact) {
  const flags = [];
  const hidden = scanHiddenChars(fact.subject).count + scanHiddenChars(fact.body).count;
  if (hidden > 0) flags.push({ code: "hidden_characters", message: `${hidden} hidden character(s) in the commit message (bidi, tag, or zero-width), escaped here` });
  if (addressesReviewer(fact.subject) || addressesReviewer(fact.body)) flags.push({ code: "reviewer_addressed", message: "the commit message addresses a reviewer or an AI directly" });
  return flags;
}

// Flags a reader should see on the claim itself: hidden characters or text addressed to a
// reviewer or an AI, in the claim, in the evidence it cites, or in a commit that evidence
// cites.
function claimTextFlags(doc, { facts, members, citedShasByEvidence }) {
  const evidenceById = new Map(doc.evidence.map((e) => [e.id, e]));
  const membersByEvidence = new Map(members.map((m) => [m.evidence, m.commits]));
  const byClaim = new Map();
  for (const c of doc.claims) {
    const cited = c.evidence_refs.map((ref) => evidenceById.get(ref)).filter(Boolean);
    const texts = [c.claim, c.short, ...cited.map((e) => e.description)].filter((t) => typeof t === "string");
    const shas = new Set(cited.flatMap((e) => [...(citedShasByEvidence[e.id] ?? []), ...(membersByEvidence.get(e.id) ?? [])]));
    const flags = [];
    const hidden = texts.reduce((n, t) => n + scanHiddenChars(t).count, 0);
    if (hidden > 0)
      flags.push({ code: "hidden_characters", message: `claim ${c.id}: ${hidden} hidden character(s) in the claim or the evidence it cites (bidi, tag, or zero-width); the pack shows them escaped` });
    if (texts.some(addressesReviewer)) flags.push({ code: "reviewer_addressed", message: `claim ${c.id}: the claim or the evidence it cites addresses a reviewer or an AI directly` });
    const flagged = [...shas].filter((sha) => facts.has(sha) && commitFlags(facts.get(sha)).length > 0).length;
    if (flagged > 0)
      flags.push({ code: "cited_commit_flagged", message: `claim ${c.id}: ${flagged} cited commit(s) carry hidden characters or text addressed to a reviewer or an AI (see the pack)` });
    byClaim.set(c.id, flags);
  }
  return byClaim;
}

function buildAuditPack(workDir, { doc, bareRepo, facts, members, citedPaths }) {
  const packDir = path.join(workDir, "pack");
  const commitsDir = path.join(packDir, "commits");
  const filesDir = path.join(packDir, "files");
  mkdirSync(commitsDir, { recursive: true });
  mkdirSync(filesDir, { recursive: true });

  // The auditor reads the claims from this escaped copy, never from the raw proof.json.
  const proofCopy = escapeStrings(doc);
  writeFileSync(path.join(packDir, "proof.json"), `${JSON.stringify(proofCopy.value, null, 2)}\n`);

  const head = doc.repository.head_sha;
  const index = { head_sha: head, proof_hidden_characters: proofCopy.count, commits: [], ranges: members, files: [], directories: [], unavailable: [] };

  for (const [sha, fact] of facts) {
    if (!SHA_RE.test(sha)) continue;
    const record = {
      sha,
      subject: scanHiddenChars(fact.subject).escaped,
      body: scanHiddenChars(capText(fact.body)).escaped,
      authored_by_subject: isSubject(fact.authorEmail, doc.subject.identities),
      parents: fact.parents.length,
      insertions: fact.insertions,
      deletions: fact.deletions,
      files_total: fact.files.length,
      files: fact.files.slice(0, MAX_LISTED).map((p) => scanHiddenChars(p).escaped),
      flags: commitFlags(fact),
    };
    writeFileSync(path.join(commitsDir, `${sha}.json`), `${JSON.stringify(record, null, 2)}\n`);
    index.commits.push(sha);
  }

  for (const p of bareRepo ? citedPaths : []) {
    const shown = scanHiddenChars(p).escaped;
    if (shown !== p || hasControlChars(p)) {
      index.unavailable.push({ path: shown, reason: "the path itself contains hidden or control characters" });
      continue;
    }
    const spec = `${head}:${p}`;
    const type = tryGit(bareRepo, ["cat-file", "-t", spec])?.trim() ?? null;
    if (type === "tree") {
      const entries = (tryGit(bareRepo, ["ls-tree", "--name-only", spec]) ?? "").split("\n").filter(Boolean);
      index.directories.push({ path: p, entries: entries.slice(0, MAX_LISTED).map((x) => scanHiddenChars(x).escaped), entries_total: entries.length });
      continue;
    }
    if (type !== "blob") {
      index.unavailable.push({ path: p, reason: type ? `a ${type} at head_sha, not a file` : "not present at head_sha" });
      continue;
    }
    const size = Number(tryGit(bareRepo, ["cat-file", "-s", spec])?.trim());
    let content;
    if (!(size <= MAX_BLOB_BYTES)) {
      content = `(${size} bytes, over the ${MAX_BLOB_BYTES}-byte read limit: excerpt omitted)\n`;
    } else {
      const raw = tryGit(bareRepo, ["cat-file", "blob", spec]) ?? "";
      if (raw.includes(NUL)) {
        content = "(binary file: excerpt omitted)\n";
      } else {
        const scan = scanHiddenChars(capText(raw));
        const header = [];
        if (scan.count > 0) header.push(`[proof pack] ${scan.count} hidden character(s) (bidi, tag, or zero-width) are escaped below`);
        if (addressesReviewer(raw)) header.push("[proof pack] this file addresses a reviewer or an AI directly");
        content = [...header, scan.escaped].join("\n");
      }
    }
    // Blob paths in one tree never nest inside each other, so a collision here can only
    // come from a case-insensitive file system folding two names together.
    try {
      const dest = path.join(filesDir, p);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, content, { flag: "wx" });
      index.files.push(p);
    } catch {
      index.unavailable.push({ path: p, reason: "could not be written into the pack on this file system (the name collides with another cited path)" });
    }
  }

  writeFileSync(path.join(packDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

function pointerResolves(pointer, { doc, packDir }) {
  const sep = pointer.indexOf(":");
  if (sep < 0) return false;
  const kind = pointer.slice(0, sep);
  const value = pointer.slice(sep + 1);
  if (kind === "proof") return doc.claims.some((c) => c.id === value) || doc.evidence.some((e) => e.id === value);
  if (kind === "commit") return SHA_RE.test(value) && existsSync(path.join(packDir, "commits", `${value}.json`));
  if (kind === "file") return doc.evidence.some((e) => PATH_REF_TYPES.has(e.type) && (e.ref === value || scanHiddenChars(e.ref).escaped === value));
  return false;
}

function contradictionReason(contradictions, evidenceTotal, gitMode) {
  const failed = new Set(contradictions.filter((f) => f.scope === "evidence").map((f) => f.id)).size;
  const documentLevel = contradictions.filter((f) => f.scope === "document").length;
  const evidencePart = gitMode
    ? `${failed} of ${evidenceTotal} evidence items do not re-derive from the repository`
    : `${failed} of ${evidenceTotal} evidence items fail the checks that need no repository`;
  const documentPart = documentLevel > 0 ? `, and ${documentLevel} document-level ${documentLevel === 1 ? "check fails" : "checks fail"} (see Problems)` : "";
  return `${evidencePart}${documentPart}.`;
}

// ---------------------------------------------------------------------------
// The mechanical re-derivation both passes share: identity, the clone, head containment,
// runChecks, and the outcome they add up to. Nothing recorded in <work>/verification.json
// feeds it.
// ---------------------------------------------------------------------------
async function deriveVerification(doc, proofBytes, { workDir, sigPath, keysFile, allowHosts, allowFileRemote, timeoutSeconds, by }) {
  const r = doc.repository;
  const problems = [];
  const notes = [];
  const timeoutMs = (timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
  const protocols = allowFileRemote ? "https:file" : "https";
  const gitTooOld = !gitSupportsAttrSource();
  let remote = null;
  let bareRepo = null;
  let headRef = null;
  let defaultBranch = null;
  let fetchKind = null;

  let identity = {
    status: "unbound",
    account: doc.subject.account ?? null,
    signature: "absent",
    emails: doc.subject.identities.map((email) => ({ email, status: "unbound", method: "unknown" })),
  };
  let identityUnavailable = false;
  try {
    const bound = await bindIdentity({ proofBytes, sigPath, account: doc.subject.account ?? null, identities: doc.subject.identities, keysFile });
    identity = bound.identity;
    notes.push(...bound.notes);
  } catch (e) {
    if (!(e instanceof IdentityError)) throw e;
    identityUnavailable = true;
    notes.push(`identity could not be checked in this environment: ${e.message}`);
  }

  if (r.redacted) {
    problems.push({ code: "redacted", message: "The repository name and remote are withheld, so there is nothing to fetch." });
  } else if (!r.remote) {
    problems.push({ code: "remote_missing", message: "The proof names no remote, so there is nothing to fetch." });
  } else {
    const policy = checkUrlPolicy(r.remote, { allowHosts, allowFileRemote });
    if (!policy.ok) {
      problems.push({ code: policy.code, message: policy.message });
    } else {
      try {
        bareRepo = fetchClone(workDir, policy.url, { protocols, timeoutMs });
        remote = policy.url;
      } catch (e) {
        fetchKind = fetchFailureKind(e);
        const code = { timeout: "fetch_timeout", network: "fetch_network_error", refused: "clone_refused" }[fetchKind];
        const message =
          fetchKind === "timeout" ? `the fetch did not finish within ${timeoutMs / 1000} seconds` : `could not fetch the repository: ${sanitizePrint(e.message).slice(0, 300)}`;
        problems.push({ code, message });
        rmSync(path.join(workDir, "repo.git"), { recursive: true, force: true });
      }
    }
  }

  if (bareRepo) {
    if (gitTooOld) notes.push(`this environment's git (${gitEnvironment().git}) is older than 2.40, so attributes committed at head_sha were not applied`);
    defaultBranch = remoteDefaultBranch(bareRepo, remote, { protocols, timeoutMs });
    headRef = refContaining(bareRepo, r.head_sha, defaultBranch);
    if (!headRef) problems.push({ code: "head_not_on_any_ref", message: `head_sha ${r.head_sha} is not on any branch or tag the remote publishes` });
  }

  const gitMode = bareRepo !== null && headRef !== null;
  const { findings, evidence, claims, signals, citedShas, citedPaths, citedShasByEvidence, stats } = await runChecks(doc, {
    repo: gitMode ? bareRepo : null,
    gitMode,
    signals: gitMode,
    defaultBranch,
  });

  let members = [];
  let facts = new Map();
  if (gitMode) {
    members = rangeMembers(bareRepo, doc);
    const packShas = [...new Set([...citedShas, ...members.flatMap((m) => m.commits)])].filter((sha) => SHA_RE.test(sha));
    try {
      facts = commitFacts(bareRepo, packShas);
    } catch (e) {
      notes.push(`cited commits could not be read for the audit pack: ${e.message}`);
    }
  }
  const textFlags = claimTextFlags(doc, { facts, members, citedShasByEvidence });

  // A contradiction stands whether or not a clone was fetched: the document-level checks
  // (a share that does not equal its own ratio, an invalid ref) need no repository.
  const trust = findings.filter((f) => f.class === "trust");
  const toolErrors = trust.filter((f) => TOOL_ERROR_CODES.has(f.code));
  const contradictions = trust.filter((f) => !TOOL_ERROR_CODES.has(f.code));
  // Only a recorded, different git version excuses diff-stat drift: a proof that records
  // none claims no version difference, so its drift stands as a contradiction.
  const candidateGit = gitVersion(doc.provenance?.environment?.git);
  const localGit = gitVersion(gitEnvironment().git);
  const versionsDiffer = candidateGit !== null && candidateGit !== localGit;
  const onlyDiffStats = contradictions.length > 0 && contradictions.every((f) => f.code === "diff_stat_drift");

  let outcome;
  let reason;
  if (contradictions.length > 0 && !(onlyDiffStats && versionsDiffer)) {
    outcome = "contradicted";
    reason = contradictionReason(contradictions, doc.evidence.length, gitMode);
  } else if (!gitMode) {
    outcome = fetchKind === "timeout" || fetchKind === "network" ? "inconclusive" : "not_reproducible";
    reason = problems[0]?.message ?? "The repository could not be checked.";
  } else if (contradictions.length > 0) {
    outcome = "inconclusive";
    reason =
      "Only diff-derived counts differ (lines and files changed, which rename detection can shift between git versions), " +
      `and the proof was generated with git ${candidateGit} while this check ran git ${localGit}. ` +
      "Re-run with the candidate's git version, or ask.";
  } else if (toolErrors.length > 0) {
    outcome = "inconclusive";
    reason = `Some checks could not run: ${toolErrors[0].message}`;
  } else {
    outcome = "reproduced";
    reason = "Every mechanical check passed against the fetched repository.";
  }
  if (gitMode && gitTooOld && (outcome === "reproduced" || outcome === "contradicted")) {
    outcome = "inconclusive";
    reason = "This environment's git is older than 2.40, so some checks could not run at full fidelity. Re-run with git 2.40 or newer.";
  }
  if (identityUnavailable && outcome === "reproduced") {
    outcome = "inconclusive";
    reason = "Every mechanical check passed, but the signature could not be checked in this environment. Re-run where ssh-keygen and the network are available.";
  }

  for (const f of trust) if (f.scope === "document") problems.push({ code: f.code, message: f.message });
  for (const f of findings) if (f.code === "narrative_number_uncited") problems.push({ code: f.code, message: f.message });

  const verification = {
    verification_version: currentVersion(loadSchema("verification"), "verification_version"),
    proof_sha256: sha256(proofBytes),
    verified_at: new Date().toISOString(),
    verified_by: by ?? null,
    environment: { tool: `proof-skill/${PROOF_VERSION}`, git: gitEnvironment().git, node: process.version },
    remote,
    head_ref: headRef,
    head_on_default_branch: headRef && defaultBranch ? headRef === `refs/heads/${defaultBranch}` : null,
    outcome,
    reason,
    problems,
    counts: {
      evidence_total: stats.evidence,
      evidence_failed: evidence.filter((e) => e.status === "failed").length,
      numbers_rederived: stats.numbersRederived,
      numbers_self_reported: stats.numbersSelfReported,
      numbers_unbacked: stats.numbersUnbacked,
    },
    identity,
    signals,
    evidence: evidence.map((e) => ({ id: e.id, status: e.status, problems: e.problems, numbers: e.numbers, ownership: e.ownership })),
    claims: claims.map((c) => ({ id: c.id, problems: c.problems, flags: [...c.flags, ...(textFlags.get(c.id) ?? [])], audit: null })),
    notes: [...notes, ...findings.filter((f) => f.class === "hygiene" && f.code !== "narrative_number_uncited").map((f) => f.message)],
  };
  return { verification, gitMode, bareRepo, facts, members, citedPaths };
}

function parseProof(bytes, where) {
  let doc;
  try {
    doc = JSON.parse(bytes.toString("utf8"));
  } catch (e) {
    fail(`${where} is not valid JSON: ${e.message}`);
  }
  const schema = loadSchema();
  if (!acceptedVersion(schema).test(String(doc?.proof_version)))
    fail(`proof_version ${doc?.proof_version} is not 0.3.x; ask the candidate to regenerate the proof with proof 0.3`);
  const structural = checkSchema(schema, doc);
  if (structural.length > 0) {
    const first = structural[0];
    fail(`${where} does not match the proof 0.3 schema (${structural.length} problem(s); first: ${first.path || "/"} ${first.message}); ask the candidate to regenerate it with proof 0.3`);
  }
  return doc;
}

const networkOptions = (opts) => ({
  keysFile: opts.keysFile,
  allowHosts: opts.allowHosts,
  allowFileRemote: opts.allowFileRemote === true,
  timeoutSeconds: opts.timeoutSeconds,
  by: opts.by,
});

// The finalize command with the same flags, quoted for a POSIX shell.
function finalizeCommand(work, opts) {
  const q = (s) => `'${String(s).split("'").join(`'"'"'`)}'`;
  const parts = ["node", q(path.resolve(process.argv[1])), "--finalize", q(work)];
  if (opts.by) parts.push("--by", q(opts.by));
  for (const host of opts.allowHosts) parts.push("--allow-host", q(host));
  if (opts.allowFileRemote) parts.push("--allow-file-remote");
  if (opts.keysFile) parts.push("--keys-file", q(path.resolve(opts.keysFile)));
  if (opts.timeoutSeconds) parts.push("--timeout", String(opts.timeoutSeconds));
  return sanitizePrint(parts.join(" "));
}

// ---------------------------------------------------------------------------
// First pass: fetch, recompute, write the audit pack and verification.json (audits null).
// ---------------------------------------------------------------------------
async function verify(opts) {
  const work = path.resolve(opts.work);
  if (existsSync(work) && readdirSync(work).length > 0) fail(`--work ${work} is not empty`);
  if (opts.sigPath && !existsSync(opts.sigPath)) fail(`--sig ${opts.sigPath} does not exist`);
  const proofBytes = readFileSync(opts.file);
  const doc = parseProof(proofBytes, opts.file);

  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, "proof.json"), proofBytes);
  const sigSource = opts.sigPath ?? (existsSync(`${opts.file}.sig`) ? `${opts.file}.sig` : null);
  const sigPath = sigSource ? path.join(work, SIG_NAME) : null;
  if (sigSource) copyFileSync(sigSource, sigPath);

  const derived = await deriveVerification(doc, proofBytes, { workDir: work, sigPath, ...networkOptions(opts) });
  buildAuditPack(work, { doc, bareRepo: derived.gitMode ? derived.bareRepo : null, facts: derived.facts, members: derived.members, citedPaths: derived.citedPaths });
  writeFileSync(path.join(work, "verification.json"), `${JSON.stringify(derived.verification, null, 2)}\n`);

  const v = derived.verification;
  console.log(`OUTCOME: ${v.outcome}`);
  console.log(sanitizePrint(v.reason));
  console.log(`IDENTITY: ${v.identity.status} (signature ${v.identity.signature})`);
  console.log("");
  console.log(`Next: audit every claim from ${path.join(work, "pack")} alone (VERIFY.md has the rubric), writing`);
  console.log(`claims[].audit = {verdict, reason, question, pointers} into ${path.join(work, "verification.json")}. Then run:`);
  console.log(`  ${finalizeCommand(work, opts)}`);
}

// ---------------------------------------------------------------------------
// --finalize: re-hash proof.json, recompute everything, take only claims[].audit from the
// file, check every claim was audited with pointers that resolve, schema-validate,
// render, and delete the clone.
// ---------------------------------------------------------------------------
async function finalize(opts) {
  const work = path.resolve(opts.finalize);
  const proofPath = path.join(work, "proof.json");
  const verificationPath = path.join(work, "verification.json");
  if (!existsSync(proofPath) || !existsSync(verificationPath)) fail(`${work} is not a verify-proof.mjs work directory; run the first pass with --work ${work}`);
  const proofBytes = readFileSync(proofPath);
  let prior;
  try {
    prior = JSON.parse(readFileSync(verificationPath, "utf8"));
  } catch (e) {
    fail(`${verificationPath} is not valid JSON: ${e.message}`);
  }
  if (prior?.proof_sha256 !== sha256(proofBytes))
    fail(`${proofPath} has changed since the first pass (hash mismatch); start again from the proof you received`);
  const doc = parseProof(proofBytes, proofPath);

  const sigPath = existsSync(path.join(work, SIG_NAME)) ? path.join(work, SIG_NAME) : null;
  const derived = await deriveVerification(doc, proofBytes, { workDir: work, sigPath, ...networkOptions(opts) });
  const { verification } = derived;

  const packDir = path.join(work, "pack");
  const priorClaims = Array.isArray(prior.claims) ? prior.claims : [];
  for (const c of verification.claims) {
    const audit = priorClaims.find((x) => x?.id === c.id)?.audit ?? null;
    if (!audit) fail(`claim ${c.id} has no audit in ${verificationPath}; audit every claim before --finalize`);
    for (const pointer of Array.isArray(audit.pointers) ? audit.pointers : [])
      if (typeof pointer !== "string" || !pointerResolves(pointer, { doc, packDir }))
        fail(`claim ${c.id}: audit pointer ${JSON.stringify(pointer)} resolves to nothing in the proof or the pack`);
    c.audit = audit;
  }

  const schemaProblems = checkSchema(loadSchema("verification"), verification);
  if (schemaProblems.length > 0) fail(`the finalized verification does not match its schema: ${schemaProblems.map((p) => `${p.path || "/"} ${p.message}`).join("; ")}`);

  const r = doc.repository;
  const logoSvg = derived.gitMode && r.project?.logo_path && !r.redacted ? readLogoSvg(derived.bareRepo, r.head_sha, r.project.logo_path) : null;
  writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);
  writeFileSync(path.join(work, "verified.md"), renderMarkdown(doc, { verification }));
  writeFileSync(path.join(work, "verified.html"), renderHtml(doc, { logoSvg, verification }));
  rmSync(path.join(work, "repo.git"), { recursive: true, force: true });

  console.log(`OUTCOME: ${verification.outcome}`);
  console.log(sanitizePrint(verification.reason));
  console.log(`IDENTITY: ${verification.identity.status} (signature ${verification.identity.signature})`);
  console.log(`PASS: finalized ${work}: wrote verified.md and verified.html, and deleted the clone`);
}

const opts = parseArgs(process.argv.slice(2));
(opts.finalize ? finalize(opts) : verify(opts)).catch((e) => {
  console.error(`FAIL: ${sanitizePrint(e?.stack || e?.message || String(e))}`);
  process.exit(1);
});
