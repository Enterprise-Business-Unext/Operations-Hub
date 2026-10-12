"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Layers, Clock, Search, Timer, Users, RefreshCw, Star, TrendingUp } from "lucide-react";
import { ActiveBatchItem, ActiveBatchesResponse, ActiveSessionItem } from "@/lib/api";
import { formatDate } from "@/lib/dateUtils";
import { PaginationControls } from "@/components/PaginationControls";
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
  PanelTitle,
  StatCard,
  TABLE_TH_STYLE,
} from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/statusBadge";
import { useTableSort } from "@/hooks/useTableSort";
import { useTableFilters } from "@/hooks/useTableFilters";
import { useColumnVisibility, type UseColumnVisibilityResult } from "@/hooks/useColumnVisibility";
import {
  buildFilterFields,
  buildSearchAccessor,
  buildSortAccessors,
  buildSortOptions,
  type TableColumnDef,
} from "@/lib/tableColumns";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/utils";

interface ActiveBatchesViewProps {
  filterDate: string;
  onFilterDateChange: (date: string) => void;
  data: ActiveBatchesResponse | null;
  isLoading: boolean;
  error?: string | null;
  batchPage: number;
  batchPageSize: number;
  onBatchPageChange: (page: number) => void;
  onBatchPageSizeChange: (pageSize: number) => void;
  sessionPage: number;
  sessionPageSize: number;
  onSessionPageChange: (page: number) => void;
  onSessionPageSizeChange: (pageSize: number) => void;
  onRefresh?: () => void;
  // Rows here only carry the immutable batch code, not a full `Batch`, so the
  // callback is typed against what the table actually holds. The host has to
  // resolve the full record from that code before opening the drawer.
  onOpenBatchDetail?: (batchId: string) => void;
}

function formatTime(value?: string | null, fallback: string = "—"): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const timeMatch = trimmed.match(/T(\d{2}):(\d{2})/);
  if (timeMatch) return `${timeMatch[1]}:${timeMatch[2]}`;
  const plainMatch = trimmed.match(/^(\d{2}):(\d{2})/);
  if (plainMatch) return `${plainMatch[1]}:${plainMatch[2]}`;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return fallback;
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

// Values that ride along inside a composite cell (or are filterable without
// being a column of their own). Declared once so sort, search and filter agree.
const BATCH_VALUE = {
  program: (batch: ActiveBatchItem) => batch.program_name ?? "",
  category: (batch: ActiveBatchItem) => batch.category || "",
  client: (batch: ActiveBatchItem) => batch.client_name || "Enterprise Client",
  deliveryMode: (batch: ActiveBatchItem) => batch.delivery_mode || "Online",
  location: (batch: ActiveBatchItem) => batch.location_city || "Remote",
};

const SESSION_VALUE = {
  batchName: (session: ActiveSessionItem) => session.batch_name || "",
  person: (session: ActiveSessionItem) =>
    (session.session_type === "actual" ? session.faculty_name : session.trainer_name) || "",
  location: (session: ActiveSessionItem) => session.location_city || session.venue || "Remote",
};

const BATCH_COLUMN_DEFS = [
  {
    key: "batch",
    label: "Batch & Program",
    accessor: (batch: ActiveBatchItem) => batch.batch_id || "",
    search: [BATCH_VALUE.program],
  },
  {
    key: "client",
    label: "Client & Category",
    accessor: BATCH_VALUE.client,
    search: [BATCH_VALUE.category],
    filterable: true,
  },
  {
    key: "deliveryMode",
    label: "Mode & Location",
    accessor: BATCH_VALUE.deliveryMode,
    search: [BATCH_VALUE.location],
    filterable: true,
  },
  { key: "startDate", label: "Start Date", accessor: (batch: ActiveBatchItem) => batch.start_date ?? null },
  { key: "endDate", label: "End Date", accessor: (batch: ActiveBatchItem) => batch.end_date ?? null },
  { key: "status", label: "Status", accessor: (batch: ActiveBatchItem) => batch.status || "", filterable: true },
  {
    key: "enrollments",
    label: "Enrollments",
    accessor: (batch: ActiveBatchItem) => batch.total_enrollments ?? 0,
    align: "center",
  },
  {
    key: "sessionsConducted",
    label: "Sessions Conducted",
    accessor: (batch: ActiveBatchItem) => batch.sessions_conducted ?? 0,
    search: [(batch: ActiveBatchItem) => batch.training_days ?? 0],
  },
  { key: "progress", label: "Progress", accessor: (batch: ActiveBatchItem) => batch.progress ?? 0 },
  {
    key: "feedback",
    label: "Avg Feedback",
    accessor: (batch: ActiveBatchItem) => batch.batch_avg_feedback ?? null,
    align: "center",
    filterable: true,
  },
  {
    key: "nps",
    label: "NPS",
    accessor: (batch: ActiveBatchItem) => batch.batch_nps ?? null,
    align: "center",
    filterable: true,
  },
] as const satisfies readonly TableColumnDef<ActiveBatchItem>[];

