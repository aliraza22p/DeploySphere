import { useState, type FormEvent } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Activity, Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Field, Input } from "../components/ui/input";
import { Spinner } from "../components/ui/states";

export function LoginPage() {
  const { login, demoLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname: string } } };
  const [email, setEmail] = useState("admin@deploysphere.dev");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const showDemoAccess = import.meta.env.VITE_SHOW_DEMO_ACCESS !== "false";

  const from = location.state?.from?.pathname ?? "/";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  };

  const onDemo = async () => {
    setError(null);
    setDemoLoading(true);
    try {
      await demoLogin();
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to start demo");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left: brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-gradient-to-br from-[#0b1220] via-[#0d1626] to-[#12203a] p-10 lg:flex">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(34,197,238,0.15), transparent 40%), radial-gradient(circle at 80% 60%, rgba(99,102,241,0.18), transparent 45%)",
          }}
          aria-hidden
        />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-violet text-white">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <p className="text-lg font-bold text-ink">DeploySphere</p>
            <p className="text-xs text-ink-faint">DevOps Deployment &amp; Monitoring Platform</p>
          </div>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-3xl font-bold leading-tight text-ink">
            Ship faster. Monitor everything.{" "}
            <span className="bg-gradient-to-r from-cyan to-violet bg-clip-text text-transparent">
              Operate with confidence.
            </span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
            Multi-stage CI/CD pipelines, live infrastructure telemetry, deployment history,
            centralized logs and intelligent alerting — all in one place.
          </p>
          <ul className="mt-6 space-y-2 text-sm text-ink-muted">
            {[
              "Pipeline builder with isolated stages",
              "CPU, memory, disk & network monitoring",
              "Alert deduplication, cooldowns and ack flow",
              "Rollback, audit trails and RBAC",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-ink-faint">
          Demo mode ships with realistic sample data — clearly labelled everywhere.
        </p>
      </div>

      {/* Right: form */}
      <div className="flex w-full items-center justify-center bg-surface-1 px-4 py-10 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-violet text-white">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-bold text-ink">DeploySphere</p>
              <p className="text-[11px] text-ink-faint">DevOps Platform</p>
            </div>
          </div>

          <h2 className="text-xl font-bold text-ink">Sign in to your account</h2>
          <p className="mt-1 text-sm text-ink-faint">
            Enter your account details to continue.
          </p>

          {showDemoAccess && (
            <div className="mt-5 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3 text-xs leading-relaxed text-ink-muted">
              <p className="font-semibold text-cyan-300">Demo access</p>
              <p className="mt-1">Use the sample administrator account for your local demo environment.</p>
              <Button
                variant="primary"
                size="sm"
                className="mt-2.5"
                loading={demoLoading}
                onClick={onDemo}
              >
                <LogIn className="mr-1.5 h-3.5 w-3.5" /> Enter demo dashboard
              </Button>
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <Field label="Email" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
              />
            </Field>

            <Field label="Password" required>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-faint hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-300"
              >
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              Sign in
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-between text-xs">
            <Link to="/reset-password" className="text-accent hover:underline">
              Forgot password?
            </Link>
            <span className="text-ink-faint">
              Need an account?{" "}
              <Link to="/register" className="text-accent hover:underline">
                Register
              </Link>
            </span>
          </div>

          {loading && (
            <div className="mt-4 flex justify-center">
              <Spinner />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
