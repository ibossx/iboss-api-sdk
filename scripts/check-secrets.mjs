#!/usr/bin/env node
/**
 * Repo hygiene gate: scans tracked/untracked source files for values that must
 * never be committed — live credentials, session tokens, or tenant-specific
 * hostnames. Runs as part of `npm test`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite"]);
const SKIP_FILES = new Set(["package-lock.json"]);
const TEXT_EXT = /\.(ts|tsx|mts|mjs|js|jsx|json|md|html|css|yml|yaml|txt|example)$/;

/** Each rule: [name, regex, explanation]. Keep patterns tenant-agnostic. */
const RULES = [
  [
    "real-looking bearer token",
    /Authorization:\s*Token\s+[A-Za-z0-9+/_-]{24,}/,
    "Looks like a live token in an Authorization header. Use placeholders like <API_KEY>.",
  ],
  [
    "assigned secret literal",
    /(apiKey|api_key|password|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{28,}["']/i,
    "Long literal assigned to a credential-named field. Use placeholders or env lookups.",
  ],
  [
    "tenant node hostname",
    /node-cluster\d+[a-z0-9.-]*\./i,
    "Tenant-specific cluster node hostname. Use synthetic hosts like gateway.node.example.invalid.",
  ],
  [
    "internal test tenant domain",
    /ibosstest\.com/i,
    "Internal test tenant domain must not appear in the SDK.",
  ],
  [
    "private key block",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    "Private key material.",
  ],
];

/** Lines containing an explicit placeholder marker are allowed. */
const PLACEHOLDER = /not-a-real|placeholder|your-api-key|example\.invalid|<API_KEY>|\{\{?[a-zA-Z_]+\}?\}/;

const failures = [];

function scanDir(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) scanDir(full);
      continue;
    }
    if (SKIP_FILES.has(entry) || !TEXT_EXT.test(entry)) continue;
    const rel = relative(ROOT, full);
    if (rel === "scripts/check-secrets.mjs") continue;
    const text = readFileSync(full, "utf8");
    const lines = text.split("\n");
    for (const [name, regex, hint] of RULES) {
      lines.forEach((line, i) => {
        if (regex.test(line) && !PLACEHOLDER.test(line)) {
          failures.push({ file: rel, line: i + 1, name, hint });
        }
      });
    }
  }
}

scanDir(ROOT);

if (failures.length > 0) {
  console.error("check:secrets FAILED — potential secrets or tenant data found:\n");
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}  [${f.name}]\n    ${f.hint}\n`);
  }
  process.exit(1);
}
console.log("check:secrets passed — no credential or tenant-data patterns found.");
