import { NextResponse } from "next/server";
import { databaseError, errorResponse, isIsoDateOrNull, isOneOf, isOptionalText, isText, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const taskStatuses = ["Backlog", "To Do", "In Progress", "In Review", "Completed"] as const;
const taskPriorities = ["Low", "Medium", "High", "Critical"] as const;
const taskFields = ["title", "description", "status", "priority", "due_date", "assignee_id", "position"] as const;

export async function GET() {
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("tasks").select("*, projects(name), assignee:profiles!tasks_assignee_id_fkey(full_name, avatar_url)").order("position");
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isText(body.title, 1, 200) || !isUuid(body.project_id)) return errorResponse("A project id and task title (1–200 characters) are required.");
  if (!isOptionalTaskFieldsValid(body)) return errorResponse("Task status, priority, assignee, description, or due date is invalid.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("tasks").insert({
    title: body.title.trim(), project_id: body.project_id,
    status: body.status ?? "To Do", priority: body.priority ?? "Medium",
    due_date: body.due_date ?? null, assignee_id: body.assignee_id ?? null,
    description: typeof body.description === "string" ? body.description.trim() : "",
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
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("tasks").update(updates).eq("id", body.id).select().single();
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!isUuid(id)) return errorResponse("A valid task id is required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
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
