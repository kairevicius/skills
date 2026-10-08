import { test, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runChecks } from "../lib/checks.mjs";
import { collect } from "../lib/evidence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const example = JSON.parse(readFileSync(path.join(here, "..", "..", "fixtures", "proof.example.json"), "utf8"));
const clone = (doc) => JSON.parse(JSON.stringify(doc));

const nonInfo = (findings) => findings.filter((f) => f.class !== "info");
const codesOf = (findings) => findings.map((f) => f.code);

test("the shipped example has zero trust/claim/hygiene findings", async () => {
  const { findings } = await runChecks(example, {});
  assert.deepEqual(nonInfo(findings), []);
});

// A minimal, otherwise-valid document to mutate per test — avoids re-deriving the whole
// example's cross-references for checks that only touch one corner of the document.
function baseDoc() {
  return {
    proof_version: "0.3.0",
    subject: { name: "Ada Example", identities: ["ada@example.dev"], headline: "Ships things." },
    repository: {
      name: "example/repo",
      remote: null,
      head_sha: "a".repeat(40),
      analyzed_at: "2026-01-01T00:00:00Z",
      first_authored_commit: "2025-01-01",
      last_authored_commit: "2025-01-02",
      redacted: false,
    },
    summary: {
      authored_commits: 1,
      lines_added: 10,
      lines_removed: 0,
      files_touched: 1,
      active_days: 1,
      span_days: 1,
      ai_coauthored_commits: 0,
      ai_assisted_commit_share: 0,
    },
    skills: [],
    claims: [
      {
        id: "c1",
        claim: "Wrote the widget module.",
        category: "framework",
        confidence: 0.8,
        authorship: "hand_authored",
        evidence_refs: ["e1"],
      },
    ],
    evidence: [{ id: "e1", type: "file", ref: "src/widget.js", description: "The widget module." }],
    gaps: ["No infrastructure work in the tree."],
    provenance: { generator: "proof-skill/0.3.0" },
  };
}

test("ref_invalid: '.', './', a leading '/' or ':', and '..' are all rejected", async () => {
  for (const bad of [".", "./", "/etc/passwd", ":stream", "src/../secrets.env"]) {
    const doc = baseDoc();
    doc.evidence[0].ref = bad;
    const { findings } = await runChecks(doc, {});
    assert.ok(findings.some((f) => f.code === "ref_invalid" && f.scope === "evidence" && f.id === "e1"), `expected ref_invalid for ${JSON.stringify(bad)}`);
  }
});

test("ref_invalid does not fire on an ordinary repo-relative path", async () => {
  const doc = baseDoc();
  const { findings } = await runChecks(doc, {});
  assert.ok(!codesOf(findings).includes("ref_invalid"));
});

test("number_uncited: a claim number absent from its cited evidence is flagged", async () => {
  const doc = baseDoc();
  doc.claims[0].claim = "Wrote the widget module and its 42 tests.";
  const { findings } = await runChecks(doc, {});
  const f = findings.find((x) => x.code === "number_uncited");
  assert.ok(f, "expected a number_uncited finding");
  assert.equal(f.scope, "claim");
  assert.equal(f.id, "c1");
  assert.match(f.message, /"42"/);
});

test("number_uncited does not fire when the claim's number is in the cited evidence", async () => {
  const doc = baseDoc();
  doc.evidence[0].description = "The widget module and its 42 tests.";
  doc.claims[0].claim = "Wrote the widget module and its 42 tests.";
  const { findings } = await runChecks(doc, {});
  assert.ok(!codesOf(findings).includes("number_uncited"));
});

test("count_word: a count word in a claim is rejected, whatever the underlying evidence says", async () => {
  const doc = baseDoc();
  doc.evidence[0].description = "12 tests for the widget module.";
  doc.claims[0].claim = "Wrote a dozen tests for the widget module.";
  const { findings } = await runChecks(doc, {});
  const f = findings.find((x) => x.code === "count_word");
  assert.ok(f, "expected a count_word finding");
  assert.equal(f.scope, "claim");
  assert.match(f.message, /"dozen"/i);
});

