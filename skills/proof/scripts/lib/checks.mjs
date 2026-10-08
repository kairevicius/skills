// The semantic checks behind both validate-proof.mjs (the candidate's self-check) and
// verify-proof.mjs (the recipient's re-derivation). Every check produces one finding:
// {class: "trust"|"claim"|"hygiene"|"info", scope: "document"|"evidence"|"claim", id?,
// code, message}. "trust" and "claim" findings are what verify-proof.mjs turns into a
// Contradicted outcome; "hygiene" findings are advisory; "info" findings are notes and
// never fail anything. Message text for every check ported from proof 0.2.0 is preserved
// byte-for-byte, because scripts/test/validator.test.mjs asserts against it.
//
// All git access goes through evidence.mjs's sanitized runGit/tryGit: no raw
// execFileSync("git", ...) anywhere in this file. Every "is this the subject's commit"
// decision uses isSubject on the raw author email (exact, ASCII-only fold) — there is no
// substring or subject.name matching left below.
//
import { collect, commitFacts, pathFacts, tryGit, isSubject, asciiLower } from "./evidence.mjs";
import { loadSchema, currentVersion } from "./schema-check.mjs";
import { missingNumbers, countWords, classifyNumbers } from "./numbers.mjs";

// Fields a measure may bind, per source. Anything else (a non-numeric summary field like
// activity_by_month, a scope/blame measure missing its key, a summary/context measure
// carrying one) is measure_invalid.
const MEASURE_FIELDS = {
  summary: new Set(["authored_commits", "lines_added", "lines_removed", "files_touched", "active_days", "span_days", "ai_coauthored_commits", "ai_assisted_commit_share", "test_touches", "test_files", "recent_commits_90d"]),
  context: new Set(["total_commits", "total_authors", "subject_rank"]),
  scope: new Set(["commits", "touches", "files", "new_files"]),
  blame: new Set(["share", "subject", "total"]),
};

// Summary fields computed from per-commit diff stats, so rename detection affects them.
const DIFF_DERIVED_SUMMARY_FIELDS = new Set(["lines_added", "lines_removed", "files_touched", "test_touches", "test_files"]);

function measureIsValid(m) {
  const fields = MEASURE_FIELDS[m.source];
  if (!fields || !fields.has(m.field)) return false;
  const needsKey = m.source === "scope" || m.source === "blame";
  return needsKey ? !!m.key : m.key === undefined;
}

function resolveMeasureValue(m, ev) {
  if (m.source === "summary") return ev.summary[m.field];
  if (m.source === "context") return ev.context[m.field];
  if (m.source === "scope") return ev.scopes[m.key]?.[m.field];
  if (m.source === "blame") return ev.blame.find((b) => b.path === m.key)?.[m.field];
  return undefined;
}

// Words a claim uses to assert exclusive or from-scratch ownership; checked against the
// cited evidence's ownership facts. Words git has no way to check at all (leadership,
// mentoring — not visible in any commit) get their own, non-numeric flag instead.
const EXCLUSIVITY_WORDS = ["sole", "solely", "entire", "only", "owns", "single-handedly", "from scratch", "architected"];
const NOT_CHECKABLE_WORDS = ["led", "managed", "mentored"];

// Whole-word matching only: a plain substring search on "sole" hits "console", "only"
// hits "commonly", "led" hits "compiled" — every one of these words is common enough as
// a fragment of an unrelated word that substring matching would be mostly false positives.
function findWordHit(text, words) {
  for (const w of words) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(text)) return w;
  }
  return null;
}

const lower = (s) => String(s).toLowerCase();

// Rejects empty, ".", "./", a leading "/" or ":", and any ".." — the same shape the
// schema already enforces for repository.project.logo_path, applied here to every
// path-like evidence ref (file/directory/test/document/asset).
function isValidPathRef(ref) {
  if (typeof ref !== "string" || ref.length === 0) return false;
  if (ref === "." || ref === "./") return false;
  if (ref.startsWith("/") || ref.startsWith(":")) return false;
  if (ref.includes("..")) return false;
  return true;
}
const PATH_REF_TYPES = new Set(["file", "directory", "test", "document", "asset"]);

const utcDays = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

const bandOf = (score) => (score >= 0.85 ? "very_strong" : score >= 0.7 ? "strong" : score >= 0.5 ? "moderate" : "weak");

// A forge noreply address names its account, so it can contradict subject.account offline.
const NOREPLY = {
  "github.com": /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i,
  "gitlab.com": /^\d+-([A-Za-z0-9._-]+)@users\.noreply\.gitlab\.com$/i,
};

