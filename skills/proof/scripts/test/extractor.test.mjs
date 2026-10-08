// Set before any Date use so the March 2026 EU DST transition in the fixture is a real
// timezone conversion, not a no-op — a test run under TZ=UTC would never exercise the
// bug class (local-time epoch math) this extractor is designed to avoid.
process.env.TZ = "Europe/Paris";

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  collect,
  matchesGlob,
  matchesAnyGlob,
  isSubject,
  asciiLower,
  commitFacts,
  pathFacts,
  readLogoSvg,
  runGit,
} from "../lib/evidence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SCRIPT = path.join(__dirname, "..", "make-fixture-repo.mjs");
const CLI = path.join(__dirname, "..", "git-evidence.mjs");
const ASOF = "2026-04-01T00:00:00Z";
const ADA_EMAIL = "100+ada@users.noreply.github.com";
const DANA_EMAIL = "dana@example.design";
const SUBJECT_EMAIL = "subject@example.dev";

let workDir;
let fixtureDir;
let shallowDir;
let designDir;
let bareDir;
let adversarialDir;
let adversarialShas;
let soloDir;
let fixtureShas;

before(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "proof-fixture-"));
  fixtureDir = path.join(workDir, "repo");
  shallowDir = path.join(workDir, "shallow");
  designDir = path.join(workDir, "design-repo");
  bareDir = path.join(workDir, "bare.git");
  adversarialDir = path.join(workDir, "adversarial");
  soloDir = path.join(workDir, "solo");
  const out = execFileSync(
    process.execPath,
    [
      FIXTURE_SCRIPT,
      "--out",
      fixtureDir,
      "--shallow-out",
      shallowDir,
      "--design-out",
      designDir,
      "--bare-out",
      bareDir,
      "--adversarial-out",
      adversarialDir,
      "--solo-out",
      soloDir,
    ],
    { encoding: "utf8" }
  );
  const parsed = JSON.parse(out);
  adversarialShas = parsed.adversarialShas;
  fixtureShas = parsed.shas;
});

after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best-effort; the OS temp dir gets reaped regardless
  }
});

// Strips the one field that is SUPPOSED to differ between two runs matched by
// different --author patterns against the same commits (the echoed-back pattern
// itself) so the rest of the comparison is a true "same underlying evidence" check.
function withoutPatterns(ev) {
  const { subject, ...rest } = ev;
  const { patterns, ...restSubject } = subject;
  return { ...rest, subject: restSubject };
}

