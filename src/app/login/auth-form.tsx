"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseConfigurationError } from "@/lib/supabase/config";

type AuthMode = "Sign in" | "Create account" | "Reset password";

function isEmailRateLimitError(error: { code?: string; message: string; status?: number }): boolean {
  return error.code === "over_email_send_rate_limit" ||
    error.code === "email_rate_limit_exceeded" ||
    error.status === 429 ||
    /email.{0,20}rate.?limit|rate.?limit.{0,20}email/i.test(error.message);
}

export function AuthForm({ initialMode = "Sign in" }: { initialMode?: AuthMode }) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailRateLimited, setEmailRateLimited] = useState(false);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("auth_error");
    if (!error) return;
    const messages: Record<string, string> = {
      configuration: getSupabaseConfigurationError() ?? "Supabase configuration is invalid. Check .env.local and restart pnpm dev.",
      email_not_confirmed: "Confirm your email using the latest message from Supabase, then sign in again.",
      otp_expired: "This confirmation link has expired or was already used. Request a new confirmation email.",
      access_denied: "The authentication link was declined or is no longer valid. Request a new link.",
      callback: "The authentication link could not be completed. Request a fresh confirmation email or sign in again.",
    };
    const timer = window.setTimeout(() => setMessage(messages[error] ?? messages.callback), 0);
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
      if (mode === "Reset password") {
        const recoveryRedirectTo = new URL("/auth/callback", window.location.origin);
        recoveryRedirectTo.searchParams.set("next", "/reset-password");
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirectTo.toString() });
        if (error) {
          if (isEmailRateLimitError(error)) {
            setEmailRateLimited(true);
            setMessage("Supabase rejected this reset-email request because its email-send rate limit has been reached; no email was sent for this attempt. Check for an earlier reset email and use the newest link. Wait for Supabase's configured limit window to reset, then reload this page before trying once.");
          } else {
            setMessage(error.message);
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
            data: { full_name: fullName.trim() },
            emailRedirectTo: invite
              ? `${window.location.origin}/auth/callback?invite=${encodeURIComponent(invite)}`
              : `${window.location.origin}/auth/callback`,
          },
        });
      if (result.error) {
        if (result.error.code === "email_not_confirmed") {
          setMessage("Confirm your email using the latest message from Supabase, then sign in again.");
        } else if (result.error.code === "invalid_credentials") {
          setMessage("Supabase could not sign in with that email and password. Check both fields and try again.");
        } else {
          setMessage(result.error.message);
        }
        return;
      }
      if (mode === "Create account" && !result.data.session) {
        setMessage("Check your email to confirm your account. You’ll return to your workspace automatically.");
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
      setMessage(error instanceof Error
        ? `Authentication request failed: ${error.message}`
        : "Authentication request failed before Supabase returned an error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
  }

  return <div className="auth-shell"><div className="auth-card"><div className="brand-mark">◈</div><h1>{mode === "Reset password" ? "Reset your password" : "Welcome to Orbit"}</h1><p>Your team’s work, moving forward.</p><form onSubmit={submit}>
    {mode === "Create account" && <label>Full name<input required minLength={2} maxLength={100} autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} /></label>}
    <label>Email address<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
    {mode !== "Reset password" && <label>Password<input required minLength={6} type="password" autoComplete={mode === "Sign in" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>}
    {message && <span className="auth-error" role="alert">{message}</span>}
    <button className="primary-button auth-submit" disabled={loading}>{loading ? "Please wait…" : mode === "Reset password" ? "Send reset link" : mode}</button>
  </form>
  {mode === "Sign in" && <Link className="auth-switch" href="/forgot-password">Forgot your password?</Link>}
  {initialMode === "Reset password"
    ? <Link className="auth-switch" href="/login">Back to sign in</Link>
    : <button className="auth-switch" type="button" onClick={() => changeMode(mode === "Sign in" ? "Create account" : "Sign in")}>{mode === "Sign in" ? "New to Orbit? Create an account" : "Back to sign in"}</button>}
  </div></div>;
}