test("narrative_number_uncited: a headline number absent from every evidence description is a hygiene flag", async () => {
  const doc = baseDoc();
  doc.subject.headline = "Cut load time by 80% across the board.";
  const { findings } = await runChecks(doc, {});
  const f = findings.find((x) => x.code === "narrative_number_uncited");
  assert.ok(f, "expected a narrative_number_uncited finding");
  assert.equal(f.class, "hygiene");
  assert.equal(f.scope, "document");
  assert.match(f.message, /"80%"/);
});

test("narrative_number_uncited does not fire when the headline's number is backed", async () => {
  const doc = baseDoc();
  doc.evidence[0].description = "Cut load time by 80% across the board.";
  doc.subject.headline = "Cut load time by 80% across the board.";
  const { findings } = await runChecks(doc, {});
  assert.ok(!codesOf(findings).includes("narrative_number_uncited"));
});

// --git: link 2 (measures), ownership facts, and repository-fact re-derivation, all of
// which need a real repository. Reuses the same synthetic fixture and subject email as
// scripts/test/validator.test.mjs.
const fixtureBuilder = path.join(here, "..", "make-fixture-repo.mjs");
const subjectEmail = "100+ada@users.noreply.github.com";
let fixture;
let ev;
let gitBase;

before(async () => {
  fixture = mkdtempSync(path.join(os.tmpdir(), "proof-checks-fixture-"));
  execFileSync(process.execPath, [fixtureBuilder, "--out", fixture], { stdio: "ignore" });
  ev = await collect({ repo: fixture, rev: "HEAD", identities: [subjectEmail], since: null, asOf: "2026-04-01T00:00:00Z", scopes: ["src/**"], blamePaths: ["src/index.js"], blameTop: 0 });
  const { first_authored_commit, last_authored_commit, ...summary } = ev.summary;
  gitBase = {
    proof_version: "0.3.0",
    subject: { name: "Ada Example", identities: [subjectEmail], headline: "Owns the widget module.", account: { host: "github.com", login: "ada" } },
    repository: {
      name: path.basename(fixture),
      remote: null,
      head_sha: ev.head_sha,
      analyzed_at: "2026-04-01T00:00:00Z",
      first_authored_commit,
      last_authored_commit,
      redacted: false,
      context: { ...ev.context },
      project: { description: "A synthetic repository built by the proof self-test.", first_commit: ev.repo.first_commit },
    },
    summary,
    skills: [],
    claims: [{ id: "c1", claim: "Wrote the widget module.", category: "framework", confidence: 0.6, authorship: "hand_authored", evidence_refs: ["e1"] }],
    evidence: [{ id: "e1", type: "file", ref: "src/index.js", description: "The module the subject owns." }],
    gaps: ["No infrastructure work in the tree."],
    provenance: { generator: "proof-skill/0.3.0" },
  };
});

test("a fixture-derived document with no measures passes with zero trust/claim findings", async () => {
  const { findings } = await runChecks(gitBase, { repo: fixture, gitMode: true });
  assert.deepEqual(nonInfo(findings), []);
});

test("number_underived: a scope measure whose token is stale (does not match the re-derived value)", async () => {
  const doc = clone(gitBase);
  const commits = ev.scopes["src/**"].commits;
  const staleToken = String(commits + 1);
  doc.evidence[0].description = `${staleToken} subject commits touched src/**.`;
  doc.evidence[0].measures = [{ token: staleToken, source: "scope", key: "src/**", field: "commits" }];
  const { findings } = await runChecks(doc, { repo: fixture, gitMode: true });
  const f = findings.find((x) => x.code === "number_underived");
  assert.ok(f, "expected a number_underived finding for a stale scope measure");
  assert.equal(f.scope, "evidence");
  assert.equal(f.id, "e1");
});

test("number_underived: a number found only in a commit BODY (never the subject) does not re-derive", async () => {
  // The Lighthouse-attack shape: the evidence cites a real commit, but the number in the
  // description only appears in that commit's body, which self-reporting never reads.
  const pr = ev.prs.find((p) => p.number === 7);
  const doc = clone(gitBase);
  doc.evidence[0] = { id: "e1", type: "commit", ref: pr.sha, description: "Improved Lighthouse to 100." };
  doc.claims[0].evidence_refs = ["e1"];
  const { findings } = await runChecks(doc, { repo: fixture, gitMode: true });
  assert.ok(findings.some((x) => x.code === "number_underived" && x.id === "e1"));
});

