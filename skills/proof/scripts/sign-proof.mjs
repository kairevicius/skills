#!/usr/bin/env node
// Signs proof.json with a local SSH key and self-verifies the result against the account's
// published keys, so a recipient can later bind the report to a real forge account with
// scripts/lib/identity.mjs's bindIdentity. Wraps OpenSSH's own `ssh-keygen -Y sign/verify`
// (the same primitive `git commit -S` uses) rather than any bundled crypto.
//
// Usage: sign-proof.mjs <proof.json> --account <host>/<login> [--key <path>] [--keys-file <path>]
// Exit codes: 0 signed and verified, 1 usage error or no local key verifies against the
//             account, 2 the chosen key exists locally but ssh-agent does not hold it
//             (its passphrase prompt needs a real terminal, which this command cannot
//             answer for you — it prints the exact command to run yourself).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOWED_KEY_HOSTS, LOGIN_RE, SIGNATURE_NAMESPACE, fetchAccountKeys, verifySignature } from "./lib/identity.mjs";

const HELP = `usage: sign-proof.mjs <proof.json> --account <host>/<login> [options]

  --account <host>/<login>  the forge account to sign as (host: ${ALLOWED_KEY_HOSTS.join(", ")})
  --key <path>               sign with this key: a private key file (works standalone), or
                              a public key file whose matching private key is loaded in
                              ssh-agent. Default: the first of git config user.signingkey,
                              then ~/.ssh/*.pub, that is published on the account.
  --keys-file <path>         read the account's public keys from this local file instead of
                              fetching https://<host>/<login>.keys (offline / tests)
  --help                     show this help and exit

Self-verifies the signature it produces against the account's published keys before
reporting success, and deletes it if verification fails.

exit codes: 0 signed and verified
            1 usage error, or no local key is published on the account
            2 the chosen key is not loaded in ssh-agent — run the printed ssh-add command
              yourself, then re-run this command (a passphrase prompt needs a real terminal)
`;

function parseArgs(argv) {
  const opts = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`flag ${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--account":
        opts.account = next();
        break;
      case "--key":
        opts.key = next();
        break;
      case "--keys-file":
        opts.keysFile = next();
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown flag: ${a}`);
        positionals.push(a);
    }
  }
  opts.proofPath = positionals[0];
  return opts;
}

function parseAccountArg(value) {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`--account must be <host>/<login>, got: ${value}`);
  }
  const host = value.slice(0, slash);
  const login = value.slice(slash + 1);
  if (!ALLOWED_KEY_HOSTS.includes(host)) {
    throw new Error(`--account host must be one of ${ALLOWED_KEY_HOSTS.join(", ")}, got: ${host}`);
  }
  if (!LOGIN_RE.test(login)) {
    throw new Error(`--account login is not a valid forge login: ${login}`);
  }
  return { host, login };
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Extracts the "<type> <base64>" pair a public-key line starts with, discarding any
// trailing comment. Used both for a candidate key's own file and for parsing
// `ssh-add -L`'s listing, which is the same format.
function keyLineFromPublicKeyText(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  const [type, base64] = trimmed.split(/\s+/);
  return type && base64 ? `${type} ${base64}` : null;
}

function tryKeyLineFromFile(filePath) {
  try {
    return keyLineFromPublicKeyText(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// `ssh-keygen -y -f <private key>` prints the matching public key. Used only when --key
// names a private key directly (no .pub file to read), so a candidate signed with that
// path can still be checked against the account's published keys before signing anything.
function derivePublicKeyLine(privateKeyPath) {
  let out;
  try {
    out = execFileSync("ssh-keygen", ["-y", "-f", privateKeyPath], {
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
    });
  } catch (err) {
    throw new Error(`could not read a public key from ${privateKeyPath}: ${err.message}`);
  }
  return keyLineFromPublicKeyText(out);
}

function fingerprintKeyLine(keyLine) {
  try {
    return execFileSync("ssh-keygen", ["-lf", "-"], { input: `${keyLine}\n`, encoding: "utf8" }).trim();
  } catch {
    return keyLine;
  }
}

function resolveExplicitKeyCandidate(keyArg) {
  const signPath = path.resolve(expandHome(keyArg));
  if (!existsSync(signPath)) {
    throw new Error(`--key path does not exist: ${signPath}`);
  }
  const keyLine = signPath.toLowerCase().endsWith(".pub")
    ? tryKeyLineFromFile(signPath)
    : derivePublicKeyLine(signPath);
  if (!keyLine) {
    throw new Error(`could not read a public key from ${signPath}`);
  }
  return { signPath, keyLine, source: "--key" };
}

// git supports `user.signingkey` naming either a file (conventionally a .pub path) or,
// with gpg.format=ssh, a literal key inline as `key::ssh-ed25519 AAAA...`. The literal
// form has to be materialized into a file: `ssh-keygen -Y sign -f` takes a path, not a
// string. That temp file is this candidate's own to clean up.
//
// This is the one `execFileSync("git", ...)` in scripts/ outside evidence.mjs and its
// tests, and deliberately does not go through evidence.mjs's sanitized runGit/tryGit:
// those exist to ISOLATE git plumbing from the caller's ambient config while reading a
// (possibly untrusted) subject repository — they redirect HOME to an empty directory
// specifically so the user's real ~/.gitconfig cannot leak in. Here the goal is the exact
// opposite: this reads the signer's own ambient user.signingkey, on their own machine, to
// find their own key. Routing it through the sanitized runner would make it always read
// nothing.
function resolveGitSigningKeyCandidate() {
  let raw;
  try {
    raw = execFileSync("git", ["config", "--get", "user.signingkey"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // unset, or not inside a git repo — not an error, just nothing to try
  }
  if (!raw) return null;

  const literal = raw.startsWith("key::") ? raw.slice("key::".length).trim() : raw;
  if (/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+|sk-\S+)\s/.test(literal)) {
    const keyLine = keyLineFromPublicKeyText(literal);
    if (!keyLine) return null;
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "proof-sign-"));
    const tmpFile = path.join(tmpDir, "signingkey.pub");
    writeFileSync(tmpFile, `${literal.trim()}\n`);
    return {
      signPath: tmpFile,
      keyLine,
      source: "git config user.signingkey (literal key)",
      cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
    };
  }

  const expanded = expandHome(raw);
  const keyLine = tryKeyLineFromFile(expanded);
  return keyLine ? { signPath: expanded, keyLine, source: "git config user.signingkey" } : null;
}

function scanSshPublicKeys() {
  const dir = path.join(os.homedir(), ".ssh");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".pub"))
    .sort()
    .map((name) => path.join(dir, name));
}

