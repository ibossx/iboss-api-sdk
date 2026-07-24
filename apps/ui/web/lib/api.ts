/** Typed client for the UI's local API. */

export interface WorkflowSummary {
  name: string;
  description: string;
  multiAccount: boolean;
  file: string;
  inputSchema: JsonSchema;
}

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

export interface RunSummary {
  id: string;
  workflow: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
  events?: StoredEvent[];
}

export interface StoredEvent {
  seq: number;
  at: string;
  event:
    | { type: "log"; message: string }
    | { type: "progress"; step: string; status: "start" | "done" | "fail"; detail?: string }
    | { type: "started"; workflow: string; account: string }
    | { type: "finished"; status: "success" | "error"; error?: string };
}

export interface ProfileAccountSummary {
  name: string;
  domain: string;
  accountSettingsId?: string;
  apiKeyMasked: string;
}

/** A profile holds one API key per account (a key maps to exactly one account). */
export interface ProfileSummary {
  name: string;
  domain: string;
  accounts: ProfileAccountSummary[];
}

export interface AccountTestResult {
  name: string;
  ok: boolean;
  account?: string;
  accountSettingsId?: string;
  keyExpires?: string;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export const api = {
  workflows: () =>
    request<{ workflows: WorkflowSummary[]; warnings: { file: string; message: string }[] }>("/workflows"),
  startRun: (body: { workflow: string; input: unknown; profile?: string; account?: string }) =>
    request<{ runId: string }>("/runs", { method: "POST", body: JSON.stringify(body) }),
  runs: () => request<RunSummary[]>("/runs"),
  run: (id: string) => request<RunSummary>(`/runs/${id}`),
  cancelRun: (id: string) => request<{ ok: true }>(`/runs/${id}/cancel`, { method: "POST" }),
  profiles: () =>
    request<{ configPath: string; defaultProfile?: string; profiles: ProfileSummary[] }>("/profiles"),
  saveProfile: (
    name: string,
    body: {
      domain: string;
      accounts: {
        name: string;
        originalName?: string;
        apiKey?: string;
        accountSettingsId?: string;
        domain?: string;
      }[];
      makeDefault?: boolean;
    },
  ) => request<{ ok: true }>(`/profiles/${encodeURIComponent(name)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProfile: (name: string) =>
    request<{ ok: true }>(`/profiles/${encodeURIComponent(name)}`, { method: "DELETE" }),
  testProfile: (name: string, account?: string) =>
    request<{ ok: boolean; results: AccountTestResult[] }>(
      `/profiles/${encodeURIComponent(name)}/test${account ? `?account=${encodeURIComponent(account)}` : ""}`,
      { method: "POST" },
    ),
};

/** Subscribe to a run's SSE stream. Returns an unsubscribe function. */
export function subscribeToRun(
  runId: string,
  onEvent: (event: StoredEvent) => void,
  onDone: (run: RunSummary) => void,
): () => void {
  const source = new EventSource(`/api/runs/${runId}/events`);
  source.onmessage = (message) => onEvent(JSON.parse(message.data) as StoredEvent);
  source.addEventListener("done", (message) => {
    onDone(JSON.parse((message as MessageEvent).data) as RunSummary);
    source.close();
  });
  source.onerror = () => source.close();
  return () => source.close();
}