describe("collect() against the synthetic fixture", () => {
  test("exact summary numbers", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF });
    assert.equal(ev.summary.authored_commits, 6);
    assert.equal(ev.summary.active_days, 3);
    assert.equal(ev.summary.span_days, 2);
    assert.equal(ev.summary.lines_added, 27);
    assert.equal(ev.summary.lines_removed, 2);
    assert.equal(ev.summary.files_touched, 4);
    assert.equal(ev.summary.ai_coauthored_commits, 1);
    assert.equal(ev.summary.ai_assisted_commit_share, 0.17);
    assert.equal(ev.summary.test_touches, 2);
    assert.equal(ev.summary.test_files, 1);
    assert.equal(ev.summary.recent_commits_90d, 6);
    assert.deepEqual(ev.summary.activity_by_month, [{ month: "2026-03", commits: 6 }]);
    assert.equal(ev.summary.first_authored_commit, "2026-03-28");
    assert.equal(ev.summary.last_authored_commit, "2026-03-30");
  });

  test("repository context numbers", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF });
    assert.equal(ev.context.total_commits, 8);
    assert.equal(ev.context.total_authors, 2);
    assert.equal(ev.context.subject_rank, 1);
  });

  test("PR detected from the squash-commit subject", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF });
    assert.deepEqual(
      ev.prs.map((p) => p.number),
      [7]
    );
  });

  test("blame share for src/index.js is 100% subject (Other Person never touches it)", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF, blameTop: 10 });
    const row = ev.blame.find((b) => b.path === "src/index.js");
    assert.ok(row, "expected a blame row for src/index.js");
    assert.equal(row.share, 1);
  });

  test("scope src/** commit and new_files counts", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF, scopes: ["src/**"] });
    assert.deepEqual(ev.scopes["src/**"], { commits: 4, touches: 5, files: 2, new_files: 2 });
  });

  test("a rename is a touch, not a new file, and is attributed to the new path only", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF, scopes: ["notes/**"], blameTop: 10 });
    // notes/release notes.md (add, by S2) then renamed to notes/RELEASE.md (by S6):
    // 2 commits, 2 touches, 2 distinct paths, but only ONE new_files (S2's add — the
    // rename must not also count as an addition).
    assert.deepEqual(ev.scopes["notes/**"], { commits: 2, touches: 2, files: 2, new_files: 1 });

    // The renamed-away path never existed at HEAD under its old name, so it gets no
    // blame row; the new name does, and is 100% the subject (git's default rename
    // detection follows blame across the rename with no extra flag required).
    assert.ok(!ev.blame.some((b) => b.path === "notes/release notes.md"));
    const renamed = ev.blame.find((b) => b.path === "notes/RELEASE.md");
    assert.ok(renamed, "expected a blame row for the renamed file's new path");
    assert.equal(renamed.share, 1);

    // The old path is still a legitimate historical touch (from S2, before the rename)
    // and the new path is a second, distinct touch (from S6) — both are real, non-git
    // artifacts of the subject's own work, so files_touched counts both.
    assert.equal(ev.summary.files_touched, 4);
  });

  test("identity matching is exact-email equality, ASCII-case-insensitive only", () => {
    // isSubject folds ASCII A-Z only, so an all-caps variant of the same exact
    // email still matches (RFC-conventional), while a bare name pattern like the
    // one this contract used to accept ("ada") no longer matches anything.
    const lower = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF });
    const upper = collect({ repo: fixtureDir, identities: [ADA_EMAIL.toUpperCase()], asOf: ASOF });
    assert.deepEqual(withoutPatterns(lower), withoutPatterns(upper));

    assert.throws(
      () => collect({ repo: fixtureDir, identities: ["ada"] }),
      (err) => err.code === 1 && /not an exact email address/.test(err.message)
    );
  });

  test("identities list two names sharing one email; the other contributor never appears", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF });
    assert.equal(ev.subject.identities.length, 2);
    assert.deepEqual(
      ev.subject.identities.map((i) => i.name).sort(),
      ["Ada Example", "ada"]
    );
    assert.equal(new Set(ev.subject.identities.map((i) => i.email)).size, 1);
    // One shared email => no "matches N distinct emails" warning.
    assert.deepEqual(ev.warnings, []);

    const json = JSON.stringify(ev);
    assert.ok(!json.includes("Other"), "Other Person's name leaked into evidence.json");
    assert.ok(!json.includes("other@example.com"), "Other Person's email leaked into evidence.json");
  });

  test("a tab in a filename round-trips through git's C-quoting and stays excluded", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF });
    // tmp\tnote.lock matches the **/*.lock exclude glob — present in the commit's diff,
    // absent from every aggregated stat.
    assert.ok(!JSON.stringify(ev).includes("note.lock"));
    assert.equal(ev.summary.files_touched, 4);
  });

  test("--since filters to the exact calendar day regardless of wall-clock time of day", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], since: "2026-03-30", asOf: ASOF });
    // Two subject commits land on 2026-03-30: S5 (the widget/PR commit) and S6 (the rename).
    assert.equal(ev.summary.authored_commits, 2);
  });

  test("--redacted nulls repo name and remote", () => {
    const ev = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF, redacted: true });
    assert.equal(ev.repo.name, null);
    assert.equal(ev.repo.remote, null);
  });

  test("an impossible calendar date in --since is rejected (exit code 2)", () => {
    assert.throws(
      () => collect({ repo: fixtureDir, identities: [ADA_EMAIL], since: "2026-13-99" }),
      (err) => err.code === 2
    );
  });

  test("zero matching commits stops rather than fabricating a proof (exit code 3)", () => {
    assert.throws(
      () => collect({ repo: fixtureDir, identities: ["nobody@invalid.test"] }),
      (err) => err.code === 3 && /stop/i.test(err.message)
    );
  });

  test("a shallow clone is refused (exit code 4)", () => {
    assert.throws(
      () => collect({ repo: shallowDir, identities: [ADA_EMAIL] }),
      (err) => err.code === 4
    );
  });

  test("output is byte-identical across two runs given the same --as-of", () => {
    const a = JSON.stringify(collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF }));
    const b = JSON.stringify(collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF }));
    assert.equal(a, b);
  });
});

