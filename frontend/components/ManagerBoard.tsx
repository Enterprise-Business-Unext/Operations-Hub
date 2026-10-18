"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Batch, ManagerDashboardSummary, User } from "@/lib/api";
import { formatDate } from "@/lib/dateUtils";
import {
  ColumnsMenu,
  ExportButton,
  FullscreenTable,
  RefreshButton,
  SortableHeaderCell,
  TableCaption,
  TableFilters,
  TableStateRow,
} from "@/components/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CountBadge,
  EmptyState,
  ErrorBanner,
  LoadingState,
  NAVBAR_HEIGHT,
  PANEL_CLASS,
  PanelTitle,
  StatusPill,
} from "@/components/ui/panel";
import { PaginationControls } from "@/components/PaginationControls";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { reviveNumber, usePersistentState } from "@/hooks/usePersistentState";
import { useTableSort } from "@/hooks/useTableSort";
import { useTableFilters } from "@/hooks/useTableFilters";
import {
  buildFilterFields,
  buildSearchAccessor,
  buildSortAccessors,
  buildSortOptions,
  type TableColumnDef,
} from "@/lib/tableColumns";
import type { CsvColumn } from "@/lib/csv";
import {
  Kanban,
  BarChart3,
  Search,
  Download,
  AlertTriangle,
  Clock,
  PlayCircle,
  CheckCircle2,
  Users,
  Award,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Flame,
} from "lucide-react";

interface ManagerBoardProps {
  batches: Batch[];
  summary: ManagerDashboardSummary | null;
  reports: User[];
  isLoading: boolean;
  error?: string | null;
  onRefresh: () => void;
  onOpenBatchDetail: (batch: Batch) => void;
  onOpenApproval: (batch: Batch) => void;
  currentUser: User | null;
  onExportMbr: () => void;
  isExportingMbr: boolean;
}

type BoardViewMode = "kanban" | "executive";

interface KanbanStage {
  id: string;
  title: string;
  subtitle: string;
  badgeBg: string;
  badgeColor: string;
  borderColor: string;
  icon: React.ElementType;
  filterFn: (batch: Batch) => boolean;
}

/** Flattened row for the "Supervised Personnel & Reporting Team" table. */
interface PersonnelRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  team: string;
  batchesHandled: number;
  status: string;
}

// globals.css has no violet token, so the sign-off and domain accents keep
// their own hue while everything else reads from the shared palette.
const VIOLET = "hsl(262 83% 52%)";
const VIOLET_SOFT = "hsl(262 100% 96%)";

/** Token fills are tuned for large surfaces; darken them for text on a card. */
function shade(token: string): string {
  return `color-mix(in srgb, ${token} 80%, black)`;
}

/** Pale variant of a token, for borders that must not shout. */
function softBorder(token: string): string {
  return `color-mix(in srgb, ${token} 42%, var(--color-card))`;
}

interface StagePalette {
  badgeBg: string;
  badgeColor: string;
  borderColor: string;
}

const STAGE_PALETTE: Record<string, StagePalette> = {
  slate: {
    badgeBg: "var(--color-muted)",
    badgeColor: shade("var(--color-muted-foreground)"),
    borderColor: "var(--color-border)",
  },
  warning: {
    badgeBg: "var(--color-warning-light)",
    badgeColor: shade("var(--color-warning)"),
    borderColor: softBorder("var(--color-warning)"),
  },
  violet: {
    badgeBg: VIOLET_SOFT,
    badgeColor: VIOLET,
    borderColor: softBorder(VIOLET),
  },
  info: {
    badgeBg: "var(--color-info-light)",
    badgeColor: shade("var(--color-info)"),
    borderColor: softBorder("var(--color-info)"),
  },
  danger: {
    badgeBg: "var(--color-destructive-light)",
    badgeColor: "var(--color-destructive)",
    borderColor: softBorder("var(--color-destructive)"),
  },
  success: {
    badgeBg: "var(--color-success-light)",
    badgeColor: "var(--color-success)",
    borderColor: softBorder("var(--color-success)"),
  },
};

// Kanban columns cannot be narrower than this before the board starts
// scrolling sideways.
const KANBAN_COLUMN_MIN = 260;

/**
 * A short viewport can push `100vh - 280px` to zero, and a zero-height
 * scroll region makes the column header unreachable.
 */
const KANBAN_MAX_HEIGHT = "max(420px, calc(100vh - 280px))";

