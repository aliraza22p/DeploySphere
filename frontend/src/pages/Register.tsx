// @ts-nocheck
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, ArrowLeft } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Field, Input } from "../components/ui/input";
import { useToast } from "../components/ui/toast";

export function RegisterPage() {
  const { register, login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await register({
        email: form.email.trim(),
        full_name: form.full_name.trim() || form.email.split("@")[0],
        password: form.password,
      });
      toast.success("Account created — you are signed in");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
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
            <p className="text-[11px] text-ink-faint">Create your account</p>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-bold text-ink">Register</h2>
          <p className="mt-1 text-sm text-ink-faint">
            New accounts start with the <span className="text-ink-muted">Developer</span> role and
            can be promoted by an administrator.
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <Field label="Full name" required>
              <Input value={form.full_name} onChange={set("full_name")} required autoFocus />
            </Field>
            <Field label="Email" required>
              <Input type="email" value={form.email} onChange={set("email")} required />
            </Field>
            <Field label="Password" required hint="Minimum 8 characters.">
              <Input type="password" value={form.password} onChange={set("password")} required />
            </Field>
            <Field label="Confirm password" required>
              <Input type="password" value={form.confirm} onChange={set("confirm")} required />
            </Field>

            {error && (
              <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              Create account
            </Button>
          </form>

          <div className="mt-4 flex items-center justify-between text-xs">
            <Link to="/login" className="flex items-center gap-1 text-accent hover:underline">
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </Link>
            <Link to="/reset-password" className="text-ink-faint hover:text-ink">
              Forgot password?
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
