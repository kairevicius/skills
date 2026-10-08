// Identity binding for the proof skill.
//
// Without this module, anyone can run the skill against a well-known developer's public
// repository using that developer's git author email, put their own name on top, and the
// proof reproduces perfectly: git history proves the CODE happened, never who is sending
// you the report. This module closes that gap with a chain the recipient can check
// themselves, offline where possible:
//
//   the candidate signs proof.json with an SSH key
//     -> the matching public key is published on their forge account
//        (https://<host>/<login>.keys — public, unauthenticated, not rate-limited)
//     -> each declared identity email belongs to that same account
//     -> so the git history's author emails belong to the person who signed the report.
//
// Zero npm dependencies: verification shells out to OpenSSH's own `ssh-keygen -Y verify`
// (the same primitive `git commit -S` uses for SSH-signed commits) rather than reimplementing
// signature parsing or crypto.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadSchema } from "./schema-check.mjs";

export class IdentityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "IdentityError";
  }
}

// The forges whose `/<login>.keys` endpoint this skill will fetch from. Never grown by a
// config value or a proof.json field: an allowlist that anything but this module's own
// source can extend is not an allowlist.
export const ALLOWED_KEY_HOSTS = ["github.com", "gitlab.com", "codeberg.org"];

// The `ssh-keygen -Y sign/verify` namespace both sign-proof.mjs and verify-proof.mjs use.
// A signature is only valid for the namespace it was made under, so this string is part of
// the trust boundary: it stops a proof-skill signature from being replayed as, say, a git
// commit signature over the same bytes, and vice versa.
export const SIGNATURE_NAMESPACE = "proof-skill";

// subject.account.login's own pattern, read from the frozen schema rather than copied, so
// this module can never drift from what a proof.json is actually allowed to contain.
export const LOGIN_RE = new RegExp(loadSchema("proof").properties.subject.properties.account.properties.login.pattern);

const NOREPLY_PATTERNS = {
  "github.com": /^(?:[0-9]+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/,
  "gitlab.com": /^[0-9]+-([A-Za-z0-9._-]+)@users\.noreply\.gitlab\.com$/,
};

// Lowercases ONLY the ASCII letters A-Z. String.prototype.toLowerCase() performs full
// Unicode case folding, which maps look-alike characters onto ASCII ones — most sharply,
// U+212A KELVIN SIGN ("K") folds to "k". A login comparison built on toLowerCase() would
// treat an account whose login is spelled with a Kelvin sign as the SAME account as the
// real ASCII login it merely looks like on screen, in a chain whose entire purpose is
// telling one account from another. Comparing only the 26 ASCII letters removes the
// equivalence class instead of trying to enumerate every look-alike in it.
function asciiLower(value) {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    out += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : value[i];
  }
  return out;
}

function assertAllowedAccount(account) {
  if (!account || typeof account !== "object") {
    throw new IdentityError("an account {host, login} is required to fetch public keys");
  }
  if (!ALLOWED_KEY_HOSTS.includes(account.host)) {
    throw new IdentityError(`host is not on the public-key fetch allowlist: ${account.host}`);
  }
  if (typeof account.login !== "string" || !LOGIN_RE.test(account.login)) {
    throw new IdentityError(`invalid login: ${JSON.stringify(account.login)}`);
  }
}

function isAcceptedKeyType(type) {
  return type === "ssh-ed25519" || type === "ssh-rsa" || type.startsWith("ecdsa-sha2-") || type.startsWith("sk-");
}

// Parses an OpenSSH authorized_keys-style listing (one key per line: "<type> <base64>
// [comment]") into the `"<type> <base64>"` pairs this module signs and verifies against.
// A forge's own `.keys` endpoint never emits comments or blank lines, but a hand-written
// --keys-file fixture may, so both are ignored here rather than left to trip up ssh-keygen.
// A line whose key type this skill does not recognize is skipped rather than rejected: a
// forge account can hold key types this module never checks (e.g. a legacy DSA key)
// alongside a supported one, and one unrecognized line should not sink every key on the
// account.
function parseKeysText(text) {
  const keys = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const [type, base64] = line.split(/\s+/);
    if (!type || !base64) continue;
    if (!isAcceptedKeyType(type)) continue;
    keys.push(`${type} ${base64}`);
  }
  return keys;
}

/**
 * Fetches the public SSH keys published for a forge account, as `"<type> <base64>"` lines.
 *
 * With `keysFile`, reads that local file instead and never touches the network — this is
 * the whole account argument, ignored entirely in this mode, so tests and offline use do
 * not need a real (or even schema-valid) account to exercise key parsing.
 *
 * Without `keysFile`, fetches `https://<host>/<login>.keys` — the forge's public,
 * unauthenticated, unthrottled listing of that account's signing keys — but only for a
 * host on `ALLOWED_KEY_HOSTS` and a login matching the schema's own pattern. Both are
 * checked before the URL is built, and the URL itself is built with `new URL(path, base)`
 * rather than string concatenation, so a login that fails validation never reaches a
 * fetch call at all.
 *
 * @param {{host: string, login: string}} account
 * @param {{keysFile?: string, timeoutMs?: number, fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<string[]>}
 */