type BatchColumnKey = (typeof BATCH_COLUMN_DEFS)[number]["key"] | (typeof EXTRA_BATCH_DEFS)[number]["key"];

// "Program" has no column of its own but stays sortable; "Category" and
// "Location" stay sortable and filterable on top of that.
const EXTRA_BATCH_DEFS: readonly TableColumnDef<ActiveBatchItem>[] = [
  { key: "program", label: "Program", accessor: BATCH_VALUE.program },
  { key: "category", label: "Category", accessor: BATCH_VALUE.category, filterable: true },
  { key: "location", label: "Location", accessor: BATCH_VALUE.location, filterable: true },
];

const BATCH_ALL_DEFS = [...BATCH_COLUMN_DEFS, ...EXTRA_BATCH_DEFS];
const BATCH_ACCESSORS = buildSortAccessors(BATCH_ALL_DEFS);
const BATCH_SORT_OPTIONS = buildSortOptions(BATCH_ALL_DEFS);
const BATCH_FILTER_FIELDS = buildFilterFields(BATCH_ALL_DEFS);
const BATCH_SEARCH_ACCESSOR = buildSearchAccessor(BATCH_COLUMN_DEFS);
const BATCH_DESC_FIRST_KEYS = ["startDate", "endDate", "progress", "enrollments", "sessionsConducted"];

const BATCH_COLUMN_KEYS: readonly { key: BatchColumnKey; label: string }[] = [
  ...BATCH_COLUMN_DEFS.map((column) => ({ key: column.key, label: column.label })),
  ...EXTRA_BATCH_DEFS.map((column) => ({ key: column.key as BatchColumnKey, label: column.label })),
];

const BATCH_EXPORT_COLUMNS: readonly CsvColumn<ActiveBatchItem>[] = [
  { key: "batch_id", label: "Batch ID" },
  { key: "program_name", label: "Program" },
  { key: "client_name", label: "Client" },
  { key: "category", label: "Category" },
  { key: "delivery_mode", label: "Delivery Mode" },
  { key: "location_city", label: "Location" },
  { key: "start_date", label: "Start Date" },
  { key: "end_date", label: "End Date" },
  { key: "status", label: "Status" },
  { key: "total_enrollments", label: "Enrollments" },
  { key: "training_days", label: "Training Days" },
  { key: "sessions_conducted", label: "Sessions Conducted" },
  { key: "progress", label: "Progress" },
  { key: "batch_avg_feedback", label: "Avg Feedback" },
  { key: "batch_nps", label: "NPS" },
];

const SESSION_COLUMN_DEFS = [
  {
    key: "batch",
    label: "Batch",
    accessor: (session: ActiveSessionItem) => session.batch_id || "",
    search: [SESSION_VALUE.batchName],
    filterable: true,
  },
  {
    key: "type",
    label: "Type",
    accessor: (session: ActiveSessionItem) => session.session_type || "",
    filterable: true,
  },
  {
    key: "module",
    label: "Module",
    accessor: (session: ActiveSessionItem) => session.module || "",
    search: [(session: ActiveSessionItem) => session.sequence_number ?? null],
  },
  { key: "person", label: "Trainer / Faculty", accessor: SESSION_VALUE.person },
  { key: "date", label: "Date", accessor: (session: ActiveSessionItem) => session.session_date ?? null },
  {
    key: "startTime",
    label: "Time & Duration",
    accessor: (session: ActiveSessionItem) => session.start_time ?? null,
    search: [
      (session: ActiveSessionItem) => session.end_time ?? null,
      (session: ActiveSessionItem) => session.duration_hours ?? 0,
    ],
  },
  { key: "status", label: "Status", accessor: (session: ActiveSessionItem) => session.status || "", filterable: true },
  {
    key: "delivery",
    label: "Delivery Mode",
    accessor: (session: ActiveSessionItem) => session.mode_of_delivery || "Online",
    search: [SESSION_VALUE.location],
    filterable: true,
  },
] as const satisfies readonly TableColumnDef<ActiveSessionItem>[];

type SessionColumnKey = (typeof SESSION_COLUMN_DEFS)[number]["key"] | (typeof EXTRA_SESSION_DEFS)[number]["key"];

