import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

function isAuthServiceUnavailable(error: unknown): boolean {
  if (error instanceof TypeError && /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message)) return true;
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  const status = error.status;
  return typeof status !== "number" || status === 0 || status >= 500;
}

function serviceUnavailableResponse(request: NextRequest): NextResponse {
  const message = "Supabase Auth is temporarily unreachable. Verify the project URL and check DNS or network connectivity.";
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 503 });
  }
  if (["/login", "/signup"].includes(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }
  return new NextResponse(message, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export async function proxy(request: NextRequest) {
  const config = getSupabasePublicConfig();
  if (!config) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Supabase public configuration is missing or invalid." }, { status: 503 });
    }
    if (["/", "/login", "/signup", "/reset-password"].includes(request.nextUrl.pathname)) return NextResponse.next({ request });
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
  let user: User | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error && isAuthServiceUnavailable(error)) {
      return serviceUnavailableResponse(request);
    }
    user = data.user;
  } catch (error) {
    if (!isAuthServiceUnavailable(error)) throw error;
    return serviceUnavailableResponse(request);
  }
  if (!user && request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user && !["/", "/login", "/signup", "/reset-password"].includes(request.nextUrl.pathname)) return NextResponse.redirect(new URL("/login", request.url));
  if (user && ["/login", "/signup"].includes(request.nextUrl.pathname)) {
    const destination = new URL("/", request.url);
    const invite = request.nextUrl.searchParams.get("invite");
    if (invite) destination.searchParams.set("invite", invite);
    return NextResponse.redirect(destination);
  }
  return response;
}

export const config = { matcher: ["/", "/login", "/signup", "/reset-password", "/projects/:path*", "/settings/:path*", "/team/:path*", "/api/:path*"] };
