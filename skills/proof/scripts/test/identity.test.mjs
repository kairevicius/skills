import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_KEY_HOSTS,
  IdentityError,
  LOGIN_RE,
  SIGNATURE_NAMESPACE,
  fetchAccountKeys,
  verifySignature,
  bindEmails,
  bindIdentity,
} from "../lib/identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGN_PROOF_CLI = path.join(__dirname, "..", "sign-proof.mjs");

// `ssh-keygen -lf -` on empty stdin fails (it is not a key), but that failure alone tells
// us the binary was found at all; ENOENT is the one error that means it was not.
function hasSshKeygen() {
  try {
    execFileSync("ssh-keygen", ["-lf", "-"], { input: "", stdio: ["pipe", "ignore", "ignore"] });
  } catch (err) {
    return err.code !== "ENOENT";
  }
  return true;
}

const SSH_KEYGEN_AVAILABLE = hasSshKeygen();
const needsSshKeygen = SSH_KEYGEN_AVAILABLE ? {} : { skip: "ssh-keygen is not installed on PATH" };

let workDir;
let keyA; // the "real" / published key
let keyB; // a different key, used for mismatch cases

before(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "proof-identity-test-"));
  if (SSH_KEYGEN_AVAILABLE) {
    keyA = genKeypair(workDir, "key-a");
    keyB = genKeypair(workDir, "key-b");
  }
});

after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // best-effort; the OS temp dir gets reaped regardless
  }
});

function freshDir(label) {
  const dir = mkdtempSync(path.join(workDir, `${label}-`));
  return dir;
}

function genKeypair(dir, name) {
  const priv = path.join(dir, name);
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", priv, "-C", name]);
  const pubLine = readFileSync(`${priv}.pub`, "utf8").trim().split(/\s+/).slice(0, 2).join(" ");
  return { priv, pub: `${priv}.pub`, pubLine };
}

// Writes `bytes` to <dir>/<filename>, signs that exact file with `privPath`, and returns
// both the bytes and the resulting .sig path — so callers verify against the very buffer
// that was signed, never a re-serialized copy of it.
function signBytes(dir, filename, bytes, privPath) {
  const filePath = path.join(dir, filename);
  writeFileSync(filePath, bytes);
  execFileSync("ssh-keygen", ["-Y", "sign", "-f", privPath, "-n", SIGNATURE_NAMESPACE, filePath]);
  return { filePath, sigPath: `${filePath}.sig` };
}

function writeKeysFile(dir, name, pubLines) {
  const file = path.join(dir, name);
  writeFileSync(file, `${pubLines.join("\n")}\n`);
  return file;
}

describe("verifySignature", needsSshKeygen, () => {
  test("a signature over the exact bytes verifies against the signer's own key", () => {
    const dir = freshDir("verify-ok");
    const bytes = Buffer.from(JSON.stringify({ hello: "world" }));
    const { sigPath } = signBytes(dir, "proof.json", bytes, keyA.priv);
    const result = verifySignature(bytes, sigPath, { host: "github.com", login: "ada" }, [keyA.pubLine]);
    assert.equal(result, "valid");
  });

  test("changing the bytes after signing invalidates the signature", () => {
    const dir = freshDir("verify-tampered");
    const original = Buffer.from(JSON.stringify({ hello: "world" }));
    const { sigPath } = signBytes(dir, "proof.json", original, keyA.priv);
    const tampered = Buffer.from(JSON.stringify({ hello: "world!" }));
    const result = verifySignature(tampered, sigPath, { host: "github.com", login: "ada" }, [keyA.pubLine]);
    assert.equal(result, "invalid");
  });

  test("a signature made by a different key does not verify against this one", () => {
    const dir = freshDir("verify-wrongkey");
    const bytes = Buffer.from(JSON.stringify({ hello: "world" }));
    const { sigPath } = signBytes(dir, "proof.json", bytes, keyB.priv);
    // allowed_signers only lists key A's line under the "ada" principal, so a signature
    // made with key B cannot verify even though the bytes are untouched.
    const result = verifySignature(bytes, sigPath, { host: "github.com", login: "ada" }, [keyA.pubLine]);
    assert.equal(result, "invalid");
  });

  test("ssh-keygen missing from PATH throws IdentityError instead of reporting invalid", () => {
    const dir = freshDir("verify-noenoent");
    const bytes = Buffer.from(JSON.stringify({ hello: "world" }));
    const { sigPath } = signBytes(dir, "proof.json", bytes, keyA.priv);
    const savedPath = process.env.PATH;
    process.env.PATH = "";
    try {
      assert.throws(
        () => verifySignature(bytes, sigPath, { host: "github.com", login: "ada" }, [keyA.pubLine]),
        IdentityError,
      );
    } finally {
      process.env.PATH = savedPath;
    }
  });
});