export async function fetchAccountKeys(account, { keysFile, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  if (keysFile) {
    let text;
    try {
      text = readFileSync(keysFile, "utf8");
    } catch (err) {
      throw new IdentityError(`could not read keys file ${keysFile}: ${err.message}`, { cause: err });
    }
    return parseKeysText(text);
  }

  assertAllowedAccount(account);
  const url = new URL(`/${account.login}.keys`, `https://${account.host}`);

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "proof-skill" },
    });
  } catch (err) {
    throw new IdentityError(`fetching ${url} failed: ${err.message}`, { cause: err });
  }
  if (!response.ok) {
    throw new IdentityError(`fetching ${url} returned HTTP ${response.status}`);
  }
  return parseKeysText(await response.text());
}

/**
 * Checks a detached SSH signature over the exact bytes of proof.json against an account's
 * published keys, using `ssh-keygen -Y verify` — the same mechanism `git commit -S` and
 * GitHub's own SSH commit-signature verification use.
 *
 * Writes a throwaway `allowed_signers` file (one line per key: `"<login> <type> <base64>"`,
 * so the signing principal is the account's login) into a fresh temp directory, shells out,
 * and removes the directory before returning either way.
 *
 * Any failure to verify — a bad signature, a signature made under a different key or a
 * different namespace, a missing or unreadable signature file — is `ssh-keygen` exiting
 * non-zero, which this function reports as `"invalid"` rather than throwing: whether a
 * signature is good is exactly the fact this function exists to report as data, not as an
 * exception. The one exception is `ssh-keygen` itself being absent (ENOENT): that is an
 * environment problem, not a verdict on the proof, so it throws `IdentityError` and lets
 * the caller decide how to surface "verification could not run" as distinct from
 * "verification failed."
 *
 * @param {Buffer} proofBytes
 * @param {string} sigPath
 * @param {{host: string, login: string}} account
 * @param {string[]} keys
 * @returns {"valid" | "invalid"}
 */
