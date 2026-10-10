import { NextResponse } from "next/server";
import { databaseError, errorResponse, isText, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get("task_id");
  if (!isUuid(taskId)) return errorResponse("A valid task_id is required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("comments").select("*, author:profiles!comments_author_id_fkey(full_name,avatar_url)").eq("task_id", taskId).order("created_at");
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.task_id) || !isText(body.body, 1, 5000)) return errorResponse("A valid task_id and comment body (1–5,000 characters) are required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("comments").insert({ task_id: body.task_id, body: body.body.trim() }).select("*, author:profiles!comments_author_id_fkey(full_name,avatar_url)").single();
  if (error) return databaseError(error);
  return NextResponse.json(data, { status: 201 });
}
