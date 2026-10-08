// Renders proof.md and proof.html as pure functions of a validated proof.json
// document. Both renderers read the same document and share every helper
// below, so the two reports can never drift from each other or from the data.
//
// Both functions also take an optional `verification` (a finalized
// verification.json produced by a recipient's own `verify-proof.mjs`). With
// verification omitted, the output is exactly the candidate's own report —
// unchanged byte for byte from what a recipient with no verification gets —
// so the validator's `--rendered` parity check can call these functions with
// no second argument. With it, the same document grows a recipient-only
// layer: a plain-word outcome, a Verification section, and a verdict on each
// claim. Nothing the candidate's file asserts is trusted; every recipient
// fact comes from `verification`, never from `doc` itself.
//
// Design reference: REPORT-TEMPLATE.md (markdown) and
// HTML-REPORT.md (html) are the contracts; a hand-accepted
// rendering of a real proof.json is the concrete "reproduce this look"
// target for the html design (see the proof skill's own commit history for
// that reference render).

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const LEVEL_LABELS = {
  very_strong: "Extensive evidence",
  strong: "Strong evidence",
  moderate: "Moderate evidence",
  weak: "Thin evidence",
};

// Plain-language fallback labels for "Demonstrated capabilities" when the
// document carries no authored `capabilities`. Covers every category the
// schema enum allows, so the fallback never has to invent a label at render
// time.
const CATEGORY_LABELS = {
  language: "Language proficiency",
  framework: "Framework-level engineering",
  architecture: "System architecture",
  testing: "Testing",
  debugging: "Debugging",
  refactoring: "Refactoring",
  infrastructure: "Infrastructure ownership",
  data: "Data engineering",
  security: "Security engineering",
  performance: "Performance engineering",
  product: "Product engineering",
  process: "Process ownership",
  ai_native: "AI-native engineering",
  design: "Design",
  documentation: "Documentation",
  content: "Content",
  data_science: "Data science",
  accessibility: "Accessibility",
  localization: "Localization",
  tooling: "Developer tooling",
  other: "Other demonstrated work",
};

const OUTCOME_LABELS = {
  reproduced: "Reproduced",
  contradicted: "Contradicted",
  inconclusive: "Inconclusive",
  not_reproducible: "Not reproducible",
};

const VERDICT_GLYPH = { supported: "✓", partial: "◐", unsupported: "✗", not_assessable: "?" };
const VERDICT_LABEL = { supported: "supported", partial: "partial", unsupported: "unsupported", not_assessable: "not assessable" };

const MAX_LOGO_BYTES = 64 * 1024;

/* ---------------------------------- shared, exported helpers ---------------------------------- */

/** "2025-01" -> "January 2025". */
export function monthName(yyyymm) {
  const [y, m] = String(yyyymm).split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/**
 * English-humanized calendar span. Deterministic (no clock): a pure function
 * of the day count using the average month/year length, never wall-clock
 * "now". Thresholds and formula are the format, not a UX nicety.
 */
export function humanizeSpan(days) {
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30.4375));
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.max(1, Math.floor(days / 365.25));
  const months = Math.round((days - years * 365.25) / 30.4375);
  const yearsPart = `${years} year${years === 1 ? "" : "s"}`;
  return months > 0 ? `${yearsPart} ${months} month${months === 1 ? "" : "s"}` : yearsPart;
}

/** The evidence-strength word for a skill's level enum. */
export function levelLabel(level) {
  return LEVEL_LABELS[level] ?? "Unknown evidence";
}

