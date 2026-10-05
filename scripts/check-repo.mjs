#!/usr/bin/env node
/**
 * Structural checks for the skills repository, run in CI before the tests. Each check
 * guards a failure that is silent otherwise: a skill the installer skips, a README that
 * drifts from the canonical install block, or wording that ties a skill to one agent.
 *
 *   node scripts/check-repo.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const errors = [];
const fail = (message) => errors.push(message);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);

/** The code inside each `<canonical-block name="...">` of the install block. */
function installBlocks() {
    const text = read(".agents/install-block.md");
    const blocks = {};
    for (const match of text.matchAll(/<canonical-block name="([^"]+)">([\s\S]*?)<\/canonical-block>/g)) {
        const code = match[2].match(/```[a-z]*\n([\s\S]*?)```/);
        if (code) blocks[match[1]] = code[1].trim();
    }
    return blocks;
}

/** The frontmatter fields of a SKILL.md, or null when the delimiters are missing. */
function frontmatter(text) {
    const match = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) return null;
    const fields = {};
    for (const line of match[1].split("\n")) {
        const field = line.match(/^([a-z-]+):\s?(.*)$/);
        if (field) fields[field[1]] = field[2];
    }
    return fields;
}

const readme = read("README.md");
const siteIndex = read("sites/index.html");
const blocks = installBlocks();

if (!blocks["whole-set"] || !blocks["one-skill"]) fail(".agents/install-block.md needs the canonical blocks \"whole-set\" and \"one-skill\"");
else {
    // Whole lines, because the whole-set command is a prefix of the one-skill command.
    const lines = readme.split("\n").map((l) => l.trim());
    if (!lines.includes(blocks["whole-set"])) fail(`README.md must contain the whole-set install command on its own line: ${blocks["whole-set"]}`);
    const oneSkill = new RegExp(`^${escapeRegExp(blocks["one-skill"]).replace("<skill>", "[a-z0-9-]+")}$`);
    if (!lines.some((l) => oneSkill.test(l))) fail(`README.md must contain the one-skill install command on its own line, in the form: ${blocks["one-skill"]}`);
    if (!siteIndex.includes(blocks["whole-set"])) fail(`sites/index.html must show the whole-set install command: ${blocks["whole-set"]}`);
}

const skillDirs = readdirSync(join(ROOT, "skills")).filter((name) => statSync(join(ROOT, "skills", name)).isDirectory());
if (skillDirs.length === 0) fail("skills/ has no skill folders");

const AGENT_SPECIFIC = [/~\/\.claude\/skills/, /-a claude-code/, /\.claude\/skills\//];
const label = (pattern) => pattern.source.replace(/\\/g, "");

for (const name of skillDirs) {
    const dir = `skills/${name}`;
    if (!existsSync(join(ROOT, dir, "SKILL.md"))) { fail(`${dir}: SKILL.md is missing`); continue; }
    const fields = frontmatter(read(`${dir}/SKILL.md`));
    if (!fields) { fail(`${dir}/SKILL.md: the frontmatter must open and close with ---`); continue; }
    if (fields.name !== name) fail(`${dir}/SKILL.md: name is "${fields.name}", but the folder is "${name}"`);
    const description = fields.description ?? "";
    if (!description) fail(`${dir}/SKILL.md: description is missing`);
    // An unquoted colon followed by a space is invalid YAML, and the skills CLI then skips the skill.
    else if (!/^".*"$/.test(description) && description.includes(": ")) fail(`${dir}/SKILL.md: quote the description, because it contains ": "`);

    const yamlPath = `${dir}/agents/openai.yaml`;
    if (!existsSync(join(ROOT, yamlPath))) fail(`${yamlPath} is missing`);
    else {
        const yaml = read(yamlPath);
        if (!/display_name:\s*\S/.test(yaml)) fail(`${yamlPath}: interface.display_name is missing`);
        if (!/short_description:\s*\S/.test(yaml)) fail(`${yamlPath}: interface.short_description is missing`);
        const userInvoked = fields["disable-model-invocation"] === "true";
        const noImplicit = /allow_implicit_invocation:\s*false/.test(yaml);
        if (userInvoked !== noImplicit) fail(`${dir}: set disable-model-invocation in SKILL.md and allow_implicit_invocation: false in agents/openai.yaml together, or neither`);
    }

    if (!readme.includes(`[${name}](./skills/${name}/SKILL.md)`)) fail(`README.md: the Reference list must link ${name} to ./skills/${name}/SKILL.md`);
    if (!siteIndex.includes(name)) fail(`sites/index.html must list ${name}`);

    // The skill must read the same for every agent: no one harness's install path or flag.
    for (const file of readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".md"))) {
        const text = read(`${dir}/${file}`);
        for (const pattern of AGENT_SPECIFIC) {
            if (pattern.test(text)) fail(`${dir}/${file}: remove the agent-specific "${label(pattern)}"; name agents only as examples`);
        }
    }
}
for (const pattern of AGENT_SPECIFIC) {
    if (pattern.test(readme)) fail(`README.md: remove the agent-specific "${label(pattern)}"`);
}

if (errors.length) {
    for (const message of errors) console.error(`check-repo: ${message}`);
    process.exit(1);
}
console.log(`check-repo: ${skillDirs.length} skill(s) pass: ${skillDirs.join(", ")}`);
