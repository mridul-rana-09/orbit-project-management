import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export async function proxy(request: NextRequest) {
  const config = getSupabasePublicConfig();
  if (!config) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Supabase public configuration is missing or invalid." }, { status: 503 });
    }
    if (["/", "/login", "/signup"].includes(request.nextUrl.pathname)) return NextResponse.next({ request });
    return NextResponse.redirect(new URL("/login?auth_error=configuration", request.url));
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user && !["/", "/login", "/signup"].includes(request.nextUrl.pathname)) return NextResponse.redirect(new URL("/login", request.url));
  if (user && ["/login", "/signup"].includes(request.nextUrl.pathname)) {
    const destination = new URL("/", request.url);
    const invite = request.nextUrl.searchParams.get("invite");
    if (invite) destination.searchParams.set("invite", invite);
    return NextResponse.redirect(destination);
  }
  return response;
}

export const config = { matcher: ["/", "/login", "/signup", "/projects/:path*", "/api/:path*"] };
