import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw, Shield, User } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch, type User as UserType } from "../lib/api";
import type { SettingsResponse } from "../types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Field, Input, Switch } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { ConfirmDialog } from "../components/ui/dialog";
import { useToast } from "../components/ui/toast";
import { Spinner, ErrorState } from "../components/ui/states";
import { cn } from "../lib/utils";

export function SettingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useApi<SettingsResponse>("/settings");

  const [profileName, setProfileName] = useState<string | null>(null);
  const [passwords, setPasswords] = useState({ current_password: "", new_password: "", confirm: "" });
  const [settingsDraft, setSettingsDraft] = useState<Partial<SettingsResponse> | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const saveProfile = useApiMutation<{ full_name: string }, UserType>(
    (body) => apiFetch("/auth/profile", { method: "PATCH", body }),
    {
      successMessage: "Profile updated",
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api"] }),
    },
  );

  const changePassword = useApiMutation<{ current_password: string; new_password: string }, unknown>(
    (body) => apiFetch("/auth/profile", { method: "PATCH", body }),
    {
      successMessage: "Password changed",
      onSuccess: () => setPasswords({ current_password: "", new_password: "", confirm: "" }),
    },
  );

  const saveSettings = useApiMutation<Partial<SettingsResponse>, SettingsResponse>(
    (body) => apiFetch("/settings", { method: "PATCH", body }),
    {
      successMessage: "Settings saved",
      onSuccess: () => {
        setSettingsDraft(null);
        queryClient.invalidateQueries({ queryKey: ["api"] });
      },
    },
  );

  const resetDemo = async () => {
    setResetting(true);
    try {
      await apiFetch("/settings/demo/reset", { method: "POST" });
      toast.success("Demo data reset to defaults");
      queryClient.invalidateQueries({ queryKey: ["api"] });
      setResetOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Heading />
        <div className="flex justify-center py-20">
          <Spinner label="Loading settings…" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-5">
        <Heading />
        <ErrorState message={error?.message ?? "Settings unavailable"} onRetry={refetch} />
      </div>
    );
  }

  const isAdmin = user?.role === "administrator";
  const currentProfileName = profileName ?? user?.full_name ?? "";
  const effectiveSettings = { ...data, ...settingsDraft };
  const editableSettings = {
    site_name: effectiveSettings.site_name,
    timezone: effectiveSettings.timezone,
    retention_days: effectiveSettings.retention_days,
    alert_cooldown_seconds: effectiveSettings.alert_cooldown_seconds,
    deduplicate_alerts: effectiveSettings.deduplicate_alerts,
    notify_email_enabled: effectiveSettings.notify_email_enabled,
    notify_slack_enabled: effectiveSettings.notify_slack_enabled,
    notify_discord_enabled: effectiveSettings.notify_discord_enabled,
    production_approval_required: effectiveSettings.production_approval_required,
  };

  return (
    <div className="space-y-5">
      <Heading />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Profile */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-accent" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Your account details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-3 p-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-cyan/60 to-violet/60 text-sm font-bold text-white">
                {(currentProfileName || "?").slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{currentProfileName}</p>
                <p className="text-xs text-ink-faint">
                  {user?.email} ·{" "}
                  <Badge tone={isAdmin ? "violet" : "cyan"}>
                    {isAdmin ? "Administrator" : "Developer"}
                  </Badge>
                </p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveProfile.mutate({ full_name: currentProfileName });
              }}
              className="space-y-3"
            >
              <Field label="Full name">
                <Input
                  value={currentProfileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  minLength={2}
                  required
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={saveProfile.isPending ?? false}>
                  Save profile
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-accent" />
              <CardTitle>Change password</CardTitle>
            </div>
            <CardDescription>Update your account password securely</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (passwords.new_password !== passwords.confirm) {
                  toast.error("New passwords do not match");
                  return;
                }
                changePassword.mutate({
                  current_password: passwords.current_password,
                  new_password: passwords.new_password,
                });
              }}
              className="space-y-3"
            >
              <Field label="Current password" required>
                <Input
                  type="password"
                  value={passwords.current_password}
                  onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })}
                  required
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="New password" required hint="Minimum 8 characters.">
                  <Input
                    type="password"
                    value={passwords.new_password}
                    onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })}
                    required
                  />
                </Field>
                <Field label="Confirm new password" required>
                  <Input
                    type="password"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                    required
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button type="submit" variant="primary" loading={changePassword.isPending ?? false}>
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Workspace settings */}
        <Card>
          <CardHeader>
            <CardTitle>Workspace settings</CardTitle>
            <CardDescription>Retention, notifications, and deployment safeguards</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (settingsDraft) saveSettings.mutate(settingsDraft);
              }}
              className="space-y-3"
            >
              <Field label="Site name">
                <Input
                  value={effectiveSettings.site_name}
                  onChange={(e) => setSettingsDraft({ ...editableSettings, site_name: e.target.value })}
                  disabled={!isAdmin}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Timezone">
                  <Input
                    value={effectiveSettings.timezone}
                    onChange={(e) => setSettingsDraft({ ...editableSettings, timezone: e.target.value })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Retention days">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={effectiveSettings.retention_days}
                    onChange={(e) => setSettingsDraft({ ...editableSettings, retention_days: Number(e.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
                <Field label="Alert cooldown (seconds)">
                  <Input
                    type="number"
                    min={0}
                    max={86400}
                    value={effectiveSettings.alert_cooldown_seconds}
                    onChange={(e) => setSettingsDraft({ ...editableSettings, alert_cooldown_seconds: Number(e.target.value) })}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
              {([
                ["deduplicate_alerts", "Deduplicate alerts"],
                ["notify_email_enabled", "Email notifications"],
                ["notify_slack_enabled", "Slack notifications"],
                ["notify_discord_enabled", "Discord notifications"],
                ["production_approval_required", "Require production approval"],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-line bg-surface-3 px-3 py-2.5">
                  <span className="text-sm text-ink">{label}</span>
                  <Switch
                    checked={effectiveSettings[key]}
                    onChange={(checked) => setSettingsDraft({ ...editableSettings, [key]: checked })}
                    label={label}
                    disabled={!isAdmin}
                  />
                </div>
              ))}
              {isAdmin ? (
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    loading={saveSettings.isPending}
                    disabled={!settingsDraft}
                  >
                    Save settings
                  </Button>
                </div>
              ) : (
                <p className="text-right text-xs text-ink-faint">
                  Only administrators can change workspace settings.
                </p>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Demo data */}
        <Card className={cn(!isAdmin && "opacity-70")}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <CardTitle>Demo data</CardTitle>
            </div>
            <CardDescription>
              Demo mode is {data.demo_mode ? "enabled" : "disabled"} for this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone={data.demo_mode ? "violet" : "slate"}>
                {data.demo_mode ? "Demo environment" : "Live environment"}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-ink-faint">
              Resetting restores the sample environment to its initial state. This operation is
              available only when demo mode is enabled.
            </p>
            {isAdmin && data.demo_mode ? (
              <Button variant="danger" onClick={() => setResetOpen(true)}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset demo data
              </Button>
            ) : !isAdmin ? (
              <p className="text-xs text-ink-faint">Administrator permission required.</p>
            ) : (
              <p className="text-xs text-ink-faint">Enable demo mode to reset sample data.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={resetDemo}
        loading={resetting}
        danger
        confirmLabel="Reset demo data"
        title="Reset demo environment?"
        message={
          <>
            Demo entities will be restored to their initial sample state. This cannot be undone;
            live credentials and integrations are not affected.
          </>
        }
      />
    </div>
  );
}

function Heading() {
  return (
    <div>
      <h1 className="text-xl font-bold text-ink sm:text-2xl">Settings</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Profile, security, workspace configuration and demo data management
      </p>
    </div>
  );
}
