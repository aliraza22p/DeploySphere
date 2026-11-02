import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./components/ui/toast";
import { AppShell } from "./components/layout/AppShell";
import { PageLoader } from "./components/ui/states";
import type { ReactNode } from "react";

import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { DashboardPage } from "./pages/Dashboard";
import { PipelinesPage } from "./pages/Pipelines";
import { PipelineDetailPage } from "./pages/PipelineDetail";
import { ServersPage } from "./pages/Servers";
import { ServerDetailPage } from "./pages/ServerDetail";
import { ApplicationsPage } from "./pages/Applications";
import { DeploymentsPage } from "./pages/Deployments";
import { DeploymentDetailPage } from "./pages/DeploymentDetail";
import { AlertsPage } from "./pages/Alerts";
import { LogsPage } from "./pages/Logs";
import { RepositoriesPage } from "./pages/Repositories";
import { TeamPage } from "./pages/Team";
import { IntegrationsPage } from "./pages/Integrations";
import { AuditPage } from "./pages/Audit";
import { SettingsPage } from "./pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10_000,
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const location = useLocation();
  if (!ready) return <PageLoader label="Checking your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  if (!ready) return <PageLoader label="Checking your session…" />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Routes>
              <Route
                path="/login"
                element={
                  <GuestOnly>
                    <LoginPage />
                  </GuestOnly>
                }
              />
              <Route
                path="/register"
                element={
                  <GuestOnly>
                    <RegisterPage />
                  </GuestOnly>
                }
              />
              <Route
                path="/reset-password"
                element={
                  <GuestOnly>
                    <ResetPasswordPage />
                  </GuestOnly>
                }
              />

              <Route
                element={
                  <RequireAuth>
                    <AppShell>
                      <Outlet />
                    </AppShell>
                  </RequireAuth>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/pipelines" element={<PipelinesPage />} />
                <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
                <Route path="/servers" element={<ServersPage />} />
                <Route path="/servers/:id" element={<ServerDetailPage />} />
                <Route path="/applications" element={<ApplicationsPage />} />
                <Route path="/deployments" element={<DeploymentsPage />} />
                <Route path="/deployments/:id" element={<DeploymentDetailPage />} />
                <Route path="/alerts" element={<AlertsPage />} />
                <Route path="/logs" element={<LogsPage />} />
                <Route path="/repositories" element={<RepositoriesPage />} />
                <Route path="/team" element={<TeamPage />} />
                <Route path="/integrations" element={<IntegrationsPage />} />
                <Route path="/audit" element={<AuditPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
