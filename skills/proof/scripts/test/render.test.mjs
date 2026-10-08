import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderMarkdown,
  renderHtml,
  forgeBase,
  bar,
  levelLabel,
  humanizeSpan,
  monthName,
} from "../lib/render.mjs";

const exampleUrl = new URL("../../fixtures/proof.example.json", import.meta.url);
const example = JSON.parse(readFileSync(exampleUrl, "utf8"));

const verificationExampleUrl = new URL("../../fixtures/verification.example.json", import.meta.url);
const verificationExample = JSON.parse(readFileSync(verificationExampleUrl, "utf8"));

// A synthetic proof.json written against the OLDER 0.1.2 schema (no `short`,
// no `capabilities`, no `narrative`, no `subject_slice`, no
// `ai_coauthored_commits`) — fictional subject and project, placeholder
// repeated-hex SHAs. It pins two regressions a real 0.1.2 document once
// exposed, where a hand-rendered report drifted from its source JSON: a
// multi-em-dash headline had its dashes flattened to commas, and a stack
// entry's parenthetical gloss ("MCP (Model Context Protocol)") was dropped
// to just "MCP". A pure-function renderer must reproduce neither drift.
const legacyUrl = new URL("./fixtures/proof.0.1.2.json", import.meta.url);
const legacyDoc = JSON.parse(readFileSync(legacyUrl, "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function rowFor(html, id) {
  const m = html.match(new RegExp(`<tr id="${id}">.*?</tr>`, "s"));
  return m ? m[0] : "";
}

function hasUrl(html) {
  return /https?:\/\//.test(html);
}

// A verification.json shaped against the example proof's real claim and
// evidence ids (c1-c3, e1-e5), covering every rendering case in one fixture:
// a supported claim (c1), a claim whose mechanical problem must override its
// own "supported" audit verdict (c2), a partial claim carrying an advisory
// flag (c3), ownership facts on some evidence (e1, e2, e4) and none on
// others (e3, e5), and a failed evidence item with an unbacked number (e3).
function fullVerification(outcome = "reproduced", identityStatus = "bound") {
  return {
    verification_version: "0.3.0",
    proof_sha256: "a".repeat(64),
    verified_at: "2026-09-25T12:00:00Z",
    verified_by: "Jane Reviewer",
    environment: { tool: "proof-skill/0.3.0", git: "2.54.0", node: "v24.13.0" },
    remote: "https://github.com/org/repo.git",
    head_ref: "refs/heads/main",
    head_on_default_branch: true,
    outcome,
    reason: `Test fixture reason for outcome ${outcome}.`,
    problems: [],
    counts: {
      evidence_total: 5,
      evidence_failed: 1,
      numbers_rederived: 6,
      numbers_self_reported: 0,
      numbers_unbacked: 1,
    },
    identity: {
      status: identityStatus,
      account: identityStatus === "conflict" ? { host: "github.com", login: "someone-else" } : { host: "github.com", login: "ada" },
      signature: identityStatus === "bound" ? "valid" : identityStatus === "conflict" ? "invalid" : "absent",
      emails: [{ email: "ada@example.dev", status: identityStatus, method: "noreply" }],
    },
    signals: null,
    notes: [],
    evidence: [
      {
        id: "e1",
        status: "ok",
        problems: [],
        numbers: [
          { raw: "31", class: "rederived", source: "files under packages/shared/src/types/**" },
          { raw: "118", class: "rederived", source: "subject commits touching packages/shared/src/types/**" },
        ],
        ownership: { blame_share: 0.82, subject_commits: 118, total_commits: 140, other_identities: 2 },
      },
      {
        id: "e2",
        status: "ok",
        problems: [],
        numbers: [],
        ownership: { blame_share: 1, subject_commits: 1, total_commits: 1, other_identities: 0 },
      },
      {
        id: "e3",
        status: "failed",
        problems: [{ code: "count_mismatch", message: "17 commits claimed; the range has 16." }],
        numbers: [{ raw: "17", class: "unbacked", source: null }],
        ownership: null,
      },
      {
        id: "e4",
        status: "ok",
        problems: [],
        numbers: [{ raw: "23", class: "rederived", source: "files under apps/web/src/components/**" }],
        ownership: { blame_share: 0.61, subject_commits: 23, total_commits: 38, other_identities: 2 },
      },
      {
        id: "e5",
        status: "ok",
        problems: [],
        numbers: [
          { raw: "140", class: "rederived", source: "summary.ai_coauthored_commits" },
          { raw: "412", class: "rederived", source: "summary.authored_commits" },
          { raw: "34%", class: "rederived", source: "summary.ai_assisted_commit_share" },
        ],
        ownership: null,
      },
    ],
    claims: [
      {
        id: "c1",
        problems: [],
        flags: [],
        audit: {
          verdict: "supported",
          reason: "The shared-types directory and the cited commit both check out against the clone.",
          question: "Walk me through the discriminated-union event model.",
          pointers: ["proof:c1", "proof:e1", "proof:e2"],
        },
      },
      {
        id: "c2",
        problems: [{ code: "number_unbacked", message: "17 does not appear in any cited evidence description." }],
        flags: [],
        audit: {
          verdict: "supported",
          reason: "The commit range exists, but a mechanical problem overrides this audit.",
          question: "Which module was hardest to convert to strict TypeScript?",
          pointers: ["proof:c2", "proof:e3"],
        },
      },
      {
        id: "c3",
        problems: [],
        flags: [{ code: "exclusivity_unsupported", message: "\"maintains\" reads as sole ownership; blame share is 61%." }],
        audit: {
          verdict: "partial",
          reason: "The component count checks out; authorship is mixed with two other contributors.",
          question: "Pick one AI-generated component and describe your review changes.",
          pointers: ["proof:c3", "proof:e4"],
        },
      },
    ],
  };
}

test("rendering the same document twice is byte-identical", () => {
  assert.equal(renderMarkdown(example), renderMarkdown(example));
  assert.equal(renderHtml(example), renderHtml(example));
  assert.equal(renderMarkdown(clone(example)), renderMarkdown(clone(example)));
});

test("the headline and every stack name appear verbatim in both renders", () => {
  const md = renderMarkdown(example);
  const html = renderHtml(example);
  // Skip only the very first character: the byline lowercases it when the
  // headline doesn't open on a stylized name, so the rest of the sentence
  // (all its punctuation, em dashes included) is the part that must survive
  // untouched.
  const headlineTail = example.subject.headline.slice(1);
  assert.ok(md.includes(headlineTail), "markdown headline diverged");
  assert.ok(html.includes(headlineTail), "html headline diverged");
  for (const s of example.stack) {
    assert.ok(md.includes(s.name), `markdown missing stack name ${s.name}`);
    assert.ok(html.includes(s.name), `html missing stack name ${s.name}`);
  }
});

test("every evidence id cited in a skill bullet has an html anchor and a register row", () => {
  const html = renderHtml(example);
  const claimById = new Map(example.claims.map((c) => [c.id, c]));
  const cited = new Set();
  for (const skill of example.skills) {
    for (const ref of skill.claim_refs) {
      for (const eid of claimById.get(ref).evidence_refs) cited.add(eid);
    }
  }
  assert.ok(cited.size > 0);
  for (const id of cited) {
    assert.ok(html.includes(`href="#${id}"`), `no anchor link for ${id}`);
    assert.ok(html.includes(`id="${id}"`), `no register row for ${id}`);
  }
});

test("html has no script, no dark-mode override, no stray http (redacted example), and print styles", () => {
  const html = renderHtml(example);
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("prefers-color-scheme"));
  assert.ok(!hasUrl(html), "redacted example must carry zero forge/profile links");
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes("print-color-adjust"));
});

