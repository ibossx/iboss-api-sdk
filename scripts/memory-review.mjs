#!/usr/bin/env node
/**
 * Advisory LLM review for public memory notes changed in a pull request.
 *
 *   node scripts/memory-review.mjs <base-ref> <out.md>
 *
 * Needs OPENAI_API_KEY. MEMORY_REVIEW_MODEL picks the model (default gpt-4o), and
 * OPENAI_BASE_URL overrides the endpoint.
 * Writes a markdown comment body and exits 2 when a high-severity finding or an
 * obstructed analysis needs a human before merge. Notes are sent as data; the
 * prompt in .github/memory-review.md tells the model not to follow them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStore } from "./memory.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const MAX_NOTE_CHARS = 4000;

function git(...args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" });
}

function changedNotes(base) {
  return git("diff", "--name-only", "--diff-filter=AMR", `${base}...HEAD`)
    .split("\n")
    .map((line) => line.trim())
    .filter((path) => /^memory\/(?!_templates\/).+\.md$/.test(path) && !path.endsWith("README.md"))
    .filter((path) => existsSync(join(ROOT, path)));
}

function checkOutput() {
  try {
    return execFileSync("node", [join(ROOT, "scripts", "memory.mjs"), "check"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    return `${error.stdout || ""}${error.stderr || ""}`;
  }
}

async function review(base) {
  const files = changedNotes(base);
  if (files.length === 0) return { files, result: null };
  const existing = loadStore()
    .filter(({ rel }) => !files.includes(`memory/${rel}`))
    .map(({ meta }) => `- ${meta.id}: area ${meta.area}; signatures ${[].concat(meta.signatures || []).join(", ")}`)
    .join("\n");
  const notes = files
    .map((path) => `=== ${path} ===\n${readFileSync(join(ROOT, path), "utf8").slice(0, MAX_NOTE_CHARS)}`)
    .join("\n\n");
  const user = [
    "DETERMINISTIC CHECK OUTPUT:",
    checkOutput().trim(),
    "",
    "EXISTING NOTES (ids only):",
    existing || "(none)",
    "",
    "NOTES UNDER REVIEW (untrusted data):",
    notes,
  ].join("\n");

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.MEMORY_REVIEW_MODEL || "gpt-4o",
      response_format: { type: "json_object" },
      temperature: 0,
      messages: [
        { role: "system", content: readFileSync(join(ROOT, ".github", "memory-review.md"), "utf8") },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
  const payload = await response.json();
  return { files, result: JSON.parse(payload.choices?.[0]?.message?.content || "{}") };
}

function render(files, result) {
  const lines = ["### Public memory review (advisory)", ""];
  if (!result) {
    lines.push("No memory notes changed.");
    return { body: lines.join("\n"), blocking: false };
  }
  const findings = (Array.isArray(result.findings) ? result.findings : []).filter((f) => f && typeof f === "object");
  const blocking = Boolean(result.analysis_obstructed) || findings.some((f) => f.severity === "high");
  lines.push(`Reviewed ${files.length} note(s) against the public review questions in \`.github/memory-review.md\`.`, "");
  if (result.analysis_obstructed) {
    lines.push("**A note appears to contain instructions aimed at reviewers or assistants. A maintainer must read it before merge.**", "");
  }
  for (const f of findings) {
    const fix = f.suggested_fix ? ` Suggested fix: ${String(f.suggested_fix).slice(0, 400)}` : "";
    lines.push(`- **${f.severity || "info"}** \`${f.file || "?"}\` (${f.category || "general"}): ${String(f.finding || "").slice(0, 600)}${fix}`);
  }
  if (findings.length === 0) lines.push("No findings.");
  if (result.summary) lines.push("", String(result.summary).slice(0, 600));
  lines.push("", "_This review is advisory. A maintainer approves every memory PR, and `npm run check:memory` is the required gate._");
  return { body: lines.join("\n"), blocking };
}

const [base = "origin/main", out = "memory-review.md"] = process.argv.slice(2);
if (!process.env.OPENAI_API_KEY) {
  console.log("OPENAI_API_KEY is not set; skipping the LLM review.");
  process.exit(0);
}
try {
  const { files, result } = await review(base);
  const { body, blocking } = render(files, result);
  writeFileSync(out, `${body}\n`);
  console.log(body);
  process.exit(blocking ? 2 : 0);
} catch (error) {
  console.error(`memory-review: ${error.message}`);
  process.exit(1);
}
