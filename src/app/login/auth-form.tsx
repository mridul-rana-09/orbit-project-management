"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfigurationError, getSupabasePublicConfig } from "@/lib/supabase/config";

type AuthMode = "Sign in" | "Create account" | "Reset password";

function getSupabaseFetchErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error) || !/failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(error.message)) return null;
  const config = getSupabasePublicConfig();
  const host = config ? new URL(config.url).host : "the configured Supabase host";
  return `Could not reach Supabase Auth at ${host}: ${error.message}. The browser received no HTTP response. Check DevTools > Network for DNS, CORS, or blocked-request details, and verify this project URL in Supabase Dashboard > Project Settings > API.`;
}

function isEmailRateLimitError(error: { code?: string; message: string; status?: number }): boolean {
  return error.code === "over_email_send_rate_limit" ||
    error.code === "email_rate_limit_exceeded" ||
    error.status === 429 ||
    /email.{0,20}rate.?limit|rate.?limit.{0,20}email/i.test(error.message);
}

function getAuthErrorMessage(error: { code?: string; message: string; status?: number }): string {
  const fetchErrorMessage = getSupabaseFetchErrorMessage(error);
  if (fetchErrorMessage) return fetchErrorMessage;

  switch (error.code) {
    case "email_not_confirmed":
      return "Confirm your email using the latest message from Supabase, then sign in again.";
    case "invalid_credentials":
      return "Supabase could not sign in with that email and password. Check both fields and try again.";
    case "user_already_exists":
    case "email_exists":
      return "An account may already exist for this email. Try signing in instead.";
    case "signup_disabled":
      return "New account creation is currently disabled for this Supabase project.";
    case "over_email_send_rate_limit":
      return "Supabase's email-send limit has been reached. No email was sent for this request. Wait for the configured limit window to reset, then reload and try once.";
    case "weak_password":
    case "password_too_short":
      return "Choose a stronger password that meets this Supabase project's password requirements.";
    case "redirect_to_not_allowed":
      return "Supabase rejected the confirmation redirect URL. Add this app's /auth/callback URL to the Auth redirect allow list.";
    default:
      if (error.status !== undefined && error.status >= 500) {
        return "Supabase Auth is temporarily unavailable. Wait a moment and try again.";
      }
      return error.message;
  }
}