describe("fetchAccountKeys", () => {
  test("a keys file with comments and blank lines is parsed, ignoring both", () => {
    const dir = freshDir("keysfile");
    const file = writeKeysFile(dir, "ada.keys", [
      "# this is a comment",
      "",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB ada@laptop",
      "   ",
      "# another comment",
      "ecdsa-sha2-nistp256 AAAACCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC ada@desktop",
    ]);
    return fetchAccountKeys({ host: "github.com", login: "ada" }, { keysFile: file }).then((keys) => {
      assert.deepEqual(keys, [
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        "ecdsa-sha2-nistp256 AAAACCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      ]);
    });
  });

  test("an unsupported key type in a keys file is skipped, not fatal", async () => {
    const dir = freshDir("keysfile-unsupported");
    const file = writeKeysFile(dir, "ada.keys", [
      "ssh-dss AAAADEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF ada@legacy",
      "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB ada@laptop",
    ]);
    const keys = await fetchAccountKeys({ host: "github.com", login: "ada" }, { keysFile: file });
    assert.deepEqual(keys, ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"]);
  });

  test("refuses a host that is not on the allowlist", async () => {
    await assert.rejects(fetchAccountKeys({ host: "evil.example.com", login: "ada" }), IdentityError);
  });

  test("refuses a login that does not match the schema's own pattern", async () => {
    await assert.rejects(fetchAccountKeys({ host: "github.com", login: "../etc/passwd" }), IdentityError);
    await assert.rejects(fetchAccountKeys({ host: "github.com", login: "" }), IdentityError);
    await assert.rejects(fetchAccountKeys({ host: "github.com", login: "has a space" }), IdentityError);
  });

  test("ALLOWED_KEY_HOSTS matches the three forges this skill knows how to bind", () => {
    assert.deepEqual([...ALLOWED_KEY_HOSTS].sort(), ["codeberg.org", "github.com", "gitlab.com"]);
  });

  test("uses an injected fetchImpl and requests exactly https://github.com/ada.keys", async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, text: async () => "ssh-ed25519 AAAAINJECTED injected@test\n" };
    };
    const keys = await fetchAccountKeys({ host: "github.com", login: "ada" }, { fetchImpl });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://github.com/ada.keys");
    assert.deepEqual(keys, ["ssh-ed25519 AAAAINJECTED"]);
  });

  test("a non-ok HTTP response is rejected rather than treated as zero keys", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "Not Found" });
    await assert.rejects(fetchAccountKeys({ host: "github.com", login: "nobody-at-all" }, { fetchImpl }), IdentityError);
  });

  test("a network failure from fetchImpl is wrapped, not swallowed", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    };
    await assert.rejects(fetchAccountKeys({ host: "github.com", login: "ada" }, { fetchImpl }), IdentityError);
  });
});