describe("git-evidence.mjs CLI", () => {
  test("writes evidence.json with numbers matching collect()", () => {
    const jsonOut = path.join(workDir, "cli-evidence.json");
    execFileSync(
      process.execPath,
      [CLI, "--repo", fixtureDir, "--author", ADA_EMAIL, "--as-of", ASOF, "--json", jsonOut],
      { encoding: "utf8" }
    );
    assert.ok(existsSync(jsonOut));
    const ev = JSON.parse(readFileSync(jsonOut, "utf8"));
    assert.equal(ev.summary.authored_commits, 6);
    assert.equal(ev.summary.lines_added, 27);
    assert.equal(ev.summary.lines_removed, 2);
  });

  test("defaults --json to <repo>/proof/evidence.json when not given", () => {
    execFileSync(process.execPath, [CLI, "--repo", fixtureDir, "--author", ADA_EMAIL, "--as-of", ASOF], {
      encoding: "utf8",
    });
    const defaultPath = path.join(fixtureDir, "proof", "evidence.json");
    assert.ok(existsSync(defaultPath));
  });

  test("--print output never names the other contributor", () => {
    const out = execFileSync(
      process.execPath,
      [CLI, "--repo", fixtureDir, "--author", ADA_EMAIL, "--as-of", ASOF, "--print", "--json", path.join(workDir, "print-evidence.json")],
      { encoding: "utf8" }
    );
    assert.ok(!out.includes("Other"));
    assert.ok(!out.includes("other@example.com"));
    assert.ok(out.includes("summary.authored_commits: 6"));
  });

  test("--since 2026-13-99 exits 2", () => {
    assert.throws(
      () =>
        execFileSync(process.execPath, [CLI, "--repo", fixtureDir, "--author", ADA_EMAIL, "--since", "2026-13-99"], {
          encoding: "utf8",
        }),
      (err) => err.status === 2
    );
  });

  test("an unmatched --author exits 3", () => {
    assert.throws(
      () =>
        execFileSync(process.execPath, [CLI, "--repo", fixtureDir, "--author", "nobody@invalid.test"], {
          encoding: "utf8",
        }),
      (err) => err.status === 3
    );
  });

  test("a shallow clone exits 4", () => {
    assert.throws(
      () => execFileSync(process.execPath, [CLI, "--repo", shallowDir, "--author", ADA_EMAIL], { encoding: "utf8" }),
      (err) => err.status === 4
    );
  });

  test("--discover lists every identity whose name or email contains the text, with commit counts", () => {
    const out = execFileSync(process.execPath, [CLI, "--repo", fixtureDir, "--discover", "ada"], {
      encoding: "utf8",
    });
    assert.match(out, /^4\tada <100\+ada@users\.noreply\.github\.com>$/m);
    assert.match(out, /^2\tAda Example <100\+ada@users\.noreply\.github\.com>$/m);
    assert.ok(!out.includes("Other Person"), "a --discover search for \"ada\" must not surface Other Person");
  });

  test("--author must be an exact email; a bare name is rejected with a clear message", () => {
    assert.throws(
      () => execFileSync(process.execPath, [CLI, "--repo", fixtureDir, "--author", "ada"], { encoding: "utf8" }),
      (err) => err.status === 1 && /not an exact email address/.test(err.stderr ?? String(err))
    );
  });
});

describe("collect() against the design-role fixture (subject.role_family: design)", () => {
  test("exact counts for a 4-commit design subject", () => {
    const ev = collect({ repo: designDir, identities: [DANA_EMAIL], asOf: "2026-06-01T00:00:00Z" });
    assert.equal(ev.summary.authored_commits, 4);
    assert.equal(ev.summary.active_days, 2);
    assert.equal(ev.summary.span_days, 1);
    assert.equal(ev.summary.lines_added, 26);
    assert.equal(ev.summary.lines_removed, 0);
    // tokens/colors.css, components/button.stories.tsx, assets/logo.svg,
    // docs/design-notes.md (renamed away), docs/design-system.md (the rename target).
    assert.equal(ev.summary.files_touched, 5);
    assert.equal(ev.context.total_commits, 5);
    assert.equal(ev.context.total_authors, 2);
    assert.equal(ev.context.subject_rank, 1);
    assert.equal(ev.repo.first_commit, "2026-05-01");
  });

  test("the docs rename is pinned the same way as the main fixture's", () => {
    const ev = collect({ repo: designDir, identities: [DANA_EMAIL], asOf: "2026-06-01T00:00:00Z", scopes: ["docs/**"] });
    assert.deepEqual(ev.scopes["docs/**"], { commits: 2, touches: 2, files: 2, new_files: 1 });
  });

  test("the other contributor never appears", () => {
    const ev = collect({ repo: designDir, identities: [DANA_EMAIL], asOf: "2026-06-01T00:00:00Z" });
    const json = JSON.stringify(ev);
    assert.ok(!json.includes("Other Contributor"));
    assert.ok(!json.includes("other-contributor@example.com"));
  });

  test("assets/logo.svg exists at HEAD and is a small, well-formed SVG", () => {
    const svgPath = path.join(designDir, "assets", "logo.svg");
    assert.ok(existsSync(svgPath), "assets/logo.svg must exist in the built fixture");
    const bytes = readFileSync(svgPath);
    assert.ok(bytes.length < 64 * 1024, `logo.svg is ${bytes.length} bytes, expected under 64 KB`);
    const text = bytes.toString("utf8");
    assert.match(text, /^<svg[\s>]/, "logo.svg must start with an <svg> tag");
    assert.ok(text.trim().endsWith("</svg>"), "logo.svg must be a complete, well-formed SVG document");
  });
});

