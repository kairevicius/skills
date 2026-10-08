#!/usr/bin/env node
// Deterministic, read-only git evidence for the proof skill.
// Usage: git-evidence.mjs [--repo <path>] [--rev <rev>] [--author <email>]...
//                          [--since <YYYY-MM-DD>] [--as-of <iso>] [--scope <glob>]...
//                          [--blame-top N] [--blame <path>]... [--redacted]
//                          [--check-remote] [--json <path>] [--print] [--help]
//        git-evidence.mjs --repo <path> --discover <text>
//   --author repeats to OR-match several identities (e.g. two emails for one person).
//   --author must be an exact email — use --discover first to find one.
//   default author: git config user.email in --repo.
// Exit codes: 0 ok, 2 bad --since, 3 zero authored commits, 4 shallow clone,
//             5 rev does not resolve, 1 other.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collect, EvidenceError, runGit, tryGit, asciiLower } from "./lib/evidence.mjs";

const HELP = `usage: git-evidence.mjs [options]
       git-evidence.mjs --repo <path> --discover <text>

  --repo <path>        repository to analyze (default: cwd)
  --rev <rev>          commit/ref to analyze (default: HEAD) — use this when the
                        commit to report on is not yet pushed to any branch you
                        want considered, or to pin an exact sha
  --author <email>     exact identity email, ASCII-lowercase-equal match against
                        the raw commit author email (repeatable; default: git
                        config user.email). NOT a name or a substring pattern —
                        run --discover first to find the exact email(s) to use.
  --discover <text>    print every distinct "name <email>" identity in the
                        repository's whole history whose name or email contains
                        <text> (case-insensitive substring), with commit counts,
                        then exit. Use this to find the exact --author value.
  --since <YYYY-MM-DD> only count commits on or after this date
  --as-of <iso>        analysis instant, for the recent/90d window (default: now)
  --scope <glob>       report commits/touches/files/new_files under this glob (repeatable)
  --blame-top <N>      number of top-churn files to run blame over (default: 10)
  --blame <path>       also run blame on this exact path, in addition to the
                        top-churn files (repeatable)
  --redacted           null out repo name and remote in the JSON
  --check-remote       anonymously probe the recorded remote (ls-remote, 20s
                        timeout) and warn if head_sha is on no refs/remotes/*
                        ref. Off by default: this is a network call.
  --json <path>        where to write evidence.json (default: <repo>/proof/evidence.json)
  --print              also print a human-readable summary to stdout
  --help               show this help and exit

exit codes: 0 ok, 2 bad --since, 3 zero authored commits, 4 shallow clone,
            5 rev does not resolve, 1 other error
`;

function parseArgs(argv) {
  const opts = { authors: [], scopes: [], blamePaths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new EvidenceError(`flag ${a} needs a value`, 1);
      return argv[++i];
    };
    switch (a) {
      case "--repo":
        opts.repo = next();
        break;
      case "--rev":
        opts.rev = next();
        break;
      case "--author":
        opts.authors.push(next());
        break;
      case "--discover":
        opts.discover = next();
        break;
      case "--since":
        opts.since = next();
        break;
      case "--as-of":
        opts.asOf = next();
        break;
      case "--scope":
        opts.scopes.push(next());
        break;
      case "--blame-top":
        opts.blameTop = Number(next());
        break;
      case "--blame":
        opts.blamePaths.push(next());
        break;
      case "--redacted":
        opts.redacted = true;
        break;
      case "--check-remote":
        opts.checkRemote = true;
        break;
      case "--json":
        opts.json = next();
        break;
      case "--print":
        opts.print = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new EvidenceError(`unknown flag: ${a}`, 1);
    }
  }
  return opts;
}

