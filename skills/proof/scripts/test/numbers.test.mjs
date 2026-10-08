import { test } from "node:test";
import assert from "node:assert/strict";
import { readNumbers, countWords, missingNumbers, classifyNumbers } from "../lib/numbers.mjs";

const values = (text) => readNumbers(text).map((t) => t.value);
const raws = (text) => readNumbers(text).map((t) => t.raw);

// The owner's real strings, one table: what a reader must and must not see as a quantity.
test("readNumbers: a comma-grouped number stops before an attached word", () => {
  const tokens = readNumbers("a 3,569-line diff");
  assert.deepEqual(tokens.map((t) => ({ raw: t.raw, value: t.value, unit: t.unit })), [
    { raw: "3,569", value: 3569, unit: null },
  ]);
});

test("readNumbers: two bare numbers separated by a word", () => {
  assert.deepEqual(values("Lighthouse 46 to 99"), [46, 99]);
});

test("readNumbers: a size unit reads the same with or without a space", () => {
  assert.deepEqual(readNumbers("122MB").map((t) => [t.value, t.unit]), [[122, "MB"]]);
  assert.deepEqual(readNumbers("122 MB").map((t) => [t.value, t.unit]), [[122, "MB"]]);
  assert.equal(readNumbers("122MB")[0].raw, "122MB");
  assert.equal(readNumbers("122 MB")[0].raw, "122 MB");
});

test("readNumbers: identifiers starting with a letter are never quantities", () => {
  assert.deepEqual(values("bumped to v3 on S3 with ES2022, see p95 and d3"), []);
});

test("readNumbers: 2D/3D skipped case-insensitively, standalone or compounded", () => {
  assert.deepEqual(values("a 3D scene, canvas-2D fallback, via d3-force-3d"), []);
});

test("readNumbers: a parenthesised PR reference reads with unit #", () => {
  const [t] = readNumbers("merged (#4978) yesterday");
  assert.deepEqual({ raw: t.raw, value: t.value, unit: t.unit }, { raw: "#4978", value: 4978, unit: "#" });
});

test("readNumbers: a percent token", () => {
  assert.deepEqual(readNumbers("14%").map((t) => [t.value, t.unit]), [[14, "%"]]);
});

test("readNumbers: a version triple is skipped", () => {
  assert.deepEqual(values("TypeScript 11.8.0 shipped"), []);
});

test("readNumbers: an ISO calendar date is skipped", () => {
  assert.deepEqual(values("since 2026-03-30"), []);
});

test("readNumbers: multiplier, frame-rate, and duration units read", () => {
  assert.deepEqual(readNumbers("a 10x speedup at 60fps, down from ~2.2s").map((t) => [t.value, t.unit]), [
    [10, "x"],
    [60, "fps"],
    [2.2, "s"],
  ]);
});

test("readNumbers: a full 40-char SHA starting with a digit is skipped", () => {
  const sha = "4" + "b".repeat(39);
  assert.deepEqual(values(`commit ${sha} fixed it`), []);
});

test("readNumbers: a short hex abbreviation containing a letter is skipped", () => {
  assert.deepEqual(values("fixed in 3f9a2b1 yesterday"), []);
});

test("readNumbers: a plain 7-digit count with no hex letters is not mistaken for a SHA", () => {
  assert.deepEqual(values("processed 1234567 rows"), [1234567]);
});

test("readNumbers: a clock time is skipped", () => {
  assert.deepEqual(values("ran at 14:32:07 sharp"), []);
});

test("readNumbers: a thousand-grouped size stays one token", () => {
  assert.deepEqual(readNumbers("a 1,861 KB bundle").map((t) => [t.value, t.unit]), [[1861, "KB"]]);
});

test("readNumbers: k and % do not swallow the next word", () => {
  assert.deepEqual(readNumbers("40k rows, 2 seconds later").map((t) => [t.value, t.unit]), [
    [40, "k"],
    [2, null],
  ]);
});

test("countWords: whole-word, case-insensitive, with values", () => {
  const words = countWords("Shipped a Dozen fixes, tripled throughput, added TWENTY tests");
  assert.deepEqual(words.map((w) => [w.raw, w.value]), [
    ["Dozen", 12],
    ["tripled", 3],
    ["TWENTY", 20],
  ]);
});