// "Sequence", "Duration" and "Location" are all sortable, and "Location" is
// filterable, without any of them being a column.
const EXTRA_SESSION_DEFS: readonly TableColumnDef<ActiveSessionItem>[] = [
  { key: "sequence", label: "Sequence", accessor: (session: ActiveSessionItem) => session.sequence_number ?? null },
  { key: "duration", label: "Duration", accessor: (session: ActiveSessionItem) => session.duration_hours ?? 0 },
  { key: "location", label: "Location", accessor: SESSION_VALUE.location, filterable: true },
];

const SESSION_ALL_DEFS = [...SESSION_COLUMN_DEFS, ...EXTRA_SESSION_DEFS];
const SESSION_ACCESSORS = buildSortAccessors(SESSION_ALL_DEFS);
const SESSION_SORT_OPTIONS = buildSortOptions(SESSION_ALL_DEFS);
const SESSION_FILTER_FIELDS = buildFilterFields(SESSION_ALL_DEFS);
const SESSION_SEARCH_ACCESSOR = buildSearchAccessor(SESSION_COLUMN_DEFS);
const SESSION_DESC_FIRST_KEYS = ["date", "startTime", "duration", "sequence"];

const SESSION_COLUMN_KEYS: readonly { key: SessionColumnKey; label: string }[] = [
  ...SESSION_COLUMN_DEFS.map((column) => ({ key: column.key, label: column.label })),
  ...EXTRA_SESSION_DEFS.map((column) => ({ key: column.key as SessionColumnKey, label: column.label })),
];

const SESSION_EXPORT_COLUMNS: readonly CsvColumn<ActiveSessionItem>[] = [
  { key: "batch_id", label: "Batch ID" },
  { key: "batch_name", label: "Batch Name" },
  { key: "session_type", label: "Type" },
  { key: "module", label: "Module" },
  { key: "sequence_number", label: "Sequence" },
  { key: "faculty_name", label: "Faculty" },
  { key: "trainer_name", label: "Trainer" },
  { key: "session_date", label: "Date" },
  { key: "start_time", label: "Start Time" },
  { key: "end_time", label: "End Time" },
  { key: "duration_hours", label: "Duration Hours" },
  { key: "status", label: "Status" },
  { key: "mode_of_delivery", label: "Delivery Mode" },
  { key: "venue", label: "Venue" },
  { key: "location_city", label: "Location" },
];

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

// The session-type breakdown pills share one shape and differ only in tone.
// Body cells and headings share these metrics so the two rows line up.
const CELL_STYLE: React.CSSProperties = { padding: "14px 16px" };
const HEAD_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "14px 16px" };

// `align` is optional, so it is only present on the members of the definition
// union that set it.
function columnAlign<T, K extends string>(column: TableColumnDef<T, K>): "left" | "center" | "right" {
  return ("align" in column ? column.align : undefined) ?? "left";
}

function progressTone(rate: number): { bar: string; text: string } {
  if (rate >= 100) return { bar: "bg-success", text: "text-success" };
  if (rate >= 50) return { bar: "bg-primary", text: "text-primary" };
  if (rate > 0) return { bar: "bg-warning", text: "text-warning" };
  return { bar: "bg-muted-foreground/40", text: "text-muted-foreground" };
}