export function AuthForm({ initialMode = "Sign in" }: { initialMode?: AuthMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [emailRateLimited, setEmailRateLimited] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("auth_error");
    if (!error) return;
    const isRecovery = params.get("auth_flow") === "recovery";
    const messages: Record<string, string> = {
      configuration: getSupabaseConfigurationError() ?? "Supabase configuration is invalid. Check .env.local and restart pnpm dev.",
      service_unavailable: "Supabase Auth is temporarily unavailable. Check your network connection and try again.",
      email_not_confirmed: "Confirm your email using the latest message from Supabase, then sign in again.",
      otp_expired: isRecovery
        ? "This password reset link has expired or was already used. Request a fresh reset link below."
        : "This one-time link has expired or was already used. Request a fresh link and open it in the same browser.",
      invalid_link: isRecovery
        ? "This password reset link is invalid or has already been used. Request a fresh reset link below."
        : "This authentication link is invalid or has already been used. Request a fresh email link.",
      invitation: "This workspace invitation is no longer valid. Ask a workspace owner or Team Leader for a new invitation.",
      access_denied: "The authentication link was declined or is no longer valid. Request a new link.",
      callback: isRecovery
        ? "This password reset link could not be verified (it may have expired or was opened in a different browser). Request a fresh reset link below."
        : "The authentication link could not be completed. Request a fresh confirmation email or sign in again.",
    };
    const timer = window.setTimeout(() => {
      if (isRecovery) {
        setMode("Reset password");
      }
      setVerificationPending(error === "email_not_confirmed" || (error === "otp_expired" && !isRecovery));
      setMessage(messages[error] ?? messages.callback);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const supabase = createClient();
      if (!supabase) {
        setMessage(getSupabaseConfigurationError() ?? "Supabase configuration is invalid. Check .env.local and restart pnpm dev.");
        return;
      }

      const invite = new URLSearchParams(window.location.search).get("invite");
      const emailRedirectTo = new URL("/auth/callback", window.location.origin);
      if (invite) emailRedirectTo.searchParams.set("invite", invite);
      if (mode === "Reset password") {
        const recoveryRedirectTo = new URL("/auth/callback", window.location.origin);
        recoveryRedirectTo.searchParams.set("next", "/reset-password");
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirectTo.toString() });
        if (error) {
          if (isEmailRateLimitError(error)) {
            setEmailRateLimited(true);
            setMessage("Supabase rejected this reset-email request because its email-send rate limit has been reached; no email was sent for this attempt. Check for an earlier reset email and use the newest link. Wait for Supabase's configured limit window to reset, then reload this page before trying once.");
          } else {
            setMessage(getAuthErrorMessage(error));
          }
          return;
        }
        setMessage("Supabase accepted the request. If an account exists for that email, a reset message should arrive shortly. Check your inbox and spam folder before requesting another.");
        return;
      }

      const result = mode === "Sign in"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              ...(invite ? { orbit_invitation_token: invite } : {}),
            },
            emailRedirectTo: emailRedirectTo.toString(),
          },
        });
      if (result.error) {
        if (result.error.code === "email_not_confirmed") setVerificationPending(true);
        setMessage(getAuthErrorMessage(result.error));
        return;
      }
      if (!result.data.session) {
        if (mode === "Create account") setVerificationPending(true);
        setMessage(mode === "Create account"
          ? "Check your inbox for a confirmation link. You must confirm your email before signing in."
          : "Supabase did not return an authenticated session. Please try signing in again.");
        return;
      }

      if (invite) {
        const { data: workspaceId, error } = await supabase.rpc("accept_workspace_invitation", { invitation_token: invite });
        if (error) {
          setMessage(error.message);
          return;
        }
        localStorage.setItem("orbit-workspace", workspaceId);
      }
      router.replace("/");
      router.refresh();
    } catch (error) {
      const fetchErrorMessage = getSupabaseFetchErrorMessage(error);
      if (fetchErrorMessage) {
        setMessage(fetchErrorMessage);
      } else {
        setMessage(error instanceof Error
          ? getAuthErrorMessage({ message: error.message })
          : "Authentication request failed before Supabase returned an error. Check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function resendVerificationEmail() {
    const supabase = createClient();
    if (!supabase) {
      setMessage(getSupabaseConfigurationError() ?? "Supabase configuration is invalid. Check .env.local and restart pnpm dev.");
      return;
    }
    if (!email.trim()) {
      setMessage("Enter the email address that needs confirmation first.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const invite = new URLSearchParams(window.location.search).get("invite");
      const emailRedirectTo = new URL("/auth/callback", window.location.origin);
      if (invite) emailRedirectTo.searchParams.set("invite", invite);
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: { emailRedirectTo: emailRedirectTo.toString() },
      });
      if (error) setMessage(getAuthErrorMessage(error));
      else setMessage("If this address has an unconfirmed account, a new confirmation link has been sent.");
    } catch (error) {
      setMessage(error instanceof Error
        ? getAuthErrorMessage({ message: error.message })
        : "The confirmation email could not be requested. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setVerificationPending(false);
  }

  return <div className="auth-shell"><div className="auth-card"><div className="brand-mark">◈</div><h1>{mode === "Reset password" ? "Reset your password" : "Welcome to Orbit"}</h1><p>{mode === "Reset password" ? "We’ll email you a secure password reset link." : "Your team’s work, moving forward."}</p><form onSubmit={submit}>
    {mode === "Create account" && <label>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} /></label>}
    <label>Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setEmailRateLimited(false); }} /></label>
    {mode !== "Reset password" && <label>Password<input required minLength={6} type="password" autoComplete={mode === "Sign in" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>}
    {message && <span className="auth-error" role="alert">{message}</span>}
    <button className="primary-button auth-submit" disabled={loading || (mode === "Reset password" && emailRateLimited)}>{loading ? "Please wait…" : emailRateLimited && mode === "Reset password" ? "Email limit reached" : mode === "Reset password" ? "Send reset link" : mode}</button>
  </form>
  {verificationPending && <button className="auth-switch" type="button" disabled={loading} onClick={() => void resendVerificationEmail()}>{loading ? "Please wait…" : "Resend confirmation email"}</button>}
  {mode === "Sign in" && <Link className="auth-switch" href="/forgot-password">Forgot your password?</Link>}
  {initialMode === "Reset password"
    ? <Link className="auth-switch" href="/login">Back to sign in</Link>
    : <button className="auth-switch" type="button" onClick={() => changeMode(mode === "Sign in" ? "Create account" : "Sign in")}>{mode === "Sign in" ? "New to Orbit? Create an account" : "Back to sign in"}</button>}
  </div></div>;
}
