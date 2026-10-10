export type SupabasePublicConfig = { url: string; key: string };

export function getSupabaseConfigurationError(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    return "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart pnpm dev.";
  }

  try {
    const parsed = new URL(url);
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) {
      return "NEXT_PUBLIC_SUPABASE_URL must be a valid http or https URL.";
    }
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL must be a valid http or https URL.";
  }

  if (/your[-_ ]?(project|supabase)|<.*>/i.test(url) || /your[-_ ]?(key|supabase)|<.*>/i.test(key)) {
    return "Replace the Supabase template values in .env.local with your project URL and public anon/publishable key.";
  }
  if (/^sb_secret_/i.test(key)) {
    return "Use the public anon/publishable key in NEXT_PUBLIC_SUPABASE_ANON_KEY. Never put a Supabase secret key in a NEXT_PUBLIC variable.";
  }

  return null;
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  if (getSupabaseConfigurationError()) return null;
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  };
}
