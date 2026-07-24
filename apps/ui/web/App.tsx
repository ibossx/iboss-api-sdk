import { useState } from "react";
import logoBlack from "./assets/iboss-logo-black.png";
import logoWhite from "./assets/iboss-logo-white.png";
import type { WorkflowSummary } from "./lib/api.js";
import { RunPage } from "./pages/Run.js";
import { SettingsPage } from "./pages/Settings.js";
import { WorkflowsPage } from "./pages/Workflows.js";

type Page = { view: "workflows" } | { view: "run"; workflow: WorkflowSummary } | { view: "settings" };

export function App() {
  const [page, setPage] = useState<Page>({ view: "workflows" });

  return (
    <>
      <header className="header">
        <h1 className="brand">
          {/* The dark theme is the stylesheet default; light is a media override. */}
          <picture>
            <source media="(prefers-color-scheme: light)" srcSet={logoBlack} />
            <img className="brand-logo" src={logoWhite} alt="iboss" />
          </picture>
          <span className="brand-suffix">SDK</span>
        </h1>
        <nav className="nav">
          <button
            className={page.view === "workflows" || page.view === "run" ? "active" : ""}
            onClick={() => setPage({ view: "workflows" })}
          >
            Workflows
          </button>
          <button
            className={page.view === "settings" ? "active" : ""}
            onClick={() => setPage({ view: "settings" })}
          >
            Settings
          </button>
        </nav>
      </header>

      {page.view === "workflows" && (
        <WorkflowsPage onRun={(workflow) => setPage({ view: "run", workflow })} />
      )}
      {page.view === "run" && (
        <RunPage
          key={page.workflow.name}
          workflow={page.workflow}
          onBack={() => setPage({ view: "workflows" })}
        />
      )}
      {page.view === "settings" && <SettingsPage />}
    </>
  );
}