test("a 0.1.2 document renders without throwing and keeps its headline and stack gloss verbatim", () => {
  let md;
  assert.doesNotThrow(() => {
    md = renderMarkdown(legacyDoc);
    renderHtml(legacyDoc);
  });
  assert.ok(md.includes(legacyDoc.subject.headline.slice(1)), "em dashes did not survive verbatim");
  assert.ok(md.includes("MCP (Model Context Protocol)"), "stack gloss was dropped");
});

test("a non-redacted document with a known forge yields commit/blob/pull links, never for metric evidence", () => {
  const doc = clone(example);
  doc.repository.redacted = false;
  doc.repository.name = "org/repo";
  doc.repository.remote = "git@github.com:org/repo.git";
  doc.evidence.push(
    { id: "e6", type: "file", ref: "src/index.ts", description: "Entry point." },
    { id: "e7", type: "pull_request", ref: "#142", description: "The PR that shipped it." },
  );
  const html = renderHtml(doc);

  const commitSha = doc.evidence.find((e) => e.id === "e2").ref;
  assert.ok(html.includes(`https://github.com/org/repo/commit/${commitSha}`));
  assert.ok(html.includes(`https://github.com/org/repo/blob/${doc.repository.head_sha}/src/index.ts`));
  assert.ok(html.includes("https://github.com/org/repo/pull/142"));

  const metricRow = rowFor(html, "e5");
  assert.ok(metricRow.length > 0, "metric row e5 not found");
  assert.ok(!metricRow.includes("<a "), "metric evidence must never render a link");
});

