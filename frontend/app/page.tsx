"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import {
  api, ActiveBatchesResponse, Batch, ManagerDashboardSummary, TrainingSession, User
} from "@/lib/api";
import { formatDate } from "@/lib/dateUtils";
import { approvalReapprovalLabel } from "@/lib/approvalQueue";
import { notifyError, notifySuccess } from "@/lib/notify";
import { ActiveBatchesView } from "./dashboard/components/ActiveBatchesView";
import { MyBatchesView } from "./dashboard/components/MyBatchesView";
import { FacultyUtilizationView } from "./dashboard/components/FacultyUtilizationView";
import { CreateBatchModal } from "@/components/CreateBatchModal";
import { ApproveBatchModal } from "@/components/ApproveBatchModal";
import { BatchDetailDrawer, BatchDetailTab } from "@/components/BatchDetailDrawer";
import { ManagerBoard } from "@/components/ManagerBoard";
import { Sidebar, DashboardView } from "@/components/Sidebar";
import { EnterpriseDashboard } from "@/components/EnterpriseDashboard";
import { PaginationControls } from "@/components/PaginationControls";
import {
  ColumnsMenu,
  ExportButton,
  FullscreenTable,
  PlainHeaderCell,
  SortableHeaderCell,
  TableCaption,
  TableFilters,
  TableStateRow,
  TABLE_CONTROL_STYLE,
} from "@/components/table";
import { Button } from "@/components/ui/button";
import {
  CountBadge,
  EmptyState,
  ErrorBanner,
  LoadingState,
  NAVBAR_HEIGHT,
  PanelTitle,
  StatCard,
  TABLE_TH_STYLE,
} from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/statusBadge";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { useTableFilters } from "@/hooks/useTableFilters";
import { useTableSort } from "@/hooks/useTableSort";
import { reviveNumber, usePersistentState } from "@/hooks/usePersistentState";
import {
  buildFilterFields,
  buildSearchAccessor,
  buildSortAccessors,
  buildSortOptions,
  isSortable,
  type TableColumnDef,
} from "@/lib/tableColumns";
import { downloadCsv, type CsvColumn } from "@/lib/csv";
import {
  Check, CheckCircle2, ClipboardCheck, Clock, FileSpreadsheet, PencilLine, RefreshCw, Search
} from "lucide-react";

function toTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Shared column metadata for the two hand-rolled tables on this page. Sort
// accessors, "Sort by" options, filter dropdowns and the search haystack are all
// derived from these definitions, so an option can never exist for a column that
// is not on screen.

const FINANCE_ACTIVE_STATUSES = new Set(["Approved", "Upcoming", "Ongoing", "Completed"]);

type ApprovalColumnKey =
  | "batchId"
  | "program"
  | "client"
  | "domain"
  | "mode"
  | "city"
  | "submittedOn"
  | "status"
  | "reapproval"
  | "action";

// `program`, `domain` and `city` used to be sub-labels inside the Batch/Client/
// Mode cells, so "Sort by" and the domain filter offered fields with no header.
// They are real columns now: an approver triages by domain and city, and hiding
// one is a column-menu choice rather than an unreachable control.
const APPROVAL_COLUMN_DEFS: readonly TableColumnDef<Batch, ApprovalColumnKey>[] = [
  { key: "batchId", label: "Batch", accessor: (b) => b.batch_id ?? "" },
  { key: "program", label: "Program", accessor: (b) => b.program_name ?? "" },
  { key: "client", label: "Client", accessor: (b) => b.client_name ?? "" },
  { key: "domain", label: "Domain", accessor: (b) => b.domain ?? "", filterable: true },
  { key: "mode", label: "Mode", accessor: (b) => b.delivery_mode ?? "" },
  { key: "city", label: "City", accessor: (b) => b.location_city ?? "" },
  { key: "submittedOn", label: "Submitted On", accessor: (b) => b.batch_request_date ?? "" },
  { key: "status", label: "Status", accessor: (b) => b.status ?? "", filterable: true },
  // A first-time submission and reapproval #N sort apart because
  // `compareTableValues` compares embedded numbers numerically.
  { key: "reapproval", label: "Reapproval", accessor: (b) => approvalReapprovalLabel(b), filterable: true, align: "center" },
];

const APPROVAL_ACCESSORS = buildSortAccessors(APPROVAL_COLUMN_DEFS);
const APPROVAL_SORT_OPTIONS = buildSortOptions(APPROVAL_COLUMN_DEFS);
const APPROVAL_FILTER_FIELDS = buildFilterFields(APPROVAL_COLUMN_DEFS);
const APPROVAL_SEARCH_ACCESSOR = buildSearchAccessor(APPROVAL_COLUMN_DEFS);
const APPROVAL_DESC_FIRST_KEYS = ["submittedOn"];

const APPROVAL_COLUMN_KEYS = [
  ...APPROVAL_COLUMN_DEFS.map((column) => ({ key: column.key, label: column.label })),
  { key: "action" as const, label: "Action" },
];

const APPROVAL_EXPORT_COLUMNS: readonly CsvColumn<Batch>[] = [
  { key: "batch_id", label: "Batch ID" },
  { key: "program_name", label: "Program" },
  { key: "client_name", label: "Client" },
  { key: "domain", label: "Domain" },
  { key: "delivery_mode", label: "Mode" },
  { key: "location_city", label: "City" },
  { key: "created_at", label: "Submitted On" },
  { key: "status", label: "Status" },
  { key: "is_reapproval", label: "Reapproval", value: (b) => approvalReapprovalLabel(b) },
];

const FINANCE_STATUS_OPTIONS = ["Pending", "Cleared"];

interface FinanceDraft {
  approval_id: string;
  finance_status: string;
  finance_status_check_date: string;
}

type FinanceDrafts = Record<string, FinanceDraft>;

type FinanceColumnKey =
  | "batchId"
  | "client"
  | "program"
  | "category"
  | "technology"
  | "domain"
  | "mode"
  | "location"
  | "startDate"
  | "endDate"
  | "enrollments"
  | "trainingDays"
  | "totalHours"
  | "sowNumber"
  | "approvalId"
  | "faculty"
  | "financeStatus"
  | "checkDate"
  | "remarks"
  | "status"
  | "action";

// 21 columns at 2200px is unreadable at 100% zoom. Only the identity, the
// operational facts and the finance review fields the sheet exists for stay on
// by default; the rest is one Columns click away.
const FINANCE_DEFAULT_HIDDEN: readonly FinanceColumnKey[] = [
  "category",
  "technology",
  "domain",
  "mode",
  "location",
  "sowNumber",
  "approvalId",
  "checkDate",
  "remarks",
  "trainingDays",
];

// Draft-aware columns must sort and filter on what the cell actually shows, so
// the definitions are rebuilt whenever the drafts change.
function buildFinanceColumns(drafts: FinanceDrafts): readonly TableColumnDef<Batch, FinanceColumnKey>[] {
  return [
    { key: "batchId", label: "Batch ID", accessor: (b) => b.batch_id ?? "" },
    { key: "client", label: "Client", accessor: (b) => b.client_name ?? "" },
    { key: "program", label: "Program", accessor: (b) => b.program_name ?? "" },
    { key: "category", label: "Category", accessor: (b) => b.category ?? "" },
    { key: "technology", label: "Technology", accessor: (b) => b.technology ?? "" },
    { key: "domain", label: "Domain", accessor: (b) => b.domain ?? "", filterable: true },
    {
      key: "mode",
      label: "Mode",
      accessor: (b) => b.delivery_mode || "Online",
      filterable: true,
    },
    { key: "location", label: "Location", accessor: (b) => b.location_city ?? "" },
    { key: "startDate", label: "Start Date", accessor: (b) => b.start_date ?? "" },
    { key: "endDate", label: "End Date", accessor: (b) => b.end_date ?? "" },
    { key: "enrollments", label: "Enrollments", accessor: (b) => b.total_enrollments, align: "center" },
    { key: "trainingDays", label: "Training Days", accessor: (b) => b.training_days ?? 0, align: "center" },
    { key: "totalHours", label: "Total Hours", accessor: (b) => b.total_hours ?? 0, align: "center" },
    { key: "sowNumber", label: "SOW Number", accessor: (b) => b.sow_number ?? "" },
    { key: "approvalId", label: "Approval ID", accessor: (b) => drafts[b.id]?.approval_id ?? null },
    { key: "faculty", label: "Faculty", accessor: (b) => b.faculty_assigned_text ?? "" },
    {
      key: "financeStatus",
      label: "Finance Status",
      accessor: (b) => drafts[b.id]?.finance_status || b.finance_status || "Pending",
      filterable: true,
    },
    {
      key: "checkDate",
      label: "Check Date",
      accessor: (b) => drafts[b.id]?.finance_status_check_date ?? null,
    },
    { key: "remarks", label: "Remarks", accessor: (b) => b.remarks ?? "", sortable: false },
    { key: "status", label: "Status", accessor: (b) => b.status ?? "", filterable: true },
  ];
}

