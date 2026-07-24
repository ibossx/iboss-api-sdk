/**
 * Minimal logger abstraction. The SDK never logs credentials — callers of
 * these methods are responsible for passing pre-redacted data (see redact.ts),
 * and the built-in debug logger redacts defensively as well.
 */
import { redactValue } from "./redact.js";

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function emit(level: string, message: string, data?: unknown): void {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(redactValue(data))}`;
  // eslint-disable-next-line no-console
  console.error(`[iboss:${level}] ${message}${suffix}`);
}

export const consoleLogger: Logger = {
  debug: (m, d) => emit("debug", m, d),
  info: (m, d) => emit("info", m, d),
  warn: (m, d) => emit("warn", m, d),
  error: (m, d) => emit("error", m, d),
};

/** Default logger: silent unless IBOSS_DEBUG is set. */
export function defaultLogger(): Logger {
  return process.env.IBOSS_DEBUG ? consoleLogger : noopLogger;
}
