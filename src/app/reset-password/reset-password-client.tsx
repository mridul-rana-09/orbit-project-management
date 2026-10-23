"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordClient({ initialHasSession = false }: { initialHasSession?: boolean }) {
  const [hasSession, setHasSession] = useState(initialHasSession);
  const [verifying, setVerifying] = useState(!initialHasSession);
  const [sessionError, setSessionError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if (initialHasSession) {
      return;
    }

    let isMounted = true;

    async function checkAndEstablishSession() {
      const supabase = createClient();
      if (!supabase) {
        if (isMounted) {
          setSessionError("Supabase configuration is unavailable. Check the app environment and try again.");
          setVerifying(false);
        }
        return;
      }
      const client = supabase;
      try {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const searchParams = new URLSearchParams(window.location.search);

        const errorCode = hashParams.get("error_code") || searchParams.get("error_code") || searchParams.get("auth_error");
        if (errorCode === "otp_expired") {
          if (isMounted) {
            setSessionError("This password reset link has expired or was already used. Request a fresh reset link.");
            setVerifying(false);
          }
          return;
        }
        if (errorCode) {
          if (isMounted) {
            setSessionError("This password reset link could not be verified. Request a fresh reset link.");
            setVerifying(false);
          }
          return;
        }

        // Check for token hash parameter (verifyOtp flow)
        const tokenHash = searchParams.get("token_hash");
        if (tokenHash) {
          const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          if (error) {
            const isExpired = error.code === "otp_expired" || /expired|already used/i.test(error.message);
            if (isMounted) {
              setSessionError(isExpired
                ? "This password reset link has expired or was already used. Request a fresh reset link."
                : error.message);
              setVerifying(false);
            }
            return;
          }
          if (isMounted) {
            setHasSession(true);
            setVerifying(false);
            window.history.replaceState(null, "", window.location.pathname);
          }
          return;
        }

        // Check for hash fragment tokens (#access_token=...&refresh_token=...)
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            if (isMounted) {
              setSessionError("This password reset link has expired or is no longer valid. Request a new reset link.");
              setVerifying(false);
            }
            return;
          }
          if (isMounted) {
            setHasSession(true);
            setVerifying(false);
            window.history.replaceState(null, "", window.location.pathname);
          }
          return;
        }

        // Check for PKCE code in search params
        const code = searchParams.get("code");
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) {
            const isExpired = error.code === "otp_expired" || /expired|already used|code.*verifier/i.test(error.message);
            if (isMounted) {
              setSessionError(isExpired
                ? "This password reset link has expired or was already used. Request a fresh reset link."
                : error.message);
              setVerifying(false);
            }
            return;
          }
          if (isMounted) {
            setHasSession(true);
            setVerifying(false);
            window.history.replaceState(null, "", window.location.pathname);
          }
          return;
        }

        // Check existing browser session
        const { data: { session } } = await client.auth.getSession();
        if (session) {
          if (isMounted) {
            setHasSession(true);
            setVerifying(false);
          }
          return;
        }

        // If no session found
        if (isMounted) {
          setSessionError("This password reset link is invalid, incomplete, or has expired. Request a new reset link.");
          setVerifying(false);
        }
      } catch (err) {
        if (isMounted) {
          setSessionError(err instanceof Error ? err.message : "The password reset link could not be verified.");
          setVerifying(false);
        }
      }
    }

    const authClient = createClient();
    const subscription = authClient?.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        if (isMounted) {
          setHasSession(true);
          setVerifying(false);
          setSessionError("");
        }
      }
    }).data.subscription;

    void checkAndEstablishSession();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [initialHasSession]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmation) {
      setMessage("The passwords do not match.");
      return;
    }

    const supabase = createClient();
    if (!supabase) {
      setMessage("Supabase configuration is unavailable. Check the app environment and try again.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMessage(error.message);
        return;
      }
      setUpdated(true);
      setPassword("");
      setConfirmation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The password could not be updated. Request a new reset link.");
    } finally {
      setSaving(false);
    }
  }

  if (updated) {
    return <main className="auth-shell"><section className="auth-card">
      <div className="brand-mark">◈</div>
      <h1>Password updated</h1>
      <p>Your Orbit account password has been changed successfully.</p>
      <Link className="primary-button auth-submit" href="/">Continue to Orbit</Link>
    </section></main>;
  }

  if (verifying) {
    return <main className="auth-shell"><section className="auth-card">
      <div className="brand-mark">◈</div>
      <h1>Verifying reset link</h1>
      <p>Confirming your one-time password reset session…</p>
    </section></main>;
  }

  if (sessionError || !hasSession) {
    return <main className="auth-shell"><section className="auth-card">
      <div className="brand-mark">◈</div>
      <h1>Unable to reset password</h1>
      <p role="alert" className="auth-error">{sessionError || "No active password recovery session was found."}</p>
      <Link className="primary-button auth-submit" href="/forgot-password">Request a new reset link</Link>
      <Link className="auth-switch" href="/login">Back to sign in</Link>
    </section></main>;
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand-mark">◈</div>
    <h1>Choose a new password</h1>
    <p>Enter and confirm your new password below.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm password<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {message && <span className="auth-error" role="alert">{message}</span>}
      <button className="primary-button auth-submit" disabled={saving}>{saving ? "Updating…" : "Update password"}</button>
    </form>
    <Link className="auth-switch" href="/login">Back to sign in</Link>
  </section></main>;
}
