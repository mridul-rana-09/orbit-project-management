import "server-only";

import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";
import { databaseError, errorResponse, isEmail, isOneOf, isUuid, readJsonObject, requireAuthenticatedClient } from "@/lib/api/request";

const assignableRoles = ["admin", "member", "guest"] as const;
type SupabaseClient = NonNullable<Awaited<ReturnType<typeof requireAuthenticatedClient>>["supabase"]>;

async function requireWorkspaceManager(supabase: SupabaseClient, workspaceId: string, userId: string) {
  const { data, error } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("profile_id", userId).maybeSingle();
  if (error) return { role: null, response: databaseError(error) };
  if (data?.role !== "owner" && data?.role !== "admin") {
    return { role: data?.role ?? null, response: errorResponse("Only the workspace owner or a Team Leader can manage members and invitations.", 403) };
  }
  return { role: data.role, response: null };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const workspaceId = requestUrl.searchParams.get("workspace_id");
  if (!isUuid(workspaceId)) return errorResponse("A valid workspace_id is required.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Supabase is not configured", 503);
  const { data: membership, error: membershipError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("profile_id", user.id).maybeSingle();
  if (membershipError) return databaseError(membershipError);
  if (!membership) return errorResponse("You are not a member of this workspace.", 403);

  const { data: members, error } = await supabase.from("workspace_members")
    .select("role, joined_at, profile:profiles(id,full_name,avatar_url)")
    .eq("workspace_id", workspaceId).order("joined_at");
  if (error) return databaseError(error);
  if (requestUrl.searchParams.get("include_invitations") !== "true") return NextResponse.json(members);

  const access = await requireWorkspaceManager(supabase, workspaceId, user.id);
  if (access.response) return access.response;
  const { data: invitations, error: invitationError } = await supabase.from("workspace_invitations")
    .select("id,token,email,role,invited_by,created_at,expires_at,accepted_at")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (invitationError) return databaseError(invitationError);
  return NextResponse.json({ members, invitations });
}

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isEmail(body.email)) return errorResponse("A valid workspace_id and email address are required.");
  const role = body.role ?? "member";
  if (!isOneOf(role, assignableRoles)) return errorResponse("Choose Team Leader, Team Member, or Guest.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const access = await requireWorkspaceManager(supabase, body.workspace_id, user.id);
  if (access.response) return access.response;
  if (role === "admin" && access.role !== "owner") {
    return errorResponse("Only the workspace owner can invite a Team Leader.", 403);
  }

  const email = body.email.trim().toLowerCase();
  const { data: invitation, error } = await supabase.from("workspace_invitations").upsert({
    workspace_id: body.workspace_id,
    email,
    role,
    invited_by: user.id,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    accepted_at: null,
  }, { onConflict: "workspace_id,email" }).select("id,token,email,role,created_at,expires_at,accepted_at").single();
  if (error) return databaseError(error);

  const origin = new URL(request.url).origin;
  const invitationUrl = new URL("/login", origin);
  invitationUrl.searchParams.set("invite", invitation.token);
  let emailSent = false;
  let emailMessage = "Invitation link created. Copy and share the link to invite this person.";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleKey) {
    const publicConfig = getSupabasePublicConfig();
    if (!publicConfig) return errorResponse("Supabase public configuration is missing or invalid.", 503);
    const admin = createSupabaseAdmin(
      publicConfig.url,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const emailRedirectTo = new URL("/auth/callback", origin);
    emailRedirectTo.searchParams.set("invite", invitation.token);
    const { error: deliveryError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: emailRedirectTo.toString(),
      data: { orbit_invitation_token: invitation.token },
    });
    if (!deliveryError) {
      emailSent = true;
      emailMessage = "Supabase sent the invitation email.";
    } else if (deliveryError.code === "email_exists" || deliveryError.code === "user_already_exists") {
      emailMessage = "This person already has a Supabase account. Share the invitation link so they can sign in with this email.";
    } else {
      emailMessage = "The invitation link was created, but Supabase could not send the email. Share the link or check the project's Auth email settings.";
    }
  } else {
    emailMessage = "Invitation link created, but email delivery is not configured. Add SUPABASE_SERVICE_ROLE_KEY as a server-only variable to enable Supabase invitation emails.";
  }

  return NextResponse.json({ invitation, invitation_url: invitationUrl.toString(), email_sent: emailSent, message: emailMessage }, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await readJsonObject(request);
  if (!body || !isUuid(body.workspace_id) || !isUuid(body.profile_id) || !isOneOf(body.role, assignableRoles)) {
    return errorResponse("A workspace, profile, and valid assignable role are required.");
  }
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const access = await requireWorkspaceManager(supabase, body.workspace_id, user.id);
  if (access.response) return access.response;
  if (body.role === "admin" && access.role !== "owner") {
    return errorResponse("Only the workspace owner can assign the Team Leader role.", 403);
  }
  const { data: target, error: targetError } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", body.workspace_id).eq("profile_id", body.profile_id).maybeSingle();
  if (targetError) return databaseError(targetError);
  if (target?.role === "owner") return errorResponse("The workspace owner role cannot be changed.", 403);
  if (access.role !== "owner") {
    if (target?.role === "admin") {
      return errorResponse("Only the workspace owner can change another owner's or Team Leader's role.", 403);
    }
  }
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
  if (!body || !isUuid(body.workspace_id)) return errorResponse("A valid workspace_id is required.");
  const { supabase, user, response } = await requireAuthenticatedClient();
  if (response) return response;
  if (!supabase || !user) return errorResponse("Unauthorized", 401);
  const access = await requireWorkspaceManager(supabase, body.workspace_id, user.id);
  if (access.response) return access.response;

  if (isUuid(body.invitation_id)) {
    if (access.role !== "owner") {
      const { data: invitation, error: invitationError } = await supabase.from("workspace_invitations")
        .select("role").eq("workspace_id", body.workspace_id).eq("id", body.invitation_id).maybeSingle();
      if (invitationError) return databaseError(invitationError);
      if (invitation?.role === "admin") return errorResponse("Only the workspace owner can cancel a Team Leader invitation.", 403);
    }
    const { data, error } = await supabase.from("workspace_invitations").delete()
      .eq("workspace_id", body.workspace_id).eq("id", body.invitation_id)
      .select("id").maybeSingle();
    if (error) return databaseError(error);
    if (!data) return errorResponse("Invitation not found or access was denied.", 404);
    return new NextResponse(null, { status: 204 });
  }

  if (!isUuid(body.profile_id)) return errorResponse("A valid profile_id or invitation_id is required.");
  if (access.role !== "owner") {
    const { data: target, error: targetError } = await supabase.from("workspace_members")
      .select("role").eq("workspace_id", body.workspace_id).eq("profile_id", body.profile_id).maybeSingle();
    if (targetError) return databaseError(targetError);
    if (target?.role === "owner" || target?.role === "admin") {
      return errorResponse("Only the workspace owner can remove another owner or Team Leader.", 403);
    }
  }
  const { data, error } = await supabase.from("workspace_members").delete()
    .eq("workspace_id", body.workspace_id).eq("profile_id", body.profile_id)
    .select("profile_id").maybeSingle();
  if (error) return databaseError(error);
  if (!data) return errorResponse("Member not found or access was denied.", 404);
  return new NextResponse(null, { status: 204 });
}
