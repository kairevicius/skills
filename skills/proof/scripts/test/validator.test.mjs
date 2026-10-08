process.env.TZ = "Europe/Paris";

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, "..");
const validator = path.join(scripts, "validate-proof.mjs");
const renderer = path.join(scripts, "render-proof.mjs");
const fixtureBuilder = path.join(scripts, "make-fixture-repo.mjs");
const example = JSON.parse(readFileSync(path.join(scripts, "..", "fixtures", "proof.example.json"), "utf8"));

const run = (args, cwd) => {
  const res = spawnSync(process.execPath, [validator, ...args], { cwd, encoding: "utf8" });
  return { status: res.status, out: res.stdout + res.stderr };
};
const clone = (doc) => JSON.parse(JSON.stringify(doc));
let tmp;
const writeDoc = (doc, name = "doc.json") => {
  const p = path.join(tmp, name);
  writeFileSync(p, JSON.stringify(doc, null, 2));
  return p;
};
const expectFail = (doc, needle, extra = []) => {
  const res = run([writeDoc(doc), ...extra], tmp);
  assert.equal(res.status, 1, `expected FAIL, got ${res.status}\n${res.out}`);
  assert.match(res.out, needle);
  return res;
};

before(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "proof-validator-"));
});

test("the shipped example passes without --git", () => {
  const res = run([writeDoc(example)], tmp);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /^PASS: /m);
});

test("a candidate-side verification claim is rejected by the schema", () => {
  const doc = clone(example);
  doc.provenance.verification = "git_verified";
  expectFail(doc, /\/provenance\/verification/);
});

test("claims, evidence, skills given as objects fail at the schema", () => {
  for (const key of ["claims", "evidence", "skills"]) {
    const doc = clone(example);
    doc[key] = { not: "an array" };
    expectFail(doc, new RegExp(`/${key}`));
  }
});

test("an empty gaps list fails", () => {
  const doc = clone(example);
  doc.gaps = [];
  expectFail(doc, /\/gaps/);
});

test("an unknown top-level key fails", () => {
  const doc = clone(example);
  doc.extra = 1;
  expectFail(doc, /extra/);
});

test("a claim with one commit reference above 0.6 fails; 0.6 passes", () => {
  const doc = clone(example);
  doc.evidence.push({ id: "e99", type: "commit", ref: "e".repeat(40), description: "One commit." });
  doc.claims.push({ id: "c99", claim: "Did one thing once.", category: "other", confidence: 0.8, authorship: "unknown", evidence_refs: ["e99"] });
  expectFail(doc, /caps confidence at 0\.6/);
  doc.claims[doc.claims.length - 1].confidence = 0.6;
  assert.equal(run([writeDoc(doc)], tmp).status, 0);
});

test("a skill level outside its score band fails", () => {
  const doc = clone(example);
  doc.skills[0].score = 0.3;
  expectFail(doc, /does not match score/);
});

test("monthly activity that does not sum to authored_commits fails", () => {
  const doc = clone(example);
  doc.summary.activity_by_month[0].commits += 1;
  expectFail(doc, /sums to/);
});

test("a recent window larger than the total fails", () => {
  const doc = clone(example);
  doc.summary.recent_commits_90d = doc.summary.authored_commits + 1;
  expectFail(doc, /recent_commits_90d .* exceeds authored_commits/);
});

test("a span off by one day fails", () => {
  const doc = clone(example);
  doc.summary.span_days += 1;
  expectFail(doc, /span_days is/);
});

test("the AI share must equal the trailer count over the total", () => {
  const doc = clone(example);
  doc.summary.ai_coauthored_commits = 10;
  expectFail(doc, /ai_assisted_commit_share/);
});

test("redacted documents may not carry a repository or project name", () => {
  const doc = clone(example);
  doc.repository.name = "org/repo";
  expectFail(doc, /repository\.name must be null when redacted/);
  const doc2 = clone(example);
  doc2.repository.project.name = "Acme";
  expectFail(doc2, /project\.name must be absent when redacted/);
});

test("a noreply identity that names a different account than subject.account fails", () => {
  const doc = clone(example);
  doc.subject.identities = ["100+ada@users.noreply.github.com"];
  doc.subject.account = { host: "github.com", login: "someone-else" };
  expectFail(doc, /belongs to the github\.com account ada, not subject\.account someone-else/);
  doc.subject.account = { host: "github.com", login: "Ada" };
  assert.equal(run([writeDoc(doc)], tmp).status, 0);
});