// --discover: a deliberately FUZZY, human-facing search (case-insensitive
// substring over the whole history's "name <email>" pairs) — the one place in
// this CLI a fuzzy match is correct, precisely because its job is to hand back
// the exact --author value the rest of the tool then matches byte-for-byte.
function discover(repo, text) {
  const raw = runGit(repo, ["log", "--format=%an%x1f%ae"]);
  const needle = asciiLower(text);
  const counts = new Map();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const [name, email] = line.split("\x1f");
    const identity = `${name} <${email}>`;
    if (!asciiLower(identity).includes(needle)) continue;
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const rows = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );
  if (rows.length === 0) {
    console.error(`no identity matching "${text}" found in ${repo}`);
    return;
  }
  for (const [identity, count] of rows) console.log(`${count}\t${identity}`);
}

// Off by default (--check-remote): a real network call, so it never runs
// unless asked. Two independent facts, each its own warning: can an anonymous
// clone even reach the recorded remote, and — regardless of that — does the
// LOCAL repository's own refs/remotes/* already contain head_sha (a commit
// can be unreachable from any remote-tracking ref while the remote itself is
// perfectly reachable, e.g. an unpushed local commit).
function checkRemote(repo, evidence) {
  const remote = evidence.repo.remote;
  if (remote) {
    const reachable = tryGit(repo, ["ls-remote", "--exit-code", "--heads", "--tags", "--", remote], {
      env: { GIT_ALLOW_PROTOCOL: "https:http:ssh" },
      timeout: 20000,
    });
    if (reachable === null) {
      evidence.warnings.push(`--check-remote: anonymous access to ${remote} was refused or timed out`);
    }
  } else {
    evidence.warnings.push("--check-remote: repository has no readable \"origin\" remote to probe");
  }
  const onRemoteRef = tryGit(repo, ["for-each-ref", "--contains", evidence.head_sha, "refs/remotes"]);
  if (!onRemoteRef || !onRemoteRef.trim()) {
    evidence.warnings.push(
      `--check-remote: head_sha ${evidence.head_sha} is on no local refs/remotes/* ref — it looks unpushed`
    );
  }
}

function fmtNum(n) {
  return n.toLocaleString("en-US");
}