function BatchRow({
  batch,
  columns,
  onOpenBatchDetail,
}: {
  batch: ActiveBatchItem;
  columns: UseColumnVisibilityResult<BatchColumnKey>;
  onOpenBatchDetail?: (batchId: string) => void;
}) {
  const rate = Math.min(100, Math.max(0, Math.round(batch.progress ?? 0)));
  const tone = progressTone(rate);
  const totalDays = batch.training_days || 0;
  const open = () => onOpenBatchDetail?.(batch.batch_id);

  return (
    <tr
      onClick={onOpenBatchDetail ? open : undefined}
      onKeyDown={
        onOpenBatchDetail
          ? (event) => {
              // The whole row is the hit target for the detail drawer, so it has
              // to answer the keyboard as well as the mouse.
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open();
              }
            }
          : undefined
      }
      tabIndex={onOpenBatchDetail ? 0 : undefined}
      aria-label={onOpenBatchDetail ? `Open details for batch ${batch.batch_id}` : undefined}
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "0.875rem",
        ...(onOpenBatchDetail ? { cursor: "pointer" } : null),
      }}
    >
      {columns.isVisible("batch") && (
        <td style={CELL_STYLE}>
          <div style={{ fontWeight: 700, color: "var(--text-main)" }}>{batch.batch_id}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>{batch.program_name}</div>
        </td>
      )}
      {columns.isVisible("client") && (
        <td style={CELL_STYLE}>
          <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{batch.client_name || "Enterprise Client"}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 2 }}>{batch.category || "—"}</div>
        </td>
      )}
      {columns.isVisible("deliveryMode") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
          <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{batch.delivery_mode || "Online"}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 2 }}>{batch.location_city || "Remote"}</div>
        </td>
      )}
      {columns.isVisible("startDate") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
          <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{formatDate(batch.start_date)}</div>
        </td>
      )}
      {columns.isVisible("endDate") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
          <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{formatDate(batch.end_date)}</div>
        </td>
      )}
      {columns.isVisible("status") && (
        <td style={CELL_STYLE}>
          <StatusBadge status={batch.status} />
        </td>
      )}
      {columns.isVisible("enrollments") && (
        <td style={{ ...CELL_STYLE, textAlign: "center", fontWeight: 600, color: "var(--text-main)" }}>
          {batch.total_enrollments}
        </td>
      )}
      {columns.isVisible("sessionsConducted") && (
        <td style={CELL_STYLE}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-main)" }}>
              {batch.sessions_conducted}
            </span>
            {totalDays > 0 ? (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>/ {totalDays} days</span>
            ) : (
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>days TBD</span>
            )}
          </div>
        </td>
      )}
      {columns.isVisible("progress") && (
        <td style={{ ...CELL_STYLE, minWidth: 130 }}>
          <div className={cn("mb-[5px] text-[0.8rem] font-bold", tone.text)}>
            {totalDays > 0 ? `${rate}%` : "N/A"}
          </div>
          <div
            role="progressbar"
            aria-label={`Progress for batch ${batch.batch_id}`}
            aria-valuenow={rate}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full transition-[width] duration-300", tone.bar)}
              style={{ width: `${rate}%` }}
            />
          </div>
        </td>
      )}
      {columns.isVisible("feedback") && (
        <td style={{ ...CELL_STYLE, textAlign: "center" }}>
          {batch.batch_avg_feedback !== null && batch.batch_avg_feedback !== undefined ? (
            <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
              {Number(batch.batch_avg_feedback).toFixed(1)} <Star className="h-3.5 w-3.5 inline ml-1 text-warning" aria-hidden="true" />
            </span>
          ) : (
            <span style={{ color: "var(--text-dim)" }}>—</span>
          )}
        </td>
      )}
      {columns.isVisible("nps") && (
        <td style={{ ...CELL_STYLE, textAlign: "center" }}>
          {batch.batch_nps !== null && batch.batch_nps !== undefined ? (
            <span
              style={{
                fontWeight: 600,
                color: batch.batch_nps > 0 ? "var(--success)" : batch.batch_nps < 0 ? "var(--destructive)" : "var(--text-muted)",
              }}
            >
              {batch.batch_nps > 0 ? "+" : ""}{Number(batch.batch_nps).toFixed(1)}
            </span>
          ) : (
            <span style={{ color: "var(--text-dim)" }}>—</span>
          )}
        </td>
      )}
      {columns.isVisible("program") && (
        <td style={CELL_STYLE}>
          <div style={{ color: "var(--text-main)" }}>{batch.program_name || "—"}</div>
        </td>
      )}
      {columns.isVisible("category") && (
        <td style={CELL_STYLE}>
          <div style={{ color: "var(--text-main)" }}>{batch.category || "—"}</div>
        </td>
      )}
      {columns.isVisible("location") && (
        <td style={CELL_STYLE}>
          <div style={{ color: "var(--text-main)" }}>{batch.location_city || "Remote"}</div>
        </td>
      )}
    </tr>
  );
}

