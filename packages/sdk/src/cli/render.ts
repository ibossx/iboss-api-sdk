/**
 * CLI output helpers. Every command supports --json for machine-readable
 * output (useful when an AI agent drives the CLI).
 */

export interface RenderOptions {
  json?: boolean;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Render rows as an aligned table. */
export function printTable(rows: Array<Record<string, string | number | boolean | undefined>>): void {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
  );
  const line = (values: string[]) =>
    values.map((v, i) => v.padEnd(widths[i] ?? 0)).join("  ");
  console.log(line(columns));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const row of rows) {
    console.log(line(columns.map((col) => String(row[col] ?? ""))));
  }
}

export function ok(message: string): void {
  console.log(`✔ ${message}`);
}

export function fail(message: string): void {
  console.error(`✖ ${message}`);
}

export function info(message: string): void {
  console.log(message);
}

/** Prompt for one line of (non-secret) input, echoed as typed. */
export async function promptLine(question: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} `)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Prompt for a secret without echoing it (used for API keys, so they never
 * land in shell history). Falls back to reading one line from stdin when not
 * attached to a terminal (piped input).
 */
export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise<string>((resolve) => {
      let data = "";
      process.stdin.resume();
      process.stdin.on("data", (chunk) => {
        data += String(chunk);
        const newline = data.indexOf("\n");
        if (newline >= 0) {
          process.stdin.pause();
          resolve(data.slice(0, newline).trim());
        }
      });
      process.stdin.on("end", () => resolve(data.trim()));
    });
  }

  process.stdout.write(`${question} `);
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    let value = "";
    const onData = (buf: Buffer) => {
      const ch = buf.toString("utf8");
      if (ch === "\n" || ch === "\r" || ch === "\u0004" /* Ctrl-D */) {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value.trim());
      } else if (ch === "\u0003" /* Ctrl-C */) {
        stdin.setRawMode(false);
        process.stdout.write("\n");
        process.exit(130);
      } else if (ch === "\u007f" /* backspace */ || ch === "\b") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** Ask a y/N question on the terminal. Returns false when not interactive. */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(`${question} [y/N] `);
  const answer = await new Promise<string>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(String(data).trim().toLowerCase());
    });
  });
  return answer === "y" || answer === "yes";
}
