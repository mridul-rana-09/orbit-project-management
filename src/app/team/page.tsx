import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TeamClient from "./team-client";

export const metadata: Metadata = {
  title: "Team — Orbit",
  description: "Manage workspace members, roles, invitations, and team progress.",
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invitation?: string }> }) {
  const supabase = await createClient();
  if (!supabase) redirect("/login?auth_error=configuration");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const metadataName = user.user_metadata?.full_name;
  const userName = typeof metadataName === "string" && metadataName.trim()
    ? metadataName
    : user.email?.split("@")[0] ?? "Account";

  const params = await searchParams;
  const invitationNotice = params.invitation === "invalid"
    ? "This invitation is invalid, expired, or has already been accepted. Ask a workspace manager for a new invitation."
    : "";

  return <TeamClient userId={user.id} userName={userName} userEmail={user.email ?? ""} initialNotice={invitationNotice} />;
}
