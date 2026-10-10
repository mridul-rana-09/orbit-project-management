import { LandingPage } from "@/components/landing-page";
import DashboardClient from "./dashboard-client";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return <DashboardClient />;
  }

  return <LandingPage />;
}
