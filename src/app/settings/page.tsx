import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "./settings-client";

export const metadata: Metadata = {
  title: "Settings — Orbit",
  description: "Manage your Orbit workspace preferences and settings.",
};

export default async function SettingsPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/login?auth_error=configuration");

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const metadataName = user.user_metadata?.full_name;
  const userName = typeof metadataName === "string" && metadataName.trim()
    ? metadataName
    : user.email?.split("@")[0] ?? "Account";

  return <SettingsClient userName={userName} userEmail={user.email ?? ""} />;
}
