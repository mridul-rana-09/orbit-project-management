"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Bell, CalendarDays, Check, ChevronDown, CircleHelp,
  Clock3, FolderKanban, Grid2X2, List, LogOut, MessageCircle, Moon, Plus,
  Search, Settings, SlidersHorizontal, Trash2, Users, X,
} from "lucide-react";
import "./projects.css";

type ProjectStatus = "Planning" | "Active" | "On Hold" | "Completed" | "Archived";
type TaskStatus = "Backlog" | "To Do" | "In Progress" | "In Review" | "Completed";
type TaskPriority = "Low" | "Medium" | "High" | "Critical";
type Project = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  color: string;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  tasks?: { id: string; status: TaskStatus }[];
  project_members?: { profile_id: string; role: string }[];
};
type Workspace = { id: string; name: string; slug: string };
type WorkspaceMembership = { workspace_id: string; role: string; workspace: Workspace | Workspace[] | null };
type Member = { profile_id: string; role: string; profile: { id: string; full_name: string; avatar_url: string | null } | null };
type Task = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  created_at: string;
  assignee?: { full_name: string; avatar_url: string | null } | null;
  comments?: { count: number }[];
};
type Activity = { id: string; project_id: string | null; action: string; created_at: string; actor?: { full_name: string } | null; details?: Record<string, unknown> };
type Comment = { id: string; body: string; created_at: string; author?: { full_name: string; avatar_url: string | null } | null };
type ProjectDraft = { id?: string; name: string; description: string; status: ProjectStatus; color: string; start_date: string; due_date: string };

const projectStatuses: ProjectStatus[] = ["Planning", "Active", "On Hold", "Completed", "Archived"];
const taskStatuses: TaskStatus[] = ["Backlog", "To Do", "In Progress", "In Review", "Completed"];
const taskPriorities: TaskPriority[] = ["Low", "Medium", "High", "Critical"];

