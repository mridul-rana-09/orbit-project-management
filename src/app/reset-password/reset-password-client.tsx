"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordClient() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [updated, setUpdated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

  return <main className="auth-shell"><section className="auth-card">
    <div className="brand-mark">◈</div>
    <h1>Choose a new password</h1>
    <p>Your reset link has authenticated this request.</p>
    <form onSubmit={(event) => void submit(event)}>
      <label>New password<input required minLength={8} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <label>Confirm password<input required minLength={8} type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
      {message && <span className="auth-error" role="alert">{message}</span>}
      <button className="primary-button auth-submit" disabled={saving}>{saving ? "Saving…" : "Update password"}</button>
    </form>
  </section></main>;
}
