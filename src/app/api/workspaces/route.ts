import { NextResponse } from "next/server";
import { databaseError, errorResponse, isText, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

export async function GET() {
  const { supabase, response } = await requireAuthenticatedClient();
  if (response || !supabase) return response;
  const { data, error } = await supabase.from("workspace_members").select("role, workspace:workspaces(id,name,slug,owner_id)").order("joined_at");
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isText(body.name, 1, 100)) return errorResponse("Workspace name must be between 1 and 100 characters.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response || !supabase) return response;
  const { data, error } = await supabase.rpc("create_workspace", { workspace_name: body.name.trim() });
  if (error) return databaseError(error);
  return NextResponse.json({ id: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isText(body.name, 1, 100)) {
    return errorResponse("A valid workspace_id and a workspace name (1–100 characters) are required.");
  }

  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const { data: membership, error: membershipError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", body.workspace_id).eq("profile_id", user.id).maybeSingle();
  if (membershipError) return databaseError(membershipError);
  if (membership?.role !== "owner") return errorResponse("Only the workspace owner can change its name.", 403);

  const { data, error } = await supabase.from("workspaces")
    .update({ name: body.name.trim() }).eq("id", body.workspace_id).select("id,name").single();
  if (error) return databaseError(error);
  return NextResponse.json(data);
}