function SessionRow({
  session,
  columns,
  onOpenBatchDetail,
}: {
  session: ActiveSessionItem;
  columns: UseColumnVisibilityResult<SessionColumnKey>;
  onOpenBatchDetail?: (batchId: string) => void;
}) {
  const isActual = session.session_type === "actual";
  const person = isActual ? session.faculty_name : session.trainer_name;
  const location = session.location_city || session.venue;
  // The API contract allows an empty code, and a row without one has nothing to
  // open, so the handler stays undefined instead of becoming a no-op click.
  const batchCode = session.batch_id?.trim();
  const openBatch = onOpenBatchDetail && batchCode ? () => onOpenBatchDetail(batchCode) : undefined;

  return (
    <tr
      onClick={openBatch}
      onKeyDown={
        openBatch
          ? (event) => {
              // The whole row is the hit target for the detail drawer, so it has
              // to answer the keyboard as well as the mouse.
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openBatch();
              }
            }
          : undefined
      }
      tabIndex={openBatch ? 0 : undefined}
      aria-label={openBatch ? `Open details for batch ${batchCode}` : undefined}
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        fontSize: "0.875rem",
        ...(openBatch ? { cursor: "pointer" } : null),
      }}
    >
      {columns.isVisible("batch") && (
        <td style={CELL_STYLE}>
          <div style={{ fontWeight: 700, color: "var(--text-main)" }}>{session.batch_id || "—"}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>{session.batch_name || "—"}</div>
        </td>
      )}
      {columns.isVisible("type") && (
        <td style={CELL_STYLE}>
          <Badge variant={isActual ? "info" : "default"} size="sm" className="normal-case tracking-normal">
            {isActual ? "Actual" : "Scheduled"}
          </Badge>
        </td>
      )}
      {columns.isVisible("module") && (
        <td style={{ ...CELL_STYLE, maxWidth: 260 }}>
          <div style={{ whiteSpace: "normal", color: "var(--text-main)" }}>{session.module || "—"}</div>
          {session.sequence_number ? (
            <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 2 }}>
              Session #{session.sequence_number}
            </div>
          ) : null}
        </td>
      )}
      {columns.isVisible("person") && (
        <td style={{ ...CELL_STYLE, color: "var(--text-main)" }}>{person || "—"}</td>
      )}
      {columns.isVisible("date") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap", color: "var(--text-main)", fontWeight: 600 }}>
          {formatDate(session.session_date)}
        </td>
      )}
      {columns.isVisible("startTime") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
          <div style={{ color: "var(--text-main)", fontWeight: 600 }}>
            {formatTime(session.start_time)} – {formatTime(session.end_time)}
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 2 }}>
            {session.duration_hours ? `${Number(session.duration_hours).toFixed(2)} hrs` : "—"}
          </div>
        </td>
      )}
      {columns.isVisible("status") && (
        <td style={CELL_STYLE}>
          <StatusBadge status={session.status} />
        </td>
      )}
      {columns.isVisible("delivery") && (
        <td style={CELL_STYLE}>
          <div style={{ color: "var(--text-main)", fontWeight: 600 }}>{session.mode_of_delivery || "Online"}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 2 }}>{location || "Remote"}</div>
        </td>
      )}
      {columns.isVisible("sequence") && (
        <td style={{ ...CELL_STYLE, textAlign: "center" }}>
          <div style={{ color: "var(--text-main)" }}>{session.sequence_number ?? "—"}</div>
        </td>
      )}
      {columns.isVisible("duration") && (
        <td style={{ ...CELL_STYLE, textAlign: "center" }}>
          <div style={{ color: "var(--text-main)" }}>{session.duration_hours ? `${Number(session.duration_hours).toFixed(2)} hrs` : "—"}</div>
        </td>
      )}
      {columns.isVisible("location") && (
        <td style={CELL_STYLE}>
          <div style={{ color: "var(--text-main)" }}>{session.location_city || session.venue || "Remote"}</div>
        </td>
      )}
    </tr>
  );
}

