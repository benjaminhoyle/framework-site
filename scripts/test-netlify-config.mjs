#!/usr/bin/env node
/**
 * Guards on netlify.toml.
 *
 *   node scripts/test-netlify-config.mjs
 *
 * This file has the widest blast radius of anything in the repo and the least
 * feedback. Netlify reads it before it does anything else, so one malformed
 * line does not break a page -- it fails the build outright, and *every*
 * change behind it stops shipping until somebody reads the deploy log. The
 * site can sit weeks behind main looking perfectly healthy.
 *
 * That is exactly what happened: a duplicated `force = true` went in with a
 * scripted edit, `npm test` passed because nothing here parsed the file, and
 * the next seven commits never deployed.
 *
 * So: parse it properly where a parser exists, and check the things a parser
 * will not -- a redirect shadowed by an earlier one, or a route the site is
 * built around quietly going missing.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "netlify.toml");
const source = fs.readFileSync(FILE, "utf8");

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) return;
  failures += 1;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
};

/*
 * A real parse, when the machine has one. Node has no TOML parser and this repo
 * has no dependencies worth adding one for, but every macOS and most Linux
 * boxes ship a Python new enough for tomllib -- and a real parser catches the
 * whole class, not the one mistake that has already been made.
 */
let parsed = null;
try {
  // The traceback is noise; the one line tomllib puts in the exception says
  // what is wrong and where, which is the whole reason to shell out for this.
  const out = execFileSync("python3", ["-c", `
import json, sys, tomllib
try:
    with open(sys.argv[1], "rb") as handle:
        json.dump({"ok": True, "config": tomllib.load(handle)}, sys.stdout)
except tomllib.TOMLDecodeError as error:
    json.dump({"ok": False, "error": str(error)}, sys.stdout)
`, FILE], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  const result = JSON.parse(out);
  if (result.ok) {
    parsed = result.config;
    console.log("  netlify.toml parses (python3 tomllib)");
  } else {
    check("netlify.toml is valid TOML", false,
      `${result.error}\n      Netlify reads this before it does anything else, so this fails the`
      + ` build outright and nothing deploys until it is fixed.`);
  }
} catch (error) {
  console.log("  no python3 with tomllib here — structural checks only");
}

/*
 * The structural pass runs either way. It reads the file as blocks rather than
 * as TOML, which is what lets it say *which* block is wrong -- a parser reports
 * a line number in a 200-line file and leaves you counting.
 */
const blocks = [];
let current = null;
source.split("\n").forEach((line, index) => {
  const header = /^\s*\[+([^\]]+)\]+\s*$/.exec(line);
  if (header) {
    current = { name: header[1], line: index + 1, keys: new Map() };
    blocks.push(current);
    return;
  }
  const pair = /^\s*([A-Za-z_][A-Za-z0-9_.]*)\s*=/.exec(line);
  if (!pair || !current) return;
  const key = pair[1];
  if (current.keys.has(key)) {
    check(`[${current.name}] at line ${current.line} sets "${key}" once`, false,
      `set again at line ${index + 1} — TOML refuses a redefined value and the whole build fails`);
  }
  current.keys.set(key, index + 1);
});

for (const block of blocks.filter((b) => b.name === "redirects")) {
  for (const required of ["from", "to", "status"]) {
    check(`the redirect at line ${block.line} declares "${required}"`, block.keys.has(required));
  }
}

/*
 * Order matters and nothing else checks it: Netlify takes the first rule whose
 * `from` matches, so a duplicate is a rule that will never run. Wildcards are
 * compared as prefixes, which is how /data/* would swallow /data/assembly/*.
 */
if (parsed && parsed.redirects) {
  const seen = [];
  for (const redirect of parsed.redirects) {
    const from = redirect.from || "";
    const shadow = seen.find((earlier) =>
      earlier === from
      || (earlier.endsWith("/*") && from.startsWith(earlier.slice(0, -1))));
    check(`"${from}" is reachable`, !shadow,
      shadow === from
        ? `declared twice; the second never runs`
        : `"${shadow}" is declared earlier and matches it first`);
    seen.push(from);
  }

  // The addresses other things in this repo are built around. A rewrite that
  // quietly disappears takes a page with it, and the page still exists on disk,
  // so nothing else notices.
  const targets = new Map(parsed.redirects.map((r) => [r.from, r]));
  for (const [from, to] of [["/builder", "/builder.html"], ["/shelving", "/shelving.html"], ["/assembly", "/assembly-lab.html"]]) {
    const rule = targets.get(from);
    check(`${from} is rewritten to ${to}`, rule && rule.to === to && rule.status === 200,
      rule ? `found ${rule.to} (${rule.status})` : "no rule at all");
  }

  for (const from of ["/docs/*", "/scripts/*", "/studio.html"]) {
    const rule = targets.get(from);
    check(`${from} stays off the public site`, rule && rule.status === 404 && rule.force === true,
      rule ? `status ${rule.status}, force ${rule.force}` : "no rule at all");
  }
}

if (failures) {
  console.error(`\n${failures} netlify.toml check${failures === 1 ? "" : "s"} failed`);
  process.exit(1);
}
console.log(`netlify.toml ok — ${blocks.filter((b) => b.name === "redirects").length} redirects, ${blocks.filter((b) => b.name === "headers").length} header rules`);