describe("bindEmails", () => {
  test("a GitHub noreply email bound to the matching account login", async () => {
    const result = await bindEmails(["12345+ada@users.noreply.github.com"], { host: "github.com", login: "ada" });
    assert.deepEqual(result, [{ email: "12345+ada@users.noreply.github.com", status: "bound", method: "noreply" }]);
  });

  test("a GitLab noreply email bound to the matching account login", async () => {
    const result = await bindEmails(["999-ada@users.noreply.gitlab.com"], { host: "gitlab.com", login: "ada" });
    assert.deepEqual(result, [{ email: "999-ada@users.noreply.gitlab.com", status: "bound", method: "noreply" }]);
  });

  test("ordinary ASCII case differences still bind (only look-alikes must not)", async () => {
    const result = await bindEmails(["1+ada@users.noreply.github.com"], { host: "github.com", login: "ADA" });
    assert.equal(result[0].status, "bound");
  });

  test("a noreply email naming a different login is a conflict", async () => {
    const result = await bindEmails(["12345+mallory@users.noreply.github.com"], { host: "github.com", login: "ada" });
    assert.deepEqual(result, [{ email: "12345+mallory@users.noreply.github.com", status: "conflict", method: "noreply" }]);
  });

  test("a Kelvin-sign look-alike login never binds, even though String#toLowerCase() would fold it", async () => {
    const kelvinLogin = "\u212Aelvin"; // KELVIN SIGN + "elvin" — renders identically to "Kelvin"
    assert.equal(kelvinLogin.toLowerCase(), "kelvin"); // the exact JS footgun this guards against
    assert.notEqual(kelvinLogin, "Kelvin");

    const result = await bindEmails(["1+kelvin@users.noreply.github.com"], { host: "github.com", login: kelvinLogin });
    assert.equal(result[0].status, "conflict", "a look-alike login must not be treated as the real ASCII login");
  });

  test("non-noreply email resolved via lookupLogin: equal login binds", async () => {
    const result = await bindEmails(["ada@example.dev"], { host: "github.com", login: "ada" }, {
      lookupLogin: async () => "ADA", // ASCII case difference only
    });
    assert.deepEqual(result, [{ email: "ada@example.dev", status: "bound", method: "api" }]);
  });

  test("non-noreply email resolved via lookupLogin: different login conflicts", async () => {
    const result = await bindEmails(["ada@example.dev"], { host: "github.com", login: "ada" }, {
      lookupLogin: async () => "mallory",
    });
    assert.deepEqual(result, [{ email: "ada@example.dev", status: "conflict", method: "api" }]);
  });

  test("non-noreply email resolved via lookupLogin: null result is unbound, not conflict", async () => {
    const result = await bindEmails(["ada@example.dev"], { host: "github.com", login: "ada" }, {
      lookupLogin: async () => null,
    });
    assert.deepEqual(result, [{ email: "ada@example.dev", status: "unbound", method: "unknown" }]);
  });

  test("non-noreply email resolved via lookupLogin: a throw is unbound, not fatal", async () => {
    const result = await bindEmails(["ada@example.dev"], { host: "github.com", login: "ada" }, {
      lookupLogin: async () => {
        throw new Error("network down");
      },
    });
    assert.deepEqual(result, [{ email: "ada@example.dev", status: "unbound", method: "unknown" }]);
  });

  test("without lookupLogin, a non-noreply email is unbound/unknown", async () => {
    const result = await bindEmails(["ada@example.dev"], { host: "github.com", login: "ada" });
    assert.deepEqual(result, [{ email: "ada@example.dev", status: "unbound", method: "unknown" }]);
  });

  test("with no account at all, every email is unbound/unknown and lookupLogin is never called", async () => {
    let called = false;
    const result = await bindEmails(["ada@example.dev"], null, {
      lookupLogin: async () => {
        called = true;
        return "ada";
      },
    });
    assert.deepEqual(result, [{ email: "ada@example.dev", status: "unbound", method: "unknown" }]);
    assert.equal(called, false);
  });
});

