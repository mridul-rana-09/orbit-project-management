import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ProjectsClient from "./projects-client";

export const metadata: Metadata = {
  title: "Projects — Orbit",
  description: "Browse and manage projects in your Orbit workspace.",
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const supabase = await createClient();
  if (!supabase) redirect("/login?auth_error=configuration");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const params = await searchParams;

  const metadataName = user.user_metadata?.full_name;
  const userName = typeof metadataName === "string" && metadataName.trim()
    ? metadataName
    : user.email?.split("@")[0] ?? "Account";

  return <ProjectsClient userName={userName} openCreate={params.new === "1"} />;
}
