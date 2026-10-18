"use client";

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "next/navigation";
import {
  Bell, Calendar, Zap, Layers,
  Plus, Shield, LogOut, KeyRound, Check, ChevronLeft, Menu, X as XIcon
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { ChangePasswordModal } from "./ChangePasswordModal";
import { Button } from "@/components/ui/button";
import { BRAND_GRADIENT } from "@/components/Navbar";
import { cn } from "@/lib/utils";

export type DashboardView =
  | "my_batches"
  | "active_batches"
  | "manager_board"
  | "approvals"
  | "finance"
  | "analytics"
  | "faculty";

const DASHBOARD_VIEWS: readonly DashboardView[] = [
  "my_batches",
  "active_batches",
  "manager_board",
  "approvals",
  "finance",
  "analytics",
  "faculty",
];

/** Where a user with no `?view=` preference starts. */
const DEFAULT_DASHBOARD_VIEW: DashboardView = "active_batches";

const VIEW_QUERY_KEY = "view";

const SIDEBAR_ID = "dashboard-sidebar";
const WORKSPACE_POPOVER_ID = "dashboard-workspace-popover";
const WORKSPACE_MENU_ID = "dashboard-workspace-menu";
const WORKSPACE_HEADING_ID = "dashboard-workspace-heading";

/**
 * Breakpoints are read from Tailwind's own scale so the JS layout and the utility
 * classes cannot disagree: `md` starts at 768px and `lg` at 1024px, so "mobile"
 * is below `md` and the collapsed rail covers everything below `lg`.
 */
const MOBILE_MEDIA_QUERY = "(max-width: 767.98px)";
const TABLET_MEDIA_QUERY = "(max-width: 1023.98px)";

interface Shortcut {
  /** Human-readable hint shown in the item's tooltip. */
  label: string;
  /** `aria-keyshortcuts` value, which wants the platform key name. */
  key: string;
}

interface NavItem {
  id: DashboardView;
  label: string;
  icon: LucideIcon;
  badge: number | null;
}

interface SidebarProps {
  activeView: DashboardView;
  setActiveView: (view: DashboardView) => void;
  onOpenCreateBatch?: () => void;
  pendingApprovalsCount?: number;
  /**
   * Category filtering is owned by the page's own table toolbar. `app/page.tsx`
   * still passes both of these in, but the sidebar renders no filter control,
   * so they stay declared and unconsumed until one exists.
   */
  onFilterCategory?: (category: string) => void;
  activeCategoryFilter?: string;
}

function isDashboardView(value: string | null): value is DashboardView {
  return value !== null && (DASHBOARD_VIEWS as readonly string[]).includes(value);
}

function readViewFromLocation(): DashboardView {
  const requested = new URLSearchParams(window.location.search).get(VIEW_QUERY_KEY);
  return isDashboardView(requested) ? requested : DEFAULT_DASHBOARD_VIEW;
}

/**
 * `window.history` + `popstate` rather than `useSearchParams`: this component is
 * rendered by `app/page.tsx` without a `<Suspense>` boundary, and that file is
 * outside this change's edit scope, so the App Router's prerender requirement
 * cannot be met here. This store needs no boundary and still gives Back and
 * Forward real behaviour.
 */
const viewChangeListeners = new Set<() => void>();

function notifyViewChange(): void {
  viewChangeListeners.forEach((listener) => listener());
}

function subscribeToViewChanges(listener: () => void): () => void {
  viewChangeListeners.add(listener);
  const handlePopState = () => notifyViewChange();
  window.addEventListener("popstate", handlePopState);
  return () => {
    viewChangeListeners.delete(listener);
    window.removeEventListener("popstate", handlePopState);
  };
}

function writeViewToLocation(view: DashboardView, basePath: string, mode: "push" | "replace"): void {
  const params = new URLSearchParams(window.location.search);
  params.set(VIEW_QUERY_KEY, view);
  const href = `${basePath}?${params.toString()}`;
  if (mode === "replace") {
    window.history.replaceState(null, "", href);
  } else {
    window.history.pushState(null, "", href);
  }
  notifyViewChange();
}

/**
 * The shared `useMediaQuery` hook reports `false` until an effect syncs it, so
 * the desktop rail painted first on a phone-sized viewport. This store reads
 * `matchMedia` during the first client render instead.
 */
function subscribeToMediaQuery(query: string) {
  return (onStoreChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", onStoreChange);
    return () => media.removeEventListener("change", onStoreChange);
  };
}

function useMediaQueryStore(query: string): boolean {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => subscribeToMediaQuery(query)(onStoreChange),
    [query]
  );
  const getSnapshot = React.useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/**
 * `Ctrl+4` and `Ctrl+5` are claimed by the OS on Windows and Linux, and
 * `Ctrl+1`-`Ctrl+3` switch browser tabs, so the sequence skips both ranges.
 */
function shortcutFor(view: DashboardView, secondaryTarget: DashboardView | null): Shortcut | undefined {
  if (secondaryTarget !== null && view === secondaryTarget) return { label: "Ctrl+3", key: "Control+3" };
  if (view === "my_batches") return { label: "Ctrl+2", key: "Control+2" };
  if (view === "active_batches") return { label: "Ctrl+6", key: "Control+6" };
  if (view === "faculty") return { label: "Ctrl+7", key: "Control+7" };
  return undefined;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  setActiveView,
  onOpenCreateBatch,
  pendingApprovalsCount = 0,
}) => {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const basePath = pathname || "/";

  const requestedView = useSyncExternalStore(
    subscribeToViewChanges,
    readViewFromLocation,
    () => DEFAULT_DASHBOARD_VIEW
  );
  const isMobile = useMediaQueryStore(MOBILE_MEDIA_QUERY);
  const isTablet = useMediaQueryStore(TABLET_MEDIA_QUERY);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspacePopoverRef = useRef<HTMLDivElement | null>(null);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const workspaceMenuRef = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role?.toLowerCase() === "admin";
  const isFinance = user?.team_name?.trim().toLowerCase() === "finance" || user?.role?.toLowerCase() === "finance";
  const isApprover = user?.is_configured_approver === true;
  const canCreateBatch = !isAdmin && user?.team_name?.trim().toLowerCase() === "delivery";
  const isManager = (user?.direct_reports_count ?? 0) > 0 || user?.is_manager || user?.role?.toLowerCase() === "manager" || isAdmin;
  // A top-level manager has no manager above them, so they get every tab
  // except the Approval Queue. Configured approvers who report to someone else
  // keep the Approval tab instead.
  const isTopLevelManager = user?.role?.toLowerCase() === "manager" && !user?.manager_id;
  const canSeeManagerBoard = !isFinance && isManager;
  const canSeeAnalytics = !isFinance && isManager;
  // My Batches is the landing view for Delivery staff, which is exactly the
  // audience that creates batches and needs the schedule UI.
  const canSeeMyBatches = !isFinance && !isAdmin;
  // All Batches is the every-batch sheet. It is not Finance-exclusive any more:
  // the configured approvers (approver 1 and approver 2) work from the same
  // rows, so they get the sheet too, alongside the Finance team. A top-level
  // manager also sees it (every tab except Approval).
  const canSeeAllBatches = isFinance || isApprover || isTopLevelManager;

  // `Ctrl+3` is deliberately ambiguous: it lands on whichever queue this role is
  // expected to work from, so it can never point at a view the user cannot open.
  const secondaryShortcutTarget: DashboardView | null = isFinance
    ? "finance"
    : canSeeManagerBoard
      ? "manager_board"
      : isApprover
        ? "approvals"
        : null;

  // Display user initial or custom avatar
  const userInitial = user?.full_name ? user.full_name.charAt(0).toUpperCase() : "U";
  const userDisplayName = user?.full_name || "Operations User";
  const userDisplayEmail = user?.email || "user@enterprise-ops.com";
  const teamLabel = user?.team_name ? `${user.team_name} Team` : "Operations";
  const roleLabel = user?.role_detail?.name || user?.role || "Staff";

  const navItems: NavItem[] = [
    ...(canSeeAllBatches ? [{
      id: "finance" as const,
      label: "All Batches",
      icon: Layers,
      badge: null,
    }] : []),
    ...(canSeeMyBatches ? [{
      id: "my_batches" as const,
      label: "My Batches",
      icon: Layers,
      badge: null,
    }] : []),
    {
      id: "active_batches" as const,
      label: "Active Batches",
      icon: Layers,
      badge: null,
    },
    ...(isApprover && !isTopLevelManager ? [{
      id: "approvals" as const,
      label: "Approval Queue",
      icon: Check,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : null,
    }] : []),
    ...(canSeeManagerBoard ? [{
      id: "manager_board" as const,
      label: "Manager Board",
      icon: Bell,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : null,
    }] : []),
    {
      id: "faculty" as const,
      label: "Faculty Utilization",
      icon: Calendar,
      badge: null,
    },
    ...(canSeeAnalytics ? [{
      id: "analytics" as const,
      label: "Team Analytics",
      icon: Zap,
      badge: null,
    }] : []),
  ];

  // A `?view=` the current role is not entitled to is ignored on load and then
  // overwritten by the effect below, so a hand-edited URL cannot widen access.
  const isRequestedViewAllowed = navItems.some((item) => item.id === requestedView);

  // Handle responsive behavior
  useEffect(() => {
    if (isMobile) {
      setIsSidebarOpen(false);
      setIsCollapsed(false);
    } else if (isTablet) {
      setIsCollapsed(true);
    } else {
      setIsCollapsed(false);
    }
  }, [isMobile, isTablet]);

  const navigateToView = (view: DashboardView) => {
    setActiveView(view);
    writeViewToLocation(view, basePath, "push");
  };

  // The URL and `activeView` have to be reconciled in one effect, not two. As
  // separate effects they read each other's value from the render that is
  // already stale: the first pushed the URL into state, the second pushed state
  // back into the URL, and neither ever observed its own write land. That trades
  // the view back and forth every render until React aborts the commit with
  // "Maximum update depth exceeded". One direction is decided per disagreement
  // by asking which of the two actually moved.
  const previousActiveViewRef = useRef(activeView);

  useEffect(() => {
    const activeViewMoved = previousActiveViewRef.current !== activeView;
    previousActiveViewRef.current = activeView;

    if (requestedView === activeView) return;

    // `activeView` held still while the URL moved under it, so this is a real
    // Back/Forward navigation and the URL wins.
    if (!activeViewMoved && isRequestedViewAllowed) {
      setActiveView(requestedView);
      return;
    }

    // Either `activeView` moved (the role-based landing redirect, or a view the
    // role is not entitled to request), so the address bar follows what is
    // actually on screen and a refresh never falls back to the default.
    // `replaceState` keeps that redirect out of the history stack.
    writeViewToLocation(activeView, basePath, "replace");
  }, [isRequestedViewAllowed, requestedView, activeView, basePath]);

  // Keyboard shortcut listener
  useEffect(() => {
    const destinationFor = (key: string): DashboardView | null => {
      if (key === "2") return canSeeMyBatches ? "my_batches" : null;
      if (key === "3") return secondaryShortcutTarget;
      if (key === "6") return "active_batches";
      if (key === "7") return "faculty";
      return null;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const destination = destinationFor(e.key);
        if (!destination) return;
        e.preventDefault();
        setActiveView(destination);
        writeViewToLocation(destination, basePath, "push");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canSeeMyBatches, secondaryShortcutTarget, basePath, setActiveView]);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(e.target as Node)) {
        setIsWorkspaceMenuOpen(false);
        workspaceTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isWorkspaceMenuOpen) return;

    const firstMenuItem = workspacePopoverRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstMenuItem?.focus();

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsWorkspaceMenuOpen(false);
        workspaceTriggerRef.current?.focus();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = workspacePopoverRef.current
        ? Array.from(workspacePopoverRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        : [];
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(current + direction + items.length) % items.length].focus();
    };

    document.addEventListener("keydown", handleMenuKeyDown);
    return () => document.removeEventListener("keydown", handleMenuKeyDown);
  }, [isWorkspaceMenuOpen]);

  return (
    <>
      {/* Mobile Overlay */}
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id={SIDEBAR_ID}
        aria-label="Dashboard navigation"
        className={cn(
          "sidebar flex h-screen flex-col overflow-y-auto transition-all duration-300",
          isMobile
            ? cn(
              "fixed inset-y-0 left-0 z-50 w-72 transform",
              isSidebarOpen ? "translate-x-0" : "-translate-x-full"
            )
            : cn("relative transform", isCollapsed ? "w-20" : "w-64")
        )}
      >
        {/* Top Header: Brand / Team Selector */}
        <div ref={workspaceMenuRef} className="relative">
          <Button
            ref={workspaceTriggerRef}
            variant="ghost"
            className={cn(
              "w-full gap-3 rounded-xl p-2.5 font-medium transition-all duration-200",
              "hover:bg-accent hover:text-accent-foreground",
              isCollapsed ? "justify-center" : "justify-start",
              isWorkspaceMenuOpen && "bg-accent/50",
            )}
            onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
            aria-haspopup={isAdmin ? "menu" : undefined}
            aria-expanded={isWorkspaceMenuOpen}
            aria-controls={WORKSPACE_POPOVER_ID}
          >
            <div className="flex items-center gap-2.5">
              {/* Logo emblem */}
              <div
                style={{
                  width: isCollapsed ? 28 : 32,
                  height: isCollapsed ? 28 : 32,
                  borderRadius: 8,
                  backgroundImage: BRAND_GRADIENT,
                  boxShadow: "var(--shadow-primary)",
                  transition: "width 0.3s, height 0.3s",
                }}
                className="flex flex-shrink-0 items-center justify-center text-primary-foreground"
              >
                <Layers size={isCollapsed ? 16 : 18} strokeWidth={2.5} aria-hidden="true" />
              </div>

              {!isCollapsed && (
                <div className="text-left min-w-0">
                  <div className="font-semibold text-foreground text-sm truncate">
                    Enterprise Ops
                  </div>
                  <div className="text-xs text-muted-foreground font-medium truncate">
                    {teamLabel} • {roleLabel}
                  </div>
                </div>
              )}
            </div>
          </Button>

          {/* Workspace Menu Popover. It renders at every width, collapsed rail
              included, so the admin destination is never unreachable. */}
          {isWorkspaceMenuOpen && (
            <div
              ref={workspacePopoverRef}
              id={WORKSPACE_POPOVER_ID}
              className={cn(
                "absolute top-full z-50 mt-2 rounded-xl border border-border bg-popover p-2 shadow-lg animate-fade-in",
                isCollapsed ? "left-full ml-2 w-64" : "left-0 right-0"
              )}
            >
              <div
                id={WORKSPACE_HEADING_ID}
                className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider"
              >
                Active Workspace
              </div>
              <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-muted">
                <span className="font-medium text-sm">Enterprise Ops</span>
                <span className="text-xs text-success font-semibold">Active</span>
              </div>

              {/* Only the destination is a menu item; the heading and the status
                  row above sit outside the menu, so it holds nothing else. */}
              {isAdmin && (
                <div id={WORKSPACE_MENU_ID} role="menu" aria-labelledby={WORKSPACE_HEADING_ID} className="mt-1">
                  <Link
                    href="/admin"
                    role="menuitem"
                    className="flex w-full items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => setIsWorkspaceMenuOpen(false)}
                  >
                    <Shield size={14} className="shrink-0 text-primary" aria-hidden="true" />
                    <span>Admin &amp; Governance</span>
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Add New Batch Button */}
        {canCreateBatch && onOpenCreateBatch && (
          <div className={cn("p-3", isCollapsed && "px-2")}>
            <Button
              variant="default"
              className={cn(
                "w-full gap-2 transition-all",
                isCollapsed && "justify-center p-2",
              )}
              style={{ backgroundImage: BRAND_GRADIENT }}
              onClick={onOpenCreateBatch}
              aria-label="Add New Batch"
            >
              <Plus
                size={isCollapsed ? 18 : 15}
                strokeWidth={isCollapsed ? 2.5 : 2}
                className="text-primary-foreground"
                aria-hidden="true"
              />
              {!isCollapsed && (
                <span className="font-semibold text-sm text-primary-foreground">Add New Batch</span>
              )}
            </Button>
          </div>
        )}

        {/* Primary Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto" aria-label="Dashboard views">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              const Icon = item.icon;
              const shortcut = shortcutFor(item.id, secondaryShortcutTarget);
              return (
                <li key={item.id}>
                  <Button
                    variant="ghost"
                    className={cn(
                      "relative w-full gap-3 rounded-xl font-medium text-sm transition-all duration-200",
                      isCollapsed ? "justify-center p-2.5" : "justify-start px-3 py-2.5",
                      "hover:bg-accent hover:text-accent-foreground",
                      isActive
                        ? "bg-primary/15 text-primary shadow-sm"
                        : "text-muted-foreground hover:translate-x-0.5",
                    )}
                    onClick={() => {
                      navigateToView(item.id);
                      if (isMobile) setIsSidebarOpen(false);
                    }}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={item.label}
                    aria-keyshortcuts={shortcut?.key}
                    title={shortcut ? `${item.label} (${shortcut.label})` : item.label}
                  >
                    {isActive && !isCollapsed && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-primary rounded-r-full" />
                    )}
                    <Icon
                      size={isCollapsed ? 20 : 17}
                      strokeWidth={isCollapsed ? 2.5 : 2}
                      className={cn(
                        "flex-shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                      )}
                      aria-hidden="true"
                    />
                    {!isCollapsed && (
                      <>
                        <span className="truncate">{item.label}</span>
                        {item.badge && (
                          <span className="ml-auto px-2 py-0.5 text-xs font-semibold text-primary-foreground bg-primary rounded-full">
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Collapse Toggle (Tablet) / Close Button (Mobile) */}
        {(!isMobile && isTablet) || isMobile ? (
          <div className={cn("p-3 border-t border-border", isCollapsed && "px-2")}>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "rounded-xl transition-all duration-200",
                "hover:bg-accent hover:text-accent-foreground",
                !isCollapsed && "justify-end",
              )}
              onClick={() => {
                if (isMobile) {
                  setIsSidebarOpen(false);
                } else {
                  setIsCollapsed(!isCollapsed);
                }
              }}
              aria-label={isMobile ? "Close sidebar" : isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isCollapsed}
              aria-controls={SIDEBAR_ID}
            >
              {isMobile ? (
                <XIcon size={18} className="text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronLeft size={18} className="text-muted-foreground" aria-hidden="true" />
              )}
            </Button>
          </div>
        ) : null}

        {/* Bottom User Profile Card */}
        <div className={cn("border-t border-border p-3", isCollapsed && "px-2")}>
          <div className="w-full gap-3 rounded-xl font-medium transition-all duration-200" style={{ display: "flex", flexDirection: isCollapsed ? "column" : "row", alignItems: "center" }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-gradient-to-br from-pink-200 to-pink-400 text-pink-900 font-semibold text-sm">
              {userInitial}
            </div>
            {!isCollapsed && (
              <div className="text-left min-w-0 flex-1">
                <div className="font-semibold text-foreground text-sm truncate">
                  {userDisplayName}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {userDisplayEmail}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons - Always visible above profile */}
          {!isCollapsed && (
            <div className="mt-3 space-y-2 w-full" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2 py-1.5 rounded-lg text-sm transition-all hover:bg-accent hover:text-accent-foreground"
                onClick={() => setIsChangePasswordOpen(true)}
              >
                <KeyRound size={15} className="text-primary" aria-hidden="true" />
                <span>Change My Password</span>
              </Button>

              <Button
                variant="ghost"
                className="w-full justify-start gap-2 px-2 py-1.5 rounded-lg text-sm text-destructive transition-all hover:bg-destructive/10"
                onClick={logout}
              >
                <LogOut size={15} aria-hidden="true" />
                <span>Sign Out</span>
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Toggle Button */}
      {isMobile && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-4 left-4 z-50 md:hidden"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open sidebar"
          aria-expanded={isSidebarOpen}
          aria-controls={SIDEBAR_ID}
        >
          <Menu size={24} className="text-foreground" aria-hidden="true" />
        </Button>
      )}

      {/* Change Password Modal */}
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
      />
    </>
  );
};
