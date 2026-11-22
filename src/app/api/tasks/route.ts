import { NextResponse } from "next/server";
import { databaseError, errorResponse, isIsoDateOrNull, isOneOf, isOptionalText, isText, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const taskStatuses = ["Backlog", "To Do", "In Progress", "In Review", "Completed"] as const;
const taskPriorities = ["Low", "Medium", "High", "Critical"] as const;
const taskFields = ["title", "description", "status", "priority", "due_date", "assignee_id", "position"] as const;
type SupabaseClient = NonNullable<Awaited<ReturnType<typeof requireAuthenticatedClient>>["supabase"]>;

async function getProjectAccess(supabase: SupabaseClient, projectId: string, userId: string) {
  const { data: project, error: projectError } = await supabase.from("projects")
    .select("workspace_id").eq("id", projectId).maybeSingle();
  if (projectError) return { response: databaseError(projectError), canManage: false, workspaceId: null };
  if (!project) return { response: errorResponse("Project not found or access was denied.", 404), canManage: false, workspaceId: null };

  const { data: membership, error: membershipError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", project.workspace_id).eq("profile_id", userId).maybeSingle();
  if (membershipError) return { response: databaseError(membershipError), canManage: false, workspaceId: null };
  if (!membership) return { response: errorResponse("You are not a member of this workspace.", 403), canManage: false, workspaceId: null };

  const { data: projectMembership, error: projectMembershipError } = await supabase.from("project_members")
    .select("role").eq("project_id", projectId).eq("profile_id", userId).maybeSingle();
  if (projectMembershipError) return { response: databaseError(projectMembershipError), canManage: false, workspaceId: null };
  return {
    response: null,
    workspaceId: project.workspace_id,
    canManage: membership.role === "owner" || membership.role === "admin" || projectMembership?.role === "lead",
  };
}

async function requireWorkspaceAssignee(supabase: SupabaseClient, workspaceId: string, profileId: string) {
  const { data, error } = await supabase.from("workspace_members")
    .select("profile_id").eq("workspace_id", workspaceId).eq("profile_id", profileId).maybeSingle();
  if (error) return databaseError(error);
  return data ? null : errorResponse("The assignee must be a member of this workspace.", 400);
}

export async function GET(request: Request) {
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const requestUrl = new URL(request.url);
  const projectId = requestUrl.searchParams.get("project_id");
  if (projectId !== null && !isUuid(projectId)) return errorResponse("A valid project_id is required.");
  let query = supabase.from("tasks").select("*, projects(name, color), assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url)").order("position");
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isText(body.title, 1, 200) || !isUuid(body.project_id)) return errorResponse("A project id and task title (1–200 characters) are required.");
  if (!isOptionalTaskFieldsValid(body)) return errorResponse("Task status, priority, assignee, description, or due date is invalid.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const access = await getProjectAccess(supabase, body.project_id, user.id);
  if (access.response) return access.response;
  if (!access.canManage) return errorResponse("Only workspace owners, admins, and project leads can create tasks.", 403);
  if (typeof body.assignee_id === "string") {
    if (!access.workspaceId) return errorResponse("The project workspace could not be verified.", 400);
    const assigneeResponse = await requireWorkspaceAssignee(supabase, access.workspaceId, body.assignee_id);
    if (assigneeResponse) return assigneeResponse;
  }
  const { data, error } = await supabase.from("tasks").insert({
    title: body.title.trim(), project_id: body.project_id,
    status: body.status ?? "To Do", priority: body.priority ?? "Medium",
    due_date: body.due_date ?? null, assignee_id: body.assignee_id ?? null,
    description: typeof body.description === "string" ? body.description.trim() : "",
    created_by: user.id,
    completed_at: body.status === "Completed" ? new Date().toISOString() : null,
  }).select().single();
  if (error) return databaseError(error);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.id)) return errorResponse("A valid task id is required.");
  if (!isOptionalTaskFieldsValid(body)) return errorResponse("Task title, status, priority, assignee, description, due date, or position is invalid.");
  const updates = Object.fromEntries(taskFields.filter((key) => key in body).map((key) => [
    key,
    key === "title" && typeof body[key] === "string" ? body[key].trim() : key === "description" && body[key] === null ? "" : body[key],
  ]));
  if (Object.keys(updates).length === 0) return errorResponse("Provide at least one task field to update.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const { data: task, error: taskError } = await supabase.from("tasks")
    .select("project_id,assignee_id").eq("id", body.id).maybeSingle();
  if (taskError) return databaseError(taskError);
  if (!task) return errorResponse("Task not found or access was denied.", 404);
  const access = await getProjectAccess(supabase, task.project_id, user.id);
  if (access.response) return access.response;
  if (!access.canManage && (task.assignee_id !== user.id || Object.keys(updates).some((field) => field !== "status"))) {
    return errorResponse("Members may only update the status of tasks assigned to them.", 403);
  }
  if (typeof updates.assignee_id === "string") {
    if (!access.workspaceId) return errorResponse("The project workspace could not be verified.", 400);
    const assigneeResponse = await requireWorkspaceAssignee(supabase, access.workspaceId, updates.assignee_id);
    if (assigneeResponse) return assigneeResponse;
  }
  const { data, error } = await supabase.from("tasks").update(updates).eq("id", body.id).select().single();
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return errorResponse("A valid task id is required.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const { data: task, error: taskError } = await supabase.from("tasks")
    .select("project_id").eq("id", id).maybeSingle();
  if (taskError) return databaseError(taskError);
  if (!task) return errorResponse("Task not found or access was denied.", 404);
  const access = await getProjectAccess(supabase, task.project_id, user.id);
  if (access.response) return access.response;
  if (!access.canManage) return errorResponse("Only workspace owners, admins, and project leads can delete tasks.", 403);
  const { data: attachments, error: attachmentsError } = await supabase.from("attachments").select("storage_path").eq("task_id", id);
  if (attachmentsError) return databaseError(attachmentsError);
  if (attachments?.length) {
    const { error: storageError } = await supabase.storage.from("task-attachments").remove(attachments.map(file => file.storage_path));
    if (storageError) return databaseError(storageError);
  }
  const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error);
  if (!data) return errorResponse("Task not found or access was denied.", 404);
  return new NextResponse(null, { status: 204 });
}

function isOptionalTaskFieldsValid(body: Record<string, unknown>) {
  return (!("title" in body) || isText(body.title, 1, 200))
    && (!("description" in body) || isOptionalText(body.description, 10000))
    && (!("status" in body) || isOneOf(body.status, taskStatuses))
    && (!("priority" in body) || isOneOf(body.priority, taskPriorities))
    && (!("due_date" in body) || isIsoDateOrNull(body.due_date))
    && (!("assignee_id" in body) || body.assignee_id === null || isUuid(body.assignee_id))
    && (!("position" in body) || (typeof body.position === "number" && Number.isFinite(body.position) && body.position >= 0));
}
