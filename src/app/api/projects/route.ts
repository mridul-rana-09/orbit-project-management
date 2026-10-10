import { NextResponse } from "next/server";
import { databaseError, errorResponse, isIsoDateOrNull, isOneOf, isText, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const projectStatuses = ["Planning", "Active", "On Hold", "Completed", "Archived"] as const;
const projectFields = ["name", "description", "status", "color", "start_date", "due_date"] as const;

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export async function GET(request: Request) {
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const workspaceId = new URL(request.url).searchParams.get("workspace_id");
  if (workspaceId !== null && !isUuid(workspaceId)) return errorResponse("A valid workspace_id is required.");
  let query = supabase.from("projects").select("*, tasks(id,status), project_members(profile_id, role)").order("updated_at", { ascending: false });
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data, error } = await query;
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isText(body.name, 1, 120)) return errorResponse("A workspace and a project name (1–120 characters) are required.");
  if (!isOptionalProjectFieldsValid(body) || !isDateRangeValid(body)) return errorResponse("Project status, description, color, or dates are invalid.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const { data, error } = await supabase.from("projects").insert({
    workspace_id: body.workspace_id,
    name: body.name.trim(),
    description: typeof body.description === "string" ? body.description.trim() : "",
    status: body.status ?? "Planning",
    color: body.color ?? "#7968e8",
    start_date: body.start_date ?? null,
    due_date: body.due_date ?? null,
    created_by: user.id,
  }).select().single();
  if (error) return databaseError(error);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.id)) return errorResponse("A valid project id is required.");
  if (!isOptionalProjectFieldsValid(body) || !isDateRangeValid(body)) return errorResponse("Project status, description, color, or dates are invalid.");
  const updates = Object.fromEntries(projectFields.filter((key) => key in body).map((key) => [key, key === "name" && typeof body[key] === "string" ? body[key].trim() : body[key]]));
  if (Object.keys(updates).length === 0) return errorResponse("Provide at least one project field to update.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("projects").update(updates).eq("id", body.id).select().single();
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return errorResponse("A valid project id is required.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const { data: project, error: projectError } = await supabase.from("projects").select("workspace_id").eq("id", id).maybeSingle();
  if (projectError) return databaseError(projectError);
  if (!project) return errorResponse("Project not found or access was denied.", 404);
  const { data: membership, error: membershipError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", project.workspace_id).eq("profile_id", user.id).maybeSingle();
  if (membershipError) return databaseError(membershipError);
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    return errorResponse("Only workspace owners and admins can delete projects.", 403);
  }

  const { data: tasks, error: tasksError } = await supabase.from("tasks").select("id").eq("project_id", id);
  if (tasksError) return databaseError(tasksError);
  const taskIds = (tasks ?? []).map((task) => task.id);
  if (taskIds.length) {
    const { data: files, error: filesError } = await supabase.from("attachments").select("storage_path").in("task_id", taskIds);
    if (filesError) return databaseError(filesError);
    if (files?.length) {
      const { error: storageError } = await supabase.storage.from("task-attachments").remove(files.map((file) => file.storage_path));
      if (storageError) return databaseError(storageError);
    }
  }

  const { data, error } = await supabase.from("projects").delete().eq("id", id).select("id").maybeSingle();
  if (error) return databaseError(error);
  if (!data) return errorResponse("Project not found or access was denied.", 404);
  return new NextResponse(null, { status: 204 });
}

function isOptionalProjectFieldsValid(body: Record<string, unknown>) {
  return (!("name" in body) || isText(body.name, 1, 120))
    && (!("description" in body) || isText(body.description, 0, 5000))
    && (!("status" in body) || isOneOf(body.status, projectStatuses))
    && (!("color" in body) || isColor(body.color))
    && (!("start_date" in body) || isIsoDateOrNull(body.start_date))
    && (!("due_date" in body) || isIsoDateOrNull(body.due_date));
}

function isDateRangeValid(body: Record<string, unknown>) {
  return typeof body.start_date !== "string"
    || typeof body.due_date !== "string"
    || body.start_date <= body.due_date;
}
