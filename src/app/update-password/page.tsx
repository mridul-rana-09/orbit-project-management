import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordClient from "@/app/reset-password/reset-password-client";

export const metadata: Metadata = {
  title: "Update password — Orbit",
  description: "Choose a new password for your Orbit account.",
};

export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  let hasServerSession = false;
  if (supabase) {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      hasServerSession = !error && Boolean(user);
    } catch {
      hasServerSession = false;
    }
  }

  return <ResetPasswordClient initialHasSession={hasServerSession} />;
}
