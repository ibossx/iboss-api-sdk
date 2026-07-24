import { useEffect, useState } from "react";
import { api, type WorkflowSummary } from "../lib/api.js";

export function WorkflowsPage({ onRun }: { onRun(workflow: WorkflowSummary): void }) {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [warnings, setWarnings] = useState<{ file: string; message: string }[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .workflows()
      .then((data) => {
        setWorkflows(data.workflows);
        setWarnings(data.warnings);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="error-text">Failed to load workflows: {error}</p>;

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>Workflows</h2>
        <span className="dim">
          {workflows.length} found — add more in the <span className="mono">workflows/</span> directory
        </span>
      </div>

      <div className="grid">
        {workflows.map((workflow) => (
          <div className="card" key={workflow.name}>
            <div className="row">
              <h3>{workflow.name}</h3>
              {workflow.multiAccount && <span className="badge accent">multi-account</span>}
            </div>
            <p>{workflow.description}</p>
            <div className="row">
              <button className="btn" onClick={() => onRun(workflow)}>
                Run
              </button>
            </div>
          </div>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="panel" style={{ marginTop: 24 }}>
          <h2>Warnings</h2>
          {warnings.map((warning) => (
            <p key={warning.file} className="error-text mono" style={{ fontSize: "0.85rem" }}>
              {warning.file}: {warning.message}
            </p>
          ))}
        </div>
      )}
    </>
  );
}