// Candidates in priority order, unfiltered: the caller decides which one (if any) is
// published on the account. git config comes first because it is an explicit, one-time
// choice the user made; ~/.ssh/*.pub is a directory scan and may hold several keys.
function discoverLocalKeyCandidates() {
  const candidates = [];
  const gitCandidate = resolveGitSigningKeyCandidate();
  if (gitCandidate) candidates.push(gitCandidate);
  for (const p of scanSshPublicKeys()) {
    const keyLine = tryKeyLineFromFile(p);
    if (keyLine) candidates.push({ signPath: p, keyLine, source: `~/.ssh/${path.basename(p)}` });
  }
  return candidates;
}

function isKeyLoadedInAgent(keyLine) {
  let out;
  try {
    out = execFileSync("ssh-add", ["-L"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return false; // no agent, no connection, or no identities — none of which hold this key
  }
  return out.split("\n").some((line) => keyLineFromPublicKeyText(line) === keyLine);
}

function printNoMatchMessage(account, accountKeys) {
  console.error(`error: no local key matches a public key published on ${account.host}/${account.login}.`);
  if (accountKeys.length === 0) {
    console.error(`The account has no supported public keys (ssh-ed25519, ssh-rsa, ecdsa-sha2-*, sk-*).`);
  } else {
    console.error("Its published keys:");
    for (const line of accountKeys) console.error(`  ${fingerprintKeyLine(line)}`);
  }
  console.error(`Add one of your local public keys to ${account.host}/${account.login}, or pass --key <path>.`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }
  if (!args.proofPath || !args.account) {
    console.error(HELP);
    process.exit(1);
  }

  const account = parseAccountArg(args.account);
  const proofPath = path.resolve(args.proofPath);
  if (!existsSync(proofPath)) throw new Error(`proof.json not found: ${proofPath}`);
  const proofBytes = readFileSync(proofPath);

  const accountKeys = await fetchAccountKeys(account, { keysFile: args.keysFile });

  const chosen = args.key
    ? resolveExplicitKeyCandidate(args.key)
    : discoverLocalKeyCandidates().find((c) => accountKeys.includes(c.keyLine)) ?? null;

  if (!chosen || !accountKeys.includes(chosen.keyLine)) {
    printNoMatchMessage(account, accountKeys);
    chosen?.cleanup?.();
    process.exit(1);
  }

  try {
    if (chosen.signPath.toLowerCase().endsWith(".pub") && !isKeyLoadedInAgent(chosen.keyLine)) {
      const privateKeyGuess = chosen.signPath.replace(/\.pub$/i, "");
      console.error(`error: ${chosen.signPath} is not loaded in ssh-agent, so ssh-keygen cannot sign with it.`);
      console.error("An automated command cannot answer its passphrase prompt. Run this yourself, then re-run this command:");
      console.error(`  ssh-add ${privateKeyGuess}`);
      console.error(
        `  node ${process.argv[1]} ${args.proofPath} --account ${args.account}` +
          (args.key ? ` --key ${args.key}` : "") +
          (args.keysFile ? ` --keys-file ${args.keysFile}` : ""),
      );
      process.exit(2);
    }

    const sigPath = `${proofPath}.sig`;
    // stdio is inherited (not captured) so a passphrase prompt is answerable — this is
    // the one step in this script where that matters, since it is the step that reads
    // the private key material.
    try {
      execFileSync("ssh-keygen", ["-Y", "sign", "-f", chosen.signPath, "-n", SIGNATURE_NAMESPACE, proofPath], {
        stdio: "inherit",
      });
    } catch (err) {
      throw new Error(`ssh-keygen -Y sign failed: ${err.message}`);
    }

    const verdict = verifySignature(proofBytes, sigPath, account, accountKeys);
    if (verdict !== "valid") {
      try {
        rmSync(sigPath);
      } catch {
        // best-effort: report the more important failure below regardless
      }
      throw new Error(`produced ${sigPath} but it does not verify against ${account.host}/${account.login}; deleted it`);
    }

    console.log(`signed: ${sigPath} (verified against ${account.host}/${account.login})`);
  } finally {
    chosen?.cleanup?.();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`error: ${err?.message ?? err}`);
    process.exit(1);
  });
