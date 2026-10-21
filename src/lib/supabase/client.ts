import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "./config";

export function createClient() {
  const config = getSupabasePublicConfig();
  return config
    ? createBrowserClient(config.url, config.key, {
      auth: { detectSessionInUrl: false },
    })
    : null;
}
