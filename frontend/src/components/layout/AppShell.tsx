import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  GitBranch,
  Server,
  Boxes,
  Rocket,
  BellRing,
  ScrollText,
  GitFork,
  Users,
  Puzzle,
  ClipboardList,
  Settings,
  Activity,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useLiveStatus } from "../../lib/live-status";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const mainNav: NavItem[] = [
  { to: "/", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: "/pipelines", label: "Pipelines", icon: <GitBranch className="h-4 w-4" /> },
  { to: "/servers", label: "Servers", icon: <Server className="h-4 w-4" /> },
  { to: "/applications", label: "Applications", icon: <Boxes className="h-4 w-4" /> },
  { to: "/deployments", label: "Deployments", icon: <Rocket className="h-4 w-4" /> },
  { to: "/alerts", label: "Alerts", icon: <BellRing className="h-4 w-4" /> },
  { to: "/logs", label: "Log Explorer", icon: <ScrollText className="h-4 w-4" /> },
];

const configNav: NavItem[] = [
  { to: "/repositories", label: "Repositories", icon: <GitFork className="h-4 w-4" /> },
  { to: "/team", label: "Team", icon: <Users className="h-4 w-4" /> },
  { to: "/integrations", label: "Integrations", icon: <Puzzle className="h-4 w-4" /> },
  { to: "/audit", label: "Audit Log", icon: <ClipboardList className="h-4 w-4" /> },
  { to: "/settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

function NavItemLink({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      end={item.to === "/"}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent/70",
          isActive
            ? "bg-accent/15 text-accent"
            : "text-ink-muted hover:bg-surface-4 hover:text-ink",
        )
      }
    >
      <span className="shrink-0">{item.icon}</span>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

function SidebarContent({
  collapsed,
  mobile,
  onNavigate,
}: {
  collapsed: boolean;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "administrator";

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-4",
          collapsed && !mobile && "justify-center px-0",
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent to-violet text-white">
          <Activity className="h-4 w-4" />
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-ink">DeploySphere</p>
            <p className="text-[10px] uppercase tracking-widest text-ink-faint">DevOps Platform</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {mainNav.map((item) => (
          <NavItemLink key={item.to} item={item} collapsed={collapsed && !mobile} onNavigate={onNavigate} />
        ))}

        <p className={cn("px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-ink-faint", collapsed && !mobile && "invisible")}>
          Configuration
        </p>
        {configNav
          .filter((item) => item.to !== "/team" || isAdmin)
          .map((item) => (
            <NavItemLink key={item.to} item={item} collapsed={collapsed && !mobile} onNavigate={onNavigate} />
          ))}
      </nav>

      <div className={cn("border-t border-line px-3 py-3", collapsed && !mobile && "px-2")}>
        <div className={cn("flex items-center gap-2.5", collapsed && !mobile && "justify-center")}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan/60 to-violet/60 text-xs font-bold text-white">
            {(user?.full_name ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          {(!collapsed || mobile) && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-ink">{user?.full_name}</p>
              <p className="truncate text-[11px] text-ink-faint">
                {user?.email} · {user?.role === "administrator" ? "Administrator" : user?.role === "viewer" ? "Viewer" : "Developer"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveIndicator() {
  const status = useLiveStatus();
  const label =
    status === "connected"
      ? "Live updates"
      : status === "connecting"
        ? "Connecting…"
        : "Updates paused";

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-line bg-surface-3 px-3 py-1.5 md:flex"
      title="Real-time updates over WebSocket"
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          status === "connected" && "bg-emerald-400 animate-pulse-dot",
          status === "connecting" && "bg-amber-400 animate-pulse-dot",
          status === "disconnected" && "bg-ink-faint",
        )}
      />
      <span className="text-[11px] font-medium text-ink-muted">{label}</span>
    </div>
  );
}

function Topbar({ onMenu, onToggleSidebar }: { onMenu: () => void; onToggleSidebar: () => void }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const isAdmin = user?.role === "administrator";

  const crumbs = pathname.split("/").filter(Boolean);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface-1/95 px-4 backdrop-blur">
      <button
        onClick={onMenu}
        aria-label="Open navigation"
        className="rounded-md p-2 text-ink-muted hover:bg-surface-4 focus-visible:ring-2 focus-visible:ring-accent/70 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <button
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="hidden rounded-md p-2 text-ink-muted hover:bg-surface-4 focus-visible:ring-2 focus-visible:ring-accent/70 lg:block"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-xs sm:flex">
        <span className="text-ink-faint">DeploySphere</span>
        {crumbs.length === 0 ? (
          <span className="text-ink-muted">/ Overview</span>
        ) : (
          crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="text-ink-faint">/</span>
              <span className={i === crumbs.length - 1 ? "text-ink" : "text-ink-muted capitalize"}>
                {crumb.replace(/-/g, " ")}
              </span>
            </span>
          ))
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-ink-faint xl:flex">
          <Search className="h-3.5 w-3.5" />
          <span className="text-[11px]">Use the sidebar to navigate</span>
        </div>
        <LiveIndicator />
        {user && (
          <div className="flex items-center gap-2">
            <Badge tone={isAdmin ? "violet" : "cyan"}>
              <ShieldCheck className="mr-1 h-3 w-3" />
              {user?.role === "administrator"
                ? "Administrator"
                : user?.role === "viewer"
                  ? "Viewer"
                  : "Developer"}
            </Badge>
            <button
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-2 text-ink-muted hover:bg-surface-4 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-accent/70"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 border-r border-line bg-surface-2 transition-[width] duration-200 lg:block",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <SidebarContent collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface-2 shadow-2xl">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-3 rounded p-1.5 text-ink-faint hover:bg-surface-4 hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent collapsed={false} mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} onToggleSidebar={() => setCollapsed((c) => !c)} />
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        <footer className="border-t border-line px-4 py-3 text-center text-[11px] text-ink-faint sm:px-6">
          DeploySphere — automated CI/CD pipelines, infrastructure monitoring &amp; alerting · demo mode
          powered by sample data
        </footer>
      </div>
    </div>
  );
}