// Narrative hygiene: the report carries prose about code, never code, secrets, or other
// people's addresses.
const CODE_MARKERS = [
  [/```/, "a code fence"],
  [/\bimport\s+[\w{*].*\bfrom\s+['"]/, "an import statement"],
  [/\bexport\s+(default|const|function|class)\b/, "an export statement"],
  [/=>\s*\{/, "an arrow-function body"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key shape"],
  [/\bghp_[A-Za-z0-9]{36}\b/, "a GitHub token shape"],
  [/\bsk-[A-Za-z0-9]{20,}\b/, "an API key shape"],
  [/-----BEGIN/, "a PEM block"],
];

/**
 * Run every semantic check against `doc`. With `repo` and `gitMode: true`, also resolves
 * every commit/path/pull-request reference against the repository at
 * `doc.repository.head_sha` and re-derives the summary. `signals` is accepted now and
 * reserved for the unauthenticated-signals pass (solo repository, default branch, …); it
 * always returns null until that lands.
 *
 * Returns `{findings, evidence, claims, signals, stats}`: `evidence`/`claims` are
 * per-id result skeletons (status, problems, and the numbers/ownership/flags/audit slots
 * later stages fill in) that a caller folds into verification.json.
 */
export async function runChecks(doc, { repo = null, gitMode = false, signals = false, defaultBranch = null } = {}) {
  const findings = [];
  const push = (klass, scope, code, message, id) => findings.push(id ? { class: klass, scope, id, code, message } : { class: klass, scope, code, message });
  const note = (code, message) => push("info", "document", code, message);
  const evidenceResults = new Map(doc.evidence.map((e) => [e.id, { id: e.id, status: "unchecked", problems: [], numbers: [], ownership: null }]));
  const claimResults = new Map(doc.claims.map((c) => [c.id, { id: c.id, problems: [], flags: [], audit: null }]));
  const fail = (scope, id, klass, code, message) => {
    push(klass, scope, code, message, id);
    const bucket = scope === "evidence" ? evidenceResults.get(id) : scope === "claim" ? claimResults.get(id) : null;
    if (bucket) bucket.problems.push({ code, message });
  };

  const expectedGenerator = currentVersion(loadSchema());
  if (doc.provenance.generator !== `proof-skill/${doc.proof_version}`)
    note("generator_mismatch", `provenance.generator is ${doc.provenance.generator}; the version this skill emits is ${expectedGenerator}`);

  // Phase 2: semantics that need no repository.
  const evidenceById = new Map();
  for (const e of doc.evidence) {
    if (evidenceById.has(e.id)) fail("document", null, "hygiene", "duplicate_evidence_id", `duplicate evidence id: ${e.id}`);
    evidenceById.set(e.id, e);
    if (PATH_REF_TYPES.has(e.type) && !isValidPathRef(e.ref))
      fail("evidence", e.id, "trust", "ref_invalid", `evidence ${e.id}: ${e.type} ref ${JSON.stringify(e.ref)} is not a valid path (empty, ".", "./", a leading "/" or ":", and ".." are all rejected)`);
  }
  const claimById = new Map();
  for (const c of doc.claims) {
    if (claimById.has(c.id)) fail("document", null, "hygiene", "duplicate_claim_id", `duplicate claim id: ${c.id}`);
    claimById.set(c.id, c);
  }

  for (const c of doc.claims) {
    for (const ref of c.evidence_refs)
      if (!evidenceById.has(ref)) fail("claim", c.id, "claim", "evidence_ref_unresolved", `claim ${c.id}: evidence ref ${ref} does not resolve`);
    const distinct = new Set(c.evidence_refs.map((r) => evidenceById.get(r)).filter(Boolean).map((e) => `${e.type}:${e.ref}`));
    const single = distinct.size === 1 ? evidenceById.get(c.evidence_refs[0]) : null;
    if (single && ["commit", "file", "test"].includes(single.type) && c.confidence > 0.6)
      fail("claim", c.id, "claim", "confidence_cap", `claim ${c.id}: a single ${single.type} reference caps confidence at 0.6 (got ${c.confidence})`);

    // Link 1: every number in the claim's own text must be traceable to the evidence it
    // cites, and count words are rejected outright so a number can always be traced.
    const citedDescriptions = c.evidence_refs.map((ref) => evidenceById.get(ref)?.description).filter(Boolean);
    for (const field of ["claim", "short"]) {
      const text = c[field];
      if (typeof text !== "string") continue;
      for (const tok of missingNumbers(text, citedDescriptions))
        fail("claim", c.id, "claim", "number_uncited", `claim ${c.id}.${field}: "${tok.raw}" does not appear in the evidence it cites`);
      for (const w of countWords(text))
        fail("claim", c.id, "claim", "count_word", `claim ${c.id}.${field}: "${w.raw}" is a count word; write the digit so it can be traced`);
    }
  }

  for (const s of doc.skills) {
    for (const ref of s.claim_refs)
      if (!claimById.has(ref)) fail("document", null, "hygiene", "skill_ref_unresolved", `skill ${s.name}: claim ref ${ref} does not resolve`);
    if (s.level !== bandOf(s.score))
      fail("document", null, "hygiene", "skill_level_mismatch", `skill ${s.name}: level ${s.level} does not match score ${s.score} (band: ${bandOf(s.score)})`);
  }

  for (const s of doc.stack ?? [])
    for (const ref of s.evidence_refs)
      if (!evidenceById.has(ref)) fail("document", null, "hygiene", "stack_ref_unresolved", `stack ${s.name}: evidence ref ${ref} does not resolve`);

  for (const cap of doc.capabilities ?? [])
    for (const ref of cap.claim_refs) {
      const c = claimById.get(ref);
      if (!c) fail("document", null, "hygiene", "capability_ref_unresolved", `capability "${cap.label}": claim ref ${ref} does not resolve`);
      else if (c.confidence < 0.7) fail("document", null, "hygiene", "capability_confidence_low", `capability "${cap.label}": claim ${ref} is below 0.7 (${c.confidence})`);
    }

  const s = doc.summary;
  const r = doc.repository;
  if (r.first_authored_commit > r.last_authored_commit)
    fail("document", null, "trust", "date_range_invalid", `repository.first_authored_commit ${r.first_authored_commit} is after last_authored_commit ${r.last_authored_commit}`);
  const expectedSpan = utcDays(r.last_authored_commit) - utcDays(r.first_authored_commit);
  if (s.span_days !== expectedSpan)
    fail("document", null, "trust", "span_days_mismatch", `summary.span_days is ${s.span_days}; the UTC day difference between ${r.first_authored_commit} and ${r.last_authored_commit} is ${expectedSpan}`);
  if (s.authored_commits > 0 && (s.active_days < 1 || s.active_days > s.span_days + 1))
    fail("document", null, "trust", "active_days_out_of_range", `summary.active_days ${s.active_days} does not fit a ${s.span_days}-day span`);
  if (s.authored_commits === 0 && s.active_days !== 0)
    fail("document", null, "trust", "active_days_nonzero_without_commits", "summary.active_days must be 0 when authored_commits is 0");
  if (s.ai_coauthored_commits > s.authored_commits)
    fail("document", null, "trust", "ai_coauthored_exceeds_total", `summary.ai_coauthored_commits ${s.ai_coauthored_commits} exceeds authored_commits ${s.authored_commits}`);
  const expectedShare = s.authored_commits === 0 ? 0 : s.ai_coauthored_commits / s.authored_commits;
  if (Math.abs(s.ai_assisted_commit_share - expectedShare) > 0.005)
    fail("document", null, "trust", "ai_share_mismatch", `summary.ai_assisted_commit_share ${s.ai_assisted_commit_share} is not ${s.ai_coauthored_commits}/${s.authored_commits} (${expectedShare.toFixed(3)})`);
  if (s.recent_commits_90d !== undefined && s.recent_commits_90d > s.authored_commits)
    fail("document", null, "trust", "recent_commits_exceeds_total", `summary.recent_commits_90d ${s.recent_commits_90d} exceeds authored_commits ${s.authored_commits}`);
  if (s.test_files !== undefined && s.test_touches !== undefined && s.test_files > s.test_touches)
    fail("document", null, "trust", "test_files_exceeds_touches", `summary.test_files ${s.test_files} exceeds test_touches ${s.test_touches}`);
  if (s.activity_by_month) {
    const months = s.activity_by_month.map((m) => m.month);
    const sum = s.activity_by_month.reduce((acc, m) => acc + m.commits, 0);
    if (sum !== s.authored_commits) fail("document", null, "trust", "activity_sum_mismatch", `summary.activity_by_month sums to ${sum}, authored_commits is ${s.authored_commits}`);
    for (let i = 1; i < months.length; i++)
      if (months[i] <= months[i - 1]) fail("document", null, "trust", "activity_not_ascending", `summary.activity_by_month is not ascending and unique at ${months[i]}`);
    if (months.length > 0) {
      if (months[0] !== r.first_authored_commit.slice(0, 7))
        fail("document", null, "trust", "activity_start_mismatch", `summary.activity_by_month starts at ${months[0]}, first_authored_commit is in ${r.first_authored_commit.slice(0, 7)}`);
      if (months[months.length - 1] !== r.last_authored_commit.slice(0, 7))
        fail("document", null, "trust", "activity_end_mismatch", `summary.activity_by_month ends at ${months[months.length - 1]}, last_authored_commit is in ${r.last_authored_commit.slice(0, 7)}`);
    }
  }
  if (r.project?.first_commit && r.project.first_commit > r.first_authored_commit)
    fail("document", null, "trust", "project_first_commit_after_subject", `repository.project.first_commit ${r.project.first_commit} is after the subject's first commit ${r.first_authored_commit}`);
  if (r.context) {
    if (r.context.subject_rank !== undefined && r.context.total_authors !== undefined && r.context.subject_rank > r.context.total_authors)
      fail("document", null, "trust", "subject_rank_exceeds_total", `repository.context.subject_rank ${r.context.subject_rank} exceeds total_authors ${r.context.total_authors}`);
    if (r.context.total_commits !== undefined && r.context.total_commits < s.authored_commits)
      fail("document", null, "trust", "total_commits_below_authored", `repository.context.total_commits ${r.context.total_commits} is below authored_commits ${s.authored_commits}`);
  }

  if (r.redacted) {
    if (r.name !== null) fail("document", null, "hygiene", "redacted_name", "repository.name must be null when redacted");
    if (r.remote !== null && r.remote !== undefined) fail("document", null, "hygiene", "redacted_remote", "repository.remote must be null or absent when redacted");
    if (r.project?.name) fail("document", null, "hygiene", "redacted_project_name", "repository.project.name must be absent when redacted");
    if (r.project?.logo_path) fail("document", null, "hygiene", "redacted_project_logo", "repository.project.logo_path must be absent when redacted");
  } else if (typeof r.name !== "string" || r.name.length === 0) {
    fail("document", null, "hygiene", "name_required_when_not_redacted", "repository.name must be a non-empty string when not redacted");
  }

  if (doc.subject.account) {
    const { host, login } = doc.subject.account;
    for (const id of doc.subject.identities) {
      const m = NOREPLY[host] ? id.match(NOREPLY[host]) : null;
      if (m && asciiLower(m[1]) !== asciiLower(login))
        fail("document", null, "trust", "identity_account_mismatch", `subject.identities: ${id} belongs to the ${host} account ${m[1]}, not subject.account ${login}`);
    }
  }

  // Link 1, narrative fields: the headline, the subject's slice of the project, and the
  // authorship paragraph are read outside any one claim, so their numbers are traced
  // against every evidence description rather than a specific claim's citations.
  const allEvidenceDescriptions = doc.evidence.map((e) => e.description);
  const numberTracedNarrativeFields = [
    ["subject.headline", doc.subject.headline],
    ["repository.project.subject_slice", r.project?.subject_slice],
    ["narrative.authorship", doc.narrative?.authorship],
  ];
  for (const [where, text] of numberTracedNarrativeFields) {
    if (typeof text !== "string") continue;
    for (const tok of missingNumbers(text, allEvidenceDescriptions))
      fail("document", null, "hygiene", "narrative_number_uncited", `${where}: "${tok.raw}" does not appear in any evidence description`);
  }

  const narrative = [];
  const collectNarrative = (where, text) => { if (typeof text === "string") narrative.push([where, text]); };
  collectNarrative("subject.headline", doc.subject.headline);
  collectNarrative("repository.project.description", r.project?.description);
  collectNarrative("repository.project.subject_slice", r.project?.subject_slice);
  collectNarrative("narrative.authorship", doc.narrative?.authorship);
  collectNarrative("provenance.notes", doc.provenance.notes);
  doc.claims.forEach((c) => { collectNarrative(`claim ${c.id}`, c.claim); collectNarrative(`claim ${c.id}.short`, c.short); });
  doc.evidence.forEach((e) => collectNarrative(`evidence ${e.id}`, e.description));
  doc.gaps.forEach((g, i) => collectNarrative(`gaps[${i}]`, g));
  (doc.capabilities ?? []).forEach((c) => collectNarrative(`capability "${c.label}"`, c.label));
  (doc.skills ?? []).forEach((k) => collectNarrative(`skill "${k.name}"`, k.name));
  (doc.stack ?? []).forEach((k) => collectNarrative(`stack "${k.name}"`, k.name));

  for (const [where, text] of narrative) {
    for (const [re, what] of CODE_MARKERS) if (re.test(text)) fail("document", null, "hygiene", "narrative_code_marker", `${where}: contains ${what}`);
    for (const email of text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])
      if (!isSubject(email, doc.subject.identities)) fail("document", null, "hygiene", "narrative_foreign_email", `${where}: names an email that is not the subject's (${email})`);
  }

  // Phase 3: the repository. Every check is pinned to repository.head_sha, never to HEAD or
  // the working tree, because the proof describes the analysed state.
  let gitResolved = 0;
  let gitSkipped = 0;
  let summaryRederived = null;
  let numbersRederived = 0;
  let numbersSelfReported = 0;
  let numbersUnbacked = 0;
  let signalsResult = null;
  let citedShas = [];
  let citedPaths = [];
  const citedShasByEvidence = {};
  let repoChecked = false;
  if (gitMode && repo) {
    const git = (...a) => tryGit(repo, a);
    const head = r.head_sha;
    const identities = doc.subject.identities;

    if (git("cat-file", "-e", `${head}^{commit}`) === null) {
      fail("document", null, "trust", "head_sha_missing", `repository.head_sha ${head} does not exist in this repository`);
    } else {
      repoChecked = true;
      const current = git("rev-parse", "HEAD")?.trim();
      if (current && current !== head) note("head_mismatch", `HEAD is ${current.slice(0, 10)}; the proof describes ${head.slice(0, 10)} — checks are pinned to the proof`);

      const authoredBySubject = (sha) => {
        const email = git("log", "-1", "--format=%ae", sha);
        return email !== null && isSubject(email.trim(), identities);
      };
      const checkCommit = (e, sha) => {
        if (!/^[0-9a-f]{40}$/.test(sha)) { fail("evidence", e.id, "trust", "sha_not_full", `evidence ${e.id}: ${sha} is not a full 40-character SHA`); return false; }
        if (git("cat-file", "-e", `${sha}^{commit}`) === null) { fail("evidence", e.id, "trust", "commit_missing", `evidence ${e.id}: commit ${sha} does not exist`); return false; }
        if (git("merge-base", "--is-ancestor", sha, head) === null) { fail("evidence", e.id, "trust", "commit_unreachable", `evidence ${e.id}: commit ${sha} is not reachable from head_sha`); return false; }
        if (!authoredBySubject(sha)) { fail("evidence", e.id, "trust", "commit_not_subject", `evidence ${e.id}: commit ${sha} is not authored by the subject`); return false; }
        return true;
      };

      // Per-evidence context Link 2 needs once the whole evidence list has been walked:
      // which commits it cites (for subject-line self-reporting), a range's commit count,
      // a PR's number. Filled in below, alongside the existing per-type checks. Only refs
      // that passed checkCommit enter it: everything downstream (commitFacts, ownership,
      // signals, the audit pack) passes these to git as revisions, and an unvalidated ref
      // such as "--output=<path>" would be parsed as an option that writes files.
      const link2Context = new Map();
      for (const e of doc.evidence) {
        switch (e.type) {
          case "commit": {
            const ok = checkCommit(e, e.ref);
            if (ok) gitResolved++;
            link2Context.set(e.id, { shas: ok ? [e.ref] : [], rangeCount: null, prNumber: null });
            break;
          }
          case "commit_range": {
            const [a, b, ...rest] = e.ref.split("..");
            if (!a || !b || rest.length) { fail("evidence", e.id, "trust", "range_malformed", `evidence ${e.id}: commit_range ref must be <sha>..<sha>`); break; }
            if (!(checkCommit(e, a) && checkCommit(e, b))) break;
            const count = Number(git("rev-list", "--count", `${a}..${b}`)?.trim() ?? "0");
            if (count === 0) fail("evidence", e.id, "trust", "range_empty", `evidence ${e.id}: range ${e.ref} contains no commits`);
            else gitResolved++;
            link2Context.set(e.id, { shas: [a, b], rangeCount: count, prNumber: null, rangeRef: `${a}..${b}` });
            break;
          }
          case "file":
          case "directory":
          case "test":
          case "document":
          case "asset": {
            if (!isValidPathRef(e.ref)) break; // already reported as ref_invalid above
            if (git("cat-file", "-e", `${head}:${e.ref}`) === null) { fail("evidence", e.id, "trust", "path_missing", `evidence ${e.id}: path ${e.ref} does not exist at head_sha`); break; }
            // Every author who ever touched the path, not git's own --author pattern
            // (a substring/regex match on "Name <email>") — isSubject decides, in JS,
            // against the exact raw email.
            const touchAuthors = (git("log", "--format=%ae", head, "--", e.ref) ?? "").split("\n").filter(Boolean);
            if (!touchAuthors.some((email) => isSubject(email, identities))) { fail("evidence", e.id, "trust", "path_not_touched", `evidence ${e.id}: the subject never touched ${e.ref}`); break; }
            gitResolved++;
            break;
          }
          case "pull_request": {
            const m = e.ref.match(/^#(\d+)$/);
            if (!m) { fail("evidence", e.id, "trust", "pr_ref_malformed", `evidence ${e.id}: pull_request ref must look like #142`); break; }
            const n = m[1];
            const out = git("log", head, "-F", "-i", `--grep=(#${n})`, `--grep=Merge pull request #${n} from`, "--format=%H%x1f%ae%x1f%P%x1f%s") ?? "";
            const hits = out.split("\n").filter(Boolean).map((l) => l.split("\x1f"))
              .filter(([, , , subject]) => new RegExp(`\\(#${n}\\)\\s*$`).test(subject) || new RegExp(`^Merge pull request #${n}\\b`).test(subject));
            if (hits.length === 0) { fail("evidence", e.id, "trust", "pr_not_found", `evidence ${e.id}: no commit for pull request #${n} is reachable from head_sha`); break; }
            const owned = hits.some(([sha, email, parents]) => {
              if (isSubject(email, identities)) return true;
              const p = parents.split(" ");
              if (p.length < 2) return false;
              const authors = (git("log", "--format=%ae", `${p[0]}..${p[1]}`) ?? "").split("\n").filter(Boolean);
              return authors.some((em) => isSubject(em, identities));
            });
            if (!owned) { fail("evidence", e.id, "trust", "pr_not_subject", `evidence ${e.id}: pull request #${n} carries no commit by the subject`); break; }
            gitResolved++;
            link2Context.set(e.id, { shas: hits.map(([sha]) => sha), rangeCount: null, prNumber: Number(n), prHits: hits });
            break;
          }
          case "metric":
          case "pattern":
            if (!/^[a-z0-9_]+$/.test(e.ref)) fail("evidence", e.id, "hygiene", "metric_ref_format", `evidence ${e.id}: ${e.type} ref must be snake_case (got ${e.ref})`);
            if (!/\d/.test(e.description)) fail("evidence", e.id, "hygiene", "metric_description_no_digit", `evidence ${e.id}: a ${e.type} description must state the number it measures`);
            gitSkipped++;
            break;
        }
      }

      if (r.project?.logo_path && !r.redacted && git("cat-file", "-e", `${head}:${r.project.logo_path}`) === null)
        fail("document", null, "trust", "logo_missing", `repository.project.logo_path ${r.project.logo_path} does not exist at head_sha`);

      // Privacy sweep: nobody but the subject may be named. Bots are not contributors in
      // the sense that matters here, and single short tokens would flag ordinary words.
      const contributors = new Map();
      for (const line of (git("log", head, "--format=%an%x09%ae") ?? "").split("\n")) {
        if (!line) continue;
        const [name, email] = line.split("\t");
        if (!name || !email) continue;
        if (isSubject(email, identities)) continue;
        if (/\[bot\]$/i.test(name) || /^(github|github actions|dependabot|renovate|copilot|claude|codex|cursor)\b/i.test(name)) continue;
        contributors.set(lower(email), lower(name));
      }
      for (const [where, text] of narrative) {
        const t = lower(text);
        for (const [email, name] of contributors) {
          if (t.includes(email)) fail("document", null, "hygiene", "narrative_other_contributor_email", `${where}: names another contributor's email`);
          const tokens = name.split(/\s+/).filter(Boolean);
          const fullName = tokens.length >= 2 || name.length >= 6;
          if (fullName && new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(t))
            fail("document", null, "hygiene", "narrative_other_contributor", `${where}: names another contributor`);
        }
      }

      // Re-derive the summary and the other repository-level facts the way the extractor
      // computes them. scopes/blamePaths are gathered from every evidence item's own
      // measures first, so this is one collect() call, not one per measure.
      const declaredScopes = new Set();
      const declaredBlamePaths = new Set();
      for (const e of doc.evidence) for (const m of e.measures ?? []) {
        if (m.source === "scope" && m.key) declaredScopes.add(m.key);
        if (m.source === "blame" && m.key) declaredBlamePaths.add(m.key);
      }
      let ev = null;
      try {
        ev = await collect({
          repo,
          rev: head,
          identities: doc.subject.identities,
          since: r.context?.since ?? null,
          asOf: r.analyzed_at,
          scopes: [...declaredScopes],
          blamePaths: [...declaredBlamePaths],
          blameTop: 0,
        });
        // Two codes, because the fields fail for different reasons: diff-derived counts
        // depend on rename detection, which a different git version can shift, while
        // history-derived counts (commits, days, trailers) come from the commit graph and
        // agree across versions. verify-proof.mjs reads a diff_stat_drift between two git
        // versions as Inconclusive; a summary_drift is always a contradiction.
        const historyDrift = [];
        const diffDrift = [];
        for (const key of Object.keys(s)) {
          if (!(key in ev.summary)) continue;
          if (JSON.stringify(s[key]) === JSON.stringify(ev.summary[key])) continue;
          (DIFF_DERIVED_SUMMARY_FIELDS.has(key) ? diffDrift : historyDrift).push(`${key}: document ${JSON.stringify(s[key])}, repository ${JSON.stringify(ev.summary[key])}`);
        }
        if (historyDrift.length) fail("document", null, "trust", "summary_drift", `summary does not re-derive from the repository:\n      ${historyDrift.join("\n      ")}`);
        if (diffDrift.length) fail("document", null, "trust", "diff_stat_drift", `summary does not re-derive from the repository:\n      ${diffDrift.join("\n      ")}`);
        summaryRederived = historyDrift.length === 0 && diffDrift.length === 0;

        // Repository facts beyond the summary: first/last authored commit, the subject's
        // standing among all contributors, and the project's own age.
        const factDrift = [];
        if (r.first_authored_commit !== ev.summary.first_authored_commit) factDrift.push(`repository.first_authored_commit: document ${r.first_authored_commit}, repository ${ev.summary.first_authored_commit}`);
        if (r.last_authored_commit !== ev.summary.last_authored_commit) factDrift.push(`repository.last_authored_commit: document ${r.last_authored_commit}, repository ${ev.summary.last_authored_commit}`);
        if (r.context) {
          for (const key of ["total_commits", "total_authors", "subject_rank"]) {
            if (r.context[key] === undefined) continue;
            if (r.context[key] !== ev.context[key]) factDrift.push(`repository.context.${key}: document ${r.context[key]}, repository ${ev.context[key]}`);
          }
        }
        if (r.project?.first_commit !== undefined && r.project.first_commit !== ev.repo.first_commit)
          factDrift.push(`repository.project.first_commit: document ${r.project.first_commit}, repository ${ev.repo.first_commit}`);
        if (factDrift.length) fail("document", null, "trust", "facts_drift", `repository facts do not re-derive from the repository:\n      ${factDrift.join("\n      ")}`);
      } catch (e) {
        fail("document", null, "trust", "summary_rederive_error", `summary could not be re-derived: ${e.message}`);
      }

      // Link 2: every evidence-description number is re-derived, self-reported, or
      // unbacked. commitFacts/pathFacts are each called once, batched over every commit
      // and path the evidence register cites, rather than once per evidence item.
      const allShas = new Set();
      for (const ctx of link2Context.values()) for (const sha of ctx.shas) allShas.add(sha);
      const pathRefs = [...new Set(doc.evidence.filter((e) => PATH_REF_TYPES.has(e.type) && isValidPathRef(e.ref)).map((e) => e.ref))];
      citedShas = [...allShas];
      citedPaths = pathRefs;
      for (const [id, ctx] of link2Context) citedShasByEvidence[id] = ctx.shas;

      let facts = new Map();
      let ownershipByPath = new Map();
      try {
        facts = commitFacts(repo, [...allShas]);
        ownershipByPath = pathFacts(repo, head, pathRefs, identities);
      } catch (e) {
        fail("document", null, "trust", "link2_facts_error", `commit and path facts could not be gathered: ${e.message}`);
      }

      for (const e of doc.evidence) {
        if (PATH_REF_TYPES.has(e.type) && isValidPathRef(e.ref)) {
          const o = ownershipByPath.get(e.ref);
          if (o) evidenceResults.get(e.id).ownership = o;
        }
      }
      // A range's or PR's ownership walks every commit in it, not just the endpoints/hit
      // commits link2Context keeps for subject-line tracing (a merge commit's own two
      // parents bound the squashed-in commits the same way the pr_not_subject check above
      // already walks them).
      for (const e of doc.evidence) {
        const ctx = link2Context.get(e.id);
        if (!ctx) continue;
        if (e.type === "commit_range" && ctx.rangeRef) {
          const emails = (git("log", "--format=%ae", ctx.rangeRef) ?? "").split("\n").filter(Boolean);
          const mine = emails.filter((em) => isSubject(em, identities)).length;
          const others = new Set(emails.filter((em) => !isSubject(em, identities)).map(asciiLower));
          evidenceResults.get(e.id).ownership = { blame_share: null, subject_commits: mine, total_commits: emails.length, other_identities: others.size };
        } else if (e.type === "pull_request" && ctx.prHits) {
          const seen = new Set();
          let mine = 0;
          const others = new Set();
          for (const [sha, email, parents] of ctx.prHits) {
            const p = parents.split(" ").filter(Boolean);
            const shas = p.length >= 2 ? (git("log", "--format=%H", `${p[0]}..${p[1]}`) ?? "").split("\n").filter(Boolean) : [sha];
            for (const s2 of shas) {
              if (seen.has(s2)) continue;
              seen.add(s2);
              const em = s2 === sha ? email : (git("log", "-1", "--format=%ae", s2) ?? "");
              if (isSubject(em, identities)) mine++;
              else if (em) others.add(asciiLower(em));
            }
          }
          evidenceResults.get(e.id).ownership = { blame_share: null, subject_commits: mine, total_commits: seen.size, other_identities: others.size };
        }
      }

      for (const e of doc.evidence) {
        const ctx = link2Context.get(e.id) ?? { shas: [], rangeCount: null, prNumber: null };
        const measures = (e.measures ?? []).map((m) => {
          if (!measureIsValid(m)) {
            fail("evidence", e.id, "trust", "measure_invalid", `evidence ${e.id}: measure token "${m.token}" has an invalid source/field combination (source=${m.source}, field=${m.field}${m.key !== undefined ? `, key=${m.key}` : ""})`);
            return null;
          }
          if (m.source === "scope" && ev) {
            const share = ev.summary.authored_commits > 0 ? (ev.scopes[m.key]?.commits ?? 0) / ev.summary.authored_commits : 0;
            if (share >= 0.9) fail("evidence", e.id, "hygiene", "scope_too_broad", `evidence ${e.id}: scope "${m.key}" touches ${Math.round(share * 100)}% of the subject's commits — too broad to distinguish this claim`);
          }
          return { ...m, value: ev ? resolveMeasureValue(m, ev) : undefined };
        }).filter(Boolean);

        const subjects = ctx.shas.map((sha) => ({ sha, subject: facts.get(sha)?.subject })).filter((x) => x.subject !== undefined);
        let stats = null;
        if (e.type === "commit") {
          const f = facts.get(e.ref);
          if (f) stats = { insertions: f.insertions, deletions: f.deletions, files: f.files.length };
        }

        const { numbers, unusedMeasures } = classifyNumbers(e.description, { measures, subjects, stats, rangeCount: ctx.rangeCount, prNumber: ctx.prNumber });
        evidenceResults.get(e.id).numbers = numbers.map((n) => ({ raw: n.raw, class: n.class, source: n.source }));
        for (const n of numbers) {
          if (n.class === "rederived") numbersRederived++;
          else if (n.class === "self_reported") numbersSelfReported++;
          else {
            numbersUnbacked++;
            fail("evidence", e.id, "trust", "number_underived", `evidence ${e.id}: "${n.raw}" in the description does not re-derive from the repository`);
          }
        }
        for (const m of unusedMeasures)
          fail("evidence", e.id, "hygiene", "measure_unused", `evidence ${e.id}: measure token "${m.token}" does not occur in the description`);
      }

      // Ownership facts, read on claims: exclusivity words ("architected", "solely", …)
      // must be backed by at least half the cited evidence's ownership share; words git
      // has no way to check at all (leadership, mentoring) get a flag of their own.
      for (const c of doc.claims) {
        const text = lower(c.claim ?? "");
        const claimResult = claimResults.get(c.id);
        const exclusivityHit = findWordHit(text, EXCLUSIVITY_WORDS);
        if (exclusivityHit) {
          const ownerships = c.evidence_refs.map((ref) => evidenceResults.get(ref)?.ownership).filter(Boolean);
          if (ownerships.length > 0) {
            const shares = ownerships.map((o) => o.blame_share ?? (o.total_commits > 0 ? o.subject_commits / o.total_commits : null)).filter((x) => x !== null);
            const avg = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
            if (avg !== null && avg < 0.5)
              claimResult.flags.push({ code: "ownership_unbacked", message: `claim ${c.id}: "${exclusivityHit}" claims exclusive ownership, but the cited evidence shows a ${Math.round(avg * 100)}% share` });
          }
        }
        const notCheckableHit = findWordHit(text, NOT_CHECKABLE_WORDS);
        if (notCheckableHit)
          claimResult.flags.push({ code: "not_checkable_from_git", message: `claim ${c.id}: "${notCheckableHit}" describes something git history cannot show either way — an interview question, not a git check` });
      }

      // Signals: unauthenticated, since whoever controls the repository controls them.
      // default_branch/head_on_default_branch are the caller's (verify-proof.mjs talks to
      // the remote for that); on_default_branch here counts cited commits against that
      // same branch name once it has been fetched locally.
      if (signals) {
        const citedShas = [...allShas];
        const defaultRef = defaultBranch ? `refs/heads/${defaultBranch}` : null;
        const onDefaultBranch = defaultRef ? citedShas.filter((sha) => git("merge-base", "--is-ancestor", sha, defaultRef) !== null).length : 0;
        let committedBySubject = 0;
        let committedByForge = 0;
        let committedByOther = 0;
        for (const sha of citedShas) {
          const cemail = facts.get(sha)?.committerEmail ?? "";
          if (!cemail) continue;
          if (isSubject(cemail, identities)) committedBySubject++;
          else if (/^noreply@github\.com$/i.test(cemail)) committedByForge++;
          else committedByOther++;
        }
        signalsResult = {
          default_branch: defaultBranch ?? null,
          solo_repository: (ev?.context.total_authors ?? 1) <= 1,
          total_authors: ev?.context.total_authors ?? 0,
          cited_commits: citedShas.length,
          on_default_branch: onDefaultBranch,
          committed_by_subject: committedBySubject,
          committed_by_forge: committedByForge,
          committed_by_other: committedByOther,
        };
      }
    }
  }

  // An evidence item fails only on a trust finding. Its hygiene findings (an unused
  // measure, a scope too broad to distinguish the claim) still list under its problems.
  // Without a repository, only the document-level checks ran, so the rest stay unchecked.
  const failedIds = new Set(findings.filter((f) => f.scope === "evidence" && f.class === "trust").map((f) => f.id));
  for (const er of evidenceResults.values()) er.status = failedIds.has(er.id) ? "failed" : repoChecked ? "ok" : "unchecked";

  return {
    findings,
    evidence: [...evidenceResults.values()],
    claims: [...claimResults.values()],
    signals: signalsResult,
    citedShas,
    citedPaths,
    citedShasByEvidence,
    stats: {
      claims: doc.claims.length,
      evidence: doc.evidence.length,
      skills: doc.skills.length,
      gaps: doc.gaps.length,
      gitResolved,
      gitSkipped,
      summaryRederived,
      numbersRederived,
      numbersSelfReported,
      numbersUnbacked,
    },
  };
}