const FINANCE_EXPORT_COLUMNS: readonly CsvColumn<Batch>[] = [
  { key: "batch_id", label: "Batch ID" },
  { key: "sow_number", label: "SOW Number" },
  { key: "approval_id", label: "Approval ID" },
  { key: "client_name", label: "Client" },
  { key: "program_name", label: "Program" },
  { key: "category", label: "Category" },
  { key: "technology", label: "Technology" },
  { key: "domain", label: "Domain" },
  { key: "delivery_mode", label: "Delivery Mode" },
  { key: "location_city", label: "Location" },
  { key: "start_date", label: "Start Date" },
  { key: "end_date", label: "End Date" },
  { key: "total_enrollments", label: "Total Enrollments" },
  { key: "training_days", label: "Training Days" },
  { key: "total_hours", label: "Total Hours" },
  { key: "finance_status", label: "Finance Status" },
  { key: "finance_status_check_date", label: "Finance Check Date" },
  { key: "batch_avg_feedback", label: "Batch Avg Feedback" },
  { key: "batch_nps", label: "Batch NPS" },
  { key: "status", label: "Status" },
];

// The approval queue's body cells use 14px vertical padding, so its headings must too.
const APPROVAL_HEAD_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "14px 16px" };
const APPROVAL_CELL_STYLE: React.CSSProperties = { padding: "14px 16px" };

const FINANCE_HEAD_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "12px 14px" };
const FINANCE_CELL_STYLE: React.CSSProperties = { padding: "12px 14px", userSelect: "text", cursor: "text" };

const FINANCE_EDITABLE_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "7px 8px",
  borderRadius: 6,
  border: "1px solid #dbe7f3",
  background: "#fff",
  fontSize: "0.82rem",
  fontWeight: 600,
  color: "var(--text-main)",
  outline: "none",
};

const FINANCE_WORKFLOW_FILTER_ID = "finance-filter-workflow";
const FINANCE_START_FILTER_ID = "finance-filter-start-date";
const FINANCE_END_FILTER_ID = "finance-filter-end-date";

// Heading floors for the three finance fields that hold a control, so the input
// never renders narrower than its heading.
const FINANCE_COLUMN_MIN_WIDTH: Partial<Record<FinanceColumnKey, number>> = {
  approvalId: 160,
  financeStatus: 130,
  checkDate: 150,
};

