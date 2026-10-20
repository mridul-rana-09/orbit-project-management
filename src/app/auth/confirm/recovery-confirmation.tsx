"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function RecoveryConfirmation({ tokenHash }: { tokenHash: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function continueToPasswordReset() {
    const supabase = createClient();
    if (!supabase) {
      setMessage("Supabase configuration is unavailable. Check the app environment and try again.");
      return;
    }

    setConfirming(true);
    setMessage("");
    try {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
      if (error) {
        const expired = error.code === "otp_expired" || /expired|already used|invalid.*token/i.test(error.message);
        setMessage(expired
          ? "This password reset link has expired or was already used. Request a new reset link."
          : error.message);
        return;
      }
      if (!data.session) {
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
    <p>{tokenHash
      ? "Continue to verify this one-time link and choose a new password."
      : "This password reset link is incomplete or invalid. Request a new one."}</p>
    {message && <span className="auth-error" role="alert">{message}</span>}
    {confirmed && <p role="status">Link verified. Taking you to choose a new password…</p>}
    {tokenHash && !confirmed && <button className="primary-button auth-submit" type="button" disabled={confirming} onClick={() => void continueToPasswordReset()}>
      {confirming ? "Verifying…" : "Continue to set new password"}
    </button>}
    <Link className="auth-switch" href="/forgot-password">Request a new reset link</Link>
    <Link className="auth-switch" href="/login">Back to sign in</Link>
  </section></main>;
}