export function ActiveBatchesView({
  filterDate,
  onFilterDateChange,
  data,
  isLoading,
  error,
  batchPage,
  batchPageSize,
  onBatchPageChange,
  onBatchPageSizeChange,
  sessionPage,
  sessionPageSize,
  onSessionPageChange,
  onSessionPageSizeChange,
  onRefresh,
  onOpenBatchDetail,
}: ActiveBatchesViewProps) {
  const [batchesFiltersOpen, setBatchesFiltersOpen] = useState(false);
  const [sessionsFiltersOpen, setSessionsFiltersOpen] = useState(false);
  const batches = useMemo(() => data?.batches ?? [], [data]);
  const sessions = useMemo(() => data?.sessions ?? [], [data]);

  const batchSort = useTableSort(batches, BATCH_ACCESSORS, { descFirstKeys: BATCH_DESC_FIRST_KEYS });
  const sessionSort = useTableSort(sessions, SESSION_ACCESSORS, { descFirstKeys: SESSION_DESC_FIRST_KEYS });

  const batchesFilters = useTableFilters(batchSort.sortedRows, BATCH_FILTER_FIELDS, BATCH_SEARCH_ACCESSOR);
  const sessionsFilters = useTableFilters(sessionSort.sortedRows, SESSION_FILTER_FIELDS, SESSION_SEARCH_ACCESSOR);

  const batchColumns = useColumnVisibility<BatchColumnKey>({
    columns: BATCH_COLUMN_KEYS,
    defaultHidden: ["sessionsConducted", "feedback", "nps"],
    storageKey: "ops.table.active-batches.columns",
  });
  const sessionColumns = useColumnVisibility<SessionColumnKey>({
    columns: SESSION_COLUMN_KEYS,
    defaultHidden: ["delivery"],
    storageKey: "ops.table.active-sessions.columns",
  });

  // A new date is a new result set, and re-sorting reorders the current one, so
  // either way the current page offset is meaningless.
  useEffect(() => {
    onBatchPageChange(1);
  }, [batchesFilters.filtersVersion, filterDate, batchSort.sortVersion]);

  useEffect(() => {
    onSessionPageChange(1);
  }, [sessionsFilters.filtersVersion, filterDate, sessionSort.sortVersion]);

  const filteredBatches = batchesFilters.filteredRows;
  const filteredSessions = sessionsFilters.filteredRows;

  const batchStart = (batchPage - 1) * batchPageSize;
  const pagedBatches = useMemo(
    () => filteredBatches.slice(batchStart, batchStart + batchPageSize),
    [filteredBatches, batchStart, batchPageSize]
  );

  const sessionStart = (sessionPage - 1) * sessionPageSize;
  const pagedSessions = useMemo(
    () => filteredSessions.slice(sessionStart, sessionStart + sessionPageSize),
    [filteredSessions, sessionStart, sessionPageSize]
  );

  const totalBatches = data?.total_batches ?? 0;
  const totalSessions = data?.total_sessions ?? sessions.length;

  // Every scheduled row contributes: `/batches/active` returns all statuses on
  // the date (the repository applies no status filter), so cancelled and
  // completed sessions also count here.
  const hoursScheduled = useMemo(
    () =>
      sessions.reduce(
        (sum, session) => sum + (session.session_type === "scheduled" ? Number(session.duration_hours) || 0 : 0),
        0
      ),
    [sessions]
  );
  const facultyDeployed = useMemo(() => {
    const names = new Set<string>();
    sessions.forEach((session) => {
      const person = (session.session_type === "actual" ? session.faculty_name : session.trainer_name)?.trim();
      if (person) names.add(person);
    });
    return names.size;
  }, [sessions]);

  // Colspan has to count only the columns that survived the show/hide menu, or
  // the state rows span fewer cells than the table has.
  const batchVisibleColumns = BATCH_COLUMN_KEYS.filter((column) => batchColumns.isVisible(column.key)).length;
  const sessionVisibleColumns = SESSION_COLUMN_KEYS.filter((column) => sessionColumns.isVisible(column.key)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
      {/* Date filter and refresh own the top-right corner on their own row,
          above the heading and the metric cards. */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="glass-panel" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
          <Calendar size={16} color="var(--text-dim)" aria-hidden="true" />
          <label htmlFor="active-batches-date" style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-dim)" }}>
            Date
          </label>
          <input
            id="active-batches-date"
            type="date"
            value={filterDate}
            onChange={(event) => onFilterDateChange(event.target.value)}
            className="glass-input"
            style={{ padding: "6px 10px", fontSize: "0.85rem" }}
          />
          {onRefresh ? (
            <button
              onClick={onRefresh}
              className="btn btn-secondary"
              style={{ padding: "6px 10px", fontSize: "0.8rem" }}
              title="Refresh active batches"
            >
              <RefreshCw size={14} className={isLoading ? "animate-spin" : undefined} aria-hidden="true" />
              <span>Refresh</span>
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <h2 style={{ fontSize: "1.35rem", fontWeight: 800, color: "var(--text-main)", margin: 0 }}>
          Active Batches &amp; Sessions
        </h2>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
          Batches running on the selected date, with the curriculum and delivery sessions scheduled for that day.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <StatCard
          icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          label="Ongoing Batches"
          value={totalBatches}
          hint="Active on the selected date"
          tone="primary"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          label="Sessions"
          value={totalSessions}
          hint="Planned and delivered for the date"
          tone="info"
        />
        <StatCard
          icon={<Timer className="h-5 w-5" aria-hidden="true" />}
          label="Scheduled Hours"
          value={`${hoursScheduled.toFixed(1)} hrs`}
          hint="Curriculum hours scheduled for the date"
          tone="warning"
        />
        <StatCard
          icon={<Users className="h-5 w-5" aria-hidden="true" />}
          label="Faculty Deployed"
          value={facultyDeployed}
          hint="Distinct trainers and faculty on the day"
          tone="success"
        />
      </div>

      <FullscreenTable
        title={
          <PanelTitle
            title="Ongoing Batches"
            description="Batches running on the selected date, with delivery progress."
            meta={
              <CountBadge
                value={`${filteredBatches.length} of ${batches.length}`}
                label={filteredBatches.length === batches.length ? "batches" : "batches match"}
              />
            }
          />
        }
        toolbar={
          <TableFilters
            filtersOpen={batchesFiltersOpen}
            onFiltersOpenChange={setBatchesFiltersOpen}
            search={{
              value: batchesFilters.search,
              onChange: batchesFilters.setSearch,
              placeholder: "Search batches by ID, program, client...",
            }}
            selects={[
              {
                key: "status",
                label: "Status",
                value: batchesFilters.getFilter("status"),
                onChange: (value) => batchesFilters.setFilter("status", value),
                options: batchesFilters.optionsFor("status"),
              },
              {
                key: "deliveryMode",
                label: "Delivery Mode",
                value: batchesFilters.getFilter("deliveryMode"),
                onChange: (value) => batchesFilters.setFilter("deliveryMode", value),
                options: batchesFilters.optionsFor("deliveryMode"),
              },
              {
                key: "client",
                label: "Client",
                value: batchesFilters.getFilter("client"),
                onChange: (value) => batchesFilters.setFilter("client", value),
                options: batchesFilters.optionsFor("client"),
                width: 170,
              },
              {
                key: "category",
                label: "Category",
                value: batchesFilters.getFilter("category"),
                onChange: (value) => batchesFilters.setFilter("category", value),
                options: batchesFilters.optionsFor("category"),
                width: 170,
              },
              {
                key: "location",
                label: "Location",
                value: batchesFilters.getFilter("location"),
                onChange: (value) => batchesFilters.setFilter("location", value),
                options: batchesFilters.optionsFor("location"),
                width: 160,
              },
            ]}
            sort={{
              options: BATCH_SORT_OPTIONS,
              sortKey: batchSort.sortKey,
              sortDir: batchSort.sortDir,
              onChange: batchSort.applySort,
            }}
            onClear={batchesFilters.clearFilters}
            hasActiveFilters={batchesFilters.hasActiveFilters}
            activeFilterCount={batchesFilters.activeFilterCount}
          />
        }
        actions={
          <>
            <ColumnsMenu
              columns={BATCH_COLUMN_KEYS}
              hidden={batchColumns.hidden}
              onToggle={batchColumns.toggle}
              onShowAll={batchColumns.showAll}
            />
            <ExportButton filename="active-batches" columns={BATCH_EXPORT_COLUMNS} rows={filteredBatches} />
            {onRefresh && <RefreshButton onClick={onRefresh} isLoading={isLoading} label="Refresh" />}
          </>
        }
        footer={
          <PaginationControls
            label="Ongoing batches pages"
            currentPage={batchPage}
            totalItems={filteredBatches.length}
            pageSize={batchPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={onBatchPageChange}
            onPageSizeChange={onBatchPageSizeChange}
          />
        }
      >
        <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 1180 }}>
          <TableCaption>Ongoing batches for the selected date, with delivery progress</TableCaption>
          <thead>
            <tr>
              {BATCH_ALL_DEFS.map((column) =>
                batchColumns.isVisible(column.key as BatchColumnKey) ? (
                  <SortableHeaderCell
                    key={column.key}
                    columnKey={column.key as BatchColumnKey}
                    label={column.label}
                    style={{ ...HEAD_STYLE, textAlign: columnAlign(column) }}
                    sortKey={batchSort.sortKey}
                    sortDir={batchSort.sortDir}
                    onSort={batchSort.toggleSort}
                  />
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <TableStateRow colSpan={batchVisibleColumns}>
                <ErrorBanner message={error} className="mx-auto my-6 max-w-lg" />
              </TableStateRow>
            ) : isLoading && batches.length === 0 ? (
              <TableStateRow colSpan={batchVisibleColumns}>
                <LoadingState label="Loading ongoing batches..." />
              </TableStateRow>
            ) : filteredBatches.length === 0 ? (
              <TableStateRow colSpan={batchVisibleColumns}>
                {batches.length === 0 ? (
                  <EmptyState
                    icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
                    title="No ongoing batches for this date"
                    description="Select a different date to view batches running that day."
                  />
                ) : (
                  <EmptyState
                    icon={<Search className="h-5 w-5" aria-hidden="true" />}
                    title="No batches match the current filters"
                    description="Clear the search or filters to see all ongoing batches."
                    action={
                      <Button size="sm" variant="outline" onClick={batchesFilters.clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                )}
              </TableStateRow>
            ) : (
              pagedBatches.map((batch) => (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  columns={batchColumns}
                  onOpenBatchDetail={onOpenBatchDetail}
                />
              ))
            )}
          </tbody>
        </table>
      </FullscreenTable>

      <FullscreenTable
        title={
          <PanelTitle
            title="Ongoing Sessions"
            description="Planned and delivered sessions for the selected date."
            meta={
              <CountBadge
                value={`${filteredSessions.length} of ${sessions.length}`}
                label={filteredSessions.length === sessions.length ? "sessions" : "sessions match"}
              />
            }
          />
        }
        toolbar={
          <TableFilters
            filtersOpen={sessionsFiltersOpen}
            onFiltersOpenChange={setSessionsFiltersOpen}
            search={{
              value: sessionsFilters.search,
              onChange: sessionsFilters.setSearch,
              placeholder: "Search sessions by batch, module, trainer...",
            }}
            selects={[
              {
                key: "status",
                label: "Status",
                value: sessionsFilters.getFilter("status"),
                onChange: (value) => sessionsFilters.setFilter("status", value),
                options: sessionsFilters.optionsFor("status"),
              },
              {
                key: "type",
                label: "Type",
                value: sessionsFilters.getFilter("type"),
                onChange: (value) => sessionsFilters.setFilter("type", value),
                options: sessionsFilters.optionsFor("type"),
                width: 140,
              },
              {
                key: "delivery",
                label: "Delivery Mode",
                value: sessionsFilters.getFilter("delivery"),
                onChange: (value) => sessionsFilters.setFilter("delivery", value),
                options: sessionsFilters.optionsFor("delivery"),
                width: 160,
              },
              {
                key: "location",
                label: "Location",
                value: sessionsFilters.getFilter("location"),
                onChange: (value) => sessionsFilters.setFilter("location", value),
                options: sessionsFilters.optionsFor("location"),
                width: 160,
              },
              {
                key: "batch",
                label: "Batch",
                value: sessionsFilters.getFilter("batch"),
                onChange: (value) => sessionsFilters.setFilter("batch", value),
                options: sessionsFilters.optionsFor("batch"),
                width: 170,
              },
            ]}
            sort={{
              options: SESSION_SORT_OPTIONS,
              sortKey: sessionSort.sortKey,
              sortDir: sessionSort.sortDir,
              onChange: sessionSort.applySort,
            }}
            onClear={sessionsFilters.clearFilters}
            hasActiveFilters={sessionsFilters.hasActiveFilters}
            activeFilterCount={sessionsFilters.activeFilterCount}
          />
        }
        actions={
          <>
            <ColumnsMenu
              columns={SESSION_COLUMN_KEYS}
              hidden={sessionColumns.hidden}
              onToggle={sessionColumns.toggle}
              onShowAll={sessionColumns.showAll}
            />
            <ExportButton filename="active-sessions" columns={SESSION_EXPORT_COLUMNS} rows={filteredSessions} />
            {onRefresh && <RefreshButton onClick={onRefresh} isLoading={isLoading} label="Refresh" />}
          </>
        }
        footer={
          <PaginationControls
            label="Ongoing sessions pages"
            currentPage={sessionPage}
            totalItems={filteredSessions.length}
            pageSize={sessionPageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={onSessionPageChange}
            onPageSizeChange={onSessionPageSizeChange}
          />
        }
      >
        <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 1180 }}>
          <TableCaption>Ongoing sessions for the selected date, with delivery details</TableCaption>
          <thead>
            <tr>
              {SESSION_ALL_DEFS.map((column) =>
                sessionColumns.isVisible(column.key as SessionColumnKey) ? (
                  <SortableHeaderCell
                    key={column.key}
                    columnKey={column.key as SessionColumnKey}
                    label={column.label}
                    style={{ ...HEAD_STYLE, textAlign: columnAlign(column) }}
                    sortKey={sessionSort.sortKey}
                    sortDir={sessionSort.sortDir}
                    onSort={sessionSort.toggleSort}
                  />
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <TableStateRow colSpan={sessionVisibleColumns}>
                <ErrorBanner message={error} className="mx-auto my-6 max-w-lg" />
              </TableStateRow>
            ) : isLoading && sessions.length === 0 ? (
              <TableStateRow colSpan={sessionVisibleColumns}>
                <LoadingState label="Loading ongoing sessions..." />
              </TableStateRow>
            ) : filteredSessions.length === 0 ? (
              <TableStateRow colSpan={sessionVisibleColumns}>
                {sessions.length === 0 ? (
                  <EmptyState
                    icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
                    title="No sessions scheduled for this date"
                    description="All statuses for this date are shown, including cancelled, not conducted, and completed."
                  />
                ) : (
                  <EmptyState
                    icon={<Search className="h-5 w-5" aria-hidden="true" />}
                    title="No sessions match the current filters"
                    description="Clear the search or filters to see all sessions."
                    action={
                      <Button size="sm" variant="outline" onClick={sessionsFilters.clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                )}
              </TableStateRow>
            ) : (
              pagedSessions.map((session) => (
                <SessionRow
                  key={`${session.session_type}-${session.id}`}
                  session={session}
                  columns={sessionColumns}
                  onOpenBatchDetail={onOpenBatchDetail}
                />
              ))
            )}
          </tbody>
        </table>
      </FullscreenTable>
    </div>
  );
}