test("measure_unused: a measure whose token never occurs in the description is flagged", async () => {
  const doc = clone(gitBase);
  doc.evidence[0].measures = [{ token: "999999", source: "summary", field: "authored_commits" }];
  const { findings } = await runChecks(doc, { repo: fixture, gitMode: true });
  const f = findings.find((x) => x.code === "measure_unused");
  assert.ok(f, "expected a measure_unused finding");
  assert.equal(f.class, "hygiene");
});

test("facts_drift: a wrong repository.first_authored_commit does not re-derive", async () => {
  const doc = clone(gitBase);
  doc.repository.first_authored_commit = "2000-01-01";
  const { findings } = await runChecks(doc, { repo: fixture, gitMode: true });
  const f = findings.find((x) => x.code === "facts_drift");
  assert.ok(f, "expected a facts_drift finding");
  assert.match(f.message, /first_authored_commit/);
});

test("ownership facts are attached to a file-type evidence item", async () => {
  const { evidence } = await runChecks(gitBase, { repo: fixture, gitMode: true });
  const e1 = evidence.find((x) => x.id === "e1");
  assert.ok(e1.ownership, "expected ownership facts on e1");
  assert.equal(e1.ownership.total_commits > 0, true);
  assert.equal(e1.ownership.blame_share, 1);
});

test("ownership_unbacked/not_checkable_from_git match whole words only, not substrings", async () => {
  // "console" contains "sole", "commonly" contains "only", "compiled" contains "led" —
  // none of these are the exclusivity/not-checkable word they happen to embed.
  const doc = clone(gitBase);
  doc.claims[0].claim = "Wrote a console logger and compiled the output commonly used in tests.";
  const { claims } = await runChecks(doc, { repo: fixture, gitMode: true });
  assert.deepEqual(claims.find((c) => c.id === "c1").flags, []);
});

test("ownership_unbacked fires on a real whole-word exclusivity claim with low ownership share", async () => {
  // A path the fixture's other contributor touched and the subject never did (same
  // discovery approach validator.test.mjs uses for its own "never touched" fixture path).
  const otherFile = execFileSync("git", ["-C", fixture, "log", "--format=", "--name-only", "--author=other@example.com"], { encoding: "utf8" })
    .split("\n").filter(Boolean)[0];
  const subjectTouched = execFileSync("git", ["-C", fixture, "log", "--format=%H", "-F", "-i", `--author=${subjectEmail}`, "--", otherFile], { encoding: "utf8" }).trim();
  assert.ok(otherFile && !subjectTouched, "fixture precondition: an other-only path must exist");

  const doc = clone(gitBase);
  doc.evidence[0] = { id: "e1", type: "file", ref: otherFile, description: "A file the other contributor wrote." };
  doc.claims[0].claim = "Solely architected this module from scratch.";
  doc.claims[0].evidence_refs = ["e1"];
  const { claims, evidence } = await runChecks(doc, { repo: fixture, gitMode: true });
  const e1 = evidence.find((x) => x.id === "e1");
  // The subject never touched this path, so it also fails path_not_touched — expected and
  // orthogonal to the flag under test, which still runs off the ownership facts pathFacts
  // computed regardless.
  assert.equal(e1.ownership.subject_commits, 0);
  const flags = claims.find((c) => c.id === "c1").flags;
  assert.ok(flags.some((f) => f.code === "ownership_unbacked"), "expected ownership_unbacked");
});

test("not_checkable_from_git fires on a whole-word not-checkable claim", async () => {
  const doc = clone(gitBase);
  doc.claims[0].claim = "Managed the widget module's roadmap.";
  const { claims } = await runChecks(doc, { repo: fixture, gitMode: true });
  const flags = claims.find((c) => c.id === "c1").flags;
  assert.ok(flags.some((f) => f.code === "not_checkable_from_git"));
});