/** Markdown bar: `Math.floor(score * 10)` filled blocks (█) out of 10, rest empty (░). */
export function bar(score) {
  const filled = Math.max(0, Math.min(10, Math.floor(score * 10)));
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

/**
 * Normalizes a git remote to an https base URL, or null when the shape is
 * not recognized. Handles the three forms git actually produces:
 * https://host/o/r(.git), git@host:o/r(.git), ssh://git@host/o/r(.git).
 */
export function forgeBase(remote) {
  if (!remote || typeof remote !== "string") return null;
  const patterns = [
    /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
    /^ssh:\/\/git@([^/]+)\/(.+?)(?:\.git)?\/?$/,
    /^git@([^:]+):(.+?)(?:\.git)?\/?$/,
  ];
  for (const pattern of patterns) {
    const m = remote.match(pattern);
    if (m) return `https://${m[1]}/${m[2]}`;
  }
  return null;
}

/**
 * Per-host link builders for a forge base URL. Returns null for a host that
 * is neither GitHub nor GitLab — evidence still stands as plain text without
 * a link.
 */
export function forgeLinks(base, host) {
  const h = String(host ?? "").toLowerCase();
  if (h === "github.com") {
    return {
      commit: (sha) => `${base}/commit/${sha}`,
      commitRange: (a, b) => `${base}/compare/${a}...${b}`,
      file: (headSha, path) => `${base}/blob/${headSha}/${path}`,
      directory: (headSha, path) => `${base}/tree/${headSha}/${path}`,
      pullRequest: (n) => `${base}/pull/${n}`,
    };
  }
  if (h.includes("gitlab.")) {
    return {
      commit: (sha) => `${base}/-/commit/${sha}`,
      commitRange: (a, b) => `${base}/-/compare/${a}...${b}`,
      file: (headSha, path) => `${base}/-/blob/${headSha}/${path}`,
      directory: (headSha, path) => `${base}/-/tree/${headSha}/${path}`,
      pullRequest: (n) => `${base}/-/merge_requests/${n}`,
    };
  }
  return null;
}

/**
 * The forge URL for one evidence item, or null when it cannot (or must not)
 * link out: metric/pattern evidence is never a URL, a redacted document
 * never links, and an unresolvable or unrecognized remote yields no link.
 */
export function evidenceHref(evidence, doc) {
  if (evidence.type === "metric" || evidence.type === "pattern") return null;
  if (doc?.repository?.redacted) return null;
  const base = forgeBase(doc?.repository?.remote);
  if (!base) return null;
  let host;
  try {
    host = new URL(base).hostname;
  } catch {
    return null;
  }
  const links = forgeLinks(base, host);
  if (!links) return null;
  const headSha = doc?.repository?.head_sha;
  switch (evidence.type) {
    case "commit":
      return links.commit(evidence.ref);
    case "commit_range": {
      const [a, b] = String(evidence.ref).split("..");
      return a && b ? links.commitRange(a, b) : null;
    }
    case "file":
    case "test":
    case "document":
    case "asset":
      return links.file(headSha, evidence.ref);
    case "directory":
      return links.directory(headSha, evidence.ref);
    case "pull_request":
      return links.pullRequest(String(evidence.ref).replace(/^#/, ""));
    default:
      return null;
  }
}

/* ---------------------------------- private helpers ---------------------------------- */

// Unicode bidi-override, zero-width, and tag characters can visually reorder
// or hide text — or, run together, smuggle a message to an AI reader — with
// no HTML syntax at all, so `&<>"'` escaping alone doesn't make a
// candidate-controlled string safe to display. Replace them with a visible
// `\u{XXXX}` escape before any other formatting, in both renderers: a report
// this hides from is a report a viewer can't check.
const HIDDEN_CHAR_RE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

function escapeHidden(str) {
  return String(str).replace(
    HIDDEN_CHAR_RE,
    (ch) => `\\u{${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}}`,
  );
}

function escapeHtml(str) {
  return escapeHidden(str).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// Plain-prose markdown insertion: neutralizes hidden characters only. Full
// HTML-entity escaping would make the .md ugly to read as text, and markdown
// itself carries no script risk the way rendered HTML does.
function mdText(str) {
  return escapeHidden(str);
}

// The only other markdown table hazard worth guarding: an unescaped "|"
// inside a cell would split the row.
function mdCell(str) {
  return mdText(str).replace(/\|/g, "\\|");
}

function commas(n) {
  const sign = n < 0 ? "-" : "";
  return sign + String(Math.trunc(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pct(share) {
  return Math.round(share * 100);
}

// Lowercases the headline's leading letter so it reads as a continuation of
// "{name} — ...". Left alone when the first word carries an internal
// capital (TypeScript, GitHub, AI-native) — those are names, not the start
// of an ordinary sentence, and lowercasing just the first letter would
// mangle them (TypeScript -> typeScript).
function lowerFirst(str) {
  if (!str.length) return str;
  const firstWord = str.match(/^\S+/)?.[0] ?? "";
  if (/[A-Z]/.test(firstWord.slice(1))) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function shaShort(sha) {
  return String(sha).slice(0, 10);
}

function monthAbbrevYear(yyyymm) {
  const [name, year] = monthName(yyyymm).split(" ");
  return `${name.slice(0, 3)} ${year}`;
}

function profileLabelForHost(host) {
  if (host === "github.com") return "GitHub";
  if (host === "gitlab.com") return "GitLab";
  if (host === "codeberg.org") return "Codeberg";
  return "Profile";
}

// The subject's forge profile is derived from `subject.account {host,
// login}`, never taken as a URL from the document, and omitted whenever the
// document is redacted (a profile link would re-identify a withheld repo).
function accountProfileUrl(doc) {
  if (doc.repository.redacted) return null;
  const account = doc.subject.account;
  if (!account) return null;
  return `https://${account.host}/${account.login}`;
}

// One proof per project: the title names the project, never the person.
// Redacted documents have no project identity to show, so the subject's
// name fills the slot instead.
function projectTitle(doc) {
  if (doc.repository.redacted) return doc.subject.name;
  return doc.repository.project?.name || doc.repository.name || doc.subject.name;
}

function repoLabelForFacts(doc) {
  if (doc.repository.redacted) return "a private repository";
  return doc.repository.name || "this repository";
}

function claimMap(doc) {
  return new Map(doc.claims.map((c) => [c.id, c]));
}

// The one-line "In development since ...; N commits by M contributors;
// structure." fact line for The project section, plus the authored
// subject-slice sentence appended as its own sentence in the same paragraph.
// Built once, in plain text, so each renderer decides how to escape/wrap it.
function projectFactsLine(doc) {
  const project = doc.repository.project;
  if (!project) return "";
  const clauses = [];
  if (project.first_commit) clauses.push(`In development since ${monthName(project.first_commit.slice(0, 7))}`);
  const ctx = doc.repository.context;
  if (ctx?.total_commits != null && ctx?.total_authors != null) {
    clauses.push(`${commas(ctx.total_commits)} commits by ${commas(ctx.total_authors)} contributors`);
  }
  if (project.structure) clauses.push(project.structure);
  let line = clauses.join("; ");
  if (line) line += ".";
  if (project.subject_slice) line += (line ? " " : "") + project.subject_slice;
  return line;
}

// Skill-title suffix labels for "Demonstrated capabilities": the authored
// `capabilities` array when present, else one line per claim category that
// clears the confidence floor, deduplicated in document order.
function capabilityLabels(doc) {
  if (doc.capabilities && doc.capabilities.length > 0) {
    return doc.capabilities.map((c) => c.label);
  }
  const seen = new Set();
  const labels = [];
  for (const claim of doc.claims) {
    if (claim.confidence >= 0.7 && !seen.has(claim.category)) {
      seen.add(claim.category);
      labels.push(CATEGORY_LABELS[claim.category] ?? claim.category);
    }
  }
  return labels;
}

const TRUST_NOTE_TEXT =
  "The subject generated this report from the repository's git history. " +
  "Every number and claim cites evidence in the registers below; a " +
  "recipient with access to the repository can re-derive them with " +
  "{{CODE:/proof verify}}. The gaps section lists what the repository does " +
  "{{B:not}} show, on purpose. The report is also bounded to this " +
  "repository's git history: work that happens outside code — design, " +
  "product direction, planning, review — does not appear here. Read it as " +
  "a floor, not a ceiling.";

function trustNoteMd() {
  return TRUST_NOTE_TEXT
    .replace("{{CODE:/proof verify}}", "`/proof verify`")
    .replace("{{B:not}}", "NOT");
}

function trustNoteHtml() {
  return TRUST_NOTE_TEXT
    .replace("{{CODE:/proof verify}}", "<code>/proof verify</code>")
    .replace("{{B:not}}", "<b>not</b>");
}

/* ---------------------------------- verification (recipient view) ---------------------------------- */

function claimVerdict(verifClaim) {
  if (!verifClaim) return null;
  if (verifClaim.problems && verifClaim.problems.length > 0) {
    return { glyph: "✗", label: "unsupported (mechanical)" };
  }
  const verdict = verifClaim.audit?.verdict;
  return { glyph: VERDICT_GLYPH[verdict] ?? "?", label: VERDICT_LABEL[verdict] ?? "not assessable" };
}

// The verdict prefix is built from fixed, non-candidate-controlled
// vocabulary (a glyph and one of four English words), so it needs no
// hidden-character or HTML escaping of its own — only the surrounding
// renderer decides how to join it to the (escaped) claim text.
function verdictPrefixMd(verifClaim) {
  const verdict = claimVerdict(verifClaim);
  return verdict ? `${verdict.glyph} ${verdict.label} — ` : "";
}

function verdictPrefixHtml(verifClaim) {
  const verdict = claimVerdict(verifClaim);
  return verdict ? `${verdict.glyph} ${escapeHtml(verdict.label)} — ` : "";
}

// Summarizes each cited evidence item's ownership facts (blame share, the
// subject's share of touching commits, other contributors) into one clause
// per evidence id, for the claim register's detail line.
function ownershipSummary(claim, vEvidenceMap) {
  if (!vEvidenceMap) return null;
  const facts = [];
  for (const eid of claim.evidence_refs) {
    const ownership = vEvidenceMap.get(eid)?.ownership;
    if (!ownership) continue;
    const bits = [];
    if (ownership.blame_share != null) bits.push(`${pct(ownership.blame_share)}% blame`);
    bits.push(`${commas(ownership.subject_commits)} of ${commas(ownership.total_commits)} commits`);
    if (ownership.other_identities > 0) {
      bits.push(`${commas(ownership.other_identities)} other contributor${ownership.other_identities === 1 ? "" : "s"}`);
    }
    facts.push(`${eid}: ${bits.join(", ")}`);
  }
  return facts.length > 0 ? facts.join("; ") : null;
}

// The claim register's second line: mechanical problems, the audit's reason
// and interview question, ownership facts, and advisory flags — plain
// strings the caller escapes for its own output format.
function claimDetailParts(claim, verifClaim, vEvidenceMap) {
  if (!verifClaim) return [];
  const parts = [];
  for (const problem of verifClaim.problems ?? []) parts.push(problem.message);
  if (verifClaim.audit?.reason) parts.push(verifClaim.audit.reason);
  if (verifClaim.audit?.question) parts.push(`Ask: ${verifClaim.audit.question}`);
  const ownership = ownershipSummary(claim, vEvidenceMap);
  if (ownership) parts.push(`Ownership: ${ownership}`);
  for (const flag of verifClaim.flags ?? []) parts.push(flag.message);
  return parts;
}

// The evidence register's second line: status, then each number's class and
// source ("205 = subject commits touching apps/website/**"), so a recipient
// can see exactly what was re-derived, self-reported, or left unbacked.
function evidenceDetailParts(verifEvidence) {
  if (!verifEvidence) return [];
  const parts = [`status: ${verifEvidence.status}`];
  for (const problem of verifEvidence.problems ?? []) parts.push(problem.message);
  for (const number of verifEvidence.numbers ?? []) {
    if (number.class === "rederived") parts.push(`${number.raw} = ${number.source}`);
    else if (number.class === "self_reported") parts.push(`${number.raw}: self-reported, ${number.source}`);
    else parts.push(`${number.raw}: unbacked`);
  }
  return parts;
}

const IDENTITY_MEANING = {
  bound: "",
  unbound: " An unbound identity means the applicant's ownership of these addresses was not proven.",
  conflict: " A conflict means a bad signature, or an email that belongs to a different account: ask about it.",
};

function identitySentence(identity) {
  const account = identity.account ? `account ${identity.account.host}/${identity.account.login}` : "no account declared";
  const emails = identity.emails.map((e) => `${e.email} (${e.status}, ${e.method})`).join(", ");
  return `${identity.status}: ${account}, signature ${identity.signature}. Emails: ${emails}.${IDENTITY_MEANING[identity.status] ?? ""}`;
}

function countsSentence(counts) {
  return `${commas(counts.evidence_failed)} of ${commas(counts.evidence_total)} evidence items failed. ` +
    `${commas(counts.numbers_rederived)} numbers re-derived, ${commas(counts.numbers_self_reported)} ` +
    `self-reported, ${commas(counts.numbers_unbacked)} unbacked.`;
}

function signalsSentence(signals) {
  const who = signals.solo_repository ? "a solo repository" : `${commas(signals.total_authors)} contributors`;
  return `${who}. ${commas(signals.cited_commits)} cited commits, ${commas(signals.on_default_branch)} of them ` +
    `on the default branch (${signals.default_branch ?? "unknown"}). Committed by the subject: ` +
    `${commas(signals.committed_by_subject)}; by the forge: ${commas(signals.committed_by_forge)}; ` +
    `by someone else: ${commas(signals.committed_by_other)}.`;
}

function outcomeSealed(verification) {
  return verification.outcome === "reproduced" && verification.identity?.status === "bound";
}

function mastheadWordMd(verification) {
  const word = OUTCOME_LABELS[verification.outcome] ?? verification.outcome;
  if (!outcomeSealed(verification)) return `**${word}**`;
  const by = mdText(verification.verified_by ?? "an unnamed reviewer");
  const date = verification.verified_at ? verification.verified_at.slice(0, 10) : "";
  return `**${word}** — Verified by ${by} · ${date}`;
}

/* ---------------------------------- markdown ---------------------------------- */

export function renderMarkdown(doc, { verification = null } = {}) {
  const claims = claimMap(doc);
  const vClaimMap = verification ? new Map(verification.claims.map((c) => [c.id, c])) : null;
  const vEvidenceMap = verification ? new Map(verification.evidence.map((e) => [e.id, e])) : null;
  const sections = [];

  if (verification) sections.push(mastheadWordMd(verification));

  sections.push(`# Proof of work — ${mdText(projectTitle(doc))}`);

  const headline = doc.subject.headline ? lowerFirst(doc.subject.headline) : null;
  sections.push(headline
    ? `**${mdText(doc.subject.name)}** — ${mdText(headline)}`
    : `**${mdText(doc.subject.name)}**`);

  const header = [mdFactsLine(doc)];
  const profileLine = mdProfileLine(doc);
  if (profileLine) header.push(profileLine);
  sections.push(header.join("\n"));

  sections.push(`> **How to read this.** ${trustNoteMd()}`);

  if (doc.repository.project) {
    const project = doc.repository.project;
    const projectLines = [`## The project`, mdText(project.description)];
    const factsLine = projectFactsLine(doc);
    if (factsLine) projectLines.push(mdText(factsLine));
    sections.push(projectLines.join("\n\n"));
  }

  const skillLines = [
    "## Skills",
    "The bar shows how strongly this repository's history backs the claims beneath it — evidence " +
      "strength, not a skill rating. Scores and levels are self-assessed.",
  ];
  for (const skill of doc.skills) {
    const bullets = skill.claim_refs
      .map((ref) => claims.get(ref))
      .filter(Boolean)
      .map((claim) => skillBulletMd(claim, vClaimMap?.get(claim.id)));
    skillLines.push([`### ${mdText(skill.name)}  ${bar(skill.score)}  ${levelLabel(skill.level)}`, ...bullets].join("\n"));
  }
  sections.push(skillLines.join("\n\n"));

  if (doc.stack && doc.stack.length > 0) {
    const stackLine = doc.stack.map((s) => `${mdText(s.name)} (${s.evidence_refs.join(", ")})`).join(" · ");
    sections.push(["## Stack", stackLine].join("\n\n"));
  }

  const capabilities = capabilityLabels(doc);
  if (capabilities.length > 0) {
    sections.push(["## Demonstrated capabilities", capabilities.map((label) => `✓ ${mdText(label)}`).join("\n")].join("\n\n"));
  }

  const authorshipParagraph = authorshipNarrative(doc);
  if (authorshipParagraph) {
    sections.push(["## How the work was produced", mdText(authorshipParagraph)].join("\n\n"));
  }

  sections.push(["## Weak or no evidence", doc.gaps.map((g) => `– ${mdText(g)}`).join("\n")].join("\n\n"));

  if (verification) sections.push(renderVerificationSectionMd(verification));

  sections.push(["## Claims register", claimsTableMd(doc, vClaimMap, vEvidenceMap)].join("\n\n"));
  sections.push(["## Evidence register", evidenceTableMd(doc, vEvidenceMap)].join("\n\n"));

  if (verification) {
    const questions = interviewQuestionsMd(doc, vClaimMap);
    if (questions) sections.push(["## Interview questions", questions].join("\n\n"));
  }

  sections.push(["## Provenance", provenanceParagraphMd(doc)].join("\n\n"));

  return sections.join("\n\n") + "\n";
}

function mdFactsLine(doc) {
  const parts = [repoLabelForFacts(doc)];
  parts.push(`${commas(doc.summary.authored_commits)} authored commits over ${humanizeSpan(doc.summary.span_days)}`);
  const ctx = doc.repository.context;
  if (ctx?.subject_rank != null && ctx?.total_authors != null) {
    parts.push(`#${ctx.subject_rank} contributor of ${commas(ctx.total_authors)}`);
  }
  if (doc.summary.recent_commits_90d != null) {
    parts.push(`${commas(doc.summary.recent_commits_90d)} commits in the last 90 days`);
  }
  parts.push(`generated ${doc.repository.analyzed_at.slice(0, 10)}`);
  parts.push(`proof v${doc.proof_version}`);
  return parts.join(" · ");
}

function mdProfileLine(doc) {
  const url = accountProfileUrl(doc);
  if (!url) return null;
  return `${profileLabelForHost(doc.subject.account.host)}: ${url}`;
}

function authorshipNarrative(doc) {
  if (doc.summary.ai_assisted_commit_share <= 0.1) return null;
  if (doc.narrative?.authorship) return doc.narrative.authorship;
  const share = pct(doc.summary.ai_assisted_commit_share);
  const count = doc.summary.ai_coauthored_commits;
  const countClause = count != null ? ` (${commas(count)} of ${commas(doc.summary.authored_commits)} commits)` : "";
  return `${share}% of authored commits carry an AI co-author trailer${countClause}. The history shows the subject directing generation and refining the result through review, testing, and follow-up commits on the same files — a demonstrated capability, not a caveat.`;
}

function skillBulletMd(claim, verifClaim) {
  const prefix = verdictPrefixMd(verifClaim);
  return `- ${prefix}${mdText(claim.short ?? claim.claim)} (${claim.evidence_refs.join(", ")})`;
}

function claimRowMd(claim, verifClaim, vEvidenceMap) {
  let claimCell = verdictPrefixMd(verifClaim) + mdCell(claim.claim);
  const detail = claimDetailParts(claim, verifClaim, vEvidenceMap);
  if (detail.length > 0) claimCell += `<br>${detail.map(mdCell).join(" · ")}`;
  const cells = [
    claim.id,
    claimCell,
    claim.category,
    claim.confidence.toFixed(2),
    claim.authorship,
    claim.evidence_refs.join(", "),
  ];
  return `| ${cells.join(" | ")} |`;
}

function claimsTableMd(doc, vClaimMap, vEvidenceMap) {
  const rows = doc.claims.map((c) => claimRowMd(c, vClaimMap?.get(c.id), vEvidenceMap));
  return [
    "| id | claim | category | self-assessed confidence | authorship | evidence |",
    "|----|-------|----------|-----------:|------------|----------|",
    ...rows,
  ].join("\n");
}

function evidenceRowMd(evidence, verifEvidence) {
  let descriptionCell = mdCell(evidence.description);
  const detail = evidenceDetailParts(verifEvidence);
  if (detail.length > 0) descriptionCell += `<br>${detail.map(mdCell).join(" · ")}`;
  const cells = [evidence.id, evidence.type, mdCell(evidence.ref), descriptionCell];
  return `| ${cells.join(" | ")} |`;
}

function evidenceTableMd(doc, vEvidenceMap) {
  const rows = doc.evidence.map((e) => evidenceRowMd(e, vEvidenceMap?.get(e.id)));
  return [
    "| id | type | ref | description |",
    "|----|------|-----|-------------|",
    ...rows,
  ].join("\n");
}

function interviewQuestionsMd(doc, vClaimMap) {
  const items = [];
  for (const claim of doc.claims) {
    const question = vClaimMap.get(claim.id)?.audit?.question;
    if (question) items.push(`- **${claim.id}.** ${mdText(question)}`);
  }
  return items.length > 0 ? items.join("\n") : null;
}

function renderVerificationSectionMd(verification) {
  const blocks = [mdText(verification.reason)];
  blocks.push(`**Identity.** ${mdText(identitySentence(verification.identity))}`);
  blocks.push(`**Evidence.** ${countsSentence(verification.counts)}`);
  if (verification.signals) {
    blocks.push(
      "**Signals** (unauthenticated — whoever controls the repository controls these). " +
      mdText(signalsSentence(verification.signals)),
    );
  }
  if (verification.problems.length > 0) {
    blocks.push(["**Problems**", ...verification.problems.map((p) => `– ${mdText(p.message)}`)].join("\n"));
  }
  if (verification.notes.length > 0) {
    blocks.push(["**Notes**", ...verification.notes.map((n) => `– ${mdText(n)}`)].join("\n"));
  }
  const env = verification.environment;
  blocks.push(`Environment: ${mdText(env.tool)}, git ${mdText(env.git)}, node ${mdText(env.node)}.`);
  blocks.push("A person makes the hiring decision; this report is evidence for it.");
  return ["## Verification", blocks.join("\n\n")].join("\n\n");
}

function provenanceParagraphMd(doc) {
  const lines = [
    `Generated locally by ${mdText(doc.provenance.generator)} against commit ${doc.repository.head_sha}.`,
    "This file contains paths, hashes, and metrics and no source code.",
  ];
  if (doc.provenance.notes) lines.push(mdText(doc.provenance.notes));
  return lines.join("\n");
}

/* ---------------------------------- html ---------------------------------- */

export function renderHtml(doc, { logoSvg = null, verification = null } = {}) {
  const claims = claimMap(doc);
  const vClaimMap = verification ? new Map(verification.claims.map((c) => [c.id, c])) : null;
  const vEvidenceMap = verification ? new Map(verification.evidence.map((e) => [e.id, e])) : null;
  const title = projectTitle(doc);
  const docTitle = doc.repository.redacted
    ? `Proof of work — ${escapeHtml(doc.subject.name)}`
    : `Proof of work — ${escapeHtml(title)} · ${escapeHtml(doc.subject.name)}`;

  const logo = logoImgHtml(logoSvg);

  const parts = [];
  parts.push("<!doctype html>");
  parts.push('<html lang="en">');
  parts.push("<head>");
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">');
  parts.push(`<title>${docTitle}</title>`);
  parts.push(`<style>${CSS}</style>`);
  parts.push("</head>");
  parts.push("<body>");
  parts.push("<main>");
  parts.push(renderHeaderHtml(doc, title, logo, verification));
  parts.push(renderProjectHtml(doc));
  parts.push(renderSkillsHtml(doc, claims, vClaimMap));
  parts.push(renderStackHtml(doc));
  parts.push(renderCapabilitiesHtml(doc));
  parts.push(renderAuthorshipHtml(doc));
  parts.push(renderGapsHtml(doc));
  if (verification) parts.push(renderVerificationSectionHtml(verification));
  parts.push(renderClaimsTableHtml(doc, vClaimMap, vEvidenceMap));
  parts.push(renderEvidenceTableHtml(doc, vEvidenceMap));
  if (verification) parts.push(renderInterviewQuestionsHtml(doc, vClaimMap));
  parts.push(renderProvenanceHtml(doc));
  parts.push("</main>");
  parts.push("</body>");
  parts.push("</html>");

  return parts.filter((p) => p !== "").join("\n") + "\n";
}

// Always an inert raster image, never inline `<svg>` DOM: an `<img>` loading
// a data: URI cannot run script or be reached by page CSS, so a candidate's
// logo can't hide the outcome or execute anything, even though its bytes are
// untrusted. Still capped at 64 KB.
function logoImgHtml(logoSvg) {
  if (!logoSvg || Buffer.byteLength(logoSvg, "utf8") > MAX_LOGO_BYTES) return null;
  const b64 = Buffer.from(logoSvg, "utf8").toString("base64");
  return `<img class="mark" src="data:image/svg+xml;base64,${b64}" alt="">`;
}

function renderOutcomeHtml(verification) {
  const word = OUTCOME_LABELS[verification.outcome] ?? verification.outcome;
  if (!outcomeSealed(verification)) {
    return `<span class="outcome">${escapeHtml(word)}</span>`;
  }
  const by = escapeHtml(verification.verified_by ?? "an unnamed reviewer");
  const date = verification.verified_at ? escapeHtml(verification.verified_at.slice(0, 10)) : "";
  return `<span class="outcome sealed">${SEAL_SVG}${escapeHtml(word)} — Verified by ${by} · ${date}</span>`;
}

function renderMastheadHtml(doc, logo, verification) {
  const items = [];
  if (logo) items.push(logo);
  if (!doc.repository.redacted && doc.repository.name) {
    const base = forgeBase(doc.repository.remote);
    items.push(base
      ? `<a class="repo" href="${escapeHtml(base)}">${escapeHtml(doc.repository.name)}</a>`
      : `<span class="repo">${escapeHtml(doc.repository.name)}</span>`);
  }
  if (verification) items.push(renderOutcomeHtml(verification));
  if (items.length === 0) return "";
  return `    <div class="masthead">\n      ${items.join("\n      ")}\n    </div>\n`;
}

function renderHeaderHtml(doc, title, logo, verification) {
  const masthead = renderMastheadHtml(doc, logo, verification);
  const headline = doc.subject.headline ? lowerFirst(doc.subject.headline) : null;
  const headlineHtml = headline
    ? `<p class="headline"><span class="who">${escapeHtml(doc.subject.name)}</span> — ${escapeHtml(headline)}</p>`
    : `<p class="headline"><span class="who">${escapeHtml(doc.subject.name)}</span></p>`;

  const facts = factsGridEntries(doc)
    .map(({ label, value }) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`)
    .join("\n      ");

  const activity = activityHtml(doc);

  // Blank lines separate the header into its visual groups (masthead / h1 +
  // headline / facts / activity / trust note); no blank line within a group.
  const groups = [];
  if (masthead) groups.push(masthead.replace(/\n$/, ""));
  groups.push([`    <h1><span class="quiet">Proof of work —</span> ${escapeHtml(title)}</h1>`, `    ${headlineHtml}`].join("\n"));
  groups.push(['    <dl class="facts">', `      ${facts}`, "    </dl>"].join("\n"));
  if (activity) groups.push(activity);
  groups.push(`    <p class="note">\n      <b>How to read this.</b> ${trustNoteHtml()}\n    </p>`);

  return ["  <header>", groups.join("\n\n"), "  </header>"].join("\n");
}

function factsGridEntries(doc) {
  const entries = [];
  const profileUrl = accountProfileUrl(doc);
  if (profileUrl) {
    const text = `${doc.subject.account.host}/${doc.subject.account.login}`;
    entries.push({ label: "Profile", value: `<a href="${escapeHtml(profileUrl)}">${escapeHtml(text)}</a>` });
  }
  entries.push({ label: "Authored commits", value: commas(doc.summary.authored_commits) });
  const ctx = doc.repository.context;
  if (ctx?.subject_rank != null && ctx?.total_authors != null) {
    entries.push({ label: "Contributor rank", value: `#${ctx.subject_rank} of ${commas(ctx.total_authors)}` });
  }
  if (doc.summary.recent_commits_90d != null) {
    entries.push({ label: "Last 90 days", value: `${commas(doc.summary.recent_commits_90d)} commits` });
  }
  entries.push({ label: "Lines", value: `+${commas(doc.summary.lines_added)} −${commas(doc.summary.lines_removed)}` });
  entries.push({ label: "Files touched", value: commas(doc.summary.files_touched) });
  // span_days is the difference between the first and last day, so the span holds one more
  // calendar day than that.
  entries.push({ label: "Active days", value: `${commas(doc.summary.active_days)} of ${commas(doc.summary.span_days + 1)}` });
  if (doc.summary.ai_assisted_commit_share != null) {
    entries.push({ label: "AI co-authored", value: `${pct(doc.summary.ai_assisted_commit_share)}%` });
  }
  return entries;
}

function activityHtml(doc) {
  const months = doc.summary.activity_by_month;
  if (!months || months.length === 0) return "";
  const max = Math.max(0, ...months.map((m) => m.commits));
  const peak = months.reduce((best, m) => (m.commits > best.commits ? m : best), months[0]);
  const bars = months
    .map((m) => {
      const h = max > 0 ? Math.round((m.commits / max) * 100) : 0;
      return `<i style="height:${h}%" title="${escapeHtml(m.month)}: ${commas(m.commits)} commits"></i>`;
    })
    .join("\n      ");
  const first = months[0].month, last = months[months.length - 1].month;
  const range = first === last ? monthAbbrevYear(first) : `${monthAbbrevYear(first)} – ${monthAbbrevYear(last)}`;
  const generated = doc.repository.analyzed_at.slice(0, 10);
  const caption = `Commits per month, ${range} · peak ${commas(max)} in ${monthAbbrevYear(peak.month)} · generated ${generated} · proof v${doc.proof_version}`;
  return [
    '    <div class="activity" aria-label="Authored commits per month">',
    `      ${bars}`,
    "    </div>",
    `    <p class="activity-caption">${escapeHtml(caption)}</p>`,
  ].join("\n");
}

function renderProjectHtml(doc) {
  const project = doc.repository.project;
  if (!project) return "";
  const factsLine = projectFactsLine(doc);
  const lines = [
    "  <h2>The project</h2>",
    `  <p class="body">${escapeHtml(project.description)}</p>`,
  ];
  if (factsLine) lines.push(`  <p class="body dim">${escapeHtml(factsLine)}</p>`);
  return lines.join("\n");
}

function skillBulletHtml(claim, verifClaim) {
  const eids = claim.evidence_refs.map((id) => `<a href="#${id}">${id}</a>`).join(", ");
  return `      <li>${verdictPrefixHtml(verifClaim)}${escapeHtml(claim.short ?? claim.claim)} <span class="eids">(${eids})</span></li>`;
}

function renderSkillsHtml(doc, claims, vClaimMap) {
  const lines = [
    "  <h2>Skills</h2>",
    "  <p class=\"legend\">The bar shows how strongly this repository's history backs the claims beneath it — " +
      "evidence strength, not a skill rating. Scores and levels are self-assessed.</p>",
  ];
  for (const skill of doc.skills) {
    const bullets = skill.claim_refs
      .map((ref) => claims.get(ref))
      .filter(Boolean)
      .map((claim) => skillBulletHtml(claim, vClaimMap?.get(claim.id)))
      .join("\n");
    lines.push([
      '  <div class="skill">',
      `    <div class="skill-head"><h3>${escapeHtml(skill.name)}</h3><div class="bar"><span style="width:${widthPct(skill.score)}%"></span></div><span class="level">${escapeHtml(levelLabel(skill.level))}</span></div>`,
      "    <ul>",
      bullets,
      "    </ul>",
      "  </div>",
    ].join("\n"));
  }
  return lines.join("\n\n");
}

function widthPct(score) {
  return Math.round(score * 100);
}

function renderStackHtml(doc) {
  if (!doc.stack || doc.stack.length === 0) return "";
  const items = doc.stack.map((s) => {
    const eids = s.evidence_refs.map((id) => `<a href="#${id}">${id}</a>`).join(", ");
    return `    <span>${escapeHtml(s.name)} <span class="eids">(${eids})</span></span>`;
  });
  const joined = items.join('<span class="sep">·</span>\n');
  return ["  <h2>Stack</h2>", '  <p class="runline">', joined, "  </p>"].join("\n");
}

function renderCapabilitiesHtml(doc) {
  const labels = capabilityLabels(doc);
  if (labels.length === 0) return "";
  const items = labels.map((label) => `    <span><span class="tick">✓</span> ${escapeHtml(label)}</span>`);
  const joined = items.join('<span class="sep">·</span>\n');
  return ["  <h2>Demonstrated capabilities</h2>", '  <p class="runline">', joined, "  </p>"].join("\n");
}

function renderAuthorshipHtml(doc) {
  const paragraph = authorshipNarrative(doc);
  if (!paragraph) return "";
  return ["  <h2>How the work was produced</h2>", `  <p class="body dim">${escapeHtml(paragraph)}</p>`].join("\n");
}

function renderGapsHtml(doc) {
  const items = doc.gaps.map((g) => `    <li>${escapeHtml(g)}</li>`).join("\n");
  return ['  <h2>Weak or no evidence</h2>', '  <ul class="gaps">', items, "  </ul>"].join("\n");
}

function renderVerificationSectionHtml(verification) {
  const parts = ["  <h2>Verification</h2>", `  <p class="body">${escapeHtml(verification.reason)}</p>`];
  parts.push(`  <p class="body dim"><b>Identity.</b> ${escapeHtml(identitySentence(verification.identity))}</p>`);
  parts.push(`  <p class="body dim"><b>Evidence.</b> ${escapeHtml(countsSentence(verification.counts))}</p>`);
  if (verification.signals) {
    parts.push(
      '  <p class="body dim"><b>Signals</b> (unauthenticated — whoever controls the repository controls these). ' +
      `${escapeHtml(signalsSentence(verification.signals))}</p>`,
    );
  }
  if (verification.problems.length > 0) {
    const items = verification.problems.map((p) => `    <li>${escapeHtml(p.message)}</li>`).join("\n");
    parts.push(['  <p class="body dim"><b>Problems</b></p>', '  <ul class="gaps">', items, "  </ul>"].join("\n"));
  }
  if (verification.notes.length > 0) {
    const items = verification.notes.map((n) => `    <li>${escapeHtml(n)}</li>`).join("\n");
    parts.push(['  <p class="body dim"><b>Notes</b></p>', '  <ul class="gaps">', items, "  </ul>"].join("\n"));
  }
  const env = verification.environment;
  parts.push(`  <p class="body dim">Environment: ${escapeHtml(env.tool)}, git ${escapeHtml(env.git)}, node ${escapeHtml(env.node)}.</p>`);
  parts.push('  <p class="body dim">A person makes the hiring decision; this report is evidence for it.</p>');
  return parts.join("\n");
}

function claimRowHtml(claim, verifClaim, vEvidenceMap) {
  const eids = claim.evidence_refs.map((id) => `<a href="#${id}">${id}</a>`).join(", ");
  const detail = claimDetailParts(claim, verifClaim, vEvidenceMap);
  const detailHtml = detail.length > 0
    ? `<br><span class="claim-detail">${detail.map(escapeHtml).join(" · ")}</span>`
    : "";
  return `      <tr id="${claim.id}"><td class="id">${claim.id}</td><td>${verdictPrefixHtml(verifClaim)}${escapeHtml(claim.claim)}${detailHtml}</td><td><span class="tag">${escapeHtml(claim.category)}</span></td><td class="num">${claim.confidence.toFixed(2)}</td><td><span class="tag">${escapeHtml(claim.authorship)}</span></td><td class="eids">${eids}</td></tr>`;
}

function renderClaimsTableHtml(doc, vClaimMap, vEvidenceMap) {
  const rows = doc.claims.map((c) => claimRowHtml(c, vClaimMap?.get(c.id), vEvidenceMap));
  return [
    "  <h2>Claims register</h2>",
    '  <div class="tablewrap">',
    "  <table>",
    "    <thead><tr><th>id</th><th>claim</th><th>category</th><th>self-assessed conf.</th><th>authorship</th><th>evidence</th></tr></thead>",
    "    <tbody>",
    rows.join("\n"),
    "    </tbody>",
    "  </table>",
    "  </div>",
  ].join("\n");
}

function evidenceRowHtml(evidence, doc, verifEvidence) {
  const href = evidenceHref(evidence, doc);
  const refText = evidence.type === "commit"
    ? shaShort(evidence.ref)
    : evidence.type === "commit_range"
      ? evidence.ref.split("..").map(shaShort).join("..")
      : evidence.ref;
  const refCell = href ? `<a href="${escapeHtml(href)}">${escapeHtml(refText)}</a>` : escapeHtml(refText);
  const detail = evidenceDetailParts(verifEvidence);
  const detailHtml = detail.length > 0
    ? `<br><span class="claim-detail">${detail.map(escapeHtml).join(" · ")}</span>`
    : "";
  return `      <tr id="${evidence.id}"><td class="id">${evidence.id}</td><td><span class="tag">${escapeHtml(evidence.type)}</span></td><td class="ref">${refCell}</td><td>${escapeHtml(evidence.description)}${detailHtml}</td></tr>`;
}

function renderEvidenceTableHtml(doc, vEvidenceMap) {
  const rows = doc.evidence.map((e) => evidenceRowHtml(e, doc, vEvidenceMap?.get(e.id)));
  return [
    "  <h2>Evidence register</h2>",
    '  <div class="tablewrap">',
    "  <table>",
    "    <thead><tr><th>id</th><th>type</th><th>ref</th><th>description</th></tr></thead>",
    "    <tbody>",
    rows.join("\n"),
    "    </tbody>",
    "  </table>",
    "  </div>",
  ].join("\n");
}

function renderInterviewQuestionsHtml(doc, vClaimMap) {
  const items = [];
  for (const claim of doc.claims) {
    const question = vClaimMap.get(claim.id)?.audit?.question;
    if (question) items.push(`    <li><a href="#${claim.id}">${claim.id}</a>. ${escapeHtml(question)}</li>`);
  }
  if (items.length === 0) return "";
  return ["  <h2>Interview questions</h2>", '  <ul class="gaps">', items.join("\n"), "  </ul>"].join("\n");
}

function renderProvenanceHtml(doc) {
  const notes = doc.provenance.notes ? ` ${escapeHtml(doc.provenance.notes)}` : "";
  return [
    '  <p class="prov">',
    `    Generated locally by ${escapeHtml(doc.provenance.generator)} against commit`,
    `    <code>${escapeHtml(doc.repository.head_sha)}</code>.`,
    `    This file contains paths, hashes, and metrics and no source code.${notes}`,
    "  </p>",
  ].join("\n");
}

const SEAL_SVG =
  '<svg class="seal" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<g fill="currentColor"><circle cx="19" cy="12" r="4.8"/><circle cx="16.95" cy="16.95" r="4.8"/>' +
  '<circle cx="12" cy="19" r="4.8"/><circle cx="7.05" cy="16.95" r="4.8"/><circle cx="5" cy="12" r="4.8"/>' +
  '<circle cx="7.05" cy="7.05" r="4.8"/><circle cx="12" cy="5" r="4.8"/><circle cx="16.95" cy="7.05" r="4.8"/>' +
  '<circle cx="12" cy="12" r="9.5"/></g>' +
  '<path d="M7 12.6l3.5 3.5 6.5-6.9" fill="none" stroke="#fff" stroke-width="2.5"/></svg>';

// One family, four sizes, two weights; one light palette with no
// prefers-color-scheme override (the report renders the same in every
// viewer, like the PDF it becomes); no chrome — hierarchy comes from type
// and hairline rules only. See HTML-REPORT.md for the rationale.
// The candidate and recipient views share this exact stylesheet: a
// recipient-only element (the outcome word, the claim-detail line) is always
// styled from one of these existing tokens, never a new hex value.
const CSS = `
  :root {
    --paper: #fcfcfa;
    --ink: #1c1a17;
    --soft: #55524b;
    --faint: #8d897f;
    --line: #e7e4dc;
    --accent: #1da1f2;
    --accent-text: #0b78bc;
    --accent-soft: #e8f4fd;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --type-title: 600 1.9rem/1.2 var(--sans);
    --type-body: 400 1rem/1.6 var(--sans);
    --type-data: 600 0.8125rem/1.5 var(--sans);
    --type-caption: 400 0.8125rem/1.5 var(--sans);
    --type-label: 600 0.6875rem/1 var(--sans);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--paper); color: var(--ink); font: var(--type-body); padding: 4rem 1.5rem 5rem; }
  main { max-width: 700px; margin: 0 auto; }
  b, strong { font-weight: 600; }
  a { color: inherit; text-decoration: underline; text-decoration-color: var(--faint); text-underline-offset: 2px; }
  a:hover { text-decoration-color: var(--ink); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .masthead { display: flex; align-items: center; gap: 0.9rem; }
  .masthead .mark { flex: none; display: block; height: 20px; width: auto; }
  .masthead .repo { font: var(--type-data); color: var(--soft); text-decoration: none; }
  .masthead .repo:hover { text-decoration: underline; }
  .masthead .outcome { margin-left: auto; font: var(--type-data); color: var(--soft); }
  .masthead .outcome.sealed { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--accent-text); }
  .masthead .seal { flex: none; color: var(--accent); }

  h1 { margin-top: 2.4rem; font: var(--type-title); letter-spacing: -0.02em; }
  h1 .quiet { color: var(--faint); font-weight: 400; }
  .headline { margin-top: 0.9rem; color: var(--soft); }
  .headline .who { color: var(--ink); font-weight: 600; }

  .facts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.3rem 1.5rem; margin-top: 2.2rem; padding-top: 1.7rem; border-top: 1px solid var(--line); }
  .facts div dt { font: var(--type-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--faint); margin-bottom: 0.4rem; }
  .facts div dd { font: var(--type-data); color: var(--ink); font-variant-numeric: tabular-nums; }
  .facts div dd a { text-decoration: none; }
  .facts div dd a:hover { text-decoration: underline; }

  .activity { display: flex; align-items: flex-end; gap: 3px; height: 72px; margin-top: 2.2rem; border-bottom: 1px solid var(--line); }
  .activity i { flex: 1; background: var(--accent); opacity: 0.55; min-height: 2px; }
  .activity-caption { font: var(--type-caption); color: var(--faint); margin-top: 0.45rem; }

  .note { margin-top: 2.2rem; color: var(--soft); }
  .note b { color: var(--ink); }

  h2 { font: var(--type-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--faint); margin: 3.4rem 0 1.1rem; }
  p.body + p.body { margin-top: 0.8rem; }
  p.dim { color: var(--soft); }
  .legend { font: var(--type-caption); color: var(--faint); margin: -0.5rem 0 1.4rem; }

  .skill { margin-bottom: 2.1rem; break-inside: avoid; }
  .skill-head { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
  .skill-head h3 { font-size: 1rem; font-weight: 600; }
  .bar { flex: none; width: 110px; height: 3px; background: var(--line); }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .level { font: var(--type-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--faint); }
  .skill ul { list-style: none; margin-top: 0.6rem; }
  .skill li { color: var(--soft); margin-bottom: 0.45rem; padding-left: 1.05em; text-indent: -1.05em; }
  .skill li::before { content: "\\2022  "; }

  .eids { font: var(--type-data); color: var(--faint); white-space: nowrap; }
  .eids a { color: var(--accent-text); text-decoration: none; }
  .eids a:hover { text-decoration: underline; }

  .runline { line-height: 2; }
  .runline .sep { color: var(--faint); margin: 0 0.45em; }
  .runline .tick { color: var(--accent); }

  .gaps { list-style: none; }
  .gaps li { color: var(--soft); margin-bottom: 0.45rem; padding-left: 1.05em; text-indent: -1.05em; }
  .gaps li::before { content: "\\2022  "; }

  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th { font: var(--type-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--faint); text-align: left; padding: 0 0.9rem 0.5rem 0; border-bottom: 1px solid var(--line); }
  td { font: var(--type-caption); padding: 0.55rem 0.9rem 0.55rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  th:last-child, td:last-child { padding-right: 0; }
  td.num { font: var(--type-data); text-align: right; font-variant-numeric: tabular-nums; }
  .id { font: var(--type-data); color: var(--accent-text); white-space: nowrap; }
  .tag { font: var(--type-caption); color: var(--faint); white-space: nowrap; }
  .ref { font: var(--type-data); word-break: break-all; }
  .ref a { color: var(--accent-text); text-decoration: none; }
  .ref a:hover { text-decoration: underline; }
  .claim-detail { color: var(--soft); }
  tr:target td { background: var(--accent-soft); }

  .prov { margin-top: 3.5rem; padding-top: 1.4rem; border-top: 1px solid var(--line); font: var(--type-caption); color: var(--soft); }
  .prov code { font: var(--type-data); word-break: break-all; }

  @media (max-width: 640px) {
    body { padding: 2.5rem 1.1rem 4rem; }
    h1 { font-size: 1.7rem; }
    .facts { grid-template-columns: repeat(2, 1fr); }
  }
  @media print {
    body { background: #ffffff; font-size: 13px; padding: 0; }
    .bar span, .activity i { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    tr, .skill, .note, .prov, .facts { break-inside: avoid; }
    a { color: inherit; }
  }
`;