/** Whole days since a batch was requested; 0 when it has no request date. */
function daysPendingRequest(batch: Batch): number {
  return batch.batch_request_date
    ? Math.floor((Date.now() - new Date(batch.batch_request_date).getTime()) / 86400000)
    : 0;
}

/**
 * Both NPS stages agree that "not recorded" means a missing value, not only a
 * literal null — testing one of the two made an undefined NPS match neither.
 */
function hasNoNps(batch: Batch): boolean {
  return batch.batch_nps === null || batch.batch_nps === undefined;
}

const PERSONNEL_COLUMN_KEYS = [
  "name",
  "email",
  "role",
  "team",
  "batchesHandled",
  "status",
] as const;

type PersonnelColumnKey = (typeof PERSONNEL_COLUMN_KEYS)[number];

const PERSONNEL_COLUMN_DEFS: readonly TableColumnDef<PersonnelRow, PersonnelColumnKey>[] = [
  {
    key: "name",
    label: "Employee Name",
    accessor: (row) => row.fullName,
    filterable: true,
  },
  { key: "email", label: "Corporate Email", accessor: (row) => row.email, filterable: true },
  { key: "role", label: "Assigned Role", accessor: (row) => row.role, filterable: true },
  { key: "team", label: "Ops Team", accessor: (row) => row.team, filterable: true },
  {
    key: "batchesHandled",
    label: "Batches Handled",
    accessor: (row) => row.batchesHandled,
    filterable: true,
  },
  { key: "status", label: "Account Status", accessor: (row) => row.status, filterable: true },
];

const PERSONNEL_COLUMN_MENU: readonly { key: PersonnelColumnKey; label: string }[] =
  PERSONNEL_COLUMN_DEFS.map((column) => ({ key: column.key, label: column.label }));

const PERSONNEL_ACCESSORS = buildSortAccessors(PERSONNEL_COLUMN_DEFS);
const PERSONNEL_SORT_OPTIONS = buildSortOptions(PERSONNEL_COLUMN_DEFS);
const PERSONNEL_FILTER_FIELDS = buildFilterFields(PERSONNEL_COLUMN_DEFS);
const PERSONNEL_SEARCH_ACCESSOR = buildSearchAccessor(PERSONNEL_COLUMN_DEFS);

const PERSONNEL_DESC_FIRST_KEYS = ["batchesHandled"];

const PERSONNEL_EXPORT_COLUMNS: readonly CsvColumn<PersonnelRow>[] = [
  { key: "fullName", label: "Employee Name" },
  { key: "email", label: "Corporate Email" },
  { key: "role", label: "Assigned Role" },
  { key: "team", label: "Ops Team" },
  { key: "batchesHandled", label: "Batches Handled" },
  { key: "status", label: "Account Status" },
];

const PERSONNEL_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const PERSONNEL_DEFAULT_PAGE_SIZE = 25;

// Headings and body cells share one padding value so the columns stay aligned.
const PERSONNEL_CELL_PADDING = "12px 14px";
const PERSONNEL_TH_STYLE: React.CSSProperties = { padding: PERSONNEL_CELL_PADDING };
const PERSONNEL_TD_STYLE: React.CSSProperties = { padding: PERSONNEL_CELL_PADDING };
const PERSONNEL_ROW_STYLE: React.CSSProperties = {
  borderBottom: "1px solid var(--border-subtle)",
  fontSize: "0.85rem",
};