function printHumanSummary(ev) {
  const lines = [];
  const push = (s = "") => lines.push(s);

  push("== REPO ==");
  push(`head_sha: ${ev.head_sha}`);
  push(`repo.name: ${ev.repo.name ?? "(redacted)"}`);
  push(`repo.remote: ${ev.repo.remote ?? "(none/redacted)"}`);
  push(`repo.first_commit: ${ev.repo.first_commit}`);
  push(`subject.patterns: ${ev.subject.patterns.join(", ")}`);
  push(`subject.since: ${ev.subject.since ?? "(full history)"}`);

  push();
  push("== IDENTITIES (subject.identities) ==");
  for (const idn of ev.subject.identities) push(`  ${idn.name} <${idn.email}> — ${fmtNum(idn.commits)} commits`);
  for (const w of ev.warnings) push(`  warning: ${w}`);

  push();
  push("== SUMMARY ==");
  const s = ev.summary;
  push(`summary.authored_commits: ${fmtNum(s.authored_commits)}`);
  push(`summary.first_authored_commit: ${s.first_authored_commit}`);
  push(`summary.last_authored_commit: ${s.last_authored_commit}`);
  push(`summary.active_days: ${fmtNum(s.active_days)}`);
  push(`summary.span_days: ${fmtNum(s.span_days)}`);
  push(`summary.lines_added: ${fmtNum(s.lines_added)}`);
  push(`summary.lines_removed: ${fmtNum(s.lines_removed)}`);
  push(`summary.files_touched: ${fmtNum(s.files_touched)}`);
  push(`summary.test_touches: ${fmtNum(s.test_touches)}`);
  push(`summary.test_files: ${fmtNum(s.test_files)}`);

  push();
  push("== AI CO-AUTHOR TRAILERS ==");
  push(`summary.ai_coauthored_commits: ${fmtNum(s.ai_coauthored_commits)} / ${fmtNum(s.authored_commits)}`);
  push(`summary.ai_assisted_commit_share: ${s.ai_assisted_commit_share}`);

  push();
  push("== TOP DIRECTORIES (top_directories, depth 2) ==");
  for (const d of ev.top_directories) push(`  ${fmtNum(d.touches)}\t${d.path}`);

  push();
  push("== TOP FILES (top_files, churn) ==");
  for (const f of ev.top_files) push(`  ${fmtNum(f.churn)}\t${f.path}`);

  push();
  push("== FILE TYPES (file_types) ==");
  for (const t of ev.file_types) push(`  ${fmtNum(t.touches)}\t.${t.ext}`);

  push();
  push("== LARGEST COMMITS (largest_commits, insertions) ==");
  for (const c of ev.largest_commits) push(`  ${fmtNum(c.insertions)}\t${c.sha.slice(0, 8)}\t${c.date}\t${c.subject}`);

  push();
  push("== PR REFERENCES (prs) ==");
  for (const pr of ev.prs) push(`  #${pr.number}\t${pr.sha.slice(0, 8)}\t${pr.date}`);
  if (ev.prs.length === 0) push("  (none found)");

  push();
  push("== REPO CONTEXT (context) ==");
  push(`context.total_commits: ${fmtNum(ev.context.total_commits)}`);
  push(`context.total_authors: ${fmtNum(ev.context.total_authors)}`);
  push(`context.subject_rank: ${fmtNum(ev.context.subject_rank)}`);
  push(`context.since: ${ev.context.since ?? "(full history)"}`);

  push();
  push("== ACTIVITY BY MONTH (summary.activity_by_month) ==");
  for (const m of s.activity_by_month) push(`  ${m.month}\t${fmtNum(m.commits)}`);

  push();
  push("== RECENT WINDOW (recent, 90d unless --since is more recent) ==");
  push(`recent.since: ${ev.recent.since}`);
  push(`recent.commits (== summary.recent_commits_90d): ${fmtNum(ev.recent.commits)}`);
  for (const d of ev.recent.top_directories) push(`  ${fmtNum(d.touches)}\t${d.path}`);

  if (Object.keys(ev.scopes).length > 0) {
    push();
    push("== SCOPES (scopes) ==");
    for (const [glob, st] of Object.entries(ev.scopes)) {
      push(`  ${glob}: commits=${fmtNum(st.commits)} touches=${fmtNum(st.touches)} files=${fmtNum(st.files)} new_files=${fmtNum(st.new_files)}`);
    }
  }

  if (ev.blame.length > 0) {
    push();
    push("== BLAME (blame, top-churn files still present at rev) ==");
    for (const b of ev.blame) push(`  ${b.path}: ${fmtNum(b.subject)}/${fmtNum(b.total)} lines (share=${b.share})`);
  }

  console.log(lines.join("\n"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const repo = args.repo ? path.resolve(args.repo) : process.cwd();

  if (args.discover !== undefined) {
    discover(repo, args.discover);
    return;
  }

  const evidence = collect({
    repo,
    rev: args.rev,
    identities: args.authors.length ? args.authors : undefined,
    since: args.since ?? null,
    asOf: args.asOf,
    scopes: args.scopes,
    blameTop: Number.isFinite(args.blameTop) ? args.blameTop : undefined,
    blamePaths: args.blamePaths,
    redacted: !!args.redacted,
  });

  if (args.checkRemote) checkRemote(repo, evidence);

  const jsonPath = args.json ? path.resolve(args.json) : path.join(repo, "proof", "evidence.json");
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(evidence, null, 2) + "\n");

  if (args.print) {
    printHumanSummary(evidence);
  }
  console.error(`wrote ${jsonPath}`);
}

try {
  main();
  process.exit(0);
} catch (err) {
  if (err instanceof EvidenceError) {
    console.error(`error: ${err.message}`);
    process.exit(err.code);
  }
  console.error(`error: ${err?.stack || err?.message || err}`);
  process.exit(1);
}