test("countWords: does not match inside a larger word", () => {
  assert.deepEqual(countWords("tension and sixteenth notes"), []);
});

test("missingNumbers: comma grouping and unit spacing normalize away", () => {
  const claim = "Cut the bundle to 1,861 KB.";
  const sources = ["The bundle now weighs 1861KB after the split."];
  assert.deepEqual(missingNumbers(claim, sources), []);
});

test("missingNumbers: a number absent from every source is reported", () => {
  const claim = "Lighthouse went from 46 to 100.";
  const sources = ["Lighthouse went from 46 to 99 after the pass."];
  const missing = missingNumbers(claim, sources);
  assert.deepEqual(missing.map((t) => t.value), [100]);
});

test("classifyNumbers: a measure whose token and re-derived value match is rederived", () => {
  const { numbers, unusedMeasures } = classifyNumbers(
    "205 subject commits touched apps/website/**.",
    { measures: [{ token: "205", source: "scope", key: "apps/website/**", field: "commits", value: 205 }] },
  );
  assert.equal(numbers[0].class, "rederived");
  assert.equal(numbers[0].source, "subject commits touching apps/website/**");
  assert.deepEqual(unusedMeasures, []);
});

test("classifyNumbers: a percent token compares round(100 x share)", () => {
  const { numbers } = classifyNumbers(
    "140 of 412 authored commits (34%) carry an AI co-author trailer.",
    {
      measures: [
        { token: "140", source: "summary", field: "ai_coauthored_commits", value: 140 },
        { token: "412", source: "summary", field: "authored_commits", value: 412 },
        { token: "34%", source: "summary", field: "ai_assisted_commit_share", value: 0.34 },
      ],
    },
  );
  assert.deepEqual(numbers.map((n) => n.class), ["rederived", "rederived", "rederived"]);
});

test("classifyNumbers: an unmatched measure is flagged measure_unused", () => {
  const { unusedMeasures } = classifyNumbers("No numbers here at all.", {
    measures: [{ token: "205", source: "summary", field: "authored_commits", value: 205 }],
  });
  assert.equal(unusedMeasures.length, 1);
  assert.equal(unusedMeasures[0].token, "205");
});

test("classifyNumbers: a diff-stat word next to a matching count is rederived", () => {
  const { numbers } = classifyNumbers("Adds 42 insertions across the change.", {
    stats: { insertions: 42, deletions: 0, files: 1 },
  });
  assert.equal(numbers[0].class, "rederived");
});

test("classifyNumbers: a range's commit count and a PR number are rederived", () => {
  const { numbers: rangeNumbers } = classifyNumbers("A 17-commit migration sequence.", { rangeCount: 17 });
  assert.equal(rangeNumbers[0].class, "rederived");
  const { numbers: prNumbers } = classifyNumbers("Shipped in pull request 142.", { prNumber: 142 });
  assert.equal(prNumbers[0].class, "rederived");
});

test("classifyNumbers: a number only in a cited commit's subject is self_reported", () => {
  const { numbers } = classifyNumbers("Added 12 new widgets to the catalog.", {
    subjects: [{ sha: "b".repeat(40), subject: "Add a dozen new widgets" }],
  });
  assert.equal(numbers[0].class, "self_reported");
  assert.match(numbers[0].source, /^commit bbbbbbb subject: "Add a dozen new widgets"$/);
});

test("classifyNumbers: a number only in a commit BODY (never the subject) is unbacked", () => {
  // The Lighthouse attack: the number is real, but only in a body line the description
  // did not cite as a subject — bodies never count toward self-reported.
  const { numbers } = classifyNumbers("Lighthouse improved to 100.", {
    subjects: [{ sha: "c".repeat(40), subject: "Improve performance" }],
  });
  assert.equal(numbers[0].class, "unbacked");
  assert.equal(numbers[0].source, null);
});

test("a count word inside an identifier is a name, not a count", () => {
  assert.deepEqual(countWords("A Three.js and d3-force-3d scene, under /three/ and @three/core."), []);
  assert.deepEqual(countWords("Shipped in three.").map((w) => w.value), [3]);
  assert.deepEqual(countWords("A three-tier cache.").map((w) => w.value), [3]);
});
