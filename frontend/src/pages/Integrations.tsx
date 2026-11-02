import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Puzzle,
  Slack,
  MessageSquare,
  Mail,
  Webhook,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { Integration } from "../types";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Field } from "../components/ui/input";
import { Modal } from "../components/ui/dialog";
import { StatusBadge, Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { formatRelative } from "../lib/utils";

const PROVIDER_META: Record<
  string,
  { label: string; icon: typeof Slack; color: string; blurb: string }
> = {
  slack: {
    label: "Slack",
    icon: Slack,
    color: "bg-pink-500/15 text-pink-300",
    blurb: "Route alerts to a Slack channel via an incoming webhook URL.",
  },
  discord: {
    label: "Discord",
    icon: MessageSquare,
    color: "bg-indigo-500/15 text-indigo-300",
    blurb: "Post alerts to a Discord channel with a webhook URL.",
  },
  email: {
    label: "Email",
    icon: Mail,
    color: "bg-amber-500/15 text-amber-300",
    blurb: "SMTP delivery of alert notifications (server-side credentials).",
  },
  github: {
    label: "GitHub",
    icon: Webhook,
    color: "bg-slate-500/15 text-slate-300",
    blurb: "Repository events, webhooks and CI/CD triggers.",
  },
};

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const { data, isLoading, error, refetch } = useApi<Integration[]>(
    "/integrations",
    { refetchInterval: 30_000 },
  );

  const save = useApiMutation<{ key: string; config: Record<string, string> }, Integration>(
    ({ key, config: values }) => apiFetch(`/integrations/${key}`, {
      method: "PATCH",
      body: { config: values },
    }),
    {
      successMessage: "Integration saved",
      onSuccess: () => {
        setSelected(null);
        setTestResult(null);
        queryClient.invalidateQueries({ queryKey: ["api"] });
      },
    },
  );

  const clearConfig = useApiMutation<string, Integration>(
    (key) => apiFetch(`/integrations/${key}`, { method: "PATCH", body: { clear: true } }),
    {
      successMessage: "Credentials removed",
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["api"] });
        refetch();
      },
    },
  );

  const items = data ?? [];

  const openConfig = (key: string) => {
    setSelected(key);
    setConfig({});
    setTestResult(null);
    // Prefill from the server's non-secret config (masked values excluded).
    const existing = items.find((i) => i.key === key);
    if (existing) {
      setConfig(
        Object.fromEntries(
          Object.entries(existing.config ?? {})
            .filter(([, v]) => typeof v === "string")
            .map(([k, v]) => [k, String(v)]),
        ),
      );
    }
  };

  const runTest = async () => {
    if (!selected) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{ ok: boolean; message: string }>(
        `/integrations/${selected}/test`,
        { method: "POST" },
      );
      setTestResult(res);
      queryClient.invalidateQueries({ queryKey: ["api"] });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : "Connection test failed",
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Integrations</h1>
          <p className="mt-1 text-sm text-ink-faint">
            Notification and repository connections — credentials stay server-side, connection state
            is verified before being reported
          </p>
        </div>
      </div>

      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading integrations…" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No integrations available"
            description="The server exposes integration endpoints once configured. Check the backend settings."
            icon={<Puzzle className="h-5 w-5" />}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {items.map((intg) => {
            const meta = PROVIDER_META[intg.key] ?? {
              label: intg.name,
              icon: Puzzle,
              color: "bg-slate-500/15 text-slate-300",
              blurb: intg.description,
            };
            const Icon = meta.icon;
            const configured = intg.configured;
            const failed = intg.last_test_ok === false;

            return (
              <Card key={intg.key} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${meta.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-ink">{meta.label}</p>
                      <p className="text-[11px] uppercase tracking-wider text-ink-faint">
                        {intg.category}
                      </p>
                    </div>
                  </div>
                  <StatusBadge
                    status={configured ? "healthy" : failed ? "critical" : "offline"}
                    label={configured ? "configured" : "not configured"}
                  />
                </div>

                <p className="mt-3 flex-1 text-xs leading-relaxed text-ink-faint">{intg.description || meta.blurb}</p>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone={configured ? "green" : "amber"}>
                    <KeyRound className="mr-1 h-3 w-3" />
                    {configured ? "configured" : "missing credentials"}
                  </Badge>
                  {intg.last_tested_at && (
                    <span className="self-center text-[11px] text-ink-faint">
                      tested {formatRelative(intg.last_tested_at)}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex gap-2 border-t border-line pt-3">
                  <Button size="sm" variant="primary" className="flex-1" onClick={() => openConfig(intg.key)}>
                    {configured ? "Manage" : "Configure"}
                  </Button>
                  {configured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Clear integration configuration"
                      onClick={() => clearConfig.mutate(intg.key)}
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {!configured && (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400/90">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Not configured — add the required settings and test the connection.
                    No fake success is reported until a connection test passes.
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Configuration modal */}
      <Modal
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          setTestResult(null);
        }}
        title={`${selected ? PROVIDER_META[selected]?.label ?? selected : ""} integration`}
        description={selected ? PROVIDER_META[selected]?.blurb : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>
              Close
            </Button>
            <Button variant="secondary" loading={testing} onClick={runTest} disabled={!selected}>
              Test connection
            </Button>
            <Button
              variant="primary"
              loading={save.isPending}
              onClick={() => selected && save.mutate({ key: selected, config })}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
            {selected === "github" && (
              <div>
                <Field label="Personal access token" hint="Stored server-side; the value is never returned to the browser.">
                  <Input
                    type="password"
                    className="font-mono"
                    value={config.token ?? ""}
                    onChange={(e) => setConfig({ ...config, token: e.target.value })}
                    placeholder="Enter token"
                  />
                </Field>
              </div>
            )}

            {(selected === "slack" || selected === "discord") && (
              <Field
                label="Webhook URL"
                hint="Kept in server-side configuration; the browser never receives it back."
              >
                <Input
                  className="font-mono"
                  value={config.webhook_url ?? ""}
                  onChange={(e) => setConfig({ ...config, webhook_url: e.target.value })}
                  placeholder={
                    selected === "slack"
                      ? "https://hooks.slack.com/services/…"
                      : "https://discord.com/api/webhooks/…"
                  }
                />
              </Field>
            )}

            {selected === "email" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="SMTP host">
                  <Input
                    value={config.smtp_host ?? ""}
                    onChange={(e) => setConfig({ ...config, smtp_host: e.target.value })}
                    placeholder="smtp.example.com"
                  />
                </Field>
                <Field label="SMTP port">
                  <Input
                    type="number"
                    value={config.smtp_port ?? "587"}
                    onChange={(e) => setConfig({ ...config, smtp_port: e.target.value })}
                  />
                </Field>
                <Field label="Username">
                  <Input
                    value={config.username ?? ""}
                    onChange={(e) => setConfig({ ...config, username: e.target.value })}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    type="password"
                    value={config.smtp_password ?? ""}
                    onChange={(e) => setConfig({ ...config, smtp_password: e.target.value })}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="From address">
                    <Input
                      type="email"
                      value={config.from_address ?? ""}
                      onChange={(e) => setConfig({ ...config, from_address: e.target.value })}
                      placeholder="deploysphere@example.com"
                    />
                  </Field>
                </div>
              </div>
            )}

            {testResult && (
              <div
                role="status"
                className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                  testResult.ok
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/40 bg-red-500/10 text-red-300"
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>
      </Modal>
    </div>
  );
}
