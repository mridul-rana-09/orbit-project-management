import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = (requestUrl.searchParams.get("type") as EmailOtpType | null) || (requestUrl.searchParams.get("next") === "/reset-password" ? "recovery" : null);
  const invite = requestUrl.searchParams.get("invite");
  const requestedNext = requestUrl.searchParams.get("next");
  const destination = new URL(requestedNext === "/reset-password" ? "/reset-password" : "/", requestUrl);

  const loginError = (reason = "callback") => {
    const url = new URL("/login", requestUrl);
    url.searchParams.set("auth_error", reason);
    if (requestedNext === "/reset-password") url.searchParams.set("auth_flow", "recovery");
    return NextResponse.redirect(url);
  };

  const config = getSupabasePublicConfig();
  if (!config) {
    return loginError("configuration");
  }

  const callbackError = requestUrl.searchParams.get("error_code") || requestUrl.searchParams.get("error");
  if (callbackError) {
    if (callbackError === "otp_expired" || callbackError === "access_denied" || callbackError === "email_not_confirmed") {
      return loginError(callbackError);
    }
    return loginError("invalid_link");
  }

  let response = NextResponse.redirect(destination);
  const cookieStore = await cookies();
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // In case cookieStore is immutable in this context
          }
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const isExpired = error.code === "otp_expired" || /expired|already used|code.*verifier/i.test(error.message);
      return loginError(isExpired ? "otp_expired" : "invalid_link");
    }
  } else if (tokenHash && otpType) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
    if (error) {
      const isExpired = error.code === "otp_expired" || /expired|already used/i.test(error.message);
      return loginError(isExpired ? "otp_expired" : "invalid_link");
    }
  } else if (requestedNext === "/reset-password") {
    // If neither code nor token_hash is present on the server, the user may have arrived with
    // a hash fragment (#access_token=...&refresh_token=...&type=recovery).
    // The server cannot see hash fragments, so redirect directly to /reset-password to let the client handle it.
    return NextResponse.redirect(new URL("/reset-password", requestUrl));
  } else {
    return loginError("callback");
  }

  if (invite) {
    if (!uuidPattern.test(invite)) {
      return NextResponse.redirect(new URL("/team?invitation=invalid", requestUrl));
    }
    const { data: workspaceId, error: invitationError } = await supabase.rpc("accept_workspace_invitation", { invitation_token: invite });
    if (invitationError) {
      return NextResponse.redirect(new URL("/team?invitation=invalid", requestUrl));
    }
    destination.searchParams.set("workspace", workspaceId);
    response = NextResponse.redirect(destination);
  }

  return response;
}
