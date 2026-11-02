import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowLeft, MailCheck, KeyRound } from "lucide-react";
import { ApiError, apiFetch } from "../lib/api";
import { Button } from "../components/ui/button";
import { Field, Input } from "../components/ui/input";

/**
 * Password reset flow: request a reset email, then set a new password with
 * the emailed token. In demo mode the dev endpoint reveals the token so the
 * flow can be exercised end to end.
 */
export function ResetPasswordPage() {
  const [step, setStep] = useState<"request" | "set">("request");
  const [email, setEmail] = useState("admin@deploysphere.dev");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ status: string; dev_reset_token?: string }>(
        "/auth/forgot-password",
        { method: "POST", body: { email } },
      );
      if (res.dev_reset_token) setDevToken(res.dev_reset_token);
      setMessage(
        res.dev_reset_token
          ? "Reset token issued — use the development token below to set a new password."
          : `If an account exists for ${email}, a reset link has been issued.`,
      );
      setStep("set");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const onSet = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await apiFetch("/auth/reset-password", {
        method: "POST",
        body: { email, token, new_password: password },
      });
      setMessage("Password updated. You can now sign in with your new password.");
      setDevToken(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-1 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-violet text-white">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-bold text-ink">DeploySphere</p>
            <p className="text-[11px] text-ink-faint">Account recovery</p>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
            <KeyRound className="h-5 w-5 text-accent" /> Reset password
          </h2>

          {step === "request" ? (
            <form onSubmit={onRequest} className="mt-5 space-y-4">
              <p className="text-sm text-ink-faint">
                Enter your account email and we&apos;ll send a reset token.
              </p>
              <Field label="Email" required>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
                Send reset link
              </Button>
            </form>
          ) : (
            <form onSubmit={onSet} className="mt-5 space-y-4">
              <p className="text-sm text-ink-faint">
                {message ?? "Enter the reset token and your new password."}
              </p>
              <Field label="Reset token" required hint="Check your email — or use the development token shown below.">
                <Input value={token} onChange={(e) => setToken(e.target.value)} required />
              </Field>
              <Field label="New password" required>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <Field label="Confirm new password" required>
                <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </Field>
              <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
                Update password
              </Button>
            </form>
          )}

          {devToken && (
            <div className="mt-4 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-xs">
              <p className="font-semibold text-violet-300">Development token (demo mode)</p>
              <p className="mt-1 break-all font-mono text-ink-muted">{devToken}</p>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-xs">
            <Link to="/login" className="flex items-center gap-1 text-accent hover:underline">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
            {message && (
              <span className="flex items-center gap-1 text-emerald-400">
                <MailCheck className="h-3.5 w-3.5" /> {step === "set" ? "Ready" : "Sent"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