describe("glob engine (in-house, dependency-free, exercised independent of the Node version running the suite)", () => {
  // The contract table every implementation must satisfy: `**` as a whole
  // segment, `*`/`?` never crossing `/`, dot-segments matching by default,
  // and non-nested `{a,b}` alternation.
  const TABLE = [
    ["apps/website/.eslintrc.json", "apps/website/**", true],
    ["node_modules/.pnpm/x/index.js", "**/node_modules/**", true],
    [".github/workflows/ci.yml", "**/*.yml", true],
    ["a/b.png", "**/*.{png,jpg}", true],
    ["src/distillery/x.js", "**/dist/**", false],
  ];

  test("contract table", () => {
    for (const [filePath, glob, expected] of TABLE) {
      assert.equal(matchesGlob(filePath, glob), expected, `matchesGlob(${filePath}, ${glob})`);
    }
  });

  test("matchesAnyGlob agrees with matchesGlob over the same table", () => {
    for (const [filePath, glob, expected] of TABLE) {
      assert.equal(matchesAnyGlob(filePath, [glob]), expected);
    }
  });

  test("a pathological run of `**` segments resolves in well under 100ms (DP, not backtracking)", () => {
    const deepPath = Array(200).fill("a").join("/");
    const start = performance.now();
    const result = matchesGlob(deepPath, "**/a/**/a/**/b");
    const elapsed = performance.now() - start;
    assert.equal(result, false); // ends in "a", the glob requires a trailing "b"
    assert.ok(elapsed < 100, `took ${elapsed}ms, expected well under 100ms`);
  });

  test("nested braces and disallowed characters inside a group are left literal", () => {
    // Not a valid alternation (nested `{`) — the braces are literal text, so
    // only a path with those exact literal characters matches.
    assert.ok(matchesGlob("a/{b,{c,d}}", "a/{b,{c,d}}"));
    assert.ok(!matchesGlob("a/b", "a/{b,{c,d}}"));
  });
});

describe("isSubject / asciiLower — exact, ASCII-only identity matching", () => {
  test('"@" never matches (the old substring vulnerability that once matched all 71 contributors)', () => {
    assert.equal(isSubject("anyone@example.com", ["@"]), false);
  });

  test("a longer email containing an identity as a substring never matches", () => {
    assert.equal(isSubject("notada@example.dev", ["ada@example.dev"]), false);
    assert.equal(isSubject("ada@example.devils.com", ["ada@example.dev"]), false);
  });

  test("a Kelvin-sign (U+212A) look-alike never matches its ASCII look-alike", () => {
    const kelvin = "\u212Aada@example.dev"; // renders as "Kada@example.dev"
    assert.equal(isSubject(kelvin, ["kada@example.dev"]), false);
    assert.equal(isSubject("kada@example.dev", [kelvin]), false);
    // Confirms *why*: String.prototype.toLowerCase() folds U+212A onto "k" —
    // ASCII-only lowering must not.
    assert.equal(kelvin.toLowerCase(), "kada@example.dev");
    assert.notEqual(asciiLower(kelvin), "kada@example.dev");
  });

  test("plain ASCII case is still equal (RFC-conventional, not the confusable-folding risk)", () => {
    assert.equal(isSubject("Ada@Example.DEV", ["ada@example.dev"]), true);
  });
});