describe("bindIdentity", () => {
  test("no account at all -> unbound, signature absent, emails still computed", async () => {
    const { identity, notes } = await bindIdentity({
      proofBytes: Buffer.from("{}"),
      sigPath: null,
      account: null,
      identities: ["ada@example.dev"],
    });
    assert.deepEqual(identity, {
      status: "unbound",
      account: null,
      signature: "absent",
      emails: [{ email: "ada@example.dev", status: "unbound", method: "unknown" }],
    });
    assert.deepEqual(notes, []);
  });

  test("account present but no signature file -> unbound, signature absent", async () => {
    const dir = freshDir("bind-nosig");
    const { identity } = await bindIdentity({
      proofBytes: Buffer.from("{}"),
      sigPath: path.join(dir, "does-not-exist.sig"),
      account: { host: "github.com", login: "ada" },
      identities: ["1+ada@users.noreply.github.com"],
    });
    assert.equal(identity.signature, "absent");
    assert.equal(identity.status, "unbound");
    assert.equal(identity.account.login, "ada");
    // the email binding itself is still reported even though the overall status can't
    // be "bound" without a valid signature.
    assert.equal(identity.emails[0].status, "bound");
  });

  test("a key-fetch network failure is swallowed into unbound/absent, with a note", async () => {
    const dir = freshDir("bind-netfail");
    const bytes = Buffer.from("{}");
    writeFileSync(path.join(dir, "proof.json.sig"), "not a real signature\n");
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    };
    const { identity, notes } = await bindIdentity({
      proofBytes: bytes,
      sigPath: path.join(dir, "proof.json.sig"),
      account: { host: "github.com", login: "ada" },
      identities: ["ada@example.dev"],
      fetchImpl,
    });
    assert.equal(identity.status, "unbound");
    assert.equal(identity.signature, "absent");
    assert.ok(notes.length >= 1);
    assert.match(notes[0], /could not fetch public keys/);
  });

  test(
    "valid signature and every email bound -> status bound, signature valid",
    needsSshKeygen,
    async () => {
      const dir = freshDir("bind-bound");
      const bytes = Buffer.from(JSON.stringify({ n: 1 }));
      const { sigPath } = signBytes(dir, "proof.json", bytes, keyA.priv);
      const { identity, notes } = await bindIdentity({
        proofBytes: bytes,
        sigPath,
        account: { host: "github.com", login: "ada" },
        identities: ["1+ada@users.noreply.github.com"],
        keysFile: writeKeysFile(dir, "ada.keys", [keyA.pubLine]),
      });
      assert.equal(identity.signature, "valid");
      assert.equal(identity.status, "bound");
      assert.deepEqual(notes, []);
    },
  );

  test(
    "valid signature but one email conflicts -> status conflict, signature stays valid",
    needsSshKeygen,
    async () => {
      const dir = freshDir("bind-emailconflict");
      const bytes = Buffer.from(JSON.stringify({ n: 1 }));
      const { sigPath } = signBytes(dir, "proof.json", bytes, keyA.priv);
      const { identity } = await bindIdentity({
        proofBytes: bytes,
        sigPath,
        account: { host: "github.com", login: "ada" },
        identities: ["1+ada@users.noreply.github.com", "2+mallory@users.noreply.github.com"],
        keysFile: writeKeysFile(dir, "ada.keys", [keyA.pubLine]),
      });
      assert.equal(identity.signature, "valid");
      assert.equal(identity.status, "conflict");
    },
  );

  test(
    "valid signature but an email cannot be bound -> status unbound, signature stays valid",
    needsSshKeygen,
    async () => {
      const dir = freshDir("bind-emailunbound");
      const bytes = Buffer.from(JSON.stringify({ n: 1 }));
      const { sigPath } = signBytes(dir, "proof.json", bytes, keyA.priv);
      const { identity } = await bindIdentity({
        proofBytes: bytes,
        sigPath,
        account: { host: "github.com", login: "ada" },
        identities: ["ada@example.dev"], // not a noreply address, and no lookupLogin given
        keysFile: writeKeysFile(dir, "ada.keys", [keyA.pubLine]),
      });
      assert.equal(identity.signature, "valid");
      assert.equal(identity.status, "unbound");
    },
  );

  test(
    "a signature that fails to verify -> status conflict, signature invalid",
    needsSshKeygen,
    async () => {
      const dir = freshDir("bind-badsig");
      const bytes = Buffer.from(JSON.stringify({ n: 1 }));
      // signed by key B, but only key A is on the account
      const { sigPath } = signBytes(dir, "proof.json", bytes, keyB.priv);
      const { identity } = await bindIdentity({
        proofBytes: bytes,
        sigPath,
        account: { host: "github.com", login: "ada" },
        identities: ["1+ada@users.noreply.github.com"],
        keysFile: writeKeysFile(dir, "ada.keys", [keyA.pubLine]),
      });
      assert.equal(identity.signature, "invalid");
      assert.equal(identity.status, "conflict");
    },
  );

  test(
    "ssh-keygen missing propagates out of bindIdentity instead of being reported as a proof fact",
    needsSshKeygen,
    async () => {
      const dir = freshDir("bind-noenoent");
      const bytes = Buffer.from(JSON.stringify({ n: 1 }));
      const { sigPath } = signBytes(dir, "proof.json", bytes, keyA.priv);
      const savedPath = process.env.PATH;
      process.env.PATH = "";
      try {
        await assert.rejects(
          bindIdentity({
            proofBytes: bytes,
            sigPath,
            account: { host: "github.com", login: "ada" },
            identities: ["1+ada@users.noreply.github.com"],
            keysFile: writeKeysFile(dir, "ada.keys", [keyA.pubLine]),
          }),
          IdentityError,
        );
      } finally {
        process.env.PATH = savedPath;
      }
    },
  );
});

