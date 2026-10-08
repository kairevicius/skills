// Pure token reading and classification for proof.json's numeric claims. No I/O: every
// function takes text (and, for classification, already-resolved facts the caller derived
// from git) and returns data. This is the shared engine behind:
//   Link 1 — does a claim's number appear in the evidence it cites? (missingNumbers)
//   Link 2 — does an evidence number re-derive from git?            (classifyNumbers)

const ALNUM_RE = /[A-Za-z0-9]/;
const isAlnum = (ch) => !!ch && ALNUM_RE.test(ch);

// Two-or-more dot-groups reads as a version (11.8.0), not a number.
const VERSION_RE = /^\d+(?:\.\d+){2,}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const CLOCK_RE = /^\d{1,2}:\d{2}(?::\d{2})?/;
const TWO_THREE_D_RE = /^[23]D$/i;
const SIZE_UNITS = ["KB", "MB", "GB", "TB"];

// A 40-char hex run is always a full SHA. A shorter one (7-39) is only treated as an
// abbreviated SHA when it contains an a-f letter — otherwise it is indistinguishable from
// an ordinary integer and must be read as one (e.g. a plain 7-digit commit count).
function hexShaLength(text, i) {
  const m = /^[0-9a-fA-F]{1,40}(?![0-9a-fA-F])/.exec(text.slice(i));
  if (!m || m[0].length < 7) return 0;
  return m[0].length === 40 || /[a-fA-F]/.test(m[0]) ? m[0].length : 0;
}

// Longest / most specific first: two-letter size units (allowing exactly one leading
// space, so "122MB" and "122 MB" read the same), then the multi-letter words, then the
// single-character suffixes — each guarded so it doesn't swallow the start of an
// unrelated word ("2 seconds" is not "2s"; "40king" is not "40k").
function matchUnit(text, pos) {
  const rest = text.slice(pos);
  for (const u of SIZE_UNITS) {
    if (rest.startsWith(u)) return { unit: u, length: u.length };
    if (rest.startsWith(" " + u)) return { unit: u, length: u.length + 1 };
  }
  if (rest.startsWith("ms")) return { unit: "ms", length: 2 };
  if (rest.startsWith("fps")) return { unit: "fps", length: 3 };
  if (rest.startsWith("%")) return { unit: "%", length: 1 };
  const nextIsLetter = /[A-Za-z]/.test(rest[1] ?? "");
  if (rest.startsWith("k") && !nextIsLetter) return { unit: "k", length: 1 };
  if (rest.startsWith("x") && !nextIsLetter) return { unit: "x", length: 1 };
  if (rest.startsWith("s") && !nextIsLetter) return { unit: "s", length: 1 };
  return null;
}

/**
 * Read every quantity token in `text`: a digit run (comma thousands groups, one decimal
 * part) with an optional unit. A token that starts with a digit is a quantity whatever
 * follows it; a token that starts with a letter (v3, S3, ES2022, p95, d3) never is, because
 * only a digit preceded by a non-alphanumeric character (or string start) begins a token.
 * Skipped: 2D/3D (case-insensitive), version triples, ISO dates, clock times, 7-40 char hex
 * SHAs. `#4978` reads as a PR reference with unit "#".
 */
export function readNumbers(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "#" && /\d/.test(text[i + 1] ?? "")) {
      const m = /^#\d+/.exec(text.slice(i))[0];
      tokens.push({ raw: m, value: Number(m.slice(1)), unit: "#", index: i });
      i += m.length;
      continue;
    }

    if (/\d/.test(ch) && !isAlnum(text[i - 1])) {
      const rest = text.slice(i);
      let skipLen = 0;
      if (ISO_DATE_RE.test(rest)) skipLen = ISO_DATE_RE.exec(rest)[0].length;
      else if (VERSION_RE.test(rest)) skipLen = VERSION_RE.exec(rest)[0].length;
      else if (CLOCK_RE.test(rest)) skipLen = CLOCK_RE.exec(rest)[0].length;
      else skipLen = hexShaLength(text, i);
      if (skipLen === 0) {
        const alnumRun = /^[A-Za-z0-9]+/.exec(rest)[0];
        if (TWO_THREE_D_RE.test(alnumRun)) skipLen = alnumRun.length;
      }
      if (skipLen > 0) {
        i += skipLen;
        continue;
      }

      const numStr = (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?/.exec(rest) ?? /^\d+(?:\.\d+)?/.exec(rest))[0];
      const value = Number(numStr.replace(/,/g, ""));
      const afterNum = i + numStr.length;
      const unitMatch = matchUnit(text, afterNum);
      const raw = unitMatch ? numStr + text.slice(afterNum, afterNum + unitMatch.length) : numStr;
      tokens.push({ raw, value, unit: unitMatch ? unitMatch.unit : null, index: i });
      i = afterNum + (unitMatch ? unitMatch.length : 0);
      continue;
    }

    i += 1;
  }
  return tokens;
}

