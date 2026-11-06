#!/usr/bin/env node
// Principle 1 by tool: fail on a block of about eight lines copied between source files
// (jscpd), and on a string literal of four or more characters written in more than one
// source file. Tests are excluded; they restate values on purpose.
//
// A literal that is the same text with two meanings (a `"utf8"` encoding, an HTTP method)
// goes in scripts/dupes-allow.txt with the exact files and a reason, so a new file reusing
// it still fails. An entry that matches nothing fails too: delete it with what it excused.
// `--root <dir>` checks another tree instead of this repo; scripts/dupes-test uses it.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repo = resolve(dirname(new URL(import.meta.url).pathname), "..");
const rootArg = process.argv.indexOf("--root");
const rootValue = rootArg === -1 ? undefined : process.argv[rootArg + 1];
if (rootArg !== -1 && !rootValue) {
  console.error("dupes: --root needs a directory");
  process.exit(2);
}
const root = rootValue ? resolve(rootValue) : repo;
const allowFile = "scripts/dupes-allow.txt";
const sourceDirs = ["src", "sidecar/src"].filter((dir) => existsSync(join(root, dir)));

const jscpd = spawnSync(
  join(repo, "node_modules/.bin/jscpd"),
  ["--min-lines", "8", "--format", "javascript,python", "--exit-code", "1", ...sourceDirs],
  { cwd: root, stdio: "inherit" },
);
if (jscpd.error) throw jscpd.error;

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : walk(path);
    return /\.(m?js|py)$/.test(entry.name) ? [path] : [];
  });
}

// Import lines name modules, not facts, so the same specifier in two files is fine. A JSDoc
// `@import` line is one too, and so is the `} from "…"` line that ends a wrapped import.
const importLine = /^\s*(import|export\s.*\sfrom|\}\s*from|from\s\S+\simport|\/\*\*\s*@import)\b/;
const literal = /(["'])((?:\\.|(?!\1)[^\\\n]){4,})\1/g;

/** @type {Map<string, Map<string, number>>} literal → file → first line it appears on */
const seen = new Map();
for (const file of sourceDirs.flatMap((dir) => walk(join(root, dir)))) {
  const shown = relative(root, file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (importLine.test(line)) return;
      for (const match of line.matchAll(literal)) {
        const text = match[2] ?? "";
        const files = seen.get(text) ?? new Map();
        if (!files.has(shown)) files.set(shown, index + 1);
        seen.set(text, files);
      }
    });
}

/** @param {string} text @param {Iterable<string>} files */
const keyOf = (text, files) => `literal "${text}" | files ${[...files].sort().join(" ")}`;

const problems = [];
const entry = /^(literal "(.*)" \| files (\S.*?)) \|(.*)$/;
/** @type {Map<string, number>} entry key → its line in the allowlist */
const allowed = new Map();
const allowPath = join(root, allowFile);
if (!existsSync(allowPath)) {
  console.error(`dupes: ${allowFile} is missing`);
  process.exit(2);
}
readFileSync(allowPath, "utf8")
  .split("\n")
  .forEach((raw, index) => {
    const line = raw.trim();
    const at = `${allowFile}:${index + 1}:`;
    if (line === "" || line.startsWith("#")) return;
    const parts = entry.exec(line);
    if (!parts) {
      problems.push(`${at} expected \`literal "…" | files <file>… | <reason>\``);
      return;
    }
    const [, , text = "", files = "", reason = ""] = parts;
    if (reason.trim() === "") problems.push(`${at} entry has no reason`);
    const key = keyOf(text, files.split(/\s+/));
    const first = allowed.get(key);
    if (first !== undefined) problems.push(`${at} repeats line ${first}`);
    else allowed.set(key, index + 1);
  });

const used = new Set();
let findings = 0;
for (const [text, files] of seen) {
  if (files.size < 2) continue;
  const key = keyOf(text, files.keys());
  if (allowed.has(key)) {
    used.add(key);
    continue;
  }
  findings += 1;
  console.error(`literal "${text}" in ${files.size} files; define it once and import it:`);
  for (const [file, line] of [...files].sort()) console.error(`  ${file}:${line}`);
  console.error(`  key: ${key}`);
}
for (const [key, line] of allowed) {
  if (!used.has(key)) problems.push(`${allowFile}:${line}: matches nothing, delete it: ${key}`);
}
for (const problem of problems) console.error(problem);

if (jscpd.status !== 0 || findings > 0 || problems.length > 0) process.exit(1);
console.log(`no copied blocks or repeated literals (${allowed.size} allowed)`);
