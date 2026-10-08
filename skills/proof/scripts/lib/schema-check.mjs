// Zero-dependency validator for the JSON-Schema (draft 2020-12) SUBSET that
// the schema/*.schema.json files actually use: type (string or array,
// including "null"; "integer" via Number.isInteger), required, properties,
// additionalProperties: false, enum, pattern, minimum, maximum, minItems,
// maxItems, minLength, maxLength, items (a single schema applied to every
// element), and format ("date", "date-time"). $schema/title/description/default
// are annotations only and are never inspected.
import { readFileSync } from "node:fs";

const TYPE_CHECKS = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  null: (v) => v === null,
};

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(value, type) {
  const check = TYPE_CHECKS[type];
  return check ? check(value) : false;
}

// Primitives only (per the schema's own use of enum), but recurses into
// arrays/objects defensively rather than assuming.
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a), bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// A regex match alone accepts calendar nonsense like 2026-13-99; round-tripping
// through Date.UTC catches that because UTC field overflow silently rolls the
// date forward instead of throwing.
function isValidCalendarDate(str) {
  if (!DATE_RE.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function isValidDateTime(str) {
  return DATE_TIME_RE.test(str) && !Number.isNaN(Date.parse(str));
}

/**
 * Validate `value` against `schema` and return every finding as
 * {path, message}, where `path` is a JSON pointer (e.g. "/claims/0/confidence").
 * An empty array means the value is valid. Unknown keywords are ignored.
 */
export function checkSchema(schema, value, path = "") {
  const findings = [];
  if (!schema || typeof schema !== "object") return findings;

  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      findings.push({ path, message: `expected type ${types.join(" or ")} but got ${typeOf(value)}` });
      return findings; // the remaining keywords all assume the declared shape
    }
  }

  if ("enum" in schema && !schema.enum.some((e) => deepEqual(e, value))) {
    findings.push({ path, message: `value is not one of the allowed values: ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}` });
  }

  if (typeof value === "string") {
    if ("pattern" in schema && !new RegExp(schema.pattern).test(value)) {
      findings.push({ path, message: `does not match pattern ${schema.pattern}` });
    }
    if ("minLength" in schema && value.length < schema.minLength) {
      findings.push({ path, message: `length ${value.length} is below minLength ${schema.minLength}` });
    }
    if ("maxLength" in schema && value.length > schema.maxLength) {
      findings.push({ path, message: `length ${value.length} is above maxLength ${schema.maxLength}` });
    }
    if (schema.format === "date" && !isValidCalendarDate(value)) {
      findings.push({ path, message: "is not a valid date (expected YYYY-MM-DD)" });
    }
    if (schema.format === "date-time" && !isValidDateTime(value)) {
      findings.push({ path, message: "is not a valid RFC 3339 date-time" });
    }
  }

  if (typeof value === "number") {
    if ("minimum" in schema && value < schema.minimum) {
      findings.push({ path, message: `${value} is below minimum ${schema.minimum}` });
    }
    if ("maximum" in schema && value > schema.maximum) {
      findings.push({ path, message: `${value} is above maximum ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if ("minItems" in schema && value.length < schema.minItems) {
      findings.push({ path, message: `has ${value.length} item(s), below minItems ${schema.minItems}` });
    }
    if ("maxItems" in schema && value.length > schema.maxItems) {
      findings.push({ path, message: `has ${value.length} item(s), above maxItems ${schema.maxItems}` });
    }
    if ("items" in schema) {
      value.forEach((item, i) => findings.push(...checkSchema(schema.items, item, `${path}/${i}`)));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!(key in value)) findings.push({ path: `${path}/${key}`, message: "required property is missing" });
      }
    }
    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        if (key in value) findings.push(...checkSchema(schema.properties[key], value[key], `${path}/${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) findings.push({ path: `${path}/${key}`, message: "additional property is not allowed" });
      }
    }
  }

  return findings;
}

/** Reads schema/<name>.schema.json relative to this module — the one copy on disk. */
export function loadSchema(name = "proof") {
  const url = new URL(`../../schema/${name}.schema.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

/** The version this skill currently emits: the schema's `default` for the version key. */
export function currentVersion(schema, key = "proof_version") {
  return schema.properties[key].default;
}

/** The range of versions the skill accepts for the version key, as a RegExp. */
export function acceptedVersion(schema, key = "proof_version") {
  return new RegExp(schema.properties[key].pattern);
}
