import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const invite = requestUrl.searchParams.get("invite");
  const requestedNext = requestUrl.searchParams.get("next");
  const destination = new URL(requestedNext === "/reset-password" ? "/reset-password" : "/", requestUrl);
  const loginError = (reason = "callback") => {
    const url = new URL("/login", requestUrl);
    url.searchParams.set("auth_error", reason);
    if (requestedNext === "/reset-password") url.searchParams.set("auth_flow", "recovery");
    return NextResponse.redirect(url);
  };
  const supabase = await createClient();

  if (!supabase) {
    return loginError("configuration");
  }
  if (!code) {
    const callbackError = requestUrl.searchParams.get("error_code");
    if (callbackError === "otp_expired" || callbackError === "email_not_confirmed" || callbackError === "access_denied") {
      return loginError(callbackError);
    }
    return loginError("callback");
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (error.code === "otp_expired" || error.code === "email_not_confirmed" || error.code === "access_denied") {
      return loginError(error.code);
    }
    return loginError("callback");
  }

  if (invite) {
    if (!uuidPattern.test(invite)) {
      destination.searchParams.set("auth_error", "invitation");
      return NextResponse.redirect(destination);
    }
    const { data: workspaceId, error: invitationError } = await supabase.rpc("accept_workspace_invitation", { invitation_token: invite });
    if (invitationError) {
      destination.searchParams.set("auth_error", "invitation");
      return NextResponse.redirect(destination);
    }
    destination.searchParams.set("workspace", workspaceId);
  }

  return NextResponse.redirect(destination);
}