test("forgeBase normalizes the three git remote shapes and rejects garbage", () => {
  assert.equal(forgeBase("https://github.com/org/repo.git"), "https://github.com/org/repo");
  assert.equal(forgeBase("https://github.com/org/repo"), "https://github.com/org/repo");
  assert.equal(forgeBase("git@github.com:org/repo.git"), "https://github.com/org/repo");
  assert.equal(forgeBase("ssh://git@github.com/org/repo.git"), "https://github.com/org/repo");
  assert.equal(forgeBase("not a remote at all"), null);
  assert.equal(forgeBase(""), null);
  assert.equal(forgeBase(null), null);
});

test("bar renders Math.floor(score * 10) filled blocks out of 10", () => {
  const filledCount = (s) => (s.match(/█/g) || []).length;
  assert.equal(bar(0.74).length, 10);
  assert.equal(filledCount(bar(0.74)), 7);
  assert.equal(filledCount(bar(0.68)), 6);
});

test("levelLabel maps every schema level to its evidence-strength phrase", () => {
  assert.equal(levelLabel("very_strong"), "Extensive evidence");
  assert.equal(levelLabel("strong"), "Strong evidence");
  assert.equal(levelLabel("moderate"), "Moderate evidence");
  assert.equal(levelLabel("weak"), "Thin evidence");
});

test("humanizeSpan renders the days/months/years thresholds", () => {
  assert.equal(humanizeSpan(271), "9 months");
  assert.equal(humanizeSpan(20), "20 days");
  assert.ok(humanizeSpan(800).startsWith("2 years"), humanizeSpan(800));
});

test("monthName renders a YYYY-MM key as a full month name and year", () => {
  assert.equal(monthName("2025-01"), "January 2025");
});

const cliPath = fileURLToPath(new URL("../render-proof.mjs", import.meta.url));
const exampleJsonPath = fileURLToPath(exampleUrl);

test("the CLI writes both proof.md and proof.html to --out by default", () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-render-test-"));
  execFileSync(process.execPath, [cliPath, exampleJsonPath, "--out", outDir]);
  assert.ok(existsSync(join(outDir, "proof.md")));
  assert.ok(existsSync(join(outDir, "proof.html")));
});

test("--stdout --md prints exactly the markdown render", () => {
  const stdout = execFileSync(process.execPath, [cliPath, exampleJsonPath, "--stdout", "--md"], { encoding: "utf8" });
  assert.equal(stdout, renderMarkdown(example));
});

test("--stdout without --md/--html, or with both, is a usage error", () => {
  assert.throws(() => execFileSync(process.execPath, [cliPath, exampleJsonPath, "--stdout"], { stdio: "pipe" }));
  assert.throws(() => execFileSync(process.execPath, [cliPath, exampleJsonPath, "--stdout", "--md", "--html"], { stdio: "pipe" }));
});

/* ---------------------------------- verify mode: the recipient view ---------------------------------- */

test("a candidate render of a non-redacted document carries no seal and no Verification section", () => {
  const doc = clone(example);
  doc.repository.redacted = false;
  doc.repository.name = "org/repo";
  doc.repository.remote = "git@github.com:org/repo.git";
  const html = renderHtml(doc);
  assert.ok(!html.includes('class="seal"'), "no verification was supplied, so no seal may appear");
  assert.ok(!html.includes("Verification:"));
  assert.ok(!html.includes("<h2>Verification</h2>"));
});

