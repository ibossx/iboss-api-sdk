/**
 * aiRiskEngines validation (DEVELOP-34913 / G).
 *
 * Settings wire form is a free-form string (observed: "chatgpt"). The SDK
 * accepts `"all"` or an array of known slugs and rejects display names
 * ("ChatGPT") before POST. The published list is not final — unknown values
 * throw rather than guess.
 */

export const KNOWN_AI_RISK_ENGINES = [
  "chatgpt",
  "claude",
  "gemini",
  "copilot",
  "perplexity",
] as const;

export type AiRiskEngine = (typeof KNOWN_AI_RISK_ENGINES)[number];

export type AiRiskEnginesInput = "all" | readonly AiRiskEngine[] | AiRiskEngine | string;

const KNOWN = new Set<string>(KNOWN_AI_RISK_ENGINES);

/**
 * Normalize an agent-facing aiRiskEngines value to the platform string.
 * `"all"` expands to the known slug list (comma-separated). Unknown slugs
 * and display names throw before any settings POST.
 */
export function encodeAiRiskEngines(value: AiRiskEnginesInput): string {
  if (value === "all") return KNOWN_AI_RISK_ENGINES.join(",");
  const list = (Array.isArray(value) ? value : [value]).map((item) => String(item).trim());
  if (list.length === 0) {
    throw new Error("aiRiskEngines must be \"all\" or a non-empty list of known engine slugs.");
  }
  const unknown = list.filter((item) => !KNOWN.has(item));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown aiRiskEngines value(s): ${unknown.map((v) => JSON.stringify(v)).join(", ")}. ` +
        `Known slugs: ${KNOWN_AI_RISK_ENGINES.join(", ")}. ` +
        `Do not send display names (e.g. "ChatGPT"); the observed wire form is "chatgpt".`,
    );
  }
  return list.join(",");
}