class ApiRequestError extends Error {
  constructor(message: string, readonly payload: unknown) {
    super(message);
  }
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Could not reach Orbit. Check your connection and try again.");
  }

  let result: unknown = null;
  if (response.status !== 204) {
    const text = await response.text();
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Orbit returned an invalid response (${response.status}).`);
    }
  }
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : `Request failed (${response.status}).`;
    throw new ApiRequestError(message, result);
  }
  return result as T;
}

function workspaceName(membership: WorkspaceMembership) {
  const related = Array.isArray(membership.workspace) ? membership.workspace[0] : membership.workspace;
  return related?.name ?? "Workspace";
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "M";
}

function displayDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ProjectForm({
  draft,
  busy,
  onChange,
  onClose,
  onSubmit,
}: {
  draft: ProjectDraft;
  busy: boolean;
  onChange: (value: ProjectDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="projects-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="projects-dialog" onSubmit={onSubmit}>
        <div className="projects-dialog-heading">
          <div><span className="projects-kicker">{draft.id ? "PROJECT SETTINGS" : "NEW PROJECT"}</span><h2>{draft.id ? "Edit project" : "Create a project"}</h2></div>
          <button className="projects-icon-button" type="button" aria-label="Close project form" onClick={onClose}><X size={19} /></button>
        </div>
        <label>Project name <span aria-hidden="true">*</span><input required maxLength={120} autoFocus value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="e.g. Website redesign" /></label>
        <label>Description<textarea maxLength={5000} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} placeholder="What will this project deliver?" /></label>
        <div className="projects-form-row">
          <label>Status<select value={draft.status} onChange={(event) => onChange({ ...draft, status: event.target.value as ProjectStatus })}>{projectStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label>Project colour<input type="color" value={draft.color} onChange={(event) => onChange({ ...draft, color: event.target.value })} /></label>
        </div>
        <div className="projects-form-row">
          <label>Start date<input type="date" value={draft.start_date} onChange={(event) => onChange({ ...draft, start_date: event.target.value })} /></label>
          <label>Due date<input type="date" value={draft.due_date} onChange={(event) => onChange({ ...draft, due_date: event.target.value })} /></label>
        </div>
        <div className="projects-dialog-actions">
          <button className="projects-button secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="projects-button primary" type="submit" disabled={busy}>{busy ? "Saving…" : <><Check size={16} />{draft.id ? "Save changes" : "Create project"}</>}</button>
        </div>
      </form>
    </div>
  );
}

function TaskComments({ taskId }: { taskId: string }) {
  const [commentState, setCommentState] = useState<{ taskId: string; comments: Comment[]; loading: boolean; error: string }>({ taskId: "", comments: [], loading: true, error: "" });
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    requestJson<Comment[]>(`/api/comments?task_id=${encodeURIComponent(taskId)}`)
      .then((comments) => { if (!cancelled) setCommentState({ taskId, comments, loading: false, error: "" }); })
      .catch((reason: unknown) => { if (!cancelled) setCommentState({ taskId, comments: [], loading: false, error: reason instanceof Error ? reason.message : "Comments could not be loaded." }); });
    return () => { cancelled = true; };
  }, [taskId]);

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      const saved = await requestJson<Comment>("/api/comments", { method: "POST", body: JSON.stringify({ task_id: taskId, body: body.trim() }) });
      setCommentState((current) => ({ ...current, comments: [...current.comments, saved], error: "" }));
      setBody("");
    } catch (reason) {
      setCommentState((current) => ({ ...current, error: reason instanceof Error ? reason.message : "Comment could not be saved." }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="projects-comments">
      {commentState.taskId !== taskId || commentState.loading ? <p className="projects-muted">Loading comments…</p> : commentState.comments.length ? commentState.comments.map((comment) => <p className="projects-comment" key={comment.id}><b>{comment.author?.full_name ?? "Workspace member"}</b><span>{comment.body}</span><small>{displayDate(comment.created_at.slice(0, 10))}</small></p>) : <p className="projects-muted">No comments on this task yet.</p>}
      {commentState.taskId === taskId && commentState.error && <p className="projects-inline-error" role="alert">{commentState.error}</p>}
      <form className="projects-comment-form" onSubmit={addComment}><input aria-label="Write a comment" maxLength={5000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add a comment…" /><button className="projects-button primary" type="submit" disabled={saving || !body.trim()}>{saving ? "Sending…" : "Send"}</button></form>
    </div>
  );
}

const emptyProjectDraft = (): ProjectDraft => ({ name: "", description: "", status: "Planning", color: "#7968e8", start_date: "", due_date: "" });

export default function ProjectsClient({ userName, openCreate }: { userName: string; openCreate: boolean }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [initializing, setInitializing] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [sortBy, setSortBy] = useState<"deadline" | "recent">("deadline");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [draft, setDraft] = useState<ProjectDraft | null>(() => openCreate ? emptyProjectDraft() : null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [demoBusy, setDemoBusy] = useState(false);
  const [detailId, setDetailId] = useState("");
  const [taskDraft, setTaskDraft] = useState({ title: "", status: "To Do" as TaskStatus, priority: "Medium" as TaskPriority, due_date: "" });
  const [taskBusy, setTaskBusy] = useState(false);
  const [openComments, setOpenComments] = useState("");
  const [loadedKey, setLoadedKey] = useState("");

  const membership = workspaces.find((item) => item.workspace_id === workspaceId);
  const currentRole = membership?.role ?? "member";
  const canDeleteProjects = currentRole === "owner" || currentRole === "admin";
  const loading = initializing || (!!workspaceId && loadedKey !== `${workspaceId}:${reloadKey}`);
  const activeProject = projects.find((project) => project.id === detailId);
  const activeProjectTasks = useMemo(() => tasks.filter((task) => task.project_id === detailId), [tasks, detailId]);
  const projectActivity = useMemo(() => activity.filter((item) => item.project_id === detailId), [activity, detailId]);

  useEffect(() => {
    let cancelled = false;
    requestJson<WorkspaceMembership[]>("/api/workspaces")
      .then((items) => {
        if (cancelled) return;
        setWorkspaces(items);
        const savedId = localStorage.getItem("orbit-workspace");
        const selected = items.find((item) => item.workspace_id === savedId) ?? items[0];
        if (selected) {
          setWorkspaceId(selected.workspace_id);
          localStorage.setItem("orbit-workspace", selected.workspace_id);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : "Workspace access could not be checked.");
      })
      .finally(() => { if (!cancelled) setInitializing(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    const requestKey = `${workspaceId}:${reloadKey}`;
    Promise.all([
      requestJson<Project[]>(`/api/projects?workspace_id=${encodeURIComponent(workspaceId)}`),
      requestJson<Task[]>("/api/tasks"),
      requestJson<Member[]>(`/api/members?workspace_id=${encodeURIComponent(workspaceId)}`),
      requestJson<Activity[]>(`/api/activity?workspace_id=${encodeURIComponent(workspaceId)}`),
    ])
      .then(([projectRows, taskRows, memberRows, activityRows]) => {
        if (cancelled) return;
        const projectIds = new Set(projectRows.map((project) => project.id));
        setProjects(projectRows);
        setTasks(taskRows.filter((task) => projectIds.has(task.project_id)));
        setMembers(memberRows);
        setActivity(activityRows);
        setLoadError("");
        setLoadedKey(requestKey);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLoadError(reason instanceof Error ? reason.message : "Workspace projects could not be loaded.");
          setLoadedKey(requestKey);
        }
      });
    return () => { cancelled = true; };
  }, [workspaceId, reloadKey]);

  useEffect(() => {
    const theme = localStorage.getItem("orbit-theme");
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleProjects = useMemo(() => {
    const filtered = projects.filter((project) =>
      project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
      && (statusFilter === "All statuses" || project.status === statusFilter));
    return filtered.sort((first, second) => {
      if (sortBy === "recent") return new Date(second.created_at).getTime() - new Date(first.created_at).getTime();
      if (!first.due_date) return second.due_date ? 1 : 0;
      if (!second.due_date) return -1;
      return first.due_date.localeCompare(second.due_date);
    });
  }, [projects, query, sortBy, statusFilter]);

  const projectMetrics = useCallback((project: Project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id);
    const completed = projectTasks.filter((task) => task.status === "Completed").length;
    return { total: projectTasks.length, completed, progress: projectTasks.length ? Math.round(completed / projectTasks.length * 100) : 0 };
  }, [tasks]);

  function notify(message: string) {
    setToast(message);
  }

  function toggleTheme() {
    const next = !document.documentElement.classList.contains("dark");
    localStorage.setItem("orbit-theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  function switchWorkspace(nextId: string) {
    localStorage.setItem("orbit-workspace", nextId);
    setWorkspaceId(nextId);
    setDetailId("");
    setReloadKey((key) => key + 1);
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !workspaceId) return;
    const name = draft.name.trim();
    if (!name || name.length > 120) {
      notify("Project name must be between 1 and 120 characters.");
      return;
    }
    if (draft.description.length > 5000) {
      notify("Project description must be 5,000 characters or fewer.");
      return;
    }
    if (draft.start_date && draft.due_date && draft.start_date > draft.due_date) {
      notify("The due date must be on or after the start date.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(draft.id ? { id: draft.id } : { workspace_id: workspaceId }),
        name,
        description: draft.description.trim(),
        status: draft.status,
        color: draft.color,
        start_date: draft.start_date || null,
        due_date: draft.due_date || null,
      };
      const saved = await requestJson<Project>("/api/projects", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      setProjects((current) => draft.id
        ? current.map((project) => project.id === saved.id ? { ...project, ...saved } : project)
        : [{ ...saved, tasks: [], project_members: [] }, ...current]);
      setDraft(null);
      setReloadKey((key) => key + 1);
      setDetailId(saved.id);
      notify(draft.id ? "Project changes saved." : "Project saved to this workspace.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Project could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function addDemoProjects() {
    if (!workspaceId || demoBusy) return;
    const confirmed = window.confirm("Create five sample projects in the current workspace? Existing demo projects will be left unchanged.");
    if (!confirmed) return;
    setDemoBusy(true);
    try {
      const result = await requestJson<{ created: Project[]; skipped: string[] }>("/api/projects/demo", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      if (result.created.length) {
        setProjects((current) => [...result.created, ...current.filter((project) => !result.created.some((created) => created.id === project.id))]);
        setReloadKey((key) => key + 1);
      }
      notify(result.created.length
        ? `${result.created.length} demo project${result.created.length === 1 ? "" : "s"} saved; ${result.skipped.length} already existed.`
        : "Demo projects already exist. No duplicates were added.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Demo projects could not be created.";
      const partial = reason instanceof ApiRequestError
        && reason.payload !== null && typeof reason.payload === "object" && "created" in reason.payload
        && Array.isArray(reason.payload.created) ? reason.payload.created as Project[] : [];
      if (partial.length) {
        setProjects((current) => [...partial, ...current.filter((project) => !partial.some((created) => created.id === project.id))]);
        notify(`${partial.length} demo project${partial.length === 1 ? "" : "s"} were saved before this error: ${message}`);
      } else {
        notify(`Demo projects could not be created: ${message}`);
      }
      setReloadKey((key) => key + 1);
    } finally {
      setDemoBusy(false);
    }
  }

  async function deleteProject(project: Project) {
    if (!canDeleteProjects) {
      notify("Only workspace owners and admins can delete projects.");
      return;
    }
    if (!window.confirm(`Delete "${project.name}" and its tasks? This cannot be undone.`)) return;
    try {
      await requestJson<void>(`/api/projects?id=${encodeURIComponent(project.id)}`, { method: "DELETE" });
      setProjects((current) => current.filter((item) => item.id !== project.id));
      setTasks((current) => current.filter((task) => task.project_id !== project.id));
      setDetailId("");
      notify("Project deleted.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Project could not be deleted.");
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeProject || !taskDraft.title.trim()) return;
    setTaskBusy(true);
    try {
      const saved = await requestJson<Task>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({ project_id: activeProject.id, title: taskDraft.title.trim(), status: taskDraft.status, priority: taskDraft.priority, due_date: taskDraft.due_date || null }),
      });
      setTasks((current) => [...current, saved]);
      setTaskDraft({ title: "", status: "To Do", priority: "Medium", due_date: "" });
      setReloadKey((key) => key + 1);
      notify("Task saved.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Task could not be created.");
    } finally {
      setTaskBusy(false);
    }
  }

  async function updateTask(task: Task, updates: Partial<Pick<Task, "status" | "priority" | "due_date">>) {
    try {
      const saved = await requestJson<Task>("/api/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, ...updates }) });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, ...saved } : item));
      notify("Task updated.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Task could not be updated.");
    }
  }

  async function logout() {
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    if (!supabase) {
      notify("Supabase is not configured; you could not be signed out.");
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      notify(`Sign out failed: ${error.message}`);
      return;
    }
    router.replace("/login");
  }

  function membersFor(project: Project) {
    const memberIds = new Set((project.project_members ?? []).map((item) => item.profile_id));
    return members.filter((member) => memberIds.has(member.profile_id));
  }

  function projectCard(project: Project) {
    const metrics = projectMetrics(project);
    const assignedMembers = membersFor(project);
    return (
      <article className="projects-card" key={project.id}>
        <button className="projects-card-main" onClick={() => setDetailId(project.id)} aria-label={`Open ${project.name} project details`}>
          <span className="projects-card-mark" style={{ background: project.color }}><FolderKanban size={19} /></span>
          <span className="projects-card-title"><b>{project.name}</b><span className={`projects-status status-${project.status.toLowerCase().replaceAll(" ", "-")}`}>{project.status}</span></span>
          <span className="projects-card-description">{project.description || "No description added."}</span>
          <span className="projects-card-dates"><span><small>START</small><b>{displayDate(project.start_date)}</b></span><span><small>DEADLINE</small><b>{displayDate(project.due_date)}</b></span></span>
          <span className="projects-progress-label"><span>Task progress <b>{metrics.completed}/{metrics.total} completed</b></span><strong>{metrics.progress}%</strong></span>
          <span className="projects-progress-track"><i style={{ width: `${metrics.progress}%`, background: project.color }} /></span>
          <span className="projects-card-bottom"><span>{metrics.total} {metrics.total === 1 ? "task" : "tasks"}</span><span className="projects-member-stack">{assignedMembers.length ? assignedMembers.slice(0, 4).map((member) => <i key={member.profile_id} title={member.profile?.full_name ?? "Workspace member"}>{initials(member.profile?.full_name ?? "Member")}</i>) : <small>No project members</small>}</span></span>
        </button>
        <div className="projects-card-actions"><button type="button" onClick={() => setDraft({ id: project.id, name: project.name, description: project.description, status: project.status, color: project.color, start_date: project.start_date ?? "", due_date: project.due_date ?? "" })}>Edit</button><button type="button" onClick={() => void deleteProject(project)} disabled={!canDeleteProjects} title={canDeleteProjects ? "Delete project" : "Only workspace owners and admins can delete projects"}><Trash2 size={14} /><span className="sr-only">Delete project</span></button></div>
      </article>
    );
  }

  const navItems = [
    { label: "Overview", icon: FolderKanban },
    { label: "My tasks", icon: Check },
    { label: "Board", icon: SlidersHorizontal },
    { label: "Calendar", icon: CalendarDays },
    { label: "Team", icon: Users },
  ];

  return (
    <div className="projects-app">
      <aside className="projects-sidebar">
        <Link className="projects-brand" href="/"><span>◈</span> orbit</Link>
        <label className="projects-workspace-select"><small>WORKSPACE</small><span><Users size={15} /><select value={workspaceId} onChange={(event) => switchWorkspace(event.target.value)} disabled={!workspaces.length} aria-label="Current workspace">{workspaces.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{workspaceName(item)}</option>)}</select><ChevronDown size={15} /></span></label>
        <nav className="projects-side-nav" aria-label="Workspace navigation">
          {navItems.map(({ label, icon: Icon }) => <Link href={`/?view=${encodeURIComponent(label)}`} key={label} className="projects-nav-link"><Icon size={17} />{label}</Link>)}
          <Link href="/projects" className="projects-nav-link selected"><FolderKanban size={17} />Projects</Link>
          <button type="button" className="projects-nav-link" onClick={() => router.push("/?view=Overview")}><Bell size={17} />Notifications</button>
          <button type="button" className="projects-nav-link" onClick={() => router.push("/?view=Overview")}><Settings size={17} />Settings</button>
        </nav>
        <div className="projects-sidebar-footer">
          <Link className="projects-nav-link" href="/"><CircleHelp size={17} />Help center</Link>
          <div className="projects-profile"><span>{initials(userName)}</span><div><b>{userName}</b><small>{currentRole}</small></div><button type="button" title="Sign out" aria-label="Sign out" onClick={() => void logout()}><LogOut size={16} /></button></div>
        </div>
      </aside>

      <main className="projects-main">
        <header className="projects-topbar"><div><span>Workspace</span><ArrowRight size={14} /><b>{activeProject ? activeProject.name : "Projects"}</b></div><div className="projects-topbar-actions"><span className="projects-live"><i /> LIVE WORKSPACE</span><button className="projects-theme-toggle" type="button" onClick={toggleTheme} aria-label="Toggle dark theme"><Moon size={17} /></button></div></header>
        <div className="projects-content">
          {activeProject ? (
            <>
              <div className="projects-page-heading projects-detail-heading">
                <div><button className="projects-back" type="button" onClick={() => setDetailId("")}><ArrowLeft size={15} /> All projects</button><span className="projects-kicker">PROJECT OVERVIEW</span><h1>{activeProject.name}</h1><p>{activeProject.description || "No description added."}</p></div>
                <div className="projects-heading-actions"><button className="projects-button secondary" type="button" onClick={() => setDraft({ id: activeProject.id, name: activeProject.name, description: activeProject.description, status: activeProject.status, color: activeProject.color, start_date: activeProject.start_date ?? "", due_date: activeProject.due_date ?? "" })}>Edit project</button><button className="projects-button primary" type="button" onClick={() => setTaskDraft({ title: "", status: "To Do", priority: "Medium", due_date: "" })}><Plus size={16} /> Add task</button></div>
              </div>
              <section className="projects-overview-grid">
                <div className="projects-overview-card"><small>STATUS</small><span className={`projects-status status-${activeProject.status.toLowerCase().replaceAll(" ", "-")}`}>{activeProject.status}</span></div>
                <div className="projects-overview-card"><small>TASK PROGRESS</small><b>{projectMetrics(activeProject).completed} / {projectMetrics(activeProject).total} tasks · {projectMetrics(activeProject).progress}%</b><span className="projects-progress-track"><i style={{ width: `${projectMetrics(activeProject).progress}%`, background: activeProject.color }} /></span></div>
                <div className="projects-overview-card"><small>START DATE</small><b>{displayDate(activeProject.start_date)}</b></div>
                <div className="projects-overview-card"><small>DEADLINE</small><b>{displayDate(activeProject.due_date)}</b></div>
              </section>
              <div className="projects-detail-columns">
                <section className="projects-panel projects-tasks-panel">
                  <div className="projects-panel-heading"><div><h2>Tasks</h2><p>Status, priority, and deadlines for this project.</p></div><span>{activeProjectTasks.length}</span></div>
                  <form className="projects-task-create" onSubmit={createTask}>
                    <input aria-label="New task title" required maxLength={200} value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} placeholder="Add a task to this project…" />
                    <select aria-label="New task status" value={taskDraft.status} onChange={(event) => setTaskDraft({ ...taskDraft, status: event.target.value as TaskStatus })}>{taskStatuses.map((status) => <option key={status}>{status}</option>)}</select>
                    <select aria-label="New task priority" value={taskDraft.priority} onChange={(event) => setTaskDraft({ ...taskDraft, priority: event.target.value as TaskPriority })}>{taskPriorities.map((priority) => <option key={priority}>{priority}</option>)}</select>
                    <input aria-label="New task due date" type="date" value={taskDraft.due_date} onChange={(event) => setTaskDraft({ ...taskDraft, due_date: event.target.value })} />
                    <button className="projects-button primary" type="submit" disabled={taskBusy}>{taskBusy ? "Adding…" : <><Plus size={15} /> Add</>}</button>
                  </form>
                  {activeProjectTasks.length ? <div className="projects-task-list">{activeProjectTasks.map((task) => <div className="projects-task-row" key={task.id}>
                    <div className="projects-task-title"><b>{task.title}</b><small>{task.assignee?.full_name ? `Assigned to ${task.assignee.full_name}` : "Unassigned"} · {task.comments?.[0]?.count ?? 0} comments</small></div>
                    <select aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => void updateTask(task, { status: event.target.value as TaskStatus })}>{taskStatuses.map((status) => <option key={status}>{status}</option>)}</select>
                    <select aria-label={`Priority for ${task.title}`} value={task.priority} onChange={(event) => void updateTask(task, { priority: event.target.value as TaskPriority })}>{taskPriorities.map((priority) => <option key={priority}>{priority}</option>)}</select>
                    <span className="projects-task-due"><CalendarDays size={14} />{displayDate(task.due_date)}</span>
                    <button className="projects-comment-toggle" type="button" onClick={() => setOpenComments(openComments === task.id ? "" : task.id)}><MessageCircle size={15} />{openComments === task.id ? "Hide comments" : "Comments"}</button>
                    {openComments === task.id && <TaskComments taskId={task.id} />}
                  </div>)}</div> : <div className="projects-empty projects-empty-small"><Check size={19} /><b>No tasks yet</b><span>Add the first task above to start tracking work.</span></div>}
                </section>
                <aside className="projects-detail-aside">
                  <section className="projects-panel"><div className="projects-panel-heading"><div><h2>Project team</h2><p>Assigned workspace members</p></div></div>{membersFor(activeProject).length ? membersFor(activeProject).map((member) => <div className="projects-team-row" key={member.profile_id}><span>{initials(member.profile?.full_name ?? "Member")}</span><div><b>{member.profile?.full_name ?? "Workspace member"}</b><small>{member.role}</small></div></div>) : <p className="projects-muted">No project members assigned.</p>}</section>
                  <section className="projects-panel"><div className="projects-panel-heading"><div><h2>Recent activity</h2><p>Workspace activity for this project</p></div><Clock3 size={16} /></div>{projectActivity.length ? projectActivity.slice(0, 8).map((item) => <p className="projects-activity-row" key={item.id}><b>{item.actor?.full_name ?? "Workspace member"}</b><span>{item.action.replaceAll("_", " ")}</span><small>{displayDate(item.created_at.slice(0, 10))}</small></p>) : <p className="projects-muted">No recent project activity.</p>}</section>
                  <button className="projects-delete-project" type="button" disabled={!canDeleteProjects} onClick={() => void deleteProject(activeProject)}><Trash2 size={15} />Delete project</button>
                </aside>
              </div>
            </>
          ) : (
            <>
              <div className="projects-page-heading">
                <div><span className="projects-kicker">YOUR WORKSPACE</span><h1>Projects</h1><p>Plan work, track progress, and keep your team aligned.</p></div>
                <div className="projects-heading-actions"><button className="projects-button secondary" type="button" onClick={() => void addDemoProjects()} disabled={!workspaceId || demoBusy}>{demoBusy ? "Adding demos…" : <><Plus size={16} /> Add Demo Projects</>}</button><button className="projects-button primary" type="button" onClick={() => setDraft({ name: "", description: "", status: "Planning", color: "#7968e8", start_date: "", due_date: "" })} disabled={!workspaceId}><Plus size={16} /> Create project</button></div>
              </div>
              <section className="projects-toolbar">
                <label className="projects-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects by name…" /></label>
                <label className="projects-filter"><SlidersHorizontal size={15} /><select aria-label="Filter projects by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{projectStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label className="projects-filter projects-sort"><span>Sort by</span><select aria-label="Sort projects" value={sortBy} onChange={(event) => setSortBy(event.target.value as "deadline" | "recent")}><option value="deadline">Deadline</option><option value="recent">Recently created</option></select></label>
                <div className="projects-view-toggle" aria-label="Project view"><button type="button" aria-label="Grid view" aria-pressed={view === "grid"} className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2 size={17} /></button><button type="button" aria-label="List view" aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={17} /></button></div>
              </section>
              {loadError && <div className="projects-error" role="alert"><b>Workspace data could not be loaded.</b><span>{loadError}</span><button type="button" onClick={() => setReloadKey((key) => key + 1)}>Try again</button></div>}
              {initializing || loading ? <div className="projects-grid">{Array.from({ length: 6 }, (_, index) => <div className="projects-skeleton" key={index}><i /><span /><span /><b /></div>)}</div>
                : !workspaceId ? <div className="projects-empty"><FolderKanban size={25} /><h2>No workspace found</h2><p>Create or join a workspace before managing projects.</p><Link className="projects-button primary" href="/">Open workspace setup <ArrowRight size={15} /></Link></div>
                  : !loadError && projects.length === 0 ? <div className="projects-empty"><FolderKanban size={25} /><h2>No projects yet</h2><p>Create a project to give your team a shared plan, or add sample projects to explore Orbit.</p><div><button className="projects-button primary" type="button" onClick={() => setDraft({ name: "", description: "", status: "Planning", color: "#7968e8", start_date: "", due_date: "" })}><Plus size={15} /> Create your first project</button><button className="projects-button secondary" type="button" onClick={() => void addDemoProjects()} disabled={demoBusy}>Add Demo Projects</button></div></div>
                    : !loadError && visibleProjects.length === 0 ? <div className="projects-empty"><Search size={24} /><h2>No matching projects</h2><p>Try changing the search term or status filter.</p><button className="projects-button secondary" type="button" onClick={() => { setQuery(""); setStatusFilter("All statuses"); }}>Clear filters</button></div>
                      : !loadError && <div className={`projects-grid ${view === "list" ? "list-view" : ""}`}>{visibleProjects.map(projectCard)}</div>}
            </>
          )}
        </div>
      </main>
      {draft && <ProjectForm draft={draft} busy={saving} onChange={setDraft} onClose={() => setDraft(null)} onSubmit={saveProject} />}
      {toast && <div className="projects-toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}
