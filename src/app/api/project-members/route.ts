import { NextResponse } from "next/server";
import { databaseError, errorResponse, isOneOf, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const projectRoles = ["lead", "member", "viewer"] as const;

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("project_id");
  if (!isUuid(projectId)) return errorResponse("A valid project_id is required.");

  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);

  const { data, error } = await supabase.from("project_members")
    .select("project_id,profile_id,role,profile:profiles(id,full_name,avatar_url)")
    .eq("project_id", projectId)
    .order("added_at");
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

async function requireProjectManager(supabase: NonNullable<Awaited<ReturnType<typeof requireAuthenticatedClient>>["supabase"]>, projectId: string, userId: string) {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("workspace_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) return { response: databaseError(projectError) };
  if (!project) return { response: errorResponse("Project not found or access was denied.", 404) };

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", project.workspace_id)
    .eq("profile_id", userId)
    .maybeSingle();
  if (membershipError) return { response: databaseError(membershipError) };
  if (membership?.role !== "owner" && membership?.role !== "admin") {
    return { response: errorResponse("Only workspace owners and admins can manage project members.", 403) };
  }

  return { response: null };
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.project_id) || !isUuid(body.profile_id) || !isOneOf(body.role, projectRoles)) {
    return errorResponse("A valid project, workspace member, and project role are required.");
  }

  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const manager = await requireProjectManager(supabase, body.project_id, user.id);
  if (manager.response) return manager.response;

  const { data, error } = await supabase.from("project_members")
    .upsert({ project_id: body.project_id, profile_id: body.profile_id, role: body.role }, { onConflict: "project_id,profile_id" })
    .select("project_id,profile_id,role")
    .single();
  if (error) return databaseError(error);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.project_id) || !isUuid(body.profile_id) || !isOneOf(body.role, projectRoles)) {
    return errorResponse("A valid project, workspace member, and project role are required.");
  }

  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const manager = await requireProjectManager(supabase, body.project_id, user.id);
  if (manager.response) return manager.response;

  const { data, error } = await supabase.from("project_members")
    .update({ role: body.role })
    .eq("project_id", body.project_id)
    .eq("profile_id", body.profile_id)
    .select("project_id,profile_id,role")
    .maybeSingle();
  if (error) return databaseError(error);
  if (!data) return errorResponse("Project member not found or access was denied.", 404);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.project_id) || !isUuid(body.profile_id)) {
    return errorResponse("A valid project and workspace member are required.");
  }

  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);

  const manager = await requireProjectManager(supabase, body.project_id, user.id);
  if (manager.response) return manager.response;

  const { data, error } = await supabase.from("project_members")
    .delete()
    .eq("project_id", body.project_id)
    .eq("profile_id", body.profile_id)
    .select("profile_id")
    .maybeSingle();
  if (error) return databaseError(error);
  if (!data) return errorResponse("Project member not found or access was denied.", 404);
  return new NextResponse(null, { status: 204 });
}