test("the markdown and HTML trust-note sentences are identical modulo markup, with the scope-honesty sentences unchanged word for word", () => {
  const md = renderMarkdown(example);
  const html = renderHtml(example);
  const mdNote = md.match(/\*\*How to read this\.\*\* (.+)/)[1];
  const htmlNote = html.match(/<b>How to read this\.<\/b> ([\s\S]+?)<\/p>/)[1];
  const strip = (s) => s.replace(/`/g, "").replace(/<\/?(code|b)>/g, "").replace(/\s+/g, " ").trim();
  assert.equal(strip(mdNote).toLowerCase(), strip(htmlNote).toLowerCase());

  const scopeSentence =
    "The report is also bounded to this repository's git history: work that happens outside code — " +
    "design, product direction, planning, review — does not appear here. Read it as a floor, not a ceiling.";
  assert.ok(mdNote.includes(scopeSentence), "markdown is missing the scope-honesty sentence verbatim");
  assert.ok(htmlNote.includes(scopeSentence), "html is missing the scope-honesty sentence verbatim");
  assert.ok(mdNote.includes("/proof verify"));
  assert.ok(htmlNote.includes("<code>/proof verify</code>"));
});

test("the masthead carries each outcome's plain word", () => {
  for (const [outcome, word] of Object.entries({
    reproduced: "Reproduced",
    contradicted: "Contradicted",
    inconclusive: "Inconclusive",
    not_reproducible: "Not reproducible",
  })) {
    const verification = fullVerification(outcome, "unbound");
    const html = renderHtml(example, { verification });
    assert.ok(html.includes(`<span class="outcome">${word}</span>`), `${outcome}: missing masthead word in html`);
    const md = renderMarkdown(example, { verification });
    assert.ok(md.includes(`**${word}**`), `${outcome}: missing masthead word in markdown`);
  }
});

test("the seal and 'Verified by' render only for reproduced + bound identity", () => {
  const bound = fullVerification("reproduced", "bound");
  const htmlBound = renderHtml(example, { verification: bound });
  assert.ok(htmlBound.includes('class="seal"'));
  assert.ok(htmlBound.includes("outcome sealed"));
  assert.ok(htmlBound.includes("Verified by Jane Reviewer · 2026-09-25"));

  const unbound = fullVerification("reproduced", "unbound");
  const htmlUnbound = renderHtml(example, { verification: unbound });
  assert.ok(!htmlUnbound.includes('class="seal"'));
  assert.ok(!htmlUnbound.includes("Verified by"));

  const conflict = fullVerification("reproduced", "conflict");
  const htmlConflict = renderHtml(example, { verification: conflict });
  assert.ok(!htmlConflict.includes('class="seal"'));
});

test("each claim shows a verdict word and glyph, and a mechanical problem forces unsupported regardless of the audit verdict", () => {
  const verification = fullVerification("reproduced", "bound");
  const html = renderHtml(example, { verification });

  const c1Row = rowFor(html, "c1");
  assert.ok(c1Row.includes("✓") && c1Row.includes("supported"), "c1 should read as supported");

  const c2Row = rowFor(html, "c2");
  assert.ok(c2Row.includes("✗") && c2Row.includes("unsupported (mechanical)"), "c2 has a mechanical problem");
  assert.ok(!c2Row.includes(">✓"), "c2 must not carry the supported glyph despite audit.verdict");

  const c3Row = rowFor(html, "c3");
  assert.ok(c3Row.includes("◐") && c3Row.includes("partial"), "c3 should read as partial");

  const md = renderMarkdown(example, { verification });
  assert.ok(md.includes("✗ unsupported (mechanical) — Migrated the ingestion layer"));

  const skillsHtml = html.slice(html.indexOf("<h2>Skills</h2>"), html.indexOf("<h2>Stack</h2>"));
  assert.ok(skillsHtml.includes("✓ supported"), "the skill bullet must also carry the verdict");
});

test("claim register rows carry id=\"cN\" for the :target highlight", () => {
  const html = renderHtml(example);
  for (const claim of example.claims) {
    assert.ok(html.includes(`<tr id="${claim.id}">`), `missing id anchor for ${claim.id}`);
  }
});

test("the evidence register shows status and each number's class and source", () => {
  const verification = fullVerification("reproduced", "bound");
  const html = renderHtml(example, { verification });
  const e1Row = rowFor(html, "e1");
  assert.ok(e1Row.includes("status: ok"));
  assert.ok(e1Row.includes("31 = files under packages/shared/src/types/**"));
  const e3Row = rowFor(html, "e3");
  assert.ok(e3Row.includes("status: failed"));
  assert.ok(e3Row.includes("17: unbacked"));
  assert.doesNotMatch(html, /(\d[\d,]*) = \1 = /, "each binding prints its token once");
});

test("a self-reported number names its commit subject, and active days count the span's calendar days", () => {
  const verification = fullVerification("reproduced", "bound");
  verification.evidence[0].numbers = [{ raw: "46", class: "self_reported", source: 'commit 241fb99 subject: "recover Lighthouse (desktop 46 to 99)"' }];
  const html = renderHtml(example, { verification });
  assert.ok(rowFor(html, "e1").includes("46: self-reported, commit 241fb99 subject:"));
  const doc = clone(example);
  doc.summary.active_days = 3;
  doc.summary.span_days = 2;
  assert.match(renderHtml(doc, {}), /3 of 3/, "a 2-day difference spans 3 calendar days");
});

test("the Verification section renders identity, counts, and signals, and appears only for a recipient", () => {
  const verification = fullVerification("reproduced", "bound");
  verification.signals = {
    default_branch: "main",
    solo_repository: false,
    total_authors: 5,
    cited_commits: 4,
    on_default_branch: 4,
    committed_by_subject: 3,
    committed_by_forge: 1,
    committed_by_other: 0,
  };
  const html = renderHtml(example, { verification });
  const md = renderMarkdown(example, { verification });
  assert.ok(html.includes("<h2>Verification</h2>"));
  assert.ok(html.includes("unauthenticated — whoever controls the repository controls these"));
  assert.ok(html.includes("bound: account github.com/ada"));
  assert.ok(!html.includes("An unbound identity means"), "a bound identity carries no unbound explanation");
  const unbound = fullVerification("reproduced", "unbound");
  unbound.identity.account = null;
  const unboundHtml = renderHtml(example, { verification: unbound });
  assert.ok(unboundHtml.includes("unbound: no account declared"));
  assert.ok(unboundHtml.includes("An unbound identity means the applicant&#39;s ownership of these addresses was not proven."));
  assert.ok(html.includes("5 contributors"));
  assert.ok(html.includes("A person makes the hiring decision; this report is evidence for it."));
  assert.ok(md.includes("## Verification"));
  assert.ok(md.includes("A person makes the hiring decision"));

  const candidateHtml = renderHtml(example);
  const candidateMd = renderMarkdown(example);
  assert.ok(!candidateHtml.includes("<h2>Verification</h2>"));
  assert.ok(!candidateMd.includes("## Verification"));
});

test("an Interview questions section lists each claim's audit question, only for a recipient", () => {
  const verification = fullVerification("reproduced", "bound");
  const html = renderHtml(example, { verification });
  const md = renderMarkdown(example, { verification });
  assert.ok(html.includes("<h2>Interview questions</h2>"));
  assert.ok(html.includes('<a href="#c1">c1</a>. Walk me through the discriminated-union event model.'));
  assert.ok(md.includes("## Interview questions"));
  assert.ok(md.includes("**c1.** Walk me through the discriminated-union event model."));

  assert.ok(!renderHtml(example).includes("<h2>Interview questions</h2>"));
  assert.ok(!renderMarkdown(example).includes("## Interview questions"));
});

test("the logo is always an <img> data URI, never inline <svg> from the candidate", () => {
  const hostileSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const html = renderHtml(example, { logoSvg: hostileSvg });
  assert.ok(html.includes('<img class="mark" src="data:image/svg+xml;base64,'));
  assert.ok(!html.includes("<svg"), "the candidate's raw <svg> must never appear in the DOM");
  assert.ok(!html.includes("<script>alert"));
});

test("the CSP meta tag is present", () => {
  const html = renderHtml(example);
  assert.ok(html.includes(
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">',
  ));
});

test("hostile candidate strings are escaped: no raw tag breakout, hidden characters shown visibly", () => {
  const doc = clone(example);
  doc.claims[0].claim = "Shipped </style><img src=x onerror=alert(1)> the feature\u202Ereversed";
  const html = renderHtml(doc);
  assert.ok(!html.includes("</style><img"), "raw markup must not appear unescaped");
  assert.ok(html.includes("&lt;/style&gt;&lt;img"), "the tag text must render escaped");
  assert.ok(!html.includes("<img src=x onerror"), "an unescaped tag must not appear");
  assert.ok(!html.includes("\u202E"), "the raw bidi override character must never reach the output");
  assert.ok(html.includes("\\u{202E}"), "the hidden character must be visibly escaped instead");
});

test("a recipient render of the redacted shipped example has no script, no dark-mode override, no stray url, and print styles", () => {
  const html = renderHtml(example, { verification: verificationExample });
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("prefers-color-scheme"));
  assert.ok(!hasUrl(html), "the redacted example must carry zero forge/profile links even in a recipient render");
  assert.ok(html.includes("@media print"));
  assert.ok(html.includes("print-color-adjust"));
  assert.ok(html.includes("Not reproducible"));
});

test("the set of hex colours in the shared stylesheet is identical between candidate and recipient renders", () => {
  // Scoped to the shared <style> block (the token palette), not the whole
  // document: SEAL_SVG's decorative white checkmark stroke is inline SVG
  // chrome the spec explicitly keeps, not a new semantic accent, and it
  // legitimately only appears once a recipient view is sealed.
  const candidate = renderHtml(example);
  const recipient = renderHtml(example, {
    verification: fullVerification("reproduced", "bound"),
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
  });
  const styleHexes = (html) => {
    const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    return [...new Set(style.match(/#[0-9a-fA-F]{3,8}/g))].sort();
  };
  assert.deepEqual(styleHexes(recipient), styleHexes(candidate));
});

test("--verification writes verified.md/verified.html and never touches proof.md/proof.html", () => {
  const outDir = mkdtempSync(join(tmpdir(), "proof-render-verify-test-"));
  execFileSync(process.execPath, [cliPath, exampleJsonPath, "--out", outDir]);
  const proofMdBefore = readFileSync(join(outDir, "proof.md"), "utf8");
  const proofHtmlBefore = readFileSync(join(outDir, "proof.html"), "utf8");

  const verificationPath = join(outDir, "verification.json");
  writeFileSync(verificationPath, JSON.stringify(verificationExample));
  execFileSync(process.execPath, [cliPath, exampleJsonPath, "--out", outDir, "--verification", verificationPath]);

  assert.ok(existsSync(join(outDir, "verified.md")));
  assert.ok(existsSync(join(outDir, "verified.html")));
  assert.equal(readFileSync(join(outDir, "proof.md"), "utf8"), proofMdBefore, "proof.md must be untouched");
  assert.equal(readFileSync(join(outDir, "proof.html"), "utf8"), proofHtmlBefore, "proof.html must be untouched");
  assert.equal(
    readFileSync(join(outDir, "verified.md"), "utf8"),
    renderMarkdown(example, { verification: verificationExample }),
  );
});

test("the CLI reads the logo from the committed tree at head_sha: a real SVG embeds as an inert image, a symlink or an uncommitted file never does", () => {
  const repo = mkdtempSync(join(tmpdir(), "proof-render-logo-"));
  const git = (...args) =>
    execFileSync("git", ["-C", repo, "-c", "user.name=Ada", "-c", "user.email=ada@example.dev", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  mkdirSync(join(repo, "assets"));
  const svg = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  writeFileSync(join(repo, "assets", "logo.svg"), svg);
  symlinkSync("logo.svg", join(repo, "assets", "link.svg"));
  git("add", "-A");
  git("commit", "-q", "-m", "add logo");
  const head = git("rev-parse", "HEAD");
  // Present in the working tree only, never committed at head.
  writeFileSync(join(repo, "assets", "later.svg"), svg);

  const render = (logoPath) => {
    const doc = JSON.parse(JSON.stringify(example));
    doc.repository.redacted = false;
    doc.repository.name = "org/repo";
    doc.repository.head_sha = head;
    doc.repository.project.logo_path = logoPath;
    const docPath = join(repo, `doc-${logoPath.replace(/\W/g, "_")}.json`);
    writeFileSync(docPath, JSON.stringify(doc));
    return execFileSync(process.execPath, [cliPath, docPath, "--stdout", "--html", "--repo", repo], { encoding: "utf8" });
  };

  const committed = render("assets/logo.svg");
  const match = committed.match(/<img[^>]+src="data:image\/svg\+xml;base64,([^"]+)"/);
  assert.ok(match, "a committed SVG logo is embedded as a data-URI image");
  assert.equal(Buffer.from(match[1], "base64").toString("utf8"), svg);
  assert.ok(!committed.includes("<svg viewBox=\"0 0 10 10\">"), "the candidate SVG is never inlined as DOM");

  for (const refused of ["assets/link.svg", "assets/later.svg"]) {
    assert.ok(!/<img[^>]+src="data:image\/svg\+xml/.test(render(refused)), `${refused} must not be embedded`);
  }
});
