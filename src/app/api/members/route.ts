import { NextResponse } from "next/server";
import { databaseError, errorResponse, isEmail, isOneOf, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const assignableRoles = ["admin", "member", "guest"] as const;

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspace_id");
  if (!isUuid(workspaceId)) return errorResponse("A valid workspace_id is required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("workspace_members")
    .select("role, joined_at, profile:profiles(id,full_name,avatar_url)")
    .eq("workspace_id", workspaceId).order("joined_at");
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isEmail(body.email)) return errorResponse("A valid workspace_id and email address are required.");
  const role = body.role ?? "member";
  if (!isOneOf(role, assignableRoles)) return errorResponse("Invitation role must be admin, member, or guest.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const { data, error } = await supabase.from("workspace_invitations").upsert({
    workspace_id: body.workspace_id,
    email: body.email.trim().toLowerCase(),
    role,
    invited_by: user.id,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    accepted_at: null,
  }, { onConflict: "workspace_id,email" }).select("token,email,role,expires_at").single();
  if (error) return databaseError(error);
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isUuid(body.profile_id) || !isOneOf(body.role, assignableRoles)) {
    return errorResponse("A workspace, profile, and valid assignable role are required.");
  }
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("workspace_members")
    .update({ role: body.role })
    .eq("workspace_id", body.workspace_id)
    .eq("profile_id", body.profile_id)
    .select("workspace_id,profile_id,role")
    .single();
  if (error) return databaseError(error);
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isUuid(body.profile_id)) return errorResponse("A valid workspace_id and profile_id are required.");
  const { supabase, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase) return errorResponse("Supabase is not configured", 503);
  const { data, error } = await supabase.from("workspace_members").delete()
    .eq("workspace_id", body.workspace_id).eq("profile_id", body.profile_id)
    .select("profile_id").maybeSingle();
  if (error) return databaseError(error);
  if (!data) return errorResponse("Member not found or access was denied.", 404);
  return new NextResponse(null, { status: 204 });
}
