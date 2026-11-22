"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, ExternalLink, LogOut, MailPlus, RefreshCw, Shield, Trash2, Users } from "lucide-react";
import "./team.css";

type Workspace = { id: string; name: string; owner_id?: string };
type WorkspaceMembership = { workspace_id: string; role: string; workspace: Workspace | Workspace[] | null };
type Profile = { id: string; full_name: string | null; avatar_url: string | null };
type Member = { role: string; joined_at: string; profile: Profile | Profile[] | null };
type Invitation = {
  id: string;
  token: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
};
type Project = { id: string; status: string; tasks?: { id: string; status: string }[] };
type Task = { project_id: string; due_date: string | null; status: string };

function workspaceFor(item: WorkspaceMembership) {
  return Array.isArray(item.workspace) ? item.workspace[0] : item.workspace;
}

function profileFor(member: Member) {
  return Array.isArray(member.profile) ? member.profile[0] : member.profile;
}

function roleLabel(role: string) {
  if (role === "admin") return "Team Leader";
  if (role === "member") return "Team Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export default function TeamClient({ userId, userName, userEmail, initialNotice }: { userId: string; userName: string; userEmail: string; initialNotice: string }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin" | "guest">("member");
  const [inviteUrl, setInviteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(initialNotice);
  const [copied, setCopied] = useState(false);

  const selectedWorkspace = workspaces.find((item) => item.workspace_id === workspaceId);
  const role = selectedWorkspace?.role ?? "";
  const canManage = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const load = useCallback(async (activeWorkspaceId: string) => {
    setLoading(true);
    setError("");
    try {
      const [memberResponse, projectResponse, taskResponse] = await Promise.all([
        fetch(`/api/members?workspace_id=${encodeURIComponent(activeWorkspaceId)}&include_invitations=true`, { cache: "no-store" }),
        fetch(`/api/projects?workspace_id=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }),
        fetch("/api/tasks", { cache: "no-store" }),
      ]);
      let memberPayload: Member[] | { members: Member[]; invitations: Invitation[] };
      if (memberResponse.status === 403) {
        memberPayload = await readResponse<Member[]>(await fetch(`/api/members?workspace_id=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" }));
      } else {
        memberPayload = await readResponse<Member[] | { members: Member[]; invitations: Invitation[] }>(memberResponse);
      }
      const [projectData, taskData] = await Promise.all([
        readResponse<Project[]>(projectResponse),
        readResponse<Task[]>(taskResponse),
      ]);
      if (Array.isArray(memberPayload)) {
        setMembers(memberPayload);
        setInvitations([]);
      } else {
        setMembers(memberPayload.members);
        setInvitations(memberPayload.invitations);
      }
      setProjects(projectData);
      setTasks(taskData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace team data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/workspaces", { cache: "no-store" })
      .then((response) => readResponse<WorkspaceMembership[]>(response))
      .then((items) => {
        if (cancelled) return;
        setWorkspaces(items);
        const preferred = localStorage.getItem("orbit-workspace");
        const selected = items.find((item) => item.workspace_id === preferred) ?? items[0];
        if (selected) {
          setWorkspaceId(selected.workspace_id);
          localStorage.setItem("orbit-workspace", selected.workspace_id);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Your workspaces could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (workspaceId) void load(workspaceId);
  }, [load, workspaceId]);

  const activeProjects = projects.filter((project) => project.status === "Active").length;
  const projectIds = new Set(projects.map((project) => project.id));
  const workspaceTasks = tasks.filter((task) => projectIds.has(task.project_id));
  const overdueTasks = workspaceTasks.filter((task) => task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "Completed").length;
  const completedTasks = workspaceTasks.filter((task) => task.status === "Completed").length;
  const completion = useMemo(() => workspaceTasks.length ? Math.round(completedTasks / workspaceTasks.length * 100) : 0, [completedTasks, workspaceTasks.length]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId) return;
    setSaving(true);
    setError("");
    setNotice("");
    setInviteUrl("");
    try {
      const response = await fetch("/api/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, email: email.trim(), role: inviteRole }),
      });
      const result = await readResponse<{ invitation_url: string; message: string }>(response);
      setInviteUrl(result.invitation_url);
      setNotice(result.message);
      setEmail("");
      await load(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invitation could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(profileId: string, nextRole: string) {
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch("/api/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, profile_id: profileId, role: nextRole }),
      }));
      setNotice("Member role updated.");
      await load(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The role could not be changed.");
    }
  }

  async function removeMember(profileId: string, name: string) {
    if (!window.confirm(`Remove ${name} from this workspace? Their account and project data will not be deleted.`)) return;
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch("/api/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, profile_id: profileId }),
      }));
      setNotice(`${name} was removed from the workspace.`);
      await load(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The member could not be removed.");
    }
  }

  async function cancelInvitation(invitationId: string) {
    setError("");
    setNotice("");
    try {
      await readResponse(await fetch("/api/members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, invitation_id: invitationId }),
      }));
      setNotice("Invitation cancelled.");
      await load(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The invitation could not be cancelled.");
    }
  }

  async function logout() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured; you could not be signed out.");
      return;
    }
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setError(`Sign out failed: ${signOutError.message}`);
      return;
    }
    window.location.replace("/login");
  }

  async function copyInvitation() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setNotice("Invitation link copied.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy automatically. Select and copy the invitation link.");
    }
  }

  return (
    <main className="team-page">
      <header className="team-topbar">
        <Link className="settings-brand" href="/"><span className="brand-mark">◈</span><b>orbit</b></Link>
        <div className="team-topbar-account">
          <span>{userName}{userEmail ? ` · ${userEmail}` : ""}</span>
          <Link href="/settings">Settings</Link>
          <button type="button" onClick={() => void logout()} style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "12px", padding: "4px 8px", borderRadius: "6px" }} title="Sign out" aria-label="Sign out">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </header>
      <div className="team-content">
        <Link className="team-back" href="/"><ArrowLeft size={16} /> Back to workspace</Link>
        <div className="team-heading">
          <div><span className="eyebrow">PEOPLE &amp; PERMISSIONS</span><h1>Team</h1><p>Manage workspace access and see how your team is progressing.</p></div>
          {workspaces.length > 1 && <label className="team-workspace-select">Workspace
            <select value={workspaceId} onChange={(event) => {
              setWorkspaceId(event.target.value);
              localStorage.setItem("orbit-workspace", event.target.value);
              setInviteUrl("");
              setNotice("");
            }}>
              {workspaces.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{workspaceFor(item)?.name ?? "Workspace"}</option>)}
            </select>
          </label>}
        </div>

        {error && <div className="team-message error" role="alert">{error}</div>}
        {notice && <div className="team-message success" role="status">{notice}</div>}
        {loading && !workspaceId ? <div className="team-card team-loading" role="status">Loading workspaces…</div> : !workspaceId ? (
          <section className="team-card team-empty"><Users size={25} /><h2>No workspace found</h2><p>Create a workspace from the main workspace menu, then come back to manage its team.</p><Link className="secondary-button" href="/">Open workspace</Link></section>
        ) : <>
          <section className="team-stats">
            <div className="team-stat"><span>Workspace members</span><strong>{members.length}</strong><small>Current access</small></div>
            <div className="team-stat"><span>Active projects</span><strong>{activeProjects}</strong><small>Across this workspace</small></div>
            <div className="team-stat"><span>Tasks completed</span><strong>{completion}%</strong><small>{completedTasks} of {workspaceTasks.length} tasks</small></div>
            <div className="team-stat overdue"><span>Overdue tasks</span><strong>{overdueTasks}</strong><small>Open past their deadline</small></div>
          </section>

          {canManage && <section className="team-card">
            <div className="team-card-heading"><div><h2><MailPlus size={18} /> Invite a teammate</h2><p>Choose a role and send an invitation or copy a shareable link.</p></div></div>
            <form className="team-invite-form" onSubmit={(event) => void invite(event)}>
              <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" required /></label>
              <label>Workspace role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "member" | "admin" | "guest")}>
                <option value="member">Team Member</option>
                {isOwner && <option value="admin">Team Leader</option>}
                <option value="guest">Guest</option>
              </select></label>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "Creating…" : "Create invitation"}</button>
            </form>
            {inviteUrl && <div className="team-invite-link"><label>Shareable invitation link<input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /></label><button className="secondary-button" type="button" onClick={() => void copyInvitation()}><Copy size={15} />{copied ? "Copied" : "Copy link"}</button><a href={inviteUrl} target="_blank" rel="noreferrer" aria-label="Open invitation link"><ExternalLink size={16}/></a></div>}
          </section>}

          <section className="team-card">
            <div className="team-card-heading"><div><h2><Users size={18} /> Members <span className="team-count">{members.length}</span></h2><p>{canManage ? "Manage the people who can access this workspace." : `You are a ${roleLabel(role)}. Members can see only projects and tasks their access allows.`}</p></div><button className="secondary-button" type="button" onClick={() => void load(workspaceId)} disabled={loading}><RefreshCw size={15}/> Refresh</button></div>
            <div className="team-member-list">
              {members.map((member) => {
                const profile = profileFor(member);
                if (!profile) return null;
                const name = profile.full_name?.trim() || "Orbit member";
                const self = profile.id === userId;
                const protectedRole = member.role === "owner" || member.role === "admin";
                return <article className="team-member-row" key={profile.id}>
                  <span className="team-avatar">{name.slice(0, 1).toUpperCase()}</span>
                  <span className="team-member-identity"><b>{name}</b><small>Joined {new Date(member.joined_at).toLocaleDateString()}</small></span>
                  {protectedRole && <span className="team-role-icon" title="Elevated workspace role"><Shield size={14}/></span>}
                  {canManage && !self && member.role !== "owner" && (!protectedRole || isOwner) ? <div className="team-member-actions">
                    <select aria-label={`Role for ${name}`} value={member.role} onChange={(event) => void updateRole(profile.id, event.target.value)}>
                      {isOwner && <option value="admin">Team Leader</option>}
                      <option value="member">Team Member</option><option value="guest">Guest</option>
                    </select>
                    {member.role !== "owner" && <button className="team-icon-button danger" type="button" aria-label={`Remove ${name}`} onClick={() => void removeMember(profile.id, name)}><Trash2 size={16}/></button>}
                  </div> : <span className={`team-role-badge ${member.role === "owner" ? "owner" : member.role === "admin" ? "leader" : ""}`}>{roleLabel(member.role)}</span>}
                </article>;
              })}
              {!members.length && <p className="team-empty-row">No workspace members were returned.</p>}
            </div>
          </section>

          {canManage && <section className="team-card">
            <div className="team-card-heading"><div><h2>Invitations <span className="team-count">{invitations.length}</span></h2><p>Pending links expire after seven days. Accepted and expired invitations remain visible for reference.</p></div></div>
            <div className="team-invitation-list">
              {invitations.map((invitation) => {
                const status = invitation.accepted_at ? "Accepted" : new Date(invitation.expires_at) <= new Date() ? "Expired" : "Pending";
                return <article className="team-invitation-row" key={invitation.id}>
                  <span><b>{invitation.email}</b><small>{roleLabel(invitation.role)} · Sent {new Date(invitation.created_at).toLocaleDateString()}</small></span>
                  <span className={`team-status ${status.toLowerCase()}`}>{status}</span>
                  <span className="team-invitation-date">{status === "Accepted" ? `Accepted ${new Date(invitation.accepted_at!).toLocaleDateString()}` : `Expires ${new Date(invitation.expires_at).toLocaleDateString()}`}</span>
                  {status === "Pending" && <button className="team-icon-button danger" type="button" aria-label={`Cancel invitation for ${invitation.email}`} onClick={() => void cancelInvitation(invitation.id)}><Trash2 size={16}/></button>}
                </article>;
              })}
              {!invitations.length && <p className="team-empty-row">No invitations yet.</p>}
            </div>
          </section>}

          {canManage && <div className="team-footer-link"><Link className="secondary-button" href="/projects"><ArrowLeft size={15}/> Projects</Link><span>Project creation and task assignment are available from your workspace.</span></div>}
        </>}
      </div>
    </main>
  );
}