test("code-like text and foreign emails in narrative fields fail", () => {
  const doc = clone(example);
  doc.evidence[0].description = "See ```const x = 1``` for details.";
  expectFail(doc, /contains a code fence/);
  const doc2 = clone(example);
  doc2.gaps.push("Reviewed by other@example.com");
  expectFail(doc2, /names an email that is not the subject's/);
});

test("a design-role document validates with design vocabulary and non-code evidence", () => {
  const doc = clone(example);
  // This test builds its own evidence register from scratch; drop the inherited
  // narrative, which cites numbers ("34%") this new evidence set doesn't carry.
  delete doc.narrative;
  doc.subject.role_family = "design";
  doc.claims = [
    {
      id: "c1",
      claim: "Owns the colour and type token source both applications import.",
      short: "Owns the shared token source",
      category: "design",
      confidence: 0.9,
      authorship: "hand_authored",
      evidence_refs: ["e1", "e2"],
    },
    {
      id: "c2",
      claim: "Documented every primitive with usage guidance and counter-examples.",
      short: "Documented the primitives",
      category: "documentation",
      confidence: 0.75,
      authorship: "mixed",
      evidence_refs: ["e3"],
    },
  ];
  doc.evidence = [
    { id: "e1", type: "asset", ref: "assets/logo.svg", description: "The mark, in 3 sizes." },
    { id: "e2", type: "file", ref: "tokens/colors.css", description: "41 tokens, one source." },
    { id: "e3", type: "document", ref: "docs/design-system.md", description: "Usage guidance for 12 primitives." },
  ];
  doc.skills = [{ name: "Design systems", level: "very_strong", score: 0.88, claim_refs: ["c1", "c2"] }];
  doc.stack = [{ name: "CSS", evidence_refs: ["e2"] }];
  doc.capabilities = [{ label: "Design-system ownership", claim_refs: ["c1", "c2"] }];
  doc.gaps = ["Motion and interaction: no animation code in the tree."];
  const res = run([writeDoc(doc, "design.json")], tmp);
  assert.equal(res.status, 0, res.out);
});

test("a claim category outside the enum fails", () => {
  const doc = clone(example);
  doc.claims[0].category = "vibes";
  expectFail(doc, /category/);
});

// --git: everything below runs against the synthetic repository with known numbers.
let fixture;
let evidence;
let base;
const subjectEmail = "100+ada@users.noreply.github.com";

const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();

before(async () => {
  fixture = mkdtempSync(path.join(os.tmpdir(), "proof-fixture-"));
  execFileSync(process.execPath, [fixtureBuilder, "--out", fixture], { stdio: "ignore" });
  const { collect } = await import("../lib/evidence.mjs");
  evidence = await collect({ repo: fixture, rev: "HEAD", identities: [subjectEmail], since: null, asOf: "2026-04-01T00:00:00Z", scopes: [], blameTop: 0 });
  const { first_authored_commit, last_authored_commit, ...summary } = evidence.summary;
  const pr = evidence.prs.find((p) => p.number === 7);
  base = {
    proof_version: "0.3.0",
    subject: { name: "Ada Example", identities: [subjectEmail], headline: "Owns the widget module end to end.", account: { host: "github.com", login: "ada" }, role_family: "software_engineering" },
    repository: {
      name: path.basename(fixture),
      remote: null,
      head_sha: evidence.head_sha,
      analyzed_at: "2026-04-01T00:00:00Z",
      first_authored_commit,
      last_authored_commit,
      redacted: false,
      context: { ...evidence.context },
      project: { description: "A synthetic repository built by the proof self-test.", first_commit: evidence.repo.first_commit },
    },
    summary,
    skills: [{ name: "JavaScript", level: "strong", score: 0.8, claim_refs: ["c1"] }],
    claims: [{ id: "c1", claim: "Built the widget module and its test.", short: "Built the widget module", category: "framework", confidence: 0.8, authorship: "mixed", evidence_refs: ["e1", "e2", "e3", "e4"] }],
    evidence: [
      { id: "e1", type: "commit", ref: pr.sha, description: "The widget commit (PR #7)." },
      { id: "e2", type: "file", ref: "src/index.js", description: "The module the subject owns." },
      { id: "e3", type: "pull_request", ref: "#7", description: "The widget pull request." },
      {
        id: "e4",
        type: "metric",
        ref: "authored_commits",
        description: `${summary.authored_commits} authored commits.`,
        measures: [{ token: String(summary.authored_commits), source: "summary", field: "authored_commits" }],
      },
    ],
    gaps: ["Infrastructure and deployment: no CI or container files in the tree."],
    provenance: { generator: "proof-skill/0.3.0" },
  };
});

const gitRun = (doc, extra = []) => run([writeDoc(doc, "git-doc.json"), "--git", "--repo", fixture, ...extra], tmp);

test("--git passes on a document derived from the fixture", () => {
  const res = gitRun(base);
  assert.equal(res.status, 0, res.out);
  assert.match(res.out, /git: 3 resolved, 1 skipped/);
  assert.match(res.out, /summary re-derived: match/);
});

test("--git rejects a commit by another contributor", () => {
  const other = git(fixture, "log", "--format=%H", "--author=other@example.com", "-1");
  const doc = clone(base);
  doc.evidence[0].ref = other;
  const res = gitRun(doc);
  assert.equal(res.status, 1);
  assert.match(res.out, /not authored by the subject/);
});

test("--git rejects a path absent at head_sha and a path the subject never touched", () => {
  const doc = clone(base);
  doc.evidence[1].ref = "src/nope.js";
  assert.match(gitRun(doc).out, /does not exist at head_sha/);
  const doc2 = clone(base);
  const otherFile = git(fixture, "log", "--format=", "--name-only", "--author=other@example.com").split("\n").filter(Boolean)[0];
  const subjectTouched = git(fixture, "log", "--format=%H", "-F", "-i", `--author=${subjectEmail}`, "--", otherFile);
  if (otherFile && !subjectTouched) {
    doc2.evidence[1].ref = otherFile;
    assert.match(gitRun(doc2).out, /never touched/);
  }
});

test("--git rejects an unknown pull request and a commit outside head_sha's history", () => {
  const doc = clone(base);
  doc.evidence[2].ref = "#99";
  assert.match(gitRun(doc).out, /no commit for pull request #99/);

  const sideDir = mkdtempSync(path.join(os.tmpdir(), "proof-side-"));
  execFileSync("git", ["clone", "-q", fixture, sideDir]);
  writeFileSync(path.join(sideDir, "side.txt"), "side\n");
  execFileSync("git", ["-C", sideDir, "-c", "user.name=ada", `-c`, `user.email=${subjectEmail}`, "add", "side.txt"]);
  execFileSync("git", ["-C", sideDir, "-c", "user.name=ada", `-c`, `user.email=${subjectEmail}`, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "side"]);
  const sideSha = git(sideDir, "rev-parse", "HEAD");
  execFileSync("git", ["-C", fixture, "fetch", "-q", sideDir, `HEAD:refs/heads/side`]);
  const doc2 = clone(base);
  doc2.evidence[0].ref = sideSha;
  assert.match(gitRun(doc2).out, /not reachable from head_sha/);
});

test("--git rejects a summary that does not re-derive", () => {
  const doc = clone(base);
  doc.summary.lines_added += 1;
  const res = gitRun(doc);
  assert.equal(res.status, 1);
  assert.match(res.out, /does not re-derive/);
});

test("--git rejects another contributor's name in the narrative", () => {
  const doc = clone(base);
  doc.gaps.push("Pairing: most reviews came from Other Person.");
  assert.match(gitRun(doc).out, /names another contributor/);
});

test("--rendered passes on fresh output and fails after one edited byte", () => {
  const outDir = path.join(tmp, "rendered");
  mkdirSync(outDir, { recursive: true });
  const docPath = writeDoc(base, "rendered.json");
  execFileSync(process.execPath, [renderer, docPath, "--out", outDir, "--repo", fixture], { stdio: "ignore" });
  const ok = run([docPath, "--git", "--repo", fixture, "--rendered", outDir], tmp);
  assert.equal(ok.status, 0, ok.out);
  assert.match(ok.out, /rendered: match/);
  appendFileSync(path.join(outDir, "proof.md"), "x");
  const bad = run([docPath, "--git", "--repo", fixture, "--rendered", outDir], tmp);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /differs from a fresh render/);
});
