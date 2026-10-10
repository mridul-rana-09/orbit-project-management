import { NextResponse } from "next/server";
import { databaseError, errorResponse, isUuid, requireAuthenticatedClient } from "@/lib/api/request";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id");
  if (!isUuid(workspaceId)) return errorResponse("A valid workspace_id is required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("activity_events")
    .select("*, actor:profiles(full_name,avatar_url), project:projects(name), task:tasks(title)")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50);
  if (error) return databaseError(error);
  return NextResponse.json(data);
}