describe("sign-proof.mjs (CLI, end to end)", needsSshKeygen, () => {
  test("signs with --key <private> and --keys-file, exits 0, and the .sig verifies", () => {
    const dir = freshDir("cli-ok");
    const proofPath = path.join(dir, "proof.json");
    writeFileSync(proofPath, JSON.stringify({ subject: { name: "Ada" } }));
    const keysFile = writeKeysFile(dir, "ada.keys", [keyA.pubLine]);

    const stdout = execFileSync(
      process.execPath,
      [SIGN_PROOF_CLI, proofPath, "--account", "github.com/ada", "--key", keyA.priv, "--keys-file", keysFile],
      { encoding: "utf8" },
    );

    assert.match(stdout, /^signed: .*\.sig \(verified against github\.com\/ada\)/m);
    assert.ok(existsSync(`${proofPath}.sig`));
    const verdict = verifySignature(readFileSync(proofPath), `${proofPath}.sig`, { host: "github.com", login: "ada" }, [
      keyA.pubLine,
    ]);
    assert.equal(verdict, "valid");
  });

  test("a --key not published on the account exits 1 with the account's fingerprints", () => {
    const dir = freshDir("cli-nomatch");
    const proofPath = path.join(dir, "proof.json");
    writeFileSync(proofPath, JSON.stringify({ subject: { name: "Ada" } }));
    const keysFile = writeKeysFile(dir, "ada.keys", [keyA.pubLine]); // only key A is "published"

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [SIGN_PROOF_CLI, proofPath, "--account", "github.com/ada", "--key", keyB.priv, "--keys-file", keysFile],
          { encoding: "utf8" },
        ),
      (err) => {
        assert.equal(err.status, 1);
        assert.match(err.stderr, /no local key matches/);
        assert.match(err.stderr, /Its published keys:/);
        return true;
      },
    );
    assert.ok(!existsSync(`${proofPath}.sig`));
  });

  test("--help exits 0 and documents --account, --key, and --keys-file", () => {
    const stdout = execFileSync(process.execPath, [SIGN_PROOF_CLI, "--help"], { encoding: "utf8" });
    assert.match(stdout, /--account <host>\/<login>/);
    assert.match(stdout, /--key <path>/);
    assert.match(stdout, /--keys-file <path>/);
  });

  test("an unsupported --account host is rejected before any key is touched", () => {
    const dir = freshDir("cli-badhost");
    const proofPath = path.join(dir, "proof.json");
    writeFileSync(proofPath, "{}");
    assert.throws(
      () =>
        execFileSync(process.execPath, [SIGN_PROOF_CLI, proofPath, "--account", "evil.example.com/ada"], {
          encoding: "utf8",
        }),
      (err) => {
        assert.equal(err.status, 1);
        assert.match(err.stderr, /--account host must be one of/);
        return true;
      },
    );
  });
});

describe("LOGIN_RE (shared with schema/proof.schema.json)", () => {
  test("accepts a typical forge login and rejects the schema's own known-bad cases", () => {
    assert.equal(LOGIN_RE.test("ada"), true);
    assert.equal(LOGIN_RE.test("ada-lovelace"), true);
    assert.equal(LOGIN_RE.test(""), false);
    assert.equal(LOGIN_RE.test("has a space"), false);
    assert.equal(LOGIN_RE.test("../etc/passwd"), false);
    assert.equal(LOGIN_RE.test("a".repeat(40)), false); // 1 + 38 max, this is one too many
  });
});
