"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export default function RecoveryConfirmation({ tokenHash, recoveryFlow }: { tokenHash: string; recoveryFlow: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [linkUnavailable, setLinkUnavailable] = useState(false);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const errorCode = fragment.get("error_code");
    if (!errorCode) return;

    const timer = window.setTimeout(() => {
      setLinkUnavailable(true);
      setMessage(errorCode === "otp_expired"
        ? "This password reset link has expired or was already used. Request a new reset link."
        : "This password reset link could not be verified. Request a new reset link.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function continueToPasswordReset() {
    const supabase = createClient();
    if (!supabase) {
      setMessage("Supabase configuration is unavailable. Check the app environment and try again.");
      return;
    }

    setConfirming(true);
    setMessage("");
    try {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      let session: Session | null = null;
      if (tokenHash) {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
        if (error) {
          const expired = error.code === "otp_expired" || /expired|already used|invalid.*token/i.test(error.message);
          setMessage(expired
            ? "This password reset link has expired or was already used. Request a new reset link."
            : error.message);
          return;
        }
        session = data.session;
      } else {
        const accessToken = fragment.get("access_token");
        const refreshToken = fragment.get("refresh_token");
        if (fragment.get("type") !== "recovery" || !accessToken || !refreshToken) {
          setLinkUnavailable(true);
          setMessage("This password reset link is incomplete or invalid. Request a new reset link.");
          return;
        }

        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          setLinkUnavailable(true);
          setMessage("This password reset link has expired or is no longer valid. Request a new reset link.");
          return;
        }
        session = data.session;
      }

      if (!session) {
        setMessage("Supabase did not create a password reset session. Request a new reset link.");
        return;
      }

      setConfirmed(true);
      router.replace("/reset-password");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : "The password reset link could not be verified. Request a new reset link.");
    } finally {
      setConfirming(false);
    }
  }

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand-mark">◈</div>
    <h1>Verify password reset</h1>
    <p>{recoveryFlow
      ? "Continue to verify this one-time link and choose a new password."
      : "This password reset link is incomplete or invalid. Request a new one."}</p>
    {message && <span className="auth-error" role="alert">{message}</span>}
    {confirmed && <p role="status">Link verified. Taking you to choose a new password…</p>}
    {recoveryFlow && !linkUnavailable && !confirmed && <button className="primary-button auth-submit" type="button" disabled={confirming} onClick={() => void continueToPasswordReset()}>
      {confirming ? "Verifying…" : "Continue to set new password"}
    </button>}
    <Link className="auth-switch" href="/forgot-password">Request a new reset link</Link>
    <Link className="auth-switch" href="/login">Back to sign in</Link>
  </section></main>;
}
