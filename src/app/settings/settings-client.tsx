"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, LogOut, Moon, Sun } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import "./settings.css";

type Workspace = { id: string; name: string };
type Membership = {
  workspace_id: string;
  role: string;
  workspace: Workspace | Workspace[] | null;
};

function workspaceFor(membership: Membership) {
  return Array.isArray(membership.workspace) ? membership.workspace[0] : membership.workspace;
}

export default function SettingsClient({ userName, userEmail }: { userName: string; userEmail: string }) {
  const router = useRouter();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", localStorage.getItem("orbit-theme") === "dark");
    setDark(localStorage.getItem("orbit-theme") === "dark");

    let cancelled = false;
    void fetch("/api/workspaces", { cache: "no-store" })
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok) {
          const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
            ? result.error
            : `Workspaces could not be loaded (${response.status}).`;
          throw new Error(message);
        }
        if (!Array.isArray(result)) throw new Error("Orbit returned an invalid workspace list.");
        if (cancelled) return;
        const items = result as Membership[];
        setMemberships(items);
        const savedId = localStorage.getItem("orbit-workspace");
        const selected = items.find((item) => item.workspace_id === savedId) ?? items[0];
        if (selected) {
          const selectedWorkspace = workspaceFor(selected);
          setWorkspaceId(selected.workspace_id);
          setWorkspaceName(selectedWorkspace?.name ?? "Workspace");
          setNameDraft(selectedWorkspace?.name ?? "");
          localStorage.setItem("orbit-workspace", selected.workspace_id);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Workspace settings could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const membership = memberships.find((item) => item.workspace_id === workspaceId);
  const workspaceRole = membership?.role ?? "";
  const canRenameWorkspace = workspaceRole === "owner";

  function changeWorkspace(nextId: string) {
    const selected = memberships.find((item) => item.workspace_id === nextId);
    const selectedWorkspace = selected ? workspaceFor(selected) : null;
    setWorkspaceId(nextId);
    setWorkspaceName(selectedWorkspace?.name ?? "Workspace");
    setNameDraft(selectedWorkspace?.name ?? "");
    setNotice("");
    localStorage.setItem("orbit-workspace", nextId);
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("orbit-theme", next ? "dark" : "light");
    setNotice(`Switched to ${next ? "dark" : "light"} mode.`);
    setError("");
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = nameDraft.trim();
    if (!workspaceId || !trimmedName || trimmedName.length > 100) {
      setError("Workspace name must be between 1 and 100 characters.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, name: trimmedName }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
          ? result.error
          : `Workspace could not be saved (${response.status}).`;
        throw new Error(message);
      }
      setWorkspaceName(trimmedName);
      setMemberships((current) => current.map((item) => item.workspace_id === workspaceId
        ? { ...item, workspace: { id: workspaceId, name: trimmedName } }
        : item));
      setNotice("Workspace name saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace name could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured. Check the project environment before signing out.");
      return;
    }
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(`Could not sign out: ${signOutError.message}`);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <Link className="settings-brand" href="/"><span className="brand-mark">◈</span><b>orbit</b></Link>
        <div className="settings-account"><span>{userName}</span><button type="button" onClick={() => void signOut()}><LogOut size={15} /> Sign out</button></div>
      </header>
      <div className="settings-content">
        <Link className="settings-back" href="/"><ArrowLeft size={16} /> Back to workspace</Link>
        <div className="settings-heading"><span className="eyebrow">WORKSPACE PREFERENCES</span><h1>Settings</h1><p>Manage your account details and workspace preferences.</p></div>
        {error && <div className="settings-message error" role="alert">{error}</div>}
        {notice && <div className="settings-message success" role="status">{notice}</div>}
        {loading ? <div className="settings-card settings-loading" role="status">Loading workspace settings…</div> : (
          <div className="settings-grid">
            <section className="settings-card">
              <div className="settings-card-heading"><div><h2>Workspace</h2><p>Choose a workspace and update its shared name.</p></div></div>
              {memberships.length ? <>
                <label className="settings-field">Current workspace
                  <select value={workspaceId} onChange={(event) => changeWorkspace(event.target.value)}>
                    {memberships.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{workspaceFor(item)?.name ?? "Workspace"}</option>)}
                  </select>
                </label>
                <form onSubmit={(event) => void saveWorkspace(event)}>
                  <label className="settings-field">Workspace name
                    <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={100} required disabled={!canRenameWorkspace || saving} />
                  </label>
                  <div className="settings-form-footer">
                    <span>{canRenameWorkspace ? "Only owners can rename a workspace." : `Your role is ${workspaceRole}; only the owner can rename it.`}</span>
                    <button className="primary-button" type="submit" disabled={!canRenameWorkspace || saving || nameDraft.trim() === workspaceName}>
                      <Check size={15} />{saving ? "Saving…" : "Save name"}
                    </button>
                  </div>
                </form>
              </> : <p className="settings-empty">No workspace is linked to this account yet. Create one from the workspace menu.</p>}
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><h2>Account</h2><p>Your signed-in identity for this Orbit session.</p></div></div>
              <dl className="settings-account-details"><div><dt>Name</dt><dd>{userName}</dd></div><div><dt>Email</dt><dd>{userEmail || "Not available"}</dd></div><div><dt>Workspace role</dt><dd>{workspaceRole || "No workspace"}</dd></div></dl>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><h2>Team management</h2><p>Review members, workspace roles, invitations, and team progress.</p></div></div>
              <Link className="secondary-button" href="/team">Open team management</Link>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><div><h2>Appearance</h2><p>Choose the theme used across Orbit on this device.</p></div></div>
              <div className="settings-theme-row"><div><b>{dark ? "Dark mode" : "Light mode"}</b><span>Your preference is saved in this browser.</span></div><button className="secondary-button" type="button" onClick={toggleTheme}>{dark ? <Sun size={16} /> : <Moon size={16} />}{dark ? "Switch to light" : "Switch to dark"}</button></div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
