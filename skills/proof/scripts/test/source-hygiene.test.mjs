// The skill parses untrusted input and renders reports a hiring team trusts, so its own
// source must read exactly as it executes. An invisible or confusable character in a
// literal (a bidi override, a zero-width space, a Kelvin sign that folds to "k") makes a
// line display differently in editors and diffs than it runs; tests that need one build it
// from its code point instead. The ranges below are code points, so this file cannot
// contain the characters it looks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const RANGES = [
  [0x200b, 0x200f], // zero-width space, joiners, directional marks
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2064], // word joiner and invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // byte-order mark / zero-width no-break space
  [0x212a, 0x212b], // Kelvin and Angstrom signs, which case-fold to ASCII letters
  [0xe0000, 0xe007f], // tag characters
];
const isSuspect = (cp) => RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(mjs|js|json|md)$/.test(entry.name) ? [full] : [];
  });
}

test("no source, schema, reference, or doc file contains a raw invisible or confusable character", () => {
  const hits = [];
  for (const file of sourceFiles(root)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const ch of line) {
        const cp = ch.codePointAt(0);
        if (isSuspect(cp)) hits.push(`${relative(root, file)}:${i + 1} U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    });
  }
  assert.deepEqual(hits, [], `write these as \\u escapes or String.fromCodePoint instead:\n${hits.join("\n")}`);
});