export const ManagerBoard: React.FC<ManagerBoardProps> = ({
  batches,
  summary,
  reports,
  isLoading,
  error,
  onRefresh,
  onOpenBatchDetail,
  onOpenApproval,
  currentUser,
  onExportMbr,
  isExportingMbr,
}) => {
  const [viewMode, setViewMode] = useState<BoardViewMode>("kanban");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("ALL");
  const [showUrgentOnly, setShowUrgentOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistentState<number>(
    "ops.table.manager-board.personnel.page-size",
    PERSONNEL_DEFAULT_PAGE_SIZE,
    reviveNumber
  );

  const domainSelectId = React.useId();
  const kpiHeadingId = React.useId();

  // Extract distinct domains for filter dropdown
  const domainList = useMemo(() => {
    const set = new Set<string>();
    batches.forEach((b) => {
      if (b.domain) set.add(b.domain);
    });
    return Array.from(set).sort();
  }, [batches]);

  // Kanban Stage Definitions
  const stages: KanbanStage[] = useMemo(() => [
    {
      id: "requested",
      title: "Requested",
      subtitle: "Awaiting submission for approval",
      ...STAGE_PALETTE.slate,
      icon: Clock,
      filterFn: (b) => b.status === "Requested",
    },
    {
      id: "l1_pending",
      title: "Level 1 Review",
      subtitle: "Coordinator verification",
      ...STAGE_PALETTE.warning,
      icon: ShieldCheck,
      filterFn: (b) => b.status === "Approval 1 Pending",
    },
    {
      id: "l2_pending",
      title: "Level 2 Manager Action",
      subtitle: "Requires your sign-off",
      ...STAGE_PALETTE.violet,
      icon: AlertTriangle,
      filterFn: (b) => b.status === "Approval 2 Pending",
    },
    {
      id: "inflight",
      title: "In-Flight Delivery",
      subtitle: "Active training sessions",
      ...STAGE_PALETTE.info,
      icon: PlayCircle,
      filterFn: (b) => {
        if (b.status !== "Approved" && b.status !== "Upcoming" && b.status !== "Ongoing") return false;
        const isPastEnd = b.end_date ? new Date(b.end_date).getTime() < Date.now() : false;
        // In-flight if delivery is not overdue for NPS closure
        return !isPastEnd && hasNoNps(b);
      },
    },
    {
      id: "nps_closure",
      title: "NPS Closure",
      subtitle: "Delivery done • Needs NPS",
      ...STAGE_PALETTE.danger,
      icon: Award,
      filterFn: (b) => {
        if (b.status === "Completed" || b.status === "Cancelled" || b.status === "OnHold") return false;
        const isPastEnd = b.end_date ? new Date(b.end_date).getTime() < Date.now() : false;
        // NPS closure if past end date or sessions completed, but NPS not yet recorded
        return isPastEnd && hasNoNps(b);
      },
    },
    {
      id: "on_hold",
      title: "On Hold",
      subtitle: "Paused delivery",
      ...STAGE_PALETTE.warning,
      icon: Clock,
      filterFn: (b) => b.status === "OnHold",
    },
    {
      id: "completed",
      title: "Completed & Locked",
      subtitle: "NPS logged & archived",
      ...STAGE_PALETTE.success,
      icon: CheckCircle2,
      filterFn: (b) => b.status === "Completed",
    },
  ], []);

  // Filtered Batches based on Search, Domain, and Urgency
  const filteredBatches = useMemo(() => {
    return batches.filter((b) => {
      // Search matching
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches =
          b.batch_id.toLowerCase().includes(q) ||
          b.program_name.toLowerCase().includes(q) ||
          (b.client_name && b.client_name.toLowerCase().includes(q)) ||
          (b.sow_number && b.sow_number.toLowerCase().includes(q)) ||
          (b.domain && b.domain.toLowerCase().includes(q)) ||
          (b.faculty_assigned_text && b.faculty_assigned_text.toLowerCase().includes(q));
        if (!matches) return false;
      }

      // Domain matching
      if (selectedDomain !== "ALL" && b.domain !== selectedDomain) {
        return false;
      }

      // Urgency matching: > 3 days pending approval or pending closure past end date
      if (showUrgentOnly) {
        const isOverdueApproval = b.status.includes("Pending") && daysPendingRequest(b) >= 3;
        const isOverdueClosure = b.end_date && new Date(b.end_date).getTime() < Date.now() && !b.batch_nps;
        return isOverdueApproval || isOverdueClosure;
      }

      return true;
    });
  }, [batches, searchQuery, selectedDomain, showUrgentOnly]);

  // Quick statistics calculated on the fly
  const quickStats = useMemo(() => {
    const activeCount = batches.filter((b) => ["Approved", "Upcoming", "Ongoing"].includes(b.status)).length;
    return { activeCount };
  }, [batches]);

  // Personnel ledger rows: the same six fields the table renders, pre-flattened
  // so sorting and filtering run on raw values instead of JSX.
  const personnelRows = useMemo<PersonnelRow[]>(
    () =>
      reports.map((r) => ({
        id: r.id,
        fullName: r.full_name || "",
        email: r.email || "",
        role: r.role_detail?.name || r.role || "",
        team: r.team_name || "Operations",
        batchesHandled: batches.filter((b) => b.coordinator_id === r.id).length,
        status: r.is_active ? "Active" : "Inactive",
      })),
    [reports, batches]
  );

  const personnelSort = useTableSort(personnelRows, PERSONNEL_ACCESSORS, {
    descFirstKeys: PERSONNEL_DESC_FIRST_KEYS,
  });
  const personnelFilters = useTableFilters(
    personnelSort.sortedRows,
    PERSONNEL_FILTER_FIELDS,
    PERSONNEL_SEARCH_ACCESSOR
  );

  const personnelColumns = useColumnVisibility<PersonnelColumnKey>({
    columns: PERSONNEL_COLUMN_MENU,
    storageKey: "ops.table.manager-board.personnel.columns",
    defaultHidden: ["batchesHandled"],
  });

  useEffect(() => {
    setPage(1);
  }, [personnelFilters.filtersVersion, personnelSort.sortVersion]);

  const personnelStart = (page - 1) * pageSize;
  const pagedPersonnel = useMemo(
    () => personnelFilters.filteredRows.slice(personnelStart, personnelStart + pageSize),
    [personnelFilters.filteredRows, personnelStart, pageSize]
  );

  const personnelVisibleColumns = PERSONNEL_COLUMN_DEFS.filter((column) =>
    personnelColumns.isVisible(column.key)
  ).length;

  const personnelPanelTitle = (
    <PanelTitle
      title="Supervised Personnel & Reporting Team"
      description="Operational team members reporting to you for scheduling, attendance, and batch management."
      meta={
        <CountBadge
          value={`${personnelFilters.filteredRows.length} of ${personnelRows.length}`}
          label={
            personnelFilters.filteredRows.length === personnelRows.length
              ? "direct reports"
              : "direct reports match"
          }
        />
      }
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Top Header & View Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--text-main)", margin: 0, letterSpacing: "-0.02em" }}>
              Manager Control Board
            </h2>
            <Badge variant="info" size="sm" className="normal-case tracking-normal">
              Operational Pipeline
            </Badge>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
            Real-time managerial board across intake, approvals, session delivery, and quality checkpoints.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {/* View Mode Toggle Button Group */}
          <div
            role="group"
            aria-label="Manager board view"
            style={{
              display: "inline-flex",
              background: "var(--color-muted)",
              borderRadius: 10,
              padding: 3,
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("kanban")}
              aria-pressed={viewMode === "kanban"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                fontSize: "0.825rem",
                fontWeight: 700,
                cursor: "pointer",
                background: viewMode === "kanban" ? "var(--color-card)" : "transparent",
                color: viewMode === "kanban" ? "var(--color-primary)" : "var(--text-muted)",
                boxShadow: viewMode === "kanban" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s",
              }}
            >
              <Kanban size={15} aria-hidden="true" />
              <span>Pipeline Stages</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("executive")}
              aria-pressed={viewMode === "executive"}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                fontSize: "0.825rem",
                fontWeight: 700,
                cursor: "pointer",
                background: viewMode === "executive" ? "var(--color-card)" : "transparent",
                color: viewMode === "executive" ? "var(--color-primary)" : "var(--text-muted)",
                boxShadow: viewMode === "executive" ? "0 2px 6px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s",
              }}
            >
              <BarChart3 size={15} aria-hidden="true" />
              <span>Executive Oversight</span>
            </button>
          </div>

          <button
            onClick={onExportMbr}
            disabled={isExportingMbr}
            className="btn btn-primary"
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", fontSize: "0.825rem" }}
          >
            <Download size={15} aria-hidden="true" />
            <span>{isExportingMbr ? "Generating..." : "Export MBR (.xlsx)"}</span>
          </button>
        </div>
      </div>

      {/* Executive KPI Ribbon */}
      <section aria-labelledby={kpiHeadingId}>
        <h2 id={kpiHeadingId} className="sr-only">
          Executive key performance indicators
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <div className="glass-panel" style={{ padding: "16px 18px", borderLeft: "4px solid var(--color-primary)" }}>
            <div style={{ fontSize: "0.725rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
              Active Operating Batches
            </div>
            <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--color-primary)", marginTop: 4 }}>
              {summary?.total_active_batches ?? quickStats.activeCount}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
              Approved, Upcoming &amp; Ongoing
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "16px 18px", borderLeft: `4px solid ${VIOLET}` }}>
            <div style={{ fontSize: "0.725rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
              Delivered Training Hours
            </div>
            <div style={{ fontSize: "1.85rem", fontWeight: 800, color: VIOLET, marginTop: 4 }}>
              {summary?.total_hours_delivered ? `${summary.total_hours_delivered}h` : "0.0h"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
              Completed session curriculum
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "16px 18px", borderLeft: "4px solid var(--color-success)" }}>
            <div style={{ fontSize: "0.725rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
              NPS Closure Rating
            </div>
            <div style={{ fontSize: "1.85rem", fontWeight: 800, color: "var(--color-success)", marginTop: 4 }}>
              {summary?.overall_avg_nps !== null && summary?.overall_avg_nps !== undefined ? `${summary.overall_avg_nps} / 10` : "—"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
              Executive Net Promoter Score
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "16px 18px", borderLeft: `4px solid ${shade("var(--color-warning)")}` }}>
            <div style={{ fontSize: "0.725rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
              Average Batch Feedback
            </div>
            <div style={{ fontSize: "1.85rem", fontWeight: 800, color: shade("var(--color-warning)"), marginTop: 4 }}>
              {summary?.overall_avg_feedback !== null && summary?.overall_avg_feedback !== undefined ? `⭐ ${summary.overall_avg_feedback} / 5` : "—"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
              Cumulative trainer ratings
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "16px 18px", borderLeft: `4px solid ${shade("var(--color-warning)")}` }}>
            <div style={{ fontSize: "0.725rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
              Schedules Not Updated
            </div>
            <div style={{ fontSize: "1.85rem", fontWeight: 800, color: shade("var(--color-warning)"), marginTop: 4 }}>
              {summary?.schedule_not_updated_count ?? 0}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
              Batches pending schedule confirmation
            </div>
          </div>
        </div>
      </section>

      {/* Filter and Control Bar */}
      <div className="glass-panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, flexWrap: "wrap" }}>
          {/* Search Input */}
          <div style={{ position: "relative", minWidth: 260 }}>
            <Search
              size={15}
              aria-hidden="true"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-dim)" }}
            />
            <input
              type="text"
              aria-label="Search batches by ID, client, program or trainer"
              placeholder="Search by ID, client, program, trainer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass-input"
              style={{ paddingLeft: 32, fontSize: "0.825rem", width: "100%" }}
            />
          </div>

          {/* Domain Dropdown */}
          <label htmlFor={domainSelectId} className="sr-only">
            Domain
          </label>
          <select
            id={domainSelectId}
            value={selectedDomain}
            onChange={(e) => setSelectedDomain(e.target.value)}
            className="glass-input"
            style={{ fontSize: "0.825rem", minWidth: 160 }}
          >
            <option value="ALL">All Domains ({domainList.length})</option>
            {domainList.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* Overdue / Urgent Only Filter Toggle */}
          <button
            type="button"
            onClick={() => setShowUrgentOnly(!showUrgentOnly)}
            aria-pressed={showUrgentOnly}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: showUrgentOnly ? "1px solid var(--color-destructive)" : "1px solid var(--border-subtle)",
              background: showUrgentOnly ? "var(--color-destructive-light)" : "var(--color-card)",
              color: showUrgentOnly ? "var(--color-destructive)" : "var(--text-muted)",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <Flame
              size={14}
              aria-hidden="true"
              color={showUrgentOnly ? "var(--color-destructive)" : "var(--color-muted-foreground)"}
            />
            <span>Urgent Attention Only</span>
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onRefresh}
            className="btn btn-secondary"
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: "0.8rem" }}
            title="Refresh Board"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: PIPELINE KANBAN BOARD */}
      {viewMode === "kanban" && (
        <div
          style={{
            overflowX: "auto",
            paddingBottom: 16,
          }}
        >
          <div
            style={{
              display: "grid",
              // `min(100%, …)` keeps a single stage usable on a phone instead of
              // forcing the whole board to scroll sideways.
              gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${KANBAN_COLUMN_MIN}px), 1fr))`,
              gap: 16,
              minWidth: 0,
            }}
          >
            {stages.map((stage) => {
              const stageBatches = filteredBatches.filter(stage.filterFn);
              const Icon = stage.icon;

              return (
                <div
                  key={stage.id}
                  style={{
                    background: "var(--color-muted)",
                    borderRadius: 12,
                    border: `1px solid ${stage.borderColor}`,
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 520,
                    maxHeight: KANBAN_MAX_HEIGHT,
                    minWidth: 0,
                  }}
                >
                  {/* Column Header */}
                  <div style={{
                    padding: "12px 14px",
                    borderBottom: `1px solid ${stage.borderColor}`,
                    background: "var(--color-card)",
                    borderTopLeftRadius: 12,
                    borderTopRightRadius: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon size={16} color={stage.badgeColor} aria-hidden="true" />
                        <span style={{ fontWeight: 800, fontSize: "0.875rem", color: "var(--text-main)" }}>
                          {stage.title}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
                        {stage.subtitle}
                      </div>
                    </div>

                    <span style={{
                      background: stage.badgeBg,
                      color: stage.badgeColor,
                      fontSize: "0.75rem",
                      fontWeight: 800,
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}>
                      {stageBatches.length}
                    </span>
                  </div>

                  {/* Cards Container */}
                  <div style={{
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    overflowY: "auto",
                    flex: 1,
                    minHeight: 0,
                  }}>
                    {stageBatches.length === 0 ? (
                      <div style={{
                        textAlign: "center",
                        padding: "36px 12px",
                        color: "var(--text-dim)",
                        fontSize: "0.8rem",
                      }}>
                        No batches in this stage
                      </div>
                    ) : (
                      stageBatches.map((batch) => {
                        const daysPending = daysPendingRequest(batch);
                        const isOverdue = daysPending >= 3 && batch.status.includes("Pending");

                        return (
                          <div
                            key={batch.id}
                            className="glass-panel"
                            role="button"
                            tabIndex={0}
                            aria-label={`Open details for batch ${batch.batch_id}`}
                            style={{
                              padding: "12px 14px",
                              background: isOverdue ? "var(--color-destructive-light)" : "var(--color-card)",
                              border: isOverdue ? "1px solid var(--color-destructive)" : "1px solid var(--border-subtle)",
                              borderRadius: 10,
                              boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
                              cursor: "pointer",
                              transition: "all 0.15s ease-in-out",
                            }}
                            onClick={() => onOpenBatchDetail(batch)}
                            onKeyDown={(event) => {
                              // The card's own action buttons answer their own keys;
                              // only a press on the card itself opens the batch.
                              if (event.target !== event.currentTarget) return;
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onOpenBatchDetail(batch);
                              }
                            }}
                          >
                            {/* Card Top: Batch ID & Urgency */}
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                              <span style={{
                                fontWeight: 800,
                                fontSize: "0.8rem",
                                color: "var(--color-primary)",
                                fontFamily: "monospace",
                              }}>
                                {batch.batch_id}
                              </span>
                              {isOverdue && (
                                <Badge variant="destructive" size="sm">
                                  {daysPending}d OVERDUE
                                </Badge>
                              )}
                            </div>

                            {/* Program Name */}
                            <div style={{
                              fontWeight: 700,
                              fontSize: "0.85rem",
                              color: "var(--text-main)",
                              margin: "4px 0 6px 0",
                              lineHeight: 1.3,
                            }}>
                              {batch.program_name}
                            </div>

                            {/* Client & Domain Chips */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                              {batch.client_name && (
                                <Badge variant="secondary" size="sm" className="normal-case tracking-normal">
                                  {batch.client_name}
                                </Badge>
                              )}
                              {batch.domain && (
                                <Badge variant="violet" size="sm" className="normal-case tracking-normal">
                                  {batch.domain}
                                </Badge>
                              )}
                              <span style={{
                                fontSize: "0.7rem",
                                color: "var(--text-dim)",
                              }}>
                                {batch.delivery_mode || "Online"} {batch.location_city ? `• ${batch.location_city}` : ""}
                              </span>
                            </div>

                            {/* Trainer / Headcount Info */}
                            <div style={{
                              fontSize: "0.75rem",
                              color: "var(--text-muted)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 8,
                              borderTop: "1px dashed var(--border-subtle)",
                              paddingTop: 6,
                              marginTop: 6,
                            }}>
                              <div>
                                <span>Faculty: </span>
                                <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                                  {batch.faculty_assigned_text || "Unassigned"}
                                </span>
                              </div>
                              <div>
                                <span style={{ fontWeight: 700, color: "var(--color-primary)" }}>
                                  {batch.total_enrollments}
                                </span>
                                <span style={{ fontSize: "0.7rem" }}> pax</span>
                              </div>
                            </div>

                            {/* Action Button Strip */}
                            <div style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginTop: 10,
                              paddingTop: 8,
                              borderTop: "1px solid var(--border-subtle)",
                            }}>
                              <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
                                {batch.start_date ? formatDate(batch.start_date) : "No date"}
                              </span>

                              {batch.status === "Approval 2 Pending"
                                && currentUser?.id?.toLowerCase() === batch.approver_2_id?.toLowerCase() ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenApproval(batch);
                                  }}
                                  className="btn btn-primary"
                                  style={{ padding: "3px 8px", fontSize: "0.72rem", background: VIOLET }}
                                >
                                  Sign Off
                                </button>
                              ) : batch.status === "Ongoing" && !batch.batch_nps ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenBatchDetail(batch);
                                  }}
                                  className="btn btn-secondary"
                                  style={{
                                    padding: "3px 8px",
                                    fontSize: "0.72rem",
                                    color: "var(--color-destructive)",
                                    borderColor: "var(--color-destructive-light)",
                                  }}
                                >
                                  Log NPS Closure
                                </button>
                              ) : (
                                <span style={{ fontSize: "0.72rem", color: "var(--color-primary)", fontWeight: 700, display: "flex", alignItems: "center" }}>
                                  View <ChevronRight size={12} aria-hidden="true" />
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 2: EXECUTIVE OVERVIEW */}
      {viewMode === "executive" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Vertical Distribution Breakdown */}
          <div className="glass-panel" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, color: "var(--text-main)", margin: 0 }}>
                  Vertical &amp; Domain Performance
                </h3>
                <p style={{ fontSize: "0.825rem", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
                  Active batch distribution, committed curriculum hours, and customer quality indices across verticals.
                </p>
              </div>
            </div>

            {summary?.vertical_distribution && summary.vertical_distribution.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
                {summary.vertical_distribution.map((v) => (
                  <div
                    key={v.vertical}
                    style={{
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 10,
                      padding: 24,
                      background: "var(--color-card)",
                      boxShadow: "0 2px 5px rgba(0,0,0,0.02)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: "1rem", color: "var(--color-primary)" }}>
                        {v.vertical}
                      </span>
                      <Badge variant="info" size="sm" className="normal-case tracking-normal">
                        {v.active_batches} Active Batch(es)
                      </Badge>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>Total Hours</div>
                        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>
                          {v.total_hours}h
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>Quality Rating</div>
                        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: shade("var(--color-warning)"), marginTop: 2 }}>
                          {v.average_feedback > 0 ? `⭐ ${v.average_feedback} / 5` : "Pending"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No domain analytics data available.
              </div>
            )}
          </div>

          {/* Supervised Personnel & Reporting Team */}
          {reports.length === 0 ? (
            <section className={PANEL_CLASS}>
              <div className="border-b border-border/70 px-5 py-4">{personnelPanelTitle}</div>
              <EmptyState
                icon={<Users className="h-5 w-5" aria-hidden="true" />}
                title="No Direct Reports Assigned"
                description="Assigned coordinators and team members reporting to your leadership line will appear here."
              />
            </section>
          ) : (
            <FullscreenTable
              stickyHeader
              stickyTop={NAVBAR_HEIGHT}
              panelClassName={PANEL_CLASS}
              title={personnelPanelTitle}
              toolbar={
                <TableFilters
                  search={{
                    value: personnelFilters.search,
                    onChange: personnelFilters.setSearch,
                    placeholder: "Search name, email, role...",
                    width: 240,
                  }}
                  selects={[
                    {
                      key: "role",
                      label: "Role",
                      value: personnelFilters.getFilter("role"),
                      onChange: (value) => personnelFilters.setFilter("role", value),
                      options: personnelFilters.optionsFor("role"),
                      width: 150,
                    },
                    {
                      key: "team",
                      label: "Ops Team",
                      value: personnelFilters.getFilter("team"),
                      onChange: (value) => personnelFilters.setFilter("team", value),
                      options: personnelFilters.optionsFor("team"),
                      width: 160,
                    },
                    {
                      key: "status",
                      label: "Account Status",
                      value: personnelFilters.getFilter("status"),
                      onChange: (value) => personnelFilters.setFilter("status", value),
                      options: personnelFilters.optionsFor("status"),
                      width: 150,
                    },
                  ]}
                  sort={{
                    options: PERSONNEL_SORT_OPTIONS,
                    sortKey: personnelSort.sortKey,
                    sortDir: personnelSort.sortDir,
                    onChange: personnelSort.applySort,
                  }}
                  onClear={personnelFilters.clearFilters}
                  hasActiveFilters={personnelFilters.hasActiveFilters}
                  activeFilterCount={personnelFilters.activeFilterCount}
                />
              }
              actions={
                <>
                  <ColumnsMenu
                    columns={PERSONNEL_COLUMN_MENU}
                    hidden={personnelColumns.hidden}
                    onToggle={personnelColumns.toggle}
                    onShowAll={personnelColumns.showAll}
                  />
                  <ExportButton
                    filename="manager-board-personnel"
                    columns={PERSONNEL_EXPORT_COLUMNS}
                    rows={personnelFilters.filteredRows}
                  />
                  <RefreshButton onClick={onRefresh} isLoading={isLoading} label="Refresh" />
                </>
              }
              footer={
                <PaginationControls
                  label="Direct reports pages"
                  currentPage={page}
                  totalItems={personnelFilters.filteredRows.length}
                  pageSize={pageSize}
                  pageSizeOptions={PERSONNEL_PAGE_SIZE_OPTIONS}
                  onPageChange={setPage}
                  onPageSizeChange={(nextSize) => {
                    setPageSize(nextSize);
                    setPage(1);
                  }}
                />
              }
            >
              <table className="glass-table table-pin-first-col w-full border-collapse">
                <TableCaption>Direct reports, their assigned role and ops team, and how many batches they handle</TableCaption>
                <thead>
                  <tr>
                    {PERSONNEL_COLUMN_DEFS.map((column) =>
                      personnelColumns.isVisible(column.key) ? (
                        <SortableHeaderCell
                          key={column.key}
                          columnKey={column.key}
                          label={column.label}
                          style={{ ...PERSONNEL_TH_STYLE, textAlign: column.align ?? "left" }}
                          sortKey={personnelSort.sortKey}
                          sortDir={personnelSort.sortDir}
                          onSort={personnelSort.toggleSort}
                        />
                      ) : null
                    )}
                  </tr>
                </thead>
                <tbody>
                  {error ? (
                    <TableStateRow colSpan={personnelVisibleColumns}>
                      <ErrorBanner message={error} className="mx-auto my-6 max-w-lg" />
                    </TableStateRow>
                  ) : isLoading && personnelFilters.filteredRows.length === 0 ? (
                    <TableStateRow colSpan={personnelVisibleColumns}>
                      <LoadingState label="Loading your direct reports..." />
                    </TableStateRow>
                  ) : pagedPersonnel.length === 0 ? (
                    <TableStateRow colSpan={personnelVisibleColumns}>
                      {personnelFilters.hasActiveFilters ? (
                        <EmptyState
                          icon={<Search className="h-5 w-5" aria-hidden="true" />}
                          title="No direct reports match your filters"
                          description="Clear the search or filter selections to see the whole team."
                          action={
                            <Button size="sm" variant="outline" onClick={personnelFilters.clearFilters}>
                              Clear filters
                            </Button>
                          }
                        />
                      ) : (
                        <EmptyState
                          icon={<Users className="h-5 w-5" aria-hidden="true" />}
                          title="No direct reports yet"
                          description="Assigned coordinators and team members reporting to you will appear here."
                        />
                      )}
                    </TableStateRow>
                  ) : (
                    pagedPersonnel.map((row) => (
                      <tr key={row.id} style={PERSONNEL_ROW_STYLE}>
                        {personnelColumns.isVisible("name") && (
                          <td style={{ ...PERSONNEL_TD_STYLE, fontWeight: 700, color: "var(--text-main)" }}>
                            {row.fullName}
                          </td>
                        )}
                        {personnelColumns.isVisible("email") && (
                          <td style={{ ...PERSONNEL_TD_STYLE, color: "var(--text-muted)" }}>
                            {row.email}
                          </td>
                        )}
                        {personnelColumns.isVisible("role") && (
                          <td style={PERSONNEL_TD_STYLE}>
                            <Badge variant="info" size="sm" className="normal-case tracking-normal">
                              {row.role}
                            </Badge>
                          </td>
                        )}
                        {personnelColumns.isVisible("team") && (
                          <td style={{ ...PERSONNEL_TD_STYLE, color: "var(--text-muted)" }}>
                            {row.team}
                          </td>
                        )}
                        {personnelColumns.isVisible("batchesHandled") && (
                          <td style={{ ...PERSONNEL_TD_STYLE, fontWeight: 700, color: "var(--color-primary)" }}>
                            {row.batchesHandled} Batch(es)
                          </td>
                        )}
                        {personnelColumns.isVisible("status") && (
                          <td style={PERSONNEL_TD_STYLE}>
                            <StatusPill active={row.status === "Active"} />
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </FullscreenTable>
          )}
        </div>
      )}
    </div>
  );
};