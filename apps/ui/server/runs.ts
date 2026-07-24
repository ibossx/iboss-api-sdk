/**
 * In-memory run manager. Buffers events per run so the UI can replay them
 * after a page refresh, and supports cancellation via AbortController.
 */
import { randomUUID } from "node:crypto";
import type { WorkflowEvent } from "@iboss/sdk";

export interface StoredEvent {
  seq: number;
  event: WorkflowEvent;
  at: string;
}

export interface RunRecord {
  id: string;
  workflow: string;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
  events: StoredEvent[];
  controller: AbortController;
  listeners: Set<(event: StoredEvent) => void>;
}

const runs = new Map<string, RunRecord>();
const MAX_RUNS = 50;

export function createRun(workflow: string): RunRecord {
  const run: RunRecord = {
    id: randomUUID(),
    workflow,
    status: "running",
    startedAt: new Date().toISOString(),
    events: [],
    controller: new AbortController(),
    listeners: new Set(),
  };
  runs.set(run.id, run);
  // Evict the oldest finished runs beyond the cap.
  if (runs.size > MAX_RUNS) {
    for (const [id, record] of runs) {
      if (runs.size <= MAX_RUNS) break;
      if (record.status !== "running") runs.delete(id);
    }
  }
  return run;
}

export function getRun(id: string): RunRecord | undefined {
  return runs.get(id);
}

export function listRuns(): RunRecord[] {
  return [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function pushEvent(run: RunRecord, event: WorkflowEvent): void {
  const stored: StoredEvent = { seq: run.events.length, event, at: new Date().toISOString() };
  run.events.push(stored);
  for (const listener of run.listeners) listener(stored);
}

export function finishRun(
  run: RunRecord,
  status: "success" | "error",
  result?: unknown,
  error?: string,
): void {
  run.status = status;
  run.finishedAt = new Date().toISOString();
  run.result = result;
  run.error = error;
}

/** Public shape (no controller/listeners). */
export function serializeRun(run: RunRecord, includeEvents = false) {
  return {
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    result: run.result,
    error: run.error,
    ...(includeEvents ? { events: run.events } : { eventCount: run.events.length }),
  };
}
