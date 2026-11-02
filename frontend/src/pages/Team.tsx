import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Shield, Search, UserCheck, UserX } from "lucide-react";
import { useApi, useApiMutation } from "../lib/hooks";
import { apiFetch } from "../lib/api";
import type { TeamUser, Page as PageT, InviteUserResult } from "../types";
import { useAuth } from "../lib/auth";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input, Field } from "../components/ui/input";
import { Modal, ConfirmDialog } from "../components/ui/dialog";
import { StatusBadge, Badge } from "../components/ui/badge";
import { EmptyState, ErrorState, TableSkeleton } from "../components/ui/states";
import { Table, THead, TBody, TR, TH, TD } from "../components/ui/table";
import { formatRelative } from "../lib/utils";

export function TeamPage() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = me?.role === "administrator";
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({
    email: "",
    full_name: "",
    role: "developer",
  });
  const [inviteResult, setInviteResult] = useState<InviteUserResult | null>(null);
  const [roleTarget, setRoleTarget] = useState<TeamUser | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<TeamUser | null>(null);

  const { data, isLoading, error, refetch } = useApi<PageT<TeamUser>>("/users?page_size=100");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["api"] });

  const invite = useApiMutation<object, InviteUserResult>(
    (body) => apiFetch("/users", { method: "POST", body }),
    {
      successMessage: (result) => result.message,
      onSuccess: (result) => {
        setInviteOpen(false);
        setForm({ email: "", full_name: "", role: "developer" });
        setInviteResult(result);
        invalidate();
      },
    },
  );

  const changeRole = useApiMutation<{ id: number; role: string }, unknown>(
    ({ id, role }) => apiFetch(`/users/${id}/role`, { method: "PATCH", body: { role } }),
    {
      successMessage: "Role updated",
      onSuccess: () => {
        setRoleTarget(null);
        invalidate();
      },
    },
  );

  const toggleActive = useApiMutation<{ id: number; is_active: boolean }, unknown>(
    ({ id, is_active }) => apiFetch(`/users/${id}`, { method: "PATCH", body: { is_active } }),
    {
      successMessage: "User updated",
      onSuccess: () => {
        setDeactivateTarget(null);
        invalidate();
      },
    },
  );

  const users = (data?.items ?? []).filter(
    (u) =>
      u.full_name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.role.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink sm:text-2xl">Team</h1>
          <p className="mt-1 text-sm text-ink-faint">
            User management with role-based access control — server-side enforced
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" onClick={() => setInviteOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add user
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total users" value={data?.total ?? "—"} />
        <Stat
          label="Administrators"
          value={(data?.items ?? []).filter((u) => u.role === "administrator").length}
          tone="violet"
        />
        <Stat
          label="Developers"
          value={(data?.items ?? []).filter((u) => u.role === "developer").length}
          tone="cyan"
        />
        <Stat
          label="Inactive"
          value={(data?.items ?? []).filter((u) => !u.is_active).length}
          tone="amber"
        />
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card>
        {error ? (
          <ErrorState message={error.message} onRetry={refetch} />
        ) : isLoading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : users.length === 0 ? (
          <EmptyState
            title="No users found"
            description="Adjust your search, or invite a teammate to collaborate on pipelines and deployments."
            icon={<Users className="h-5 w-5" />}
          />
        ) : (
          <Table>
            <THead>
              <TH>User</TH>
              <TH className="hidden sm:table-cell">Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH className="hidden lg:table-cell">Last login</TH>
              <TH className="text-right">Actions</TH>
            </THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-cyan/60 to-violet/60 text-xs font-bold text-white">
                        {u.full_name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-ink">
                          {u.full_name}
                          {u.id === me?.id && (
                            <span className="ml-1.5 text-[10px] text-ink-faint">(you)</span>
                          )}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD className="hidden sm:table-cell">{u.email}</TD>
                  <TD>
                    <Badge tone={u.role === "administrator" ? "violet" : u.role === "developer" ? "cyan" : "slate"}>
                      <Shield className="mr-1 h-3 w-3" />
                      {u.role}
                    </Badge>
                  </TD>
                  <TD>
                    <StatusBadge
                      status={u.is_active ? "healthy" : "offline"}
                      label={u.is_active ? "active" : "disabled"}
                    />
                  </TD>
                  <TD className="hidden text-xs lg:table-cell">
                    {u.last_login_at ? formatRelative(u.last_login_at) : "never"}
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    {isAdmin ? (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" disabled={u.id === me?.id} onClick={() => setRoleTarget(u)}>
                          Change role
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title={u.is_active ? "Deactivate" : "Activate"}
                          disabled={u.id === me?.id}
                          onClick={() => setDeactivateTarget(u)}
                        >
                          {u.is_active ? (
                            <UserX className="h-3.5 w-3.5 text-red-400" />
                          ) : (
                            <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                          )}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-right text-[11px] text-ink-faint">read-only</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {!isAdmin && (
        <p className="text-center text-xs text-ink-faint">
          Only administrators can invite users or change roles.
        </p>
      )}

      {/* Invite modal */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Add a user"
        description="Creates an account directly (invitation emails require SMTP configuration)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={invite.isPending}
              onClick={() =>
                invite.mutate({
                  email: form.email,
                  full_name: form.full_name,
                  role: form.role,
                })
              }
            >
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Full name" required>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              required
            />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Role" required>
              <select
                className="h-9 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                <option value="developer">Developer</option>
                <option value="administrator">Administrator</option>
                <option value="viewer">Viewer</option>
              </select>
          </Field>
          <div className="rounded-lg border border-line bg-surface-3 p-3 text-xs leading-relaxed text-ink-faint">
            <span className="text-ink-muted">Administrator</span> — full access including users,
            settings, production deployments and rollbacks.{" "}
            <span className="text-ink-muted">Developer</span> — pipelines, servers, alerts and
            non-production deployments; cannot manage users or workspace settings.
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(inviteResult)}
        onClose={() => setInviteResult(null)}
        title="User created"
        description={inviteResult?.message}
        footer={
          <Button variant="primary" onClick={() => setInviteResult(null)}>
            Done
          </Button>
        }
      >
        {inviteResult?.temporary_password ? (
          <Field label="Temporary password" hint="Copy this password now; it is only shown once.">
            <Input readOnly value={inviteResult.temporary_password} className="font-mono" />
          </Field>
        ) : (
          <p className="text-sm text-ink-muted">
            The user can sign in using the invitation email.
          </p>
        )}
      </Modal>

      {/* Role modal */}
      <Modal
        open={Boolean(roleTarget)}
        onClose={() => setRoleTarget(null)}
        title={`Change role — ${roleTarget?.full_name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRoleTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={changeRole.isPending}
              onClick={() => {
                if (roleTarget) {
                  const next = roleTarget.role === "administrator" ? "developer" : "administrator";
                  changeRole.mutate({ id: roleTarget.id, role: next });
                }
              }}
            >
              Switch to {roleTarget?.role === "administrator" ? "Developer" : "Administrator"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-muted">
          Role changes take effect on the user&apos;s next request and are recorded in the audit log.
        </p>
      </Modal>

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={() => {
          if (deactivateTarget)
            toggleActive.mutate({ id: deactivateTarget.id, is_active: !deactivateTarget.is_active });
        }}
        loading={toggleActive.isPending}
        danger={Boolean(deactivateTarget?.is_active)}
        confirmLabel={deactivateTarget?.is_active ? "Deactivate" : "Activate"}
        title={deactivateTarget?.is_active ? "Deactivate user?" : "Activate user?"}
        message={
          <>
            {deactivateTarget?.is_active ? (
              <>
                <strong>{deactivateTarget?.full_name}</strong> will lose access immediately; active
                sessions are revoked on their next request.
              </>
            ) : (
              <>
                <strong>{deactivateTarget?.full_name}</strong> will be able to sign in again with
                their existing password.
              </>
            )}
          </>
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number | string;
  tone?: "plain" | "violet" | "cyan" | "amber";
}) {
  const color =
    tone === "violet"
      ? "text-violet-300"
      : tone === "cyan"
        ? "text-cyan-300"
        : tone === "amber"
          ? "text-amber-300"
          : "text-ink";
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
    </Card>
  );
}
