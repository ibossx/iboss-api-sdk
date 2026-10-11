#!/usr/bin/env node
/**
 * Public team-memory tooling.
 *
 *   node scripts/memory.mjs check                 validate every note under memory/
 *   node scripts/memory.mjs index <version> [out] write the release index (format 1)
 *
 * The rules mirror the internal validator (cursor-config team_memory.py) for the
 * public tier, plus public-only denylists. Customer names come from the
 * MEMORY_DENYLIST environment variable (comma or newline separated, supplied by a
 * CI secret) and are never committed here.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const MEMORY = join(ROOT, "memory");

const REQUIRED = ["id", "kind", "tier", "area", "source", "owner", "last_verified", "valid_from"];
const BODY_LIMIT = 600;
const FOLDERS = ["api/", "use-cases/", "faq/"];
const ID_RE = /^[a-z0-9][a-z0-9._-]{2,80}$/;
const SOURCE_PREFIXES = ["https://github.com/ibossx/iboss-api-sdk/blob/", "https://docs.iboss.com/"];
const SDK_METHOD_RE = /^client\.[a-zA-Z]+(\.[a-zA-Z]+)*$/;
const STALE_DAYS = 180;

/** [label, regex]. Anything matching is an error in a public note. */
const DENY = [
  ["internal ticket key", /\b(DEVELOP|SWAT|PRODMGMT|SUPPORT)-\d+\b/],
  ["internal host", /ibossrepo\.com|atlassian\.net|zendesk\.com|jenkins\./i],
  ["internal repository or service name",
    /\b(lockboxLinux|cursor-config|ibcloudnode|common-ibcloud-core|ibdao|phantomDb|iboss-icap-services|iBossEnterprise\d+)\b/],
  ["internal file path", /\/usr\/local\/src\/|[A-Za-z]:\\Dev\\|\/home\/[a-z]/],
  ["customer node hostname", /\bcn-?\d[a-z0-9-]*\.(ibosscloud|ibossgov)\.com\b|node-cluster\d+/i],
  ["account number", /\baccount\s*(#|no\.?|number)?\s*:?\s*\d{5,}/i],
  ["email address", /\b[A-Za-z0-9._%+-]+@(?!example\.(com|org|net|invalid)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ["secret or credential",
    /\b(api[_-]?key|password|secret|token)\s*[:=]\s*\S{12,}|\bBearer\s+[A-Za-z0-9._~+/-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bghp_[A-Za-z0-9]{30,}/i],
  ["instruction-like wording",
    /\bignore\s+(all\s+)?(previous|prior|above|earlier)\b|\bdisregard\s+(the\s+)?(instructions|rules)\b|\byou\s+are\s+now\b|^\s*(system|assistant|developer)\s*:|<\/?\s*(system|instructions?)\s*>/im],
];

const IPV4_RE = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w]|\.\d)/g;
const VERSION_CONTEXT_RE = /(versions?|releases?|build|fixed\s+in|after|before|upgrade\s+to|through|until|\bv)\s*$/i;
/** RFC 5737 documentation ranges are fine in examples. */
const DOC_NETS = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
const PROCEDURE_RE = /^\s*(#+\s*step\s+\d+|\d+\.\s+\S|[-*]\s+run\s+`)/im;

export function parseFrontmatter(text) {
  if (!text.startsWith("---")) return [{}, text];
  const lines = text.split("\n");
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return [{}, text];
  const meta = {};
  let listKey = null;
  for (const raw of lines.slice(1, end)) {
    const line = raw.replace(/\r$/, "");
    const stripped = line.trim();
    if (!stripped || stripped.startsWith("#")) continue;
    if (listKey && stripped.startsWith("- ")) {
      meta[listKey].push(unquote(stripped.slice(2)));
      continue;
    }
    listKey = null;
    const colon = line.indexOf(":");
    if (colon < 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value === "") {
      meta[key] = [];
      listKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      meta[key] = inner ? inner.split(",").map(unquote) : [];
    } else {
      meta[key] = unquote(value);
    }
  }
  return [meta, lines.slice(end + 1).join("\n").replace(/^\n+|\n+$/g, "")];
}

function unquote(value) {
  const v = value.trim();
  return v.length >= 2 && v[0] === v[v.length - 1] && (v[0] === '"' || v[0] === "'") ? v.slice(1, -1) : v;
}

function customerDenylist() {
  return (process.env.MEMORY_DENYLIST || "")
    .split(/[\n,]/)
    .map((name) => name.trim())
    .filter((name) => name.length >= 3);
}

export function validateNote(rel, meta, body, today = new Date()) {
  const errors = [];
  const warnings = [];
  for (const field of REQUIRED) {
    if (!meta[field] || (Array.isArray(meta[field]) && meta[field].length === 0)) {
      errors.push(`missing frontmatter field '${field}'`);
    }
  }
  if (meta.kind && meta.kind !== "invariant") errors.push("public notes may only be kind 'invariant'");
  if (meta.tier && meta.tier !== "public") errors.push(`tier '${meta.tier}' does not match store tier 'public'`);
  if (meta.id && !ID_RE.test(meta.id)) errors.push("id must be a lowercase slug (a-z, 0-9, . _ -)");
  if (!FOLDERS.some((folder) => rel.startsWith(folder))) errors.push("public notes live in api/, use-cases/, or faq/");

  const source = String(meta.source || "");
  if (source && !SDK_METHOD_RE.test(source) && !SOURCE_PREFIXES.some((p) => source.startsWith(p))) {
    errors.push("source must be a public SDK blob URL, a docs.iboss.com page, or a client.* method");
  }
  if (body.trim().length > BODY_LIMIT) errors.push(`body is ${body.trim().length} chars; limit is ${BODY_LIMIT}`);
  if (PROCEDURE_RE.test(body) || (body.match(/```/g) || []).length >= 2) {
    errors.push("body reads like a procedure; put steps in docs/ or a workflow and keep one fact here");
  }
  if (/"[^"]{200,}"/.test(body)) errors.push("quote longer than 200 characters; distill instead of copying");

  const haystack = `${body}\n${Object.values(meta).flat().join("\n")}`;
  for (const [label, regex] of DENY) {
    if (regex.test(haystack)) errors.push(label);
  }
  for (const name of customerDenylist()) {
    if (haystack.toLowerCase().includes(name.toLowerCase())) errors.push("customer name from MEMORY_DENYLIST");
  }
  for (const match of body.matchAll(IPV4_RE)) {
    if (match.slice(1).some((part) => Number(part) > 255)) continue;
    if (VERSION_CONTEXT_RE.test(body.slice(Math.max(0, match.index - 24), match.index))) continue;
    if (DOC_NETS.some((net) => net.test(match[0]))) continue;
    errors.push(`dotted quad ${match[0]} looks like an IP; use 192.0.2.x or write 'version X'`);
  }

  const verified = Date.parse(String(meta.last_verified || ""));
  if (!Number.isNaN(verified) && (today - verified) / 86400000 > STALE_DAYS) {
    warnings.push(`last_verified is older than ${STALE_DAYS} days`);
  }
  const until = Date.parse(String(meta.valid_until_date || ""));
  if (!Number.isNaN(until) && today > until) warnings.push("valid_until_date has passed; the index skips it");
  return { errors, warnings };
}

function noteFiles(dir = MEMORY) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith(".") || entry.startsWith("_")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...noteFiles(full));
    else if (entry.endsWith(".md") && entry !== "README.md") out.push(full);
  }
  return out;
}

export function loadStore() {
  if (!existsSync(join(MEMORY, ".memory-tier"))) throw new Error("memory/.memory-tier is missing");
  const tier = readFileSync(join(MEMORY, ".memory-tier"), "utf8").match(/^tier:\s*(\S+)/m)?.[1];
  if (tier !== "public") throw new Error(`memory/.memory-tier must say 'tier: public' (found ${tier})`);
  return noteFiles().map((path) => {
    const rel = relative(MEMORY, path).split("\\").join("/");
    const [meta, body] = parseFrontmatter(readFileSync(path, "utf8"));
    return { rel, meta, body };
  });
}

function check() {
  const notes = loadStore();
  const ids = new Map();
  let errorCount = 0;
  let warningCount = 0;
  for (const { rel, meta, body } of notes) {
    const { errors, warnings } = validateNote(rel, meta, body);
    if (meta.id && ids.has(meta.id)) errors.push(`duplicate id (also in ${ids.get(meta.id)})`);
    if (meta.id) ids.set(meta.id, rel);
    for (const e of errors) console.error(`FAIL ${rel}: ${e}`);
    for (const w of warnings) console.warn(`WARN ${rel}: ${w}`);
    errorCount += errors.length;
    warningCount += warnings.length;
  }
  console.log(`check:memory: ${notes.length} note(s), ${errorCount} error(s), ${warningCount} warning(s)`);
  return errorCount === 0 ? 0 : 1;
}

function gitCommit() {
  try {
    return execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function index(version, outPath) {
  if (!version) throw new Error("usage: memory.mjs index <version> [out]");
  if (check() !== 0) return 1;
  const today = new Date();
  const notes = loadStore()
    .filter(({ meta }) => {
      const until = Date.parse(String(meta.valid_until_date || ""));
      return Number.isNaN(until) || today <= until;
    })
    .map(({ rel, meta, body }) => ({ ...meta, body: body.trim(), path: rel }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const payload = {
    format: 1,
    tier: "public",
    version,
    commit: process.env.GITHUB_SHA || gitCommit(),
    generated: today.toISOString().replace(/\.\d{3}Z$/, "Z"),
    notes,
  };
  const out = outPath || join(ROOT, "dist-memory", "index.json");
  mkdirSync(dirname(out), { recursive: true });
  const text = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(out, text);
  const sha = createHash("sha256").update(text).digest("hex");
  console.log(`wrote ${relative(process.cwd(), out)} (${notes.length} notes, sha256 ${sha})`);
  return 0;
}

const isMain = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1];
if (isMain) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "check") process.exit(check());
    if (command === "index") process.exit(index(rest[0], rest[1]));
    console.error("usage: memory.mjs check | index <version> [out]");
    process.exit(2);
  } catch (error) {
    console.error(`memory: ${error.message}`);
    process.exit(1);
  }
}