// two..twenty (not "one": too common a word to safely treat as a count), plus the group
// and multiplier words the owner's real proofs actually used.
const COUNT_WORDS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  dozen: 12, hundred: 100, thousand: 1000, million: 1000000,
  doubled: 2, tripled: 3, halved: 0.5, tenfold: 10,
};
const COUNT_WORD_RE = new RegExp(`\\b(${Object.keys(COUNT_WORDS).join("|")})\\b`, "gi");

// A count word inside an identifier is a name, not a count: a library (Three.js), a path
// segment (/three/), a package scope (@three). A sentence-final "three." is still a count.
function insideIdentifier(text, start, end) {
  if ([".", "/", "@"].includes(text[start - 1])) return true;
  return (text[end] === "." || text[end] === "/") && ALNUM_RE.test(text[end + 1] ?? "");
}

/** Read every count word (whole word, case-insensitive) present in `text` and its value. */
export function countWords(text) {
  const out = [];
  COUNT_WORD_RE.lastIndex = 0;
  let m;
  while ((m = COUNT_WORD_RE.exec(text))) {
    if (insideIdentifier(text, m.index, m.index + m[0].length)) continue;
    out.push({ raw: m[0], value: COUNT_WORDS[m[0].toLowerCase()], index: m.index });
  }
  return out;
}

const numberKey = (t) => `${t.value}|${(t.unit ?? "").toLowerCase()}`;

/**
 * Link 1: the tokens in `text` that appear in none of `sourceTexts`. Comma grouping and
 * unit spacing/case normalize away — matching is on the exact (value, unit) pair: a bare
 * count and the same number written with a unit are NOT the same claim, so an absent unit
 * matches only another absent unit, never any unit on the other side.
 */
export function missingNumbers(text, sourceTexts) {
  const have = new Set();
  for (const src of sourceTexts) for (const t of readNumbers(src)) have.add(numberKey(t));
  return readNumbers(text).filter((t) => !have.has(numberKey(t)));
}

// What a re-derived number is bound to, without the token itself: the renderer prints
// "<token> = <source>".
const BLAME_LABELS = { share: "the subject's blame share of", subject: "lines blamed to the subject in", total: "lines at head_sha in" };
function measureLabel(m) {
  const field = String(m.field).replace(/_/g, " ");
  if (m.source === "scope") return `subject ${field} touching ${m.key}`;
  if (m.source === "blame") return `${BLAME_LABELS[m.field]} ${m.key}`;
  return field;
}

const DIFF_STAT_RE = /^\s*(insertions?|deletions?|files?)\b/i;
const DIFF_STAT_FIELD = { insertion: "insertions", insertions: "insertions", deletion: "deletions", deletions: "deletions", file: "files", files: "files" };

/**
 * Link 2: classify every token in an evidence `description` as re-derived, self-reported,
 * or unbacked, and flag any measure whose token never occurs in the description.
 *
 * `measures`   — evidence.measures, each already resolved to the value git re-derives:
 *                {token, source, key?, field, value}.
 * `subjects`   — cited commits' SUBJECT lines only (bodies never count): {sha, subject}.
 * `stats`      — the cited commit's or range's combined exclusion-filtered diff stat:
 *                {insertions, deletions, files} | null.
 * `rangeCount` — the cited range's commit count, if this evidence is a commit_range.
 * `prNumber`   — the cited pull request's number, if this evidence is a pull_request.
 */
export function classifyNumbers(description, { measures = [], subjects = [], stats = null, rangeCount = null, prNumber = null } = {}) {
  const tokens = readNumbers(description);
  const numbers = tokens.map((t) => {
    const measure = measures.find((m) => m.token === t.raw);
    if (measure && measure.value !== undefined && measure.value !== null) {
      const expected = t.unit === "%" ? Math.round(100 * measure.value) : measure.value;
      if (expected === t.value) return { ...t, class: "rederived", source: measureLabel(measure) };
    }

    if (stats) {
      const after = description.slice(t.index + t.raw.length);
      const m = DIFF_STAT_RE.exec(after);
      if (m) {
        const field = DIFF_STAT_FIELD[m[1].toLowerCase()];
        if (field && stats[field] === t.value) return { ...t, class: "rederived", source: `${field} in the cited commit` };
      }
    }

    if (rangeCount !== null && t.value === rangeCount) return { ...t, class: "rederived", source: "commits in the cited range" };
    if (prNumber !== null && t.value === prNumber) return { ...t, class: "rederived", source: "the cited pull request's number" };

    for (const s of subjects) {
      const inSubject = readNumbers(s.subject).some((n) => n.value === t.value) || countWords(s.subject).some((w) => w.value === t.value);
      if (inSubject) return { ...t, class: "self_reported", source: `commit ${s.sha.slice(0, 7)} subject: "${s.subject}"` };
    }

    return { ...t, class: "unbacked", source: null };
  });

  const usedRaw = new Set(tokens.map((t) => t.raw));
  const unusedMeasures = measures.filter((m) => !usedRaw.has(m.token));

  return { numbers, unusedMeasures };
}
