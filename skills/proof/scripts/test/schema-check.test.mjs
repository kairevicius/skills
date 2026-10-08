import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkSchema, loadSchema, currentVersion, acceptedVersion } from "../lib/schema-check.mjs";

const schema = loadSchema();
const exampleUrl = new URL("../../fixtures/proof.example.json", import.meta.url);
const exampleBytes = readFileSync(exampleUrl);
const example = JSON.parse(exampleBytes);
const verificationSchema = loadSchema("verification");
const verificationExample = JSON.parse(
  readFileSync(new URL("../../fixtures/verification.example.json", import.meta.url), "utf8"),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function findingAt(findings, path) {
  return findings.find((f) => f.path === path);
}

test("the shipped example is a valid 0.3.0 document with zero findings", () => {
  const findings = checkSchema(schema, example);
  assert.deepEqual(findings, []);
});

test("currentVersion reads the schema's declared default", () => {
  assert.equal(currentVersion(schema), "0.3.0");
});

test("acceptedVersion accepts only 0.3.x", () => {
  const accepted = acceptedVersion(schema);
  assert.equal(accepted.test("0.3.0"), true);
  assert.equal(accepted.test("0.3.7"), true);
  assert.equal(accepted.test("0.2.0"), false);
  assert.equal(accepted.test("0.1.2"), false);
  assert.equal(accepted.test("1.0.0"), false);
});

test("the verification example is valid and bound to the exact bytes of the proof example", () => {
  assert.deepEqual(checkSchema(verificationSchema, verificationExample), []);
  const sha = createHash("sha256").update(exampleBytes).digest("hex");
  assert.equal(verificationExample.proof_sha256, sha, "editing proof.example.json requires re-binding verification.example.json");
  assert.deepEqual(verificationExample.claims.map((c) => c.id), example.claims.map((c) => c.id));
  assert.deepEqual(verificationExample.evidence.map((e) => e.id), example.evidence.map((e) => e.id));
});

test("identities must be exact ASCII emails: substrings, handles, and look-alikes are rejected", () => {
  for (const bad of ["@", "example.com", "ada", "\u212Aada@example.dev"]) {
    const doc = clone(example);
    doc.subject.identities = [bad];
    assert.ok(findingAt(checkSchema(schema, doc), "/subject/identities/0"), `accepted ${JSON.stringify(bad)}`);
  }
});

test("the removed self-attestation field is rejected", () => {
  const doc = clone(example);
  doc.provenance.verification = "git_verified";
  assert.ok(findingAt(checkSchema(schema, doc), "/provenance/verification"));
});

test("a remote carrying credentials is rejected", () => {
  const doc = clone(example);
  doc.repository.remote = "https://user:ghp_0123456789@github.com/org/repo.git";
  assert.ok(findingAt(checkSchema(schema, doc), "/repository/remote"));
});

test("maxItems caps the number of claims", () => {
  const doc = clone(example);
  doc.claims = Array.from({ length: 31 }, (_, i) => ({ ...example.claims[0], id: `c${i + 1}` }));
  assert.ok(findingAt(checkSchema(schema, doc), "/claims"));
});

test("missing required property is reported at its own path", () => {
  const doc = clone(example);
  delete doc.subject.name;
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/subject/name"), JSON.stringify(findings));
});

test("additionalProperties: false is enforced at the top level", () => {
  const doc = clone(example);
  doc.not_a_real_field = "x";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/not_a_real_field"), JSON.stringify(findings));
});

test("additionalProperties: false is enforced on a nested object", () => {
  const doc = clone(example);
  doc.subject.not_a_real_field = "x";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/subject/not_a_real_field"), JSON.stringify(findings));
});

test("wrong type is reported at the offending path", () => {
  const doc = clone(example);
  doc.summary.authored_commits = "412"; // schema wants an integer
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/summary/authored_commits"), JSON.stringify(findings));
});

test("a type array including null accepts null and rejects other mismatched types", () => {
  const acceptsNull = clone(example);
  acceptsNull.repository.name = null;
  const okFindings = checkSchema(schema, acceptsNull);
  assert.equal(findingAt(okFindings, "/repository/name"), undefined, JSON.stringify(okFindings));

  const rejectsNumber = clone(example);
  rejectsNumber.repository.remote = 123; // type is ["string", "null"]
  const badFindings = checkSchema(schema, rejectsNumber);
  assert.ok(findingAt(badFindings, "/repository/remote"), JSON.stringify(badFindings));
});

test("enum miss is reported at the offending path", () => {
  const doc = clone(example);
  doc.claims[0].category = "not_a_real_category";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/claims/0/category"), JSON.stringify(findings));
});

test("pattern miss on proof_version is reported", () => {
  const doc = clone(example);
  doc.proof_version = "1.0.0";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/proof_version"), JSON.stringify(findings));
});

test("minItems violation on gaps is reported", () => {
  const doc = clone(example);
  doc.gaps = [];
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/gaps"), JSON.stringify(findings));
});

test("minLength violation is reported", () => {
  const doc = clone(example);
  doc.subject.name = "";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/subject/name"), JSON.stringify(findings));
});

test("maxLength violation on claims[].short is reported", () => {
  const doc = clone(example);
  doc.claims[0].short = "a".repeat(161);
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/claims/0/short"), JSON.stringify(findings));
});

test("minimum violation on confidence is reported", () => {
  const doc = clone(example);
  doc.claims[0].confidence = 0.4;
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/claims/0/confidence"), JSON.stringify(findings));
});

test("maximum violation on confidence is reported", () => {
  const doc = clone(example);
  doc.claims[0].confidence = 1.2;
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/claims/0/confidence"), JSON.stringify(findings));
});

test("format: date rejects a calendar-invalid date", () => {
  const doc = clone(example);
  doc.repository.first_authored_commit = "2026-13-99";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/repository/first_authored_commit"), JSON.stringify(findings));
});

test("format: date-time rejects a non-RFC-3339 string", () => {
  const doc = clone(example);
  doc.repository.analyzed_at = "not-a-date-time";
  const findings = checkSchema(schema, doc);
  assert.ok(findingAt(findings, "/repository/analyzed_at"), JSON.stringify(findings));
});