export function verifySignature(proofBytes, sigPath, account, keys) {
  const workDir = mkdtempSync(path.join(os.tmpdir(), "proof-identity-"));
  try {
    const allowedSignersPath = path.join(workDir, "allowed_signers");
    const signersText = keys.map((keyLine) => `${account.login} ${keyLine}\n`).join("");
    writeFileSync(allowedSignersPath, signersText);

    try {
      execFileSync(
        "ssh-keygen",
        ["-Y", "verify", "-f", allowedSignersPath, "-I", account.login, "-n", SIGNATURE_NAMESPACE, "-s", sigPath],
        { input: proofBytes, timeout: 15000, stdio: ["pipe", "ignore", "ignore"] },
      );
      return "valid";
    } catch (err) {
      if (err && err.code === "ENOENT") {
        throw new IdentityError(
          "ssh-keygen is not installed or not on PATH; identity verification needs OpenSSH's ssh-keygen (8.0+) for `ssh-keygen -Y verify`",
          { cause: err },
        );
      }
      return "invalid";
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function matchNoreplyLogin(email, account) {
  const pattern = account && NOREPLY_PATTERNS[account.host];
  if (!pattern) return null;
  const m = email.match(pattern);
  return m ? m[1] : null;
}

async function bindOneEmail(email, account, lookupLogin) {
  if (!account) return { email, status: "unbound", method: "unknown" };

  const noreplyLogin = matchNoreplyLogin(email, account);
  if (noreplyLogin !== null) {
    const bound = asciiLower(noreplyLogin) === asciiLower(account.login);
    return { email, status: bound ? "bound" : "conflict", method: "noreply" };
  }

  if (typeof lookupLogin !== "function") {
    return { email, status: "unbound", method: "unknown" };
  }

  let login = null;
  try {
    login = await lookupLogin(email);
  } catch {
    login = null;
  }
  if (!login) return { email, status: "unbound", method: "unknown" };

  const bound = asciiLower(login) === asciiLower(account.login);
  return { email, status: bound ? "bound" : "conflict", method: "api" };
}

/**
 * Decides, per declared identity email, whether it belongs to the claimed forge account.
 *
 * A forge-noreply address (`<n>+login@users.noreply.github.com`,
 * `<n>-login@users.noreply.gitlab.com`) names its account inside the address itself, so it
 * is checked offline: the named login is compared against `account.login` by ASCII-only
 * lowercasing (see `asciiLower` above for why this must not be `toLowerCase()`). Any other
 * email cannot be bound offline — it is only as good as `lookupLogin`, which the caller
 * supplies (Lane B's is a GitHub-API lookup of who authored a cited commit under that
 * email). `lookupLogin` may be sync or async; a null/undefined result or a thrown error
 * both mean "could not tell", which is `"unbound"`, not `"conflict"` — a conflict is a
 * demonstrated mismatch, and an inability to check is not one.
 *
 * With no account at all (a fully redacted proof, or none declared), every email comes
 * back `unbound`/`unknown`: there is nothing to bind against, so no lookup is attempted.
 *
 * @param {string[]} identities
 * @param {{host: string, login: string} | null} account
 * @param {{lookupLogin?: (email: string) => (string|null) | Promise<string|null>}} [options]
 * @returns {Promise<Array<{email: string, status: "bound"|"unbound"|"conflict", method: "noreply"|"api"|"unknown"}>>}
 */
export async function bindEmails(identities, account, { lookupLogin } = {}) {
  const results = [];
  for (const email of identities) {
    results.push(await bindOneEmail(email, account ?? null, lookupLogin));
  }
  return results;
}

/**
 * Builds the schema's `identity` block — `{status, account, signature, emails}` — for one
 * proof, from the exact bytes that will be hashed into verification.json's `proof_sha256`.
 *
 * Status matrix (spec, restated as the branches below implement them):
 *   - no account, or no signature file            -> signature "absent", status "unbound"
 *   - signature present but does not verify        -> signature "invalid", status "conflict"
 *   - signature verifies, every email bound        -> signature "valid",   status "bound"
 *   - signature verifies, some email in conflict   -> signature "valid",   status "conflict"
 *   - signature verifies, otherwise                -> signature "valid",   status "unbound"
 *
 * Returns `{identity, notes}` rather than `identity` alone. The schema's identity block is
 * deliberately machine-shaped — status/account/signature/emails, no free-text field — so it
 * has nowhere to carry a human-readable reason. `notes` is where that reason goes: a
 * string[], usually empty, that the caller (verify-proof.mjs) appends to
 * verification.json's own top-level `notes` array. Today the only case that populates it is
 * a network failure fetching the account's keys, which is deliberately swallowed here
 * rather than thrown: it downgrades this proof's identity to "unbound" (the same as no
 * signature at all — never silently "valid"), and the rest of verification (evidence,
 * claims) still has every reason to proceed. A hard tooling problem — `ssh-keygen` itself
 * missing — is the opposite: `verifySignature` throws `IdentityError` and this function
 * lets it propagate, because that is not a fact about the proof at all, and the caller
 * should treat the whole verification run as inconclusive rather than reporting an identity
 * verdict its own environment was not equipped to compute.
 *
 * @param {{proofBytes: Buffer, sigPath?: string|null, account?: {host:string,login:string}|null,
 *   identities: string[], keysFile?: string, lookupLogin?: Function, fetchImpl?: typeof fetch}} args
 * @returns {Promise<{identity: object, notes: string[]}>}
 */
export async function bindIdentity({
  proofBytes,
  sigPath = null,
  account = null,
  identities = [],
  keysFile,
  lookupLogin,
  fetchImpl,
} = {}) {
  const notes = [];
  const accountBlock = account ? { host: account.host, login: account.login } : null;
  const sigPresent = Boolean(account) && Boolean(sigPath) && existsSync(sigPath);

  if (!sigPresent) {
    const emails = await bindEmails(identities, account, { lookupLogin });
    return { identity: { status: "unbound", account: accountBlock, signature: "absent", emails }, notes };
  }

  let keys;
  try {
    keys = await fetchAccountKeys(account, { keysFile, fetchImpl });
  } catch (err) {
    notes.push(`could not fetch public keys for ${account.host}/${account.login}: ${err.message}`);
    const emails = await bindEmails(identities, account, { lookupLogin });
    return { identity: { status: "unbound", account: accountBlock, signature: "absent", emails }, notes };
  }

  // Not caught: ssh-keygen missing is an environment fact, not a proof fact (see the
  // JSDoc above), and propagates out of this function on purpose.
  const signature = verifySignature(proofBytes, sigPath, account, keys);
  const emails = await bindEmails(identities, account, { lookupLogin });

  if (signature === "invalid") {
    return { identity: { status: "conflict", account: accountBlock, signature: "invalid", emails }, notes };
  }

  const hasConflict = emails.some((e) => e.status === "conflict");
  const allBound = emails.length > 0 && emails.every((e) => e.status === "bound");
  const status = hasConflict ? "conflict" : allBound ? "bound" : "unbound";
  return { identity: { status, account: accountBlock, signature: "valid", emails }, notes };
}