// Each row repeats the same three editables, so their labels have to be hidden
// rather than absent — a placeholder is not an accessible name.
const VISUALLY_HIDDEN_LABEL: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export default function DashboardPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  // Top-level Navigation View
  const [activeView, setActiveView] = useState<DashboardView>("active_batches");

  // Active Batches state
  const [activeFilterDate, setActiveFilterDate] = useState<string>(toTodayIso());
  const [activeBatchesData, setActiveBatchesData] = useState<ActiveBatchesResponse | null>(null);
  const [isLoadingActive, setIsLoadingActive] = useState(false);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [activeBatchPage, setActiveBatchPage] = useState(1);
  const [activeBatchPageSize, setActiveBatchPageSize] = useState(10);
  const [activeSessionPage, setActiveSessionPage] = useState(1);
  const [activeSessionPageSize, setActiveSessionPageSize] = useState(15);

  // My Batches state. Kept separate from `batches`, which is manager scope and
  // already loaded for other views.
  const [myBatches, setMyBatches] = useState<Batch[]>([]);
  const [isLoadingMyBatches, setIsLoadingMyBatches] = useState(false);
  const [myBatchesError, setMyBatchesError] = useState<string | null>(null);
  const [myBatchesPage, setMyBatchesPage] = useState(1);
  const [myBatchesPageSize, setMyBatchesPageSize] = useState(10);

  // Team batches state for managers: server-scoped to primary_manager == me
  // or coordinator is a subordinate, same as the manager board RBAC scope.
  const [teamBatches, setTeamBatches] = useState<Batch[]>([]);
  const [isLoadingTeamBatches, setIsLoadingTeamBatches] = useState(false);
  const [teamBatchesError, setTeamBatchesError] = useState<string | null>(null);
  const [teamPage, setTeamPage] = useState(1);
  const [teamPageSize, setTeamPageSize] = useState(10);

  // Direct reports state for managerial dashboard
  const [myReports, setMyReports] = useState<User[]>([]);

  // All users for enterprise dashboard
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Batches state
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchesError, setBatchesError] = useState<string | null>(null);
  const [financeDrafts, setFinanceDrafts] = useState<FinanceDrafts>({});
  const [savingFinanceBatchId, setSavingFinanceBatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [domainFilter, setDomainFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");

  // Finance review sheet state. Free-text search plus the plain value-match
  // dropdowns are owned by `useTableFilters`; the synthetic workflow bucket and
  // the date range are bespoke predicates, so they stay in local state.
  const [financeStatusFilter, setFinanceStatusFilter] = useState("ACTIVE"); // default: exclude draft/pending
  const [financeStartDate, setFinanceStartDate] = useState("");
  const [financeEndDate, setFinanceEndDate] = useState("");
  const [isSavingAllFinance, setIsSavingAllFinance] = useState(false);

  // Analytics state
  const [dashboardSummary, setDashboardSummary] = useState<ManagerDashboardSummary | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [isExportingMbr, setIsExportingMbr] = useState(false);

  // Faculty state
  const [facultyUtilizationLedger, setFacultyUtilizationLedger] = useState<TrainingSession[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);
  const [facultyError, setFacultyError] = useState<string | null>(null);

  // Pagination states for all platform lists/tables
  const [approvalPage, setApprovalPage] = useState(1);
  const [approvalPageSize, setApprovalPageSize] = usePersistentState(
    "ops.table.approvals.pageSize",
    10,
    reviveNumber
  );

  const [financePage, setFinancePage] = useState(1);
  const [financePageSize, setFinancePageSize] = usePersistentState(
    "ops.table.finance.pageSize",
    10,
    reviveNumber
  );

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedBatchForApproval, setSelectedBatchForApproval] = useState<Batch | null>(null);
  const [selectedBatchForDetail, setSelectedBatchForDetail] = useState<Batch | null>(null);
  // The My Batches "Manage Schedule" path lands the coordinator straight on the
  // timetable; every other entry point keeps the default Overview tab.
  const [detailDrawerTab, setDetailDrawerTab] = useState<BatchDetailTab>("overview");

  const openBatchDetail = (batch: Batch, tab: BatchDetailTab = "overview") => {
    setDetailDrawerTab(tab);
    setSelectedBatchForDetail(batch);
  };

  // The active-list rows only carry the batch code, so the full record has to be
  // resolved before the drawer can open. `search` is fuzzy, hence the exact
  // code match before anything is opened.
  const openBatchDetailByCode = async (batchId: string) => {
    if (!batchId) return;
    try {
      const matches = await api.getBatches({ search: batchId });
      const batch = matches.find((b) => b.batch_id === batchId);
      if (!batch) {
        notifyError(`Batch ${batchId} could not be opened`);
        return;
      }
      openBatchDetail(batch);
    } catch (err) {
      notifyError("Failed to open batch details", err);
    }
  };

  // Redirect if unauthenticated
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login");
    } else if (!isAuthLoading && user?.role?.toLowerCase() === "admin") {
      router.replace("/admin");
    }
  }, [user, isAuthLoading, router]);

  // Fetch batches
  const fetchBatches = async (forApprovals = false) => {
    setIsLoading(true);
    setBatchesError(null);
    try {
      const data = await api.getBatches({
        status: forApprovals ? undefined : statusFilter !== "ALL" ? statusFilter : undefined,
        domain: forApprovals ? undefined : domainFilter !== "ALL" ? domainFilter : undefined,
        category: forApprovals ? undefined : categoryFilter !== "ALL" ? categoryFilter : undefined,
      });
      setBatches(data);
    } catch (err) {
      console.error("Failed to load batches:", err);
      setBatchesError(err instanceof Error ? err.message : "Failed to load batches");
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch batches owned by the caller
  const fetchMyBatches = async () => {
    setIsLoadingMyBatches(true);
    setMyBatchesError(null);
    try {
      const data = await api.getBatches({ mine: true });
      setMyBatches(data);
    } catch (err: any) {
      console.error("Failed to load my batches:", err);
      setMyBatchesError(err?.message || "Failed to load your batches");
    } finally {
      setIsLoadingMyBatches(false);
    }
  };

  // Fetch batches in the manager's team scope (primary manager == me, or
  // coordinator is a subordinate). Server-side RBAC scopes the result, so no
  // `mine` flag is passed.
  const fetchTeamBatches = async () => {
    setIsLoadingTeamBatches(true);
    setTeamBatchesError(null);
    try {
      const data = await api.getBatches();
      setTeamBatches(data);
    } catch (err: any) {
      console.error("Failed to load team batches:", err);
      setTeamBatchesError(err?.message || "Failed to load your team's batches");
    } finally {
      setIsLoadingTeamBatches(false);
    }
  };

  // Fetch active batches & sessions for the selected date
  const fetchActiveBatches = async (filterDate: string) => {
    setIsLoadingActive(true);
    setActiveError(null);
    try {
      const data = await api.getActiveBatches({ 
        filterDate, 
        limit: activeBatchPageSize,
        sessionSkip: (activeSessionPage - 1) * activeSessionPageSize,
        sessionLimit: activeSessionPageSize
      });
      setActiveBatchesData(data);
    } catch (err: any) {
      console.error("Failed to load active batches:", err);
      setActiveError(err?.message || "Failed to load active batches");
    } finally {
      setIsLoadingActive(false);
    }
  };

  useEffect(() => {
    setFinanceDrafts((prev) => {
      const next: FinanceDrafts = {};
      batches.forEach((batch) => {
        const previous = prev[batch.id];
        next[batch.id] = {
          approval_id: previous?.approval_id !== undefined ? previous.approval_id : (batch.approval_id || ""),
          finance_status: previous?.finance_status || batch.finance_status || "Pending",
          finance_status_check_date: previous?.finance_status_check_date || batch.finance_status_check_date || "",
        };
      });
      return next;
    });
  }, [batches]);

  const updateFinanceDraft = (
    batchId: string,
    field: "approval_id" | "finance_status" | "finance_status_check_date",
    value: string | number | null,
  ) => {
    setFinanceDrafts((prev) => ({
      ...prev,
      [batchId]: {
        approval_id: prev[batchId]?.approval_id ?? "",
        finance_status: prev[batchId]?.finance_status || "Pending",
        finance_status_check_date: prev[batchId]?.finance_status_check_date || "",
        [field]: value,
      },
    }));
  };

  const saveFinanceBatch = async (batch: Batch) => {
    const draft = financeDrafts[batch.id];
    if (!draft) return;

    setSavingFinanceBatchId(batch.id);
    try {
      await api.updateBatch(batch.id, {
        approval_id: draft.approval_id?.trim() || null,
        finance_status: draft.finance_status || "Pending",
        finance_status_check_date: draft.finance_status_check_date || null,
      });
      await fetchBatches(true);
      notifySuccess("Finance details saved");
    } catch (err: any) {
      notifyError("Failed to save finance details", err);
    } finally {
      setSavingFinanceBatchId(null);
    }
  };

  const saveAllDirtyFinanceBatches = async () => {
    const dirtyBatches = filteredFinanceBatches.filter((b) => {
      const draft = financeDrafts[b.id];
      if (!draft) return false;
      return (
        (draft.approval_id?.trim() || "") !== (b.approval_id || "") ||
        draft.finance_status !== (b.finance_status || "Pending") ||
        draft.finance_status_check_date !== (b.finance_status_check_date || "")
      );
    });
    if (dirtyBatches.length === 0) return;
    setIsSavingAllFinance(true);
    try {
      // Settle every write so a single failure cannot leave the table in an
      // indeterminate saved/unsaved state.
      const results = await Promise.allSettled(
        dirtyBatches.map((b) => {
          const draft = financeDrafts[b.id];
          return api.updateBatch(b.id, {
            approval_id: draft.approval_id?.trim() || null,
            finance_status: draft.finance_status || "Pending",
            finance_status_check_date: draft.finance_status_check_date || null,
          });
        })
      );

      const failed = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected"
      );

      if (failed.length > 0) {
        notifyError(
          failed.length === dirtyBatches.length
            ? `Failed to save ${failed.length} record${failed.length === 1 ? "" : "s"}`
            : `Saved ${results.length - failed.length} of ${results.length} records — ${failed.length} failed`,
          failed[0].reason
        );
      } else {
        notifySuccess(`Saved ${results.length} record${results.length === 1 ? "" : "s"}`);
      }

      // Always resync, since some rows may have persisted before the failure.
      await fetchBatches(true);
    } finally {
      setIsSavingAllFinance(false);
    }
  };

  // Fetch Analytics
  const fetchAnalytics = async () => {
    setIsLoadingAnalytics(true);
    try {
      const data = await api.getManagerDashboard();
      setDashboardSummary(data);
    } catch (err) {
      console.error("Failed to load manager analytics:", err);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  // Fetch Faculty utilization ledger
  const fetchFaculty = async () => {
    setIsLoadingFaculty(true);
    setFacultyError(null);
    try {
      const isAdmin = user?.role?.toLowerCase() === "admin";
      const isFinance = user?.team_name?.trim().toLowerCase() === "finance";
      const shouldSeeAll = isAdmin || isFinance;
      const ledger = await api.getSessions({ all: shouldSeeAll });
      setFacultyUtilizationLedger(ledger ?? []);
    } catch (err: any) {
      console.error("Failed to load faculty utilization:", err);
      setFacultyError(err?.message || "Failed to load faculty utilization records");
      setFacultyUtilizationLedger([]);
    } finally {
      setIsLoadingFaculty(false);
    }
  };

  useEffect(() => {
    if (user) {
      // Reset filters when switching views
      setStatusFilter("ALL");
      setDomainFilter("ALL");
      setCategoryFilter("ALL");

      if (activeView === "my_batches") {
        fetchMyBatches();
        if (user?.role?.toLowerCase() === "manager") {
          fetchTeamBatches();
        }
      } else if (activeView === "active_batches") {
        fetchActiveBatches(activeFilterDate);
      } else if (activeView === "manager_board") {
        fetchBatches();
        fetchAnalytics();
      } else if (activeView === "approvals") {
        fetchBatches(true);
      } else if (activeView === "finance") {
        fetchBatches(true);
      } else if (activeView === "analytics") {
        fetchAnalytics();
        fetchBatches(true);
        api.getUsers().then(setAllUsers).catch(() => {});
      } else if (activeView === "faculty") {
        fetchFaculty();
      }
    }
  }, [user, activeView]);

  // Re-fetch active batches when the filter date changes
  useEffect(() => {
    if (user && activeView === "active_batches") {
      setActiveBatchPage(1);
      setActiveSessionPage(1);
      fetchActiveBatches(activeFilterDate);
    }
  }, [activeFilterDate]);

  // Re-fetch active batches when session pagination changes
  useEffect(() => {
    if (user && activeView === "active_batches") {
      fetchActiveBatches(activeFilterDate);
    }
  }, [activeSessionPage, activeSessionPageSize, activeFilterDate]);

  // Re-fetch batches when filter dropdowns change in manager board / analytics views
  useEffect(() => {
    if (user && activeView === "manager_board") {
      fetchBatches();
    }
  }, [statusFilter, domainFilter, categoryFilter]);

  // Auto-switch to the role's landing view on initial login
  useEffect(() => {
    const teamName = user?.team_name?.trim().toLowerCase();
    if (user && teamName === "finance" && activeView === "active_batches") {
      setActiveView("finance");
    } else if (user && user.role?.toLowerCase() === "manager" && activeView === "active_batches") {
      setActiveView("manager_board");
    } else if (
      user &&
      user.role?.toLowerCase() === "coordinator" &&
      teamName !== "finance" &&
      activeView === "active_batches"
    ) {
      // Coordinators create batches, so the schedule path has to be one click
      // away the moment they land.
      setActiveView("my_batches");
    }
  }, [user]);

  // Fetch all coordinators under the manager (includes direct reports + UserManagerMapping assignments)
  useEffect(() => {
    if (user) {
      api.getCoordinators().then((res) => setMyReports(res)).catch(() => setMyReports([]));
    }
  }, [user]);

  const hasReportingStaff = (user?.direct_reports_count ?? 0) > 0 || user?.is_manager || user?.role?.toLowerCase() === "manager" || user?.role?.toLowerCase() === "admin" || myReports.length > 0;

  useEffect(() => {
    const isFinanceTeam = user?.team_name?.trim().toLowerCase() === "finance";
    if (isFinanceTeam && (activeView === "analytics" || activeView === "manager_board")) {
      setActiveView("finance");
    } else if (!hasReportingStaff && (activeView === "analytics" || activeView === "manager_board")) {
      setActiveView("active_batches");
    } else if (isFinanceTeam && activeView === "my_batches") {
      // My Batches is hidden for Finance, so never strand them on an absent view.
      setActiveView("finance");
    }
  }, [hasReportingStaff, activeView, user?.team_name]);

  // Export MBR Excel Handler
  const handleExportMbr = async () => {
    setIsExportingMbr(true);
    try {
      await api.exportMbrReport();
    } catch (err: any) {
      notifyError("Failed to download MBR report", err);
    } finally {
      setIsExportingMbr(false);
    }
  };

  const approvalQueue = useMemo(
    () => batches.filter((b) => (
      user?.id && (
        (b.status === "Approval 1 Pending" && b.approver_1_id?.toLowerCase() === user.id.toLowerCase())
        || (b.status === "Approval 2 Pending" && b.approver_2_id?.toLowerCase() === user.id.toLowerCase())
      )
    )),
    [batches, user?.id]
  );

  const {
    search: approvalSearch,
    setSearch: setApprovalSearch,
    getFilter: getApprovalFilter,
    setFilter: setApprovalFilter,
    optionsFor: approvalFilterOptions,
    clearFilters: clearApprovalFilters,
    hasActiveFilters: hasApprovalFilters,
    activeFilterCount: approvalFilterCount,
    filteredRows: filteredApprovalQueue,
    filtersVersion: approvalFiltersVersion,
  } = useTableFilters<Batch>(approvalQueue, APPROVAL_FILTER_FIELDS, APPROVAL_SEARCH_ACCESSOR);

  const {
    sortKey: approvalSortKey,
    sortDir: approvalSortDir,
    sortedRows: sortedApprovalQueue,
    toggleSort: toggleApprovalSort,
    applySort: applyApprovalSort,
    sortVersion: approvalSortVersion,
  } = useTableSort<Batch>(filteredApprovalQueue, APPROVAL_ACCESSORS, {
    descFirstKeys: APPROVAL_DESC_FIRST_KEYS,
  });

  const approvalColumns = useColumnVisibility<ApprovalColumnKey>({
    columns: APPROVAL_COLUMN_KEYS,
    storageKey: "ops.table.approvals.columns",
  });
  const visibleApprovalColumnCount = APPROVAL_COLUMN_KEYS.filter((column) =>
    approvalColumns.isVisible(column.key)
  ).length;

  const financeColumns = useMemo(() => buildFinanceColumns(financeDrafts), [financeDrafts]);

  const financeColumnKeys = useMemo(
    () => [
      ...financeColumns.map((column) => ({ key: column.key, label: column.label })),
      { key: "action" as const, label: "Action" },
    ],
    [financeColumns]
  );

  const financeSortOptions = useMemo(() => buildSortOptions(financeColumns), [financeColumns]);
  const financeFilterFields = useMemo(
    () => buildFilterFields(financeColumns),
    [financeColumns]
  );
  const financeSearchAccessor = useMemo(() => buildSearchAccessor(financeColumns), [financeColumns]);

  const {
    search: financeSearch,
    setSearch: setFinanceSearch,
    getFilter: getFinanceFilter,
    setFilter: setFinanceFilter,
    optionsFor: financeFilterOptions,
    clearFilters: clearFinanceTableFilters,
    hasActiveFilters: hasFinanceTableFilters,
    activeFilterCount: financeTableFilterCount,
    filteredRows: financeControlFilteredBatches,
    filtersVersion: financeFiltersVersion,
  } = useTableFilters<Batch>(batches, financeFilterFields, financeSearchAccessor);

  // "ACTIVE" is a synthetic filter (the finance-relevant workflow statuses) and
  // the start-date range cannot be expressed as a plain column value match, so
  // both are applied here on top of the hook's output.
  const filteredFinanceBatches = useMemo(() => {
    return financeControlFilteredBatches.filter((batch) => {
      const startDate = batch.start_date ? batch.start_date.slice(0, 10) : "";
      const passesWorkflowFilter =
        financeStatusFilter === "ALL"
          ? true
          : financeStatusFilter === "ACTIVE"
          ? FINANCE_ACTIVE_STATUSES.has(batch.status)
          : batch.status === financeStatusFilter;

      return passesWorkflowFilter
        && (!financeStartDate || (startDate && startDate >= financeStartDate))
        && (!financeEndDate || (startDate && startDate <= financeEndDate));
    });
  }, [financeControlFilteredBatches, financeStatusFilter, financeStartDate, financeEndDate]);

  const financeSortAccessors = useMemo(() => buildSortAccessors(financeColumns), [financeColumns]);

  const {
    sortKey: financeSortKey,
    sortDir: financeSortDir,
    sortedRows: sortedFinanceBatches,
    toggleSort: toggleFinanceSort,
    applySort: applyFinanceSort,
    sortVersion: financeSortVersion,
  } = useTableSort<Batch>(filteredFinanceBatches, financeSortAccessors);

  const financeColumnVisibility = useColumnVisibility<FinanceColumnKey>({
    columns: financeColumnKeys,
    defaultHidden: FINANCE_DEFAULT_HIDDEN,
    storageKey: "ops.table.finance.columns",
  });
  const visibleFinanceColumnCount = financeColumnKeys.filter((column) =>
    financeColumnVisibility.isVisible(column.key)
  ).length;

  const hasFinanceFilters = hasFinanceTableFilters
    || financeStatusFilter !== "ACTIVE"
    || !!financeStartDate
    || !!financeEndDate;

  const financeFilterCount = financeTableFilterCount
    + (financeStatusFilter !== "ACTIVE" ? 1 : 0)
    + (financeStartDate ? 1 : 0)
    + (financeEndDate ? 1 : 0);

  const clearFinanceFilters = () => {
    clearFinanceTableFilters();
    setFinanceStatusFilter("ACTIVE");
    setFinanceStartDate("");
    setFinanceEndDate("");
  };

  useEffect(() => {
    setApprovalPage(1);
  }, [approvalQueue.length, approvalFiltersVersion, approvalSortVersion]);

  useEffect(() => {
    setFinancePage(1);
  }, [financeFiltersVersion, financeStatusFilter, financeStartDate, financeEndDate, financeSortVersion]);

  const paginatedApprovals = useMemo(() => {
    const start = (approvalPage - 1) * approvalPageSize;
    return sortedApprovalQueue.slice(start, start + approvalPageSize);
  }, [sortedApprovalQueue, approvalPage, approvalPageSize]);

  const paginatedFinanceBatches = useMemo(() => {
    const start = (financePage - 1) * financePageSize;
    return sortedFinanceBatches.slice(start, start + financePageSize);
  }, [sortedFinanceBatches, financePage, financePageSize]);

  // Track which finance rows have unsaved changes
  const dirtyFinanceIds = useMemo(() => {
    const dirty = new Set<string>();
    for (const b of batches) {
      const draft = financeDrafts[b.id];
      if (!draft) continue;
      if (
        (draft.approval_id?.trim() || "") !== (b.approval_id || "") ||
        draft.finance_status !== (b.finance_status || "Pending") ||
        draft.finance_status_check_date !== (b.finance_status_check_date || "")
      ) {
        dirty.add(b.id);
      }
    }
    return dirty;
  }, [batches, financeDrafts]);

  const dirtyFinanceCount = dirtyFinanceIds.size;

  // The KPI cards sit above the table, so they have to count the rows the user
  // can actually see — otherwise "Pending Review" can exceed the row count.
  const financeKpis = useMemo(() => {
    let pending = 0;
    let cleared = 0;
    for (const batch of filteredFinanceBatches) {
      const status = financeDrafts[batch.id]?.finance_status || batch.finance_status || "Pending";
      if (status === "Pending") pending += 1;
      else if (status === "Cleared") cleared += 1;
    }
    return { pending, cleared };
  }, [filteredFinanceBatches, financeDrafts]);

  // `/batches/finance/export` takes filters only, so it cannot carry the active
  // sort and the file order used to differ from the screen. The rows are already
  // sorted here, so the payload is built in the order the user is looking at.
  const exportFinanceSheet = () => {
    downloadCsv(
      `all-batches-${new Date().toISOString().split("T")[0]}`,
      FINANCE_EXPORT_COLUMNS,
      sortedFinanceBatches
    );
  };

  const isApprover = user?.is_configured_approver === true;
  // All Batches is open to Finance and to the configured approvers (approver 1
  // and approver 2). Finance access is granted by team membership -- `User.role`
  // is a fixed union that does not include "finance", so testing it there was
  // always false -- and the approvers are reached through
  // `is_configured_approver`, which is set from the approval configuration.
  const canViewAllBatches = user?.team_name?.trim().toLowerCase() === "finance" || isApprover;
  const canCreateBatch = user?.role?.toLowerCase() !== "admin" && user?.team_name?.trim().toLowerCase() === "delivery";

  useEffect(() => {
    if (!canViewAllBatches && activeView === "finance") {
      setActiveView("active_batches");
    }
  }, [canViewAllBatches, activeView]);

  if (isAuthLoading || !user || user.role?.toLowerCase() === "admin") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <RefreshCw className="animate-spin" size={32} color="#0b5cab" />
          <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>Initializing Operations Platform...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell" style={{
      minHeight: "100vh",
      display: "flex",
      padding: "24px",
      gap: 24,
      alignItems: "stretch",
      justifyContent: "flex-start",
      boxSizing: "border-box",
    }}>
      {/* Modern Card Sidebar Matching Reference Design */}
      <Sidebar
        activeView={activeView}
        setActiveView={setActiveView}
        onOpenCreateBatch={() => setIsCreateOpen(true)}
        pendingApprovalsCount={approvalQueue.length}
        onFilterCategory={(cat) => setCategoryFilter(cat)}
        activeCategoryFilter={categoryFilter}
      />

      {/* Main Content Area */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignSelf: "stretch" }}>

        {/* VIEW 0: MY BATCHES (coordinator-owned, schedule-first) */}
        {activeView === "my_batches" && (
          <MyBatchesView
            data={myBatches}
            teamData={teamBatches}
            isLoading={isLoadingMyBatches || isLoadingTeamBatches}
            error={myBatchesError || teamBatchesError}
            onRefresh={() => {
              fetchMyBatches();
              if (user?.role?.toLowerCase() === "manager") {
                fetchTeamBatches();
              }
            }}
            onOpenBatchDetail={(batch) => openBatchDetail(batch, "sessions")}
            canCreateBatch={canCreateBatch}
            onCreateBatch={() => setIsCreateOpen(true)}
            page={myBatchesPage}
            pageSize={myBatchesPageSize}
            onPageChange={setMyBatchesPage}
            onPageSizeChange={(newSize) => {
              setMyBatchesPageSize(newSize);
              setMyBatchesPage(1);
            }}
          />
        )}

        {/* VIEW 0: MANAGER LEVEL CONTROL BOARD */}
        {activeView === "manager_board" && (
          <ManagerBoard
            batches={batches}
            summary={dashboardSummary}
            reports={myReports}
            isLoading={isLoading || isLoadingAnalytics}
            onRefresh={() => {
              fetchBatches();
              fetchAnalytics();
            }}
            onOpenBatchDetail={(batch) => openBatchDetail(batch)}
            onOpenApproval={(batch) => setSelectedBatchForApproval(batch)}
            currentUser={user}
            onExportMbr={handleExportMbr}
            isExportingMbr={isExportingMbr}
          />
        )}

        {/* VIEW 1: ACTIVE BATCHES & SESSIONS */}
        {activeView === "active_batches" && (
          <ActiveBatchesView
            filterDate={activeFilterDate}
            onFilterDateChange={setActiveFilterDate}
            data={activeBatchesData}
            isLoading={isLoadingActive}
            error={activeError}
            batchPage={activeBatchPage}
            batchPageSize={activeBatchPageSize}
            onBatchPageChange={setActiveBatchPage}
            onBatchPageSizeChange={(newSize) => {
              setActiveBatchPageSize(newSize);
              setActiveBatchPage(1);
            }}
            sessionPage={activeSessionPage}
            sessionPageSize={activeSessionPageSize}
            onSessionPageChange={setActiveSessionPage}
            onSessionPageSizeChange={(newSize) => {
              setActiveSessionPageSize(newSize);
              setActiveSessionPage(1);
            }}
            onRefresh={() => fetchActiveBatches(activeFilterDate)}
            onOpenBatchDetail={(batchId) => openBatchDetailByCode(batchId)}
          />
        )}

        {/* VIEW 2: APPROVAL QUEUE */}
        {activeView === "approvals" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
            <FullscreenTable
              stickyHeader
              stickyTop={NAVBAR_HEIGHT}
              title={
                <PanelTitle
                  title="Batch Approval Queue"
                  description="Review and approve batches waiting for governance clearance."
                  meta={
                    <CountBadge
                      value={`${filteredApprovalQueue.length} of ${approvalQueue.length}`}
                      label={filteredApprovalQueue.length === approvalQueue.length ? "pending" : "pending match"}
                    />
                  }
                />
              }
              toolbar={
                <TableFilters
                  search={{
                    value: approvalSearch,
                    onChange: setApprovalSearch,
                    placeholder: "Search batch, client, program...",
                    width: 250,
                  }}
                  selects={[
                    {
                      key: "status",
                      label: "Status",
                      value: getApprovalFilter("status"),
                      onChange: (value) => setApprovalFilter("status", value),
                      options: approvalFilterOptions("status"),
                      allLabel: "All statuses",
                      width: 175,
                    },
                    {
                      key: "reapproval",
                      label: "Reapproval",
                      value: getApprovalFilter("reapproval"),
                      onChange: (value) => setApprovalFilter("reapproval", value),
                      options: approvalFilterOptions("reapproval"),
                      allLabel: "All submissions",
                      width: 160,
                    },
                    {
                      key: "domain",
                      label: "Domain",
                      value: getApprovalFilter("domain"),
                      onChange: (value) => setApprovalFilter("domain", value),
                      options: approvalFilterOptions("domain"),
                      allLabel: "All domains",
                      width: 140,
                    },
                  ]}
                  sort={{
                    options: APPROVAL_SORT_OPTIONS,
                    sortKey: approvalSortKey,
                    sortDir: approvalSortDir,
                    onChange: applyApprovalSort,
                    width: 165,
                  }}
                  onClear={clearApprovalFilters}
                  hasActiveFilters={hasApprovalFilters}
                  activeFilterCount={approvalFilterCount}
                />
              }
              actions={
                <>
                  <ColumnsMenu
                    columns={APPROVAL_COLUMN_KEYS}
                    hidden={approvalColumns.hidden}
                    onToggle={approvalColumns.toggle}
                    onShowAll={approvalColumns.showAll}
                  />
                  <ExportButton
                    filename="pending-approvals"
                    columns={APPROVAL_EXPORT_COLUMNS}
                    rows={sortedApprovalQueue}
                  />
                </>
              }
              footer={
                <PaginationControls
                  label="Approval queue pages"
                  currentPage={approvalPage}
                  totalItems={sortedApprovalQueue.length}
                  pageSize={approvalPageSize}
                  onPageChange={setApprovalPage}
                  onPageSizeChange={(newSize) => {
                    setApprovalPageSize(newSize);
                    setApprovalPage(1);
                  }}
                />
              }
            >
              <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 1260 }}>
                <TableCaption>Batches waiting for your approval, oldest submissions first</TableCaption>
                <thead>
                  <tr>
                    {APPROVAL_COLUMN_DEFS.map((column) =>
                      approvalColumns.isVisible(column.key) ? (
                        <SortableHeaderCell
                          key={column.key}
                          columnKey={column.key}
                          label={column.label}
                          style={{ ...APPROVAL_HEAD_STYLE, textAlign: column.align ?? "left" }}
                          sortKey={approvalSortKey}
                          sortDir={approvalSortDir}
                          onSort={toggleApprovalSort}
                        />
                      ) : null
                    )}
                    {approvalColumns.isVisible("action") && (
                      <PlainHeaderCell style={{ ...APPROVAL_HEAD_STYLE, textAlign: "right" }}>
                        Action
                      </PlainHeaderCell>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {batchesError ? (
                    <TableStateRow colSpan={visibleApprovalColumnCount}>
                      <ErrorBanner message={batchesError} className="mx-auto my-6 max-w-lg" />
                    </TableStateRow>
                  ) : isLoading && sortedApprovalQueue.length === 0 ? (
                    <TableStateRow colSpan={visibleApprovalColumnCount}>
                      <LoadingState label="Loading your approval queue..." />
                    </TableStateRow>
                  ) : sortedApprovalQueue.length === 0 ? (
                    <TableStateRow colSpan={visibleApprovalColumnCount}>
                      {hasApprovalFilters ? (
                        <EmptyState
                          icon={<Search className="h-5 w-5" aria-hidden="true" />}
                          title="No batches match your filters"
                          description="Clear the search or filter selections to see the whole approval queue."
                          action={
                            <Button size="sm" variant="outline" onClick={clearApprovalFilters}>
                              Clear filters
                            </Button>
                          }
                        />
                      ) : (
                        <EmptyState
                          icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />}
                          title="No batches are waiting for approval"
                          description="Everything routed to you has been actioned. New submissions will appear here."
                        />
                      )}
                    </TableStateRow>
                  ) : (
                    paginatedApprovals.map((b) => {
                      const submittedDays = b.batch_request_date
                        ? Math.floor((Date.now() - new Date(b.batch_request_date).getTime()) / 86400000)
                        : null;
                      const isUrgent = submittedDays !== null && submittedDays >= 3;
                      return (
                        <tr key={b.id} style={{
                          borderBottom: "1px solid var(--border-subtle)",
                          fontSize: "0.875rem",
                          background: isUrgent ? "rgba(251, 191, 36, 0.08)" : undefined,
                        }}>
                          {approvalColumns.isVisible("batchId") && (
                            <td style={APPROVAL_CELL_STYLE}>
                              <div style={{ fontWeight: 700, color: "var(--text-main)", display: "flex", alignItems: "center", gap: 6 }}>
                                {b.batch_id}
                                {isUrgent && (
                                  <span style={{ fontSize: "0.65rem", background: "#fef3c7", color: "#d97706", border: "1px solid #fcd34d", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>OVERDUE</span>
                                )}
                              </div>
                            </td>
                          )}
                          {approvalColumns.isVisible("program") && (
                            <td style={APPROVAL_CELL_STYLE}>{b.program_name || "—"}</td>
                          )}
                          {approvalColumns.isVisible("client") && (
                            <td style={APPROVAL_CELL_STYLE}>
                              <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                                {b.client_name || "Enterprise Client"}
                              </span>
                            </td>
                          )}
                          {approvalColumns.isVisible("domain") && (
                            <td style={{ ...APPROVAL_CELL_STYLE, color: "#7c3aed", fontWeight: 600 }}>
                              {b.domain || "IT/ITES"}
                            </td>
                          )}
                          {approvalColumns.isVisible("mode") && (
                            <td style={{ ...APPROVAL_CELL_STYLE, whiteSpace: "nowrap" }}>{b.delivery_mode || "Online"}</td>
                          )}
                          {approvalColumns.isVisible("city") && (
                            <td style={{ ...APPROVAL_CELL_STYLE, color: "var(--text-dim)", whiteSpace: "nowrap" }}>
                              {b.location_city || "Remote"}
                            </td>
                          )}
                          {approvalColumns.isVisible("submittedOn") && (
                            <td style={APPROVAL_CELL_STYLE}>
                              {b.batch_request_date ? (
                                <>
                                  <div style={{ fontWeight: 600, color: "var(--text-main)" }}>
                                    {formatDate(b.batch_request_date)}
                                  </div>
                                  <div style={{ fontSize: "0.72rem", color: isUrgent ? "#d97706" : "var(--text-muted)", marginTop: 2 }}>
                                    {submittedDays === 0 ? "Today" : `${submittedDays}d ago`}
                                  </div>
                                </>
                              ) : <span style={{ color: "var(--text-dim)" }}>—</span>}
                            </td>
                          )}
                          {approvalColumns.isVisible("status") && (
                            <td style={APPROVAL_CELL_STYLE}>
                              <StatusBadge status={b.status} />
                            </td>
                          )}
                          {approvalColumns.isVisible("reapproval") && (
                            <td style={{ ...APPROVAL_CELL_STYLE, textAlign: "center" }}>
                              {b.is_reapproval ? (
                                <span
                                  title={b.last_reapproval_at ? `Last modified ${formatDate(b.last_reapproval_at)}` : "Previously approved batch was modified"}
                                  style={{ fontSize: "0.65rem", background: "#ede9fe", color: "#6d28d9", border: "1px solid #c4b5fd", borderRadius: 4, padding: "1px 5px", fontWeight: 700, whiteSpace: "nowrap" }}
                                >
                                  REAPPROVAL #{b.reapproval_count ?? 1}
                                </span>
                              ) : (
                                <span style={{ color: "var(--text-dim)" }}>—</span>
                              )}
                            </td>
                          )}
                          {approvalColumns.isVisible("action") && (
                            <td style={{ ...APPROVAL_CELL_STYLE, textAlign: "right" }}>
                              <Button
                                size="sm"
                                onClick={() => setSelectedBatchForApproval(b)}
                                aria-label={`Open approval details for batch ${b.batch_id}`}
                              >
                                View Full Batch Details
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </FullscreenTable>
          </div>
        )}

        {/* VIEW 3: ALL BATCHES */}
        {activeView === "finance" && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            flex: 1
          }}>
            {/* Finance Summary Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
              <StatCard
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                label="Pending Review"
                value={financeKpis.pending}
                hint="Rows in view still marked Pending"
                tone="warning"
              />
              <StatCard
                icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                label="Cleared"
                value={financeKpis.cleared}
                hint="Rows in view marked Cleared"
                tone="success"
              />
              {dirtyFinanceCount > 0 && (
                <StatCard
                  icon={<PencilLine className="h-5 w-5" aria-hidden="true" />}
                  label="Unsaved Rows"
                  value={dirtyFinanceCount}
                  hint="Edited rows across all batches, not just this filter"
                  tone="violet"
                />
              )}
            </div>

            <FullscreenTable
              stickyHeader
              stickyTop={NAVBAR_HEIGHT}
              title={
                <PanelTitle
                  title="All Batches"
                  description="Every batch on one sheet: finance tracking, approval status, and operational checks."
                  meta={
                    <CountBadge
                      value={`${filteredFinanceBatches.length} of ${batches.length}`}
                      label={filteredFinanceBatches.length === batches.length ? "batch rows" : "batch rows match"}
                    />
                  }
                />
              }
              toolbar={
                <TableFilters
                  search={{
                    value: financeSearch,
                    onChange: setFinanceSearch,
                    placeholder: "Search batch, client, program, SOW...",
                    width: 250,
                  }}
                  selects={[
                    {
                      key: "financeStatus",
                      label: "Finance Status",
                      value: getFinanceFilter("financeStatus"),
                      onChange: (value) => setFinanceFilter("financeStatus", value),
                      options: FINANCE_STATUS_OPTIONS,
                      allLabel: "All finance status",
                      width: 140,
                    },
                    {
                      key: "domain",
                      label: "Domain",
                      value: getFinanceFilter("domain"),
                      onChange: (value) => setFinanceFilter("domain", value),
                      options: financeFilterOptions("domain"),
                      allLabel: "All domains",
                      width: 120,
                    },
                    {
                      key: "mode",
                      label: "Mode",
                      value: getFinanceFilter("mode"),
                      onChange: (value) => setFinanceFilter("mode", value),
                      options: financeFilterOptions("mode"),
                      allLabel: "All modes",
                      width: 125,
                    },
                    {
                      key: "status",
                      label: "Status",
                      value: getFinanceFilter("status"),
                      onChange: (value) => setFinanceFilter("status", value),
                      options: financeFilterOptions("status"),
                      allLabel: "All statuses",
                      width: 165,
                    },
                  ]}
                  sort={{
                    options: financeSortOptions,
                    sortKey: financeSortKey,
                    sortDir: financeSortDir,
                    onChange: applyFinanceSort,
                    width: 200,
                  }}
                  bespoke={[
                    {
                      key: "workflow",
                      label: "Workflow",
                      htmlFor: FINANCE_WORKFLOW_FILTER_ID,
                      width: 160,
                      chipValue: financeStatusFilter !== "ACTIVE" ? financeStatusFilter : null,
                      onClear: () => setFinanceStatusFilter("ACTIVE"),
                      content: (
                        <select
                          id={FINANCE_WORKFLOW_FILTER_ID}
                          value={financeStatusFilter}
                          onChange={(e) => setFinanceStatusFilter(e.target.value)}
                          className="glass-input"
                          style={TABLE_CONTROL_STYLE}
                        >
                          <option value="ACTIVE">Active batches</option>
                          <option value="ALL">All workflow status</option>
                          <option value="Approved">Approved</option>
                          <option value="Upcoming">Upcoming</option>
                          <option value="Ongoing">Ongoing</option>
                          <option value="Completed">Completed</option>
                          <option value="Requested">Requested (Draft)</option>
                          <option value="Approval 1 Pending">Approval 1 Pending</option>
                          <option value="Approval 2 Pending">Approval 2 Pending</option>
                        </select>
                      ),
                    },
                    {
                      key: "startDate",
                      label: "Start Date",
                      htmlFor: FINANCE_START_FILTER_ID,
                      width: 150,
                      chipValue: financeStartDate || null,
                      onClear: () => setFinanceStartDate(""),
                      content: (
                        <input
                          id={FINANCE_START_FILTER_ID}
                          type="date"
                          value={financeStartDate}
                          onChange={(e) => setFinanceStartDate(e.target.value)}
                          className="glass-input"
                          title="Start date from"
                          aria-label="Start date from"
                          style={TABLE_CONTROL_STYLE}
                        />
                      ),
                    },
                    {
                      key: "endDate",
                      label: "End Date",
                      htmlFor: FINANCE_END_FILTER_ID,
                      width: 150,
                      chipValue: financeEndDate || null,
                      onClear: () => setFinanceEndDate(""),
                      content: (
                        <input
                          id={FINANCE_END_FILTER_ID}
                          type="date"
                          value={financeEndDate}
                          onChange={(e) => setFinanceEndDate(e.target.value)}
                          className="glass-input"
                          title="Start date to"
                          aria-label="Start date to"
                          style={TABLE_CONTROL_STYLE}
                        />
                      ),
                    },
                  ]}
                  onClear={clearFinanceFilters}
                  hasActiveFilters={hasFinanceFilters}
                  activeFilterCount={financeFilterCount}
                />
              }
              actions={
                <>
                  <ColumnsMenu
                    columns={financeColumnKeys}
                    hidden={financeColumnVisibility.hidden}
                    onToggle={financeColumnVisibility.toggle}
                    onShowAll={financeColumnVisibility.showAll}
                  />
                  {dirtyFinanceCount > 0 && (
                    <Button
                      size="sm"
                      className="h-9 shrink-0"
                      onClick={saveAllDirtyFinanceBatches}
                      loading={isSavingAllFinance}
                      title={`Save the approval ID, finance status and check date of ${dirtyFinanceCount} edited row${dirtyFinanceCount === 1 ? "" : "s"}`}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      <span>{isSavingAllFinance ? "Saving..." : `Save All (${dirtyFinanceCount})`}</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 gap-1.5 px-2 text-xs"
                    onClick={exportFinanceSheet}
                    disabled={sortedFinanceBatches.length === 0}
                    title={
                      sortedFinanceBatches.length === 0
                        ? "Nothing to export with the current filters"
                        : `Export the ${sortedFinanceBatches.length} batch row${sortedFinanceBatches.length === 1 ? "" : "s"} on screen, in the current sort order`
                    }
                  >
                    <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                    <span>Export CSV</span>
                  </Button>
                </>
              }
              footer={
                <PaginationControls
                  currentPage={financePage}
                  totalItems={filteredFinanceBatches.length}
                  pageSize={financePageSize}
                  onPageChange={setFinancePage}
                  onPageSizeChange={(newSize) => {
                    setFinancePageSize(newSize);
                    setFinancePage(1);
                  }}
                />
              }
            >
              <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: "2200px" }}>
                <TableCaption>All batches: batch identity, delivery facts and the finance fields to check</TableCaption>
                <thead>
                  <tr>
                    {financeColumns.map((column) => {
                      if (!financeColumnVisibility.isVisible(column.key)) return null;
                      const headStyle = {
                        ...FINANCE_HEAD_STYLE,
                        textAlign: column.align ?? "left",
                        minWidth: FINANCE_COLUMN_MIN_WIDTH[column.key],
                      };
                      return isSortable(column) ? (
                        <SortableHeaderCell
                          key={column.key}
                          columnKey={column.key}
                          label={column.label}
                          style={headStyle}
                          sortKey={financeSortKey}
                          sortDir={financeSortDir}
                          onSort={toggleFinanceSort}
                        />
                      ) : (
                        <PlainHeaderCell key={column.key} style={headStyle}>
                          {column.label}
                        </PlainHeaderCell>
                      );
                    })}
                    {financeColumnVisibility.isVisible("action") && (
                      <PlainHeaderCell style={{ ...FINANCE_HEAD_STYLE, textAlign: "center" }}>
                        Action
                      </PlainHeaderCell>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {batchesError ? (
                    <TableStateRow colSpan={visibleFinanceColumnCount}>
                      <ErrorBanner message={batchesError} className="mx-auto my-6 max-w-lg" />
                    </TableStateRow>
                  ) : isLoading && filteredFinanceBatches.length === 0 ? (
                    <TableStateRow colSpan={visibleFinanceColumnCount}>
                      <LoadingState label="Loading all batches..." />
                    </TableStateRow>
                  ) : filteredFinanceBatches.length === 0 ? (
                    <TableStateRow colSpan={visibleFinanceColumnCount}>
                      {hasFinanceFilters ? (
                        <EmptyState
                          icon={<Search className="h-5 w-5" aria-hidden="true" />}
                          title="No batches match your filters"
                          description="Clear the search or filter selections to see every batch."
                          action={
                            <Button size="sm" variant="outline" onClick={clearFinanceFilters}>
                              Clear filters
                            </Button>
                          }
                        />
                      ) : (
                        <EmptyState
                          icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
                          title="No batch data available"
                          description="Batches will appear here once they have been created."
                        />
                      )}
                    </TableStateRow>
                  ) : (
                    paginatedFinanceBatches.map((b) => {
                      const draft = financeDrafts[b.id] || {
                        approval_id: b.approval_id || "",
                        finance_status: b.finance_status || "Pending",
                        finance_status_check_date: b.finance_status_check_date || "",
                      };
                      const visible = financeColumnVisibility.isVisible;
                      const approvalIdFieldId = `finance-approval-id-${b.id}`;
                      const financeStatusFieldId = `finance-status-${b.id}`;
                      const checkDateFieldId = `finance-check-date-${b.id}`;

                      return (
                        <tr key={b.id} style={{
                          borderBottom: "1px solid var(--border-subtle)",
                          fontSize: "0.82rem",
                          background: dirtyFinanceIds.has(b.id) ? "rgba(251, 191, 36, 0.07)" : undefined,
                        }}>
                          {visible("batchId") && (
                            <td style={{ ...FINANCE_CELL_STYLE, fontWeight: 700, color: "var(--accent-primary)", whiteSpace: "nowrap" }}>{b.batch_id}</td>
                          )}
                          {visible("client") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.client_name || "—"}</td>
                          )}
                          {visible("program") && (
                            <td style={{ ...FINANCE_CELL_STYLE, minWidth: 180 }}>{b.program_name}</td>
                          )}
                          {visible("category") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.category || "—"}</td>
                          )}
                          {visible("technology") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.technology || "—"}</td>
                          )}
                          {visible("domain") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.domain || "—"}</td>
                          )}
                          {visible("mode") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.delivery_mode || "Online"}</td>
                          )}
                          {visible("location") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.location_city || "—"}</td>
                          )}
                          {visible("startDate") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.start_date ? formatDate(b.start_date) : "—"}</td>
                          )}
                          {visible("endDate") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.end_date ? formatDate(b.end_date) : "—"}</td>
                          )}
                          {visible("enrollments") && (
                            <td style={{ ...FINANCE_CELL_STYLE, textAlign: "center" }}>{b.total_enrollments}</td>
                          )}
                          {visible("trainingDays") && (
                            <td style={{ ...FINANCE_CELL_STYLE, textAlign: "center" }}>{b.training_days || 0}</td>
                          )}
                          {visible("totalHours") && (
                            <td style={{ ...FINANCE_CELL_STYLE, textAlign: "center" }}>{b.total_hours || 0}</td>
                          )}
                          {visible("sowNumber") && (
                            <td style={{ ...FINANCE_CELL_STYLE, whiteSpace: "nowrap" }}>{b.sow_number || "—"}</td>
                          )}
                          {visible("approvalId") && (
                            <td style={{ padding: "12px 14px", minWidth: 160 }}>
                              <label htmlFor={approvalIdFieldId} style={VISUALLY_HIDDEN_LABEL}>
                                Approval ID for batch {b.batch_id}
                              </label>
                              <input
                                id={approvalIdFieldId}
                                type="text"
                                value={draft.approval_id}
                                onChange={(e) => updateFinanceDraft(b.id, "approval_id", e.target.value)}
                                placeholder="Approval ID..."
                                aria-label={`Approval ID for batch ${b.batch_id}`}
                                style={FINANCE_EDITABLE_STYLE}
                              />
                            </td>
                          )}
                          {visible("faculty") && (
                            <td style={{ ...FINANCE_CELL_STYLE, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.faculty_assigned_text || ""}>{b.faculty_assigned_text || "—"}</td>
                          )}
                          {visible("financeStatus") && (
                            <td style={{ padding: "12px 14px", minWidth: 130 }}>
                              <label htmlFor={financeStatusFieldId} style={VISUALLY_HIDDEN_LABEL}>
                                Finance status for batch {b.batch_id}
                              </label>
                              <select
                                id={financeStatusFieldId}
                                value={draft.finance_status}
                                onChange={(e) => updateFinanceDraft(b.id, "finance_status", e.target.value)}
                                aria-label={`Finance status for batch ${b.batch_id}`}
                                style={{
                                  ...FINANCE_EDITABLE_STYLE,
                                  color: draft.finance_status === "Cleared" ? "#16a34a" : "#d97706",
                                }}
                              >
                                <option value="Pending">Pending</option>
                                <option value="Cleared">Cleared</option>
                              </select>
                            </td>
                          )}
                          {visible("checkDate") && (
                            <td style={{ padding: "12px 14px", minWidth: 150 }}>
                              <label htmlFor={checkDateFieldId} style={VISUALLY_HIDDEN_LABEL}>
                                Finance check date for batch {b.batch_id}
                              </label>
                              <input
                                id={checkDateFieldId}
                                type="date"
                                value={draft.finance_status_check_date}
                                onChange={(e) => updateFinanceDraft(b.id, "finance_status_check_date", e.target.value)}
                                aria-label={`Finance check date for batch ${b.batch_id}`}
                                style={FINANCE_EDITABLE_STYLE}
                              />
                            </td>
                          )}
                          {visible("remarks") && (
                            <td style={{ ...FINANCE_CELL_STYLE, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={b.remarks || ""}>{b.remarks || "—"}</td>
                          )}
                          {visible("status") && (
                            <td style={FINANCE_CELL_STYLE}>
                              <StatusBadge status={b.status} />
                            </td>
                          )}
                          {visible("action") && (
                            <td style={{ padding: "12px 14px", textAlign: "center" }}>
                              <Button
                                size="sm"
                                onClick={() => saveFinanceBatch(b)}
                                loading={savingFinanceBatchId === b.id}
                                aria-label={`Save finance details for batch ${b.batch_id}`}
                              >
                                Save
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                      })
                    )}
                  </tbody>
                </table>
            </FullscreenTable>
          </div>
        )}

        {/* VIEW 4: ENTERPRISE DASHBOARD */}
        {activeView === "analytics" && (
          <EnterpriseDashboard
            batches={batches}
            users={allUsers}
            currentUser={user}
            dashboardSummary={dashboardSummary}
            isLoading={isLoadingAnalytics}
            facultyUtilizationLedger={facultyUtilizationLedger}
          />
        )}

        {/* VIEW 3: FACULTY UTILIZATION LEDGER */}
        {activeView === "faculty" && (
          <FacultyUtilizationView
            data={facultyUtilizationLedger}
            isLoading={isLoadingFaculty}
            error={facultyError}
            onRefresh={fetchFaculty}
          />
        )}
        </main>

      {/* Modals & Drawers */}
      <CreateBatchModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onBatchCreated={() => {
          fetchBatches();
          if (activeView === "my_batches") fetchMyBatches();
        }}
      />

      <ApproveBatchModal
        batch={selectedBatchForApproval}
        isOpen={!!selectedBatchForApproval}
        onClose={() => setSelectedBatchForApproval(null)}
        onBatchApproved={() => fetchBatches()}
        canApprove={!!selectedBatchForApproval && approvalQueue.some((batch) => batch.id === selectedBatchForApproval.id)}
      />

      {selectedBatchForDetail && (
        <BatchDetailDrawer
          batch={selectedBatchForDetail}
          isOpen={true}
          onClose={() => setSelectedBatchForDetail(null)}
          onOpenApprove={(b) => setSelectedBatchForApproval(b)}
          canApprove={!!selectedBatchForDetail && approvalQueue.some((batch) => batch.id === selectedBatchForDetail.id)}
          onBatchUpdated={() => {
            fetchBatches();
            if (activeView === "my_batches") fetchMyBatches();
          }}
          initialTab={detailDrawerTab}
        />
      )}
    </div>
  );
}
