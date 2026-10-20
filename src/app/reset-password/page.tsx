import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordClient from "./reset-password-client";

export const metadata: Metadata = {
  title: "Reset password — Orbit",
  description: "Choose a new password for your Orbit account.",
};

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  if (!supabase) redirect("/login?auth_error=configuration");

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?auth_error=invalid_link");

  return <ResetPasswordClient />;
}
