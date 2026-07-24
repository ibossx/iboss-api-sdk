import { useEffect, useRef, useState } from "react";
import {
  api,
  subscribeToRun,
  type ProfileSummary,
  type RunSummary,
  type StoredEvent,
  type WorkflowSummary,
} from "../lib/api.js";
import { defaultsFromSchema, SchemaForm } from "../lib/schemaForm.js";

export function RunPage({ workflow, onBack }: { workflow: WorkflowSummary; onBack(): void }) {
  const [input, setInput] = useState<Record<string, unknown>>(() =>
    defaultsFromSchema(workflow.inputSchema),
  );
  const [runId, setRunId] = useState<string>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [finished, setFinished] = useState<RunSummary>();
  const [error, setError] = useState<string>();
  const [profile, setProfile] = useState<ProfileSummary>();
  const [account, setAccount] = useState<string>();
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .profiles()
      .then((data) => {
        const active =
          data.profiles.find((p) => p.name === data.defaultProfile) ?? data.profiles[0];
        setProfile(active);
        setAccount(active?.accounts[0]?.name);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setFinished(undefined);
    return subscribeToRun(
      runId,
      (event) => setEvents((previous) => [...previous, event]),
      (run) => setFinished(run),
    );
  }, [runId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  const start = async () => {
    setError(undefined);
    try {
      const { runId: id } = await api.startRun({
        workflow: workflow.name,
        input,
        ...(profile ? { profile: profile.name } : {}),
        ...(account ? { account } : {}),
      });
      setRunId(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const running = runId !== undefined && finished === undefined;

  return (
    <>
      <div className="toolbar">
        <button className="btn secondary sm" onClick={onBack}>
          ← workflows
        </button>
        <h2 style={{ margin: 0 }} className="mono">
          {workflow.name}
        </h2>
        {finished && (
          <span className={`badge ${finished.status === "success" ? "success" : "danger"}`}>
            {finished.status}
          </span>
        )}
        {running && <span className="badge warning">running</span>}
      </div>

      <div className="panel">
        {profile && workflow.multiAccount && (
          <p className="dim" style={{ marginTop: 0 }}>
            Runs across all {profile.accounts.length} account
            {profile.accounts.length === 1 ? "" : "s"} in profile{" "}
            <span className="mono">{profile.name}</span> (one API key per account).
          </p>
        )}
        {profile && !workflow.multiAccount && profile.accounts.length > 1 && (
          <div className="field" style={{ maxWidth: 320, marginBottom: 14 }}>
            <label htmlFor="run-account">
              Account <span className="hint">— from profile {profile.name}</span>
            </label>
            <select
              id="run-account"
              value={account ?? ""}
              onChange={(e) => setAccount(e.target.value)}
            >
              {profile.accounts.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                  {a.accountSettingsId ? ` (${a.accountSettingsId})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <h2>Inputs</h2>
        <SchemaForm schema={workflow.inputSchema} value={input} onChange={setInput} />
        <div className="row" style={{ marginTop: 18, display: "flex", gap: 10 }}>
          <button className="btn" onClick={start} disabled={running}>
            {running ? "Running…" : runId ? "Run again" : "Run"}
          </button>
          {running && (
            <button className="btn danger" onClick={() => runId && api.cancelRun(runId)}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      {runId && (
        <div className="panel">
          <h2>Output</h2>
          <div className="log" ref={logRef}>
            {events.map((stored) => (
              <div key={stored.seq} className={`line ${lineClass(stored)}`}>
                {renderEvent(stored)}
              </div>
            ))}
            {events.length === 0 && <div className="line dim">waiting for output…</div>}
          </div>

          {finished?.result !== undefined && finished.result !== null && (
            <>
              <h2 style={{ marginTop: 18 }}>Result</h2>
              <pre className="result">{JSON.stringify(finished.result, null, 2)}</pre>
            </>
          )}
          {finished?.error && <p className="error-text">{finished.error}</p>}
        </div>
      )}
    </>
  );
}

function lineClass(stored: StoredEvent): string {
  return stored.event.type === "progress" ? `progress-${stored.event.status}` : "";
}

function renderEvent(stored: StoredEvent): string {
  const { event } = stored;
  switch (event.type) {
    case "started":
      return `▶ ${event.workflow} — account: ${event.account}`;
    case "log":
      return `  ${event.message}`;
    case "progress": {
      const icon = event.status === "start" ? "…" : event.status === "done" ? "✔" : "✖";
      return `  ${icon} ${event.step}${event.detail ? ` — ${event.detail}` : ""}`;
    }
    case "finished":
      return event.status === "success" ? "✔ finished" : `✖ failed${event.error ? `: ${event.error}` : ""}`;
  }
}
