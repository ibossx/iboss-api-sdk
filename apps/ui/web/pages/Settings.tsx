import { useEffect, useState } from "react";
import { api, type ProfileSummary } from "../lib/api.js";

interface AccountRow {
  name: string;
  /** The stored name this row was loaded as; lets a rename keep its key. */
  originalName?: string;
  apiKey: string;          // blank on edit keeps the stored key
  accountSettingsId: string;
  isNew: boolean;
}

interface EditState {
  name: string;
  domain: string;
  accounts: AccountRow[];
  isNew: boolean;
}

const emptyAccount = (name = ""): AccountRow => ({
  name,
  apiKey: "",
  accountSettingsId: "",
  isNew: true,
});

export function SettingsPage() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [configPath, setConfigPath] = useState("");
  const [defaultProfile, setDefaultProfile] = useState<string>();
  const [edit, setEdit] = useState<EditState>();
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  const refresh = () =>
    api
      .profiles()
      .then((data) => {
        setProfiles(data.profiles);
        setConfigPath(data.configPath);
        setDefaultProfile(data.defaultProfile);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    if (!edit) return;
    setError(undefined);
    try {
      await api.saveProfile(edit.name, {
        domain: edit.domain,
        accounts: edit.accounts.map((account) => ({
          name: account.name,
          ...(account.originalName ? { originalName: account.originalName } : {}),
          ...(account.apiKey ? { apiKey: account.apiKey } : {}),
          ...(account.accountSettingsId ? { accountSettingsId: account.accountSettingsId } : {}),
        })),
      });
      setEdit(undefined);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const test = async (profileName: string, accountName?: string) => {
    const key = accountName ? `${profileName}/${accountName}` : profileName;
    setTestResult((previous) => ({ ...previous, [key]: "testing…" }));
    try {
      const result = await api.testProfile(profileName, accountName);
      const summary = result.results
        .map((r) => (r.ok ? `✔ ${r.name}: ${r.account ?? r.accountSettingsId}` : `✖ ${r.name}: ${r.error}`))
        .join("   ");
      setTestResult((previous) => ({ ...previous, [key]: summary }));
    } catch (e) {
      setTestResult((previous) => ({ ...previous, [key]: `✖ ${(e as Error).message}` }));
    }
  };

  const startEdit = (profile: ProfileSummary) =>
    setEdit({
      name: profile.name,
      domain: profile.domain,
      isNew: false,
      accounts: profile.accounts.map((account) => ({
        name: account.name,
        originalName: account.name,
        apiKey: "",
        accountSettingsId: account.accountSettingsId ?? "",
        isNew: false,
      })),
    });

  return (
    <>
      <div className="toolbar">
        <h2 style={{ margin: 0 }}>API key profiles</h2>
        <span className="dim mono" style={{ fontSize: "0.82rem" }}>
          {configPath}
        </span>
        <div className="spacer" />
        <button
          className="btn"
          onClick={() =>
            setEdit({
              name: "",
              domain: "api.ibosscloud.com",
              isNew: true,
              accounts: [emptyAccount("primary")],
            })
          }
        >
          Add profile
        </button>
      </div>

      <p className="dim" style={{ marginTop: 0, fontSize: "0.9rem" }}>
        An iboss API key belongs to exactly one account. To automate several accounts, add one
        account row (with its own key) per account. Keys are stored in your home directory, never
        in this repo, and only the last 4 characters are ever shown.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Profile</th>
              <th>Cloud domain</th>
              <th>Accounts</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="dim">
                  No profiles yet. Add one to run workflows from the UI.
                </td>
              </tr>
            )}
            {profiles.map((profile) => (
              <tr key={profile.name}>
                <td style={{ verticalAlign: "top" }}>
                  <span className="mono">{profile.name}</span>{" "}
                  {profile.name === defaultProfile && <span className="badge accent">default</span>}
                </td>
                <td className="mono" style={{ verticalAlign: "top" }}>{profile.domain}</td>
                <td>
                  {profile.accounts.map((account) => (
                    <div key={account.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                      <span className="mono">{account.name}</span>
                      <span className="dim mono" style={{ fontSize: "0.82rem" }}>{account.apiKeyMasked}</span>
                      {account.accountSettingsId && (
                        <span className="dim mono" style={{ fontSize: "0.82rem" }}>#{account.accountSettingsId}</span>
                      )}
                      <button className="btn secondary sm" onClick={() => test(profile.name, account.name)}>
                        Test
                      </button>
                      <span className="dim" style={{ fontSize: "0.82rem" }}>
                        {testResult[`${profile.name}/${account.name}`]}
                      </span>
                    </div>
                  ))}
                </td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                  <span className="dim" style={{ marginRight: 10, fontSize: "0.85rem" }}>
                    {testResult[profile.name]}
                  </span>
                  <button className="btn secondary sm" onClick={() => test(profile.name)}>
                    Test all
                  </button>{" "}
                  <button className="btn secondary sm" onClick={() => startEdit(profile)}>
                    Edit
                  </button>{" "}
                  <button
                    className="btn danger sm"
                    onClick={() => api.deleteProfile(profile.name).then(refresh)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && (
        <div className="panel">
          <h2>{edit.isNew ? "New profile" : `Edit "${edit.name}"`}</h2>
          <div className="form" style={{ maxWidth: 760 }}>
            {edit.isNew && (
              <div className="field">
                <label>Profile name</label>
                <input
                  type="text"
                  value={edit.name}
                  placeholder="prod"
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </div>
            )}
            <div className="field">
              <label>
                Cloud domain <span className="hint">— the base API host for these accounts</span>
              </label>
              <input
                type="text"
                value={edit.domain}
                onChange={(e) => setEdit({ ...edit, domain: e.target.value })}
              />
            </div>

            <div className="field">
              <label>
                Accounts <span className="hint">— one API key per account</span>
              </label>
              {edit.accounts.map((account, index) => (
                <div key={index} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    type="text"
                    placeholder="name (e.g. hq)"
                    style={{ width: 140 }}
                    value={account.name}
                    onChange={(e) => {
                      const accounts = [...edit.accounts];
                      accounts[index] = { ...account, name: e.target.value };
                      setEdit({ ...edit, accounts });
                    }}
                  />
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={account.isNew ? "API key" : "API key (blank keeps current)"}
                    style={{ flex: 1 }}
                    value={account.apiKey}
                    onChange={(e) => {
                      const accounts = [...edit.accounts];
                      accounts[index] = { ...account, apiKey: e.target.value };
                      setEdit({ ...edit, accounts });
                    }}
                  />
                  <input
                    type="text"
                    placeholder="account id (optional)"
                    style={{ width: 160 }}
                    value={account.accountSettingsId}
                    onChange={(e) => {
                      const accounts = [...edit.accounts];
                      accounts[index] = { ...account, accountSettingsId: e.target.value };
                      setEdit({ ...edit, accounts });
                    }}
                  />
                  <button
                    className="btn danger sm"
                    disabled={edit.accounts.length === 1}
                    onClick={() =>
                      setEdit({ ...edit, accounts: edit.accounts.filter((_, i) => i !== index) })
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <button
                  className="btn secondary sm"
                  onClick={() => setEdit({ ...edit, accounts: [...edit.accounts, emptyAccount()] })}
                >
                  + Add account
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn"
                onClick={save}
                disabled={!edit.name || !edit.domain || edit.accounts.some((a) => !a.name)}
              >
                Save
              </button>
              <button className="btn secondary" onClick={() => setEdit(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="error-text">{error}</p>}
    </>
  );
}