describe("commitFacts()", () => {
  test("exclusion-filtered stats differ sharply from the commit's raw shortstat", () => {
    const facts = commitFacts(fixtureDir, [fixtureShas.s5]);
    const f = facts.get(fixtureShas.s5);
    assert.ok(f, "expected facts for s5");
    assert.equal(f.subject, "feat: widget (#7)");
    assert.equal(f.authorEmail, ADA_EMAIL);
    assert.deepEqual(f.parents, [fixtureShas.o2]);
    // s5 also adds package-lock.json (1000 lines) and dist/bundle.js (500 lines),
    // both excluded — the filtered stats must reflect only the kept src/index.js edit.
    assert.equal(f.insertions, 1);
    assert.equal(f.deletions, 0);
    assert.deepEqual(f.files, ["src/index.js"]);
    assert.ok(f.body.includes("Co-authored-by: Claude"));

    const rawShortstat = execFileSync(
      "git",
      ["-C", fixtureDir, "show", "--shortstat", "--format=", fixtureShas.s5],
      { encoding: "utf8" }
    );
    const rawInsertions = Number(/(\d+) insertion/.exec(rawShortstat)[1]);
    assert.ok(rawInsertions > f.insertions, `raw ${rawInsertions} should be far larger than filtered ${f.insertions}`);
  });

  test("a sha that does not resolve to a commit is simply absent, not thrown", () => {
    const facts = commitFacts(fixtureDir, [fixtureShas.s5, "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]);
    assert.equal(facts.size, 1);
    assert.ok(facts.has(fixtureShas.s5));
  });
});

describe("pathFacts()", () => {
  test("ownership facts for a subject-only file vs. one the subject never touched", () => {
    const facts = pathFacts(fixtureDir, "HEAD", ["src/index.js", "other/unrelated.md"], [ADA_EMAIL]);
    assert.deepEqual(facts.get("src/index.js"), {
      blame_share: 1,
      subject_commits: 3,
      total_commits: 3,
      other_identities: 0,
    });
    const other = facts.get("other/unrelated.md");
    assert.equal(other.blame_share, 0);
    assert.equal(other.subject_commits, 0);
    assert.equal(other.other_identities, 1);
  });
});

describe("blamePaths option", () => {
  test("blamePaths surfaces a file outside the subject's own churn (blameTop never sees it)", () => {
    const ev = collect({
      repo: fixtureDir,
      identities: [ADA_EMAIL],
      asOf: ASOF,
      blameTop: 10,
      blamePaths: ["other/unrelated.md"],
    });
    assert.ok(
      !ev.top_files.some((f) => f.path === "other/unrelated.md"),
      "the subject never touched this file, so it cannot be a churn candidate"
    );
    const row = ev.blame.find((b) => b.path === "other/unrelated.md");
    assert.ok(row, "blamePaths must add a row even though it is outside the subject's own churn");
    assert.equal(row.subject, 0);
  });

  test("blame attribution ignores a committed .mailmap that git blame itself applies", () => {
    // Ground truth first: prove the fixture's mailmap attack is actually live, so a
    // pass below means the code is immune, not that the attack never fired.
    const rawPorcelain = runGit(adversarialDir, ["blame", "--porcelain", "HEAD", "--", "src/cache.js"]);
    assert.ok(
      rawPorcelain.includes("author-mail <fake@example.com>"),
      "git blame's own porcelain output should show the mailmap-rewritten address here"
    );

    const ev = collect({ repo: adversarialDir, identities: [SUBJECT_EMAIL], asOf: "2026-08-01T00:00:00Z" });
    const row = ev.blame.find((b) => b.path === "src/cache.js");
    assert.ok(row, "expected a blame row for src/cache.js");
    assert.equal(row.share, 1, "every line is the subject's own, the mailmap rewrite notwithstanding");
  });
});

describe("readLogoSvg()", () => {
  let svgRepo;
  let svgHead;

  before(() => {
    svgRepo = mkdtempSync(path.join(tmpdir(), "proof-logo-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: svgRepo });
    writeFileSync(path.join(svgRepo, "real.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
    symlinkSync("real.svg", path.join(svgRepo, "link.svg"));
    execFileSync("git", ["add", "-A"], { cwd: svgRepo });
    execFileSync(
      "git",
      ["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "add"],
      { cwd: svgRepo }
    );
    svgHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: svgRepo, encoding: "utf8" }).trim();
  });

  test("refuses a symlink entry even though it points at a real .svg", () => {
    assert.equal(readLogoSvg(svgRepo, svgHead, "link.svg"), null);
  });

  test("refuses a .. path and reads a real one", () => {
    assert.equal(readLogoSvg(svgRepo, svgHead, "../etc/passwd.svg"), null);
    assert.equal(typeof readLogoSvg(svgRepo, svgHead, "real.svg"), "string");
  });
});

describe("repo.remote strips userinfo", () => {
  test("a credentialed https remote is stripped; an scp-style remote is left alone", () => {
    execFileSync("git", ["remote", "add", "origin", "https://user:tok@example.com/org/repo.git"], { cwd: soloDir });
    const withHttps = collect({ repo: soloDir, identities: ["solo@example.dev"], asOf: "2026-09-01T00:00:00Z" });
    assert.equal(withHttps.repo.remote, "https://example.com/org/repo.git");

    execFileSync("git", ["remote", "set-url", "origin", "git@example.com:org/repo.git"], { cwd: soloDir });
    const withScp = collect({ repo: soloDir, identities: ["solo@example.dev"], asOf: "2026-09-01T00:00:00Z" });
    assert.equal(withScp.repo.remote, "git@example.com:org/repo.git");
  });
});

describe("rev resolution", () => {
  test("a rev that does not resolve throws EvidenceError code 5", () => {
    assert.throws(
      () => collect({ repo: fixtureDir, identities: [ADA_EMAIL], rev: "refs/does-not-exist" }),
      (err) => err.code === 5
    );
  });

  test("--rev reaches a commit that exists on no branch (refs/pull/1/head)", () => {
    const ev = collect({
      repo: adversarialDir,
      identities: [SUBJECT_EMAIL],
      rev: "refs/pull/1/head",
      asOf: "2026-08-01T00:00:00Z",
    });
    assert.equal(ev.head_sha, adversarialShas.a2);
    assert.equal(ev.summary.authored_commits, 2); // a1 and a2 only
  });
});

describe("hostile environment", () => {
  test("repo-local config, an untracked mailmap/gitattributes, and adversarial env vars change nothing", () => {
    const clean = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF, blameTop: 10 });

    // Same leaf directory name as fixtureDir ("repo") so repo.name matches too —
    // a true, unqualified deep-equal against the clean run, no field excluded.
    const hostileParent = path.join(workDir, "hostile-parent");
    const hostileDir = path.join(hostileParent, "repo");
    cpSync(fixtureDir, hostileDir, { recursive: true });
    execFileSync("git", ["config", "diff.renames", "false"], { cwd: hostileDir });
    execFileSync("git", ["config", "log.showRoot", "false"], { cwd: hostileDir });
    execFileSync("git", ["config", "core.bigFileThreshold", "1"], { cwd: hostileDir });
    execFileSync("git", ["config", "diff.relative", "true"], { cwd: hostileDir });
    writeFileSync(
      path.join(hostileDir, ".mailmap"),
      "Fake Name <fake@example.com> <100+ada@users.noreply.github.com>\n"
    );
    writeFileSync(path.join(hostileDir, ".gitattributes"), "*.js -diff\n");

    const savedParams = process.env.GIT_CONFIG_PARAMETERS;
    const savedGitDir = process.env.GIT_DIR;
    process.env.GIT_CONFIG_PARAMETERS = "'diff.renames'='false'";
    process.env.GIT_DIR = "/nonexistent/bogus/git/dir/from/the/hostile/test";
    let hostile;
    try {
      hostile = collect({ repo: hostileDir, identities: [ADA_EMAIL], asOf: ASOF, blameTop: 10 });
    } finally {
      if (savedParams === undefined) delete process.env.GIT_CONFIG_PARAMETERS;
      else process.env.GIT_CONFIG_PARAMETERS = savedParams;
      if (savedGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = savedGitDir;
    }

    assert.deepEqual(hostile, clean);
  });
});

describe("bare vs worktree parity", () => {
  test("collect() on the fixture and on its --bare-out clone agree except repo.name/repo.remote", () => {
    const worktree = collect({ repo: fixtureDir, identities: [ADA_EMAIL], asOf: ASOF, blameTop: 10 });
    const bare = collect({ repo: bareDir, identities: [ADA_EMAIL], asOf: ASOF, blameTop: 10, repoName: "repo" });

    const strip = (ev) => {
      const { repo, ...rest } = ev;
      const { name, remote, ...restRepo } = repo;
      return { ...rest, repo: restRepo };
    };
    assert.deepEqual(strip(bare), strip(worktree));

    // Without opts.repoName, a bare clone (no working tree, so --show-toplevel
    // fails) reports repo.name as null rather than throwing.
    const bareNoName = collect({ repo: bareDir, identities: [ADA_EMAIL], asOf: ASOF, blameTop: 10 });
    assert.equal(bareNoName.repo.name, null);
  });
});
