"use client";

import React, { useEffect, useMemo } from "react";
import { Layers, CalendarClock, CalendarX2, Clock, Search, UserPlus, Star, TrendingUp } from "lucide-react";
import { Batch } from "@/lib/api";
import { formatDate } from "@/lib/dateUtils";
import { PaginationControls } from "@/components/PaginationControls";
import {
  ColumnsMenu,
  ExportButton,
  FullscreenTable,
  PlainHeaderCell,
  RefreshButton,
  SortableHeaderCell,
  TableCaption,
  TableFilters,
  TableStateRow,
} from "@/components/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ACTIONS_COLUMN_STYLE,
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
import { useTableSort } from "@/hooks/useTableSort";
import { useTableFilters, type TableFilterField } from "@/hooks/useTableFilters";
import { useColumnVisibility, type UseColumnVisibilityResult } from "@/hooks/useColumnVisibility";
import {
  buildFilterFields,
  buildSearchAccessor,
  buildSortAccessors,
  buildSortOptions,
  type TableColumnDef,
} from "@/lib/tableColumns";
import type { CsvColumn } from "@/lib/csv";

interface MyBatchesViewProps {
  data: Batch[];
  isLoading: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onOpenBatchDetail: (batch: Batch) => void;
  canCreateBatch?: boolean;
  onCreateBatch?: () => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * The reason this view exists: "Not scheduled" is the call to action a
 * coordinator needs before they can ingest a timetable, and it is invisible
 * everywhere else in the product.
 */
function ScheduleBadge({ count, trainingDays }: { count: number; trainingDays: number }) {
  const scheduled = count > 0;
  const overLimit = count > trainingDays;
  return (
    <Badge
      variant={overLimit ? "destructive" : scheduled ? "success" : "destructive"}
      size="sm"
      className="normal-case tracking-normal"
    >
      {overLimit
        ? `${count} / ${trainingDays} days`
        : scheduled
          ? `${count} day${count === 1 ? "" : "s"}`
          : "Not scheduled"}
    </Badge>
  );
}

// Values that ride along in a composite cell (or are filterable without being
// a column of their own). Declared once so sort, search and filter agree.
const VALUE = {
  program: (batch: Batch) => batch.program_name ?? "",
  category: (batch: Batch) => batch.category ?? "",
  client: (batch: Batch) => batch.client_name ?? "",
  city: (batch: Batch) => batch.location_city ?? "",
};

const BATCH_COLUMN_DEFS: readonly TableColumnDef<Batch>[] = [
  {
    key: "batchId",
    label: "Batch & Program",
    accessor: (batch) => batch.batch_id ?? "",
    search: [VALUE.program],
  },
  {
    key: "client",
    label: "Client",
    accessor: VALUE.client,
    search: [VALUE.category],
    filterable: true,
  },
  {
    key: "deliveryMode",
    label: "Mode & Location",
    accessor: (batch) => batch.delivery_mode ?? "",
    search: [VALUE.city],
    filterable: true,
  },
  { key: "startDate", label: "Start", accessor: (batch) => batch.start_date ?? "" },
  { key: "endDate", label: "End", accessor: (batch) => batch.end_date ?? "" },
  { key: "status", label: "Status", accessor: (batch) => batch.status ?? "", filterable: true },
  {
    key: "trainingDays",
    label: "Training Days",
    accessor: (batch) => batch.training_days ?? 0,
    align: "center",
  },
  { key: "schedule", label: "Schedule", accessor: (batch) => batch.scheduled_session_count ?? 0 },
  {
    key: "feedback",
    label: "Avg Feedback",
    accessor: (batch) => batch.batch_avg_feedback ?? null,
    align: "center",
    filterable: true,
  },
  {
    key: "nps",
    label: "NPS",
    accessor: (batch) => batch.batch_nps ?? null,
    align: "center",
    filterable: true,
  },
];

// "Category" is filterable without being a column of its own. "Client" and
// "Delivery Mode" are columns, so they carry `filterable` on the defs above --
// a select whose key is missing from the filter fields renders but silently
// filters nothing.
const EXTRA_FILTER_FIELDS: readonly TableFilterField<Batch>[] = [
  { key: "category", accessor: VALUE.category },
];

const BATCH_ACCESSORS = buildSortAccessors(BATCH_COLUMN_DEFS);
const BATCH_SORT_OPTIONS = buildSortOptions(BATCH_COLUMN_DEFS);
const BATCH_FILTER_FIELDS = [...buildFilterFields(BATCH_COLUMN_DEFS), ...EXTRA_FILTER_FIELDS];
const BATCH_SEARCH_ACCESSOR = buildSearchAccessor([
  ...BATCH_COLUMN_DEFS,
  { key: "category", label: "Category", accessor: VALUE.category },
]);

const COLUMN_KEYS = [
  ...BATCH_COLUMN_DEFS.map((column) => ({ key: column.key, label: column.label })),
  { key: "action", label: "Action" },
] as const;

type ColumnKey = (typeof COLUMN_KEYS)[number]["key"];

const EXPORT_COLUMNS: readonly CsvColumn<Batch>[] = [
  { key: "batch_id", label: "Batch ID" },
  { key: "program_name", label: "Program" },
  { key: "client_name", label: "Client" },
  { key: "category", label: "Category" },
  { key: "delivery_mode", label: "Delivery Mode" },
  { key: "location_city", label: "Location" },
  { key: "start_date", label: "Start Date" },
  { key: "end_date", label: "End Date" },
  { key: "status", label: "Status" },
  { key: "training_days", label: "Training Days" },
  { key: "scheduled_session_count", label: "Scheduled Days" },
  { key: "batch_avg_feedback", label: "Avg Feedback" },
  { key: "batch_nps", label: "NPS" },
];

// BatchRow's cells use 14px vertical padding, so the headings must match.
const CELL_STYLE: React.CSSProperties = { padding: "14px 16px" };
const HEAD_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "14px 16px" };

function BatchRow({
  batch,
  columns,
  onOpenBatchDetail,
}: {
  batch: Batch;
  columns: UseColumnVisibilityResult<ColumnKey>;
  onOpenBatchDetail: (batch: Batch) => void;
}) {
  const open = () => onOpenBatchDetail(batch);

  return (
    <tr
      onClick={open}
      onKeyDown={(event) => {
        // The whole row is the hit target for the detail drawer, so it has to
        // answer the keyboard as well as the mouse.
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      tabIndex={0}
      aria-label={`Open details for batch ${batch.batch_id}`}
      style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.875rem", cursor: "pointer" }}
    >
      {columns.isVisible("batchId") && (
        <td style={CELL_STYLE}>
          <div style={{ fontWeight: 700, color: "var(--text-main)" }}>{batch.batch_id}</div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 2 }}>
            {batch.program_name}
          </div>
        </td>
      )}
      {columns.isVisible("client") && (
        <td style={CELL_STYLE}>
          <div style={{ fontWeight: 600, color: "var(--text-main)" }}>
            {batch.client_name || "Enterprise Client"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 2 }}>
            {batch.category || "—"}
          </div>
        </td>
      )}
      {columns.isVisible("deliveryMode") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap" }}>
          <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{batch.delivery_mode || "Online"}</div>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: 2 }}>
            {batch.location_city || "Remote"}
          </div>
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
      {columns.isVisible("trainingDays") && (
        <td style={{ ...CELL_STYLE, textAlign: "center", fontWeight: 600, color: "var(--text-main)" }}>
          {batch.training_days || 0}
        </td>
      )}
      {columns.isVisible("schedule") && (
        <td style={CELL_STYLE}>
          <ScheduleBadge
            count={batch.scheduled_session_count ?? 0}
            trainingDays={batch.training_days ?? 0}
          />
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
      {columns.isVisible("action") && (
        <td style={{ ...CELL_STYLE, whiteSpace: "nowrap", textAlign: "right", ...ACTIONS_COLUMN_STYLE }}>
          <Button
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpenBatchDetail(batch);
            }}
            aria-label={`Manage schedule for batch ${batch.batch_id}`}
          >
            Manage Schedule
          </Button>
        </td>
      )}
    </tr>
  );
}

export function MyBatchesView({
  data,
  isLoading,
  error,
  onRefresh,
  onOpenBatchDetail,
  canCreateBatch = false,
  onCreateBatch,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: MyBatchesViewProps) {
  const batches = useMemo(() => data ?? [], [data]);

  const { sortKey, sortDir, sortedRows, toggleSort, applySort, sortVersion } = useTableSort(batches, BATCH_ACCESSORS, {
    descFirstKeys: ["startDate", "endDate"],
  });

  const {
    search,
    setSearch,
    setFilter,
    getFilter,
    optionsFor,
    clearFilters,
    hasActiveFilters,
    activeFilterCount,
    filteredRows,
    filtersVersion,
  } = useTableFilters(sortedRows, BATCH_FILTER_FIELDS, BATCH_SEARCH_ACCESSOR);

  const columns = useColumnVisibility<ColumnKey>({
    columns: COLUMN_KEYS,
    storageKey: "ops.table.my-batches.columns",
    defaultHidden: ["feedback", "nps"],
  });

  useEffect(() => {
    onPageChange(1);
  }, [filtersVersion, sortVersion]);

  const start = (page - 1) * pageSize;
  const pagedBatches = useMemo(() => filteredRows.slice(start, start + pageSize), [filteredRows, start, pageSize]);

  const unscheduledCount = useMemo(
    () => batches.filter((batch) => (batch.scheduled_session_count ?? 0) === 0).length,
    [batches]
  );
  const scheduledDays = useMemo(
    () => batches.reduce((sum, batch) => sum + (batch.scheduled_session_count ?? 0), 0),
    [batches]
  );
  const inFlightCount = useMemo(
    () => batches.filter((batch) => batch.status === "Ongoing").length,
    [batches]
  );

  const visibleColumnCount = COLUMN_KEYS.filter((column) => columns.isVisible(column.key)).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
        <StatCard
          icon={<Layers className="h-5 w-5" aria-hidden="true" />}
          label="My Batches"
          value={batches.length}
          hint="Batches assigned to you"
          tone="primary"
        />
        <StatCard
          icon={<CalendarX2 className="h-5 w-5" aria-hidden="true" />}
          label="Awaiting Schedule"
          value={unscheduledCount}
          hint="No timetable ingested yet"
          tone="warning"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
          label="Scheduled Days"
          value={scheduledDays}
          hint="Timetable days across your batches"
          tone="success"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" aria-hidden="true" />}
          label="Ongoing"
          value={inFlightCount}
          hint="Currently running batches"
          tone="info"
        />
      </div>

      {canCreateBatch && onCreateBatch && batches.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" className="h-9 shrink-0" onClick={onCreateBatch}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            <span>Add New Batch</span>
          </Button>
        </div>
      )}

      <FullscreenTable
        stickyHeader
        stickyTop={NAVBAR_HEIGHT}
        title={
          <PanelTitle
            title="Batches Assigned To You"
            description="Batches you own, and whether each one still needs a timetable."
            meta={
              <CountBadge
                value={`${filteredRows.length} of ${batches.length}`}
                label={filteredRows.length === batches.length ? "batches" : "batches match"}
              />
            }
          />
        }
        toolbar={
          <TableFilters
            search={{
              value: search,
              onChange: setSearch,
              placeholder: "Search batches by ID, program, client...",
              width: 280,
            }}
            selects={[
              {
                key: "status",
                label: "Status",
                value: getFilter("status"),
                onChange: (value) => setFilter("status", value),
                options: optionsFor("status"),
                allLabel: "All statuses",
                width: 150,
              },
              {
                key: "category",
                label: "Category",
                value: getFilter("category"),
                onChange: (value) => setFilter("category", value),
                options: optionsFor("category"),
                allLabel: "All categories",
                width: 150,
              },
              {
                key: "deliveryMode",
                label: "Delivery Mode",
                value: getFilter("deliveryMode"),
                onChange: (value) => setFilter("deliveryMode", value),
                options: optionsFor("deliveryMode"),
                allLabel: "All delivery modes",
                width: 160,
              },
              {
                key: "client",
                label: "Client",
                value: getFilter("client"),
                onChange: (value) => setFilter("client", value),
                options: optionsFor("client"),
                allLabel: "All clients",
                width: 170,
              },
            ]}
            sort={{
              options: BATCH_SORT_OPTIONS,
              sortKey,
              sortDir,
              onChange: applySort,
            }}
            onClear={clearFilters}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
          />
        }
        actions={
          <>
            <ColumnsMenu
              columns={COLUMN_KEYS}
              hidden={columns.hidden}
              onToggle={columns.toggle}
              onShowAll={columns.showAll}
            />
            <ExportButton filename="my-batches" columns={EXPORT_COLUMNS} rows={filteredRows} />
            {onRefresh && <RefreshButton onClick={onRefresh} isLoading={isLoading} label="Refresh" />}
          </>
        }
        footer={
          <PaginationControls
            label="My batches pages"
            currentPage={page}
            totalItems={filteredRows.length}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        }
      >
        <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 1180 }}>
          <TableCaption>Batches assigned to you, with schedule status</TableCaption>
          <thead>
            <tr>
              {BATCH_COLUMN_DEFS.map((column) =>
                columns.isVisible(column.key as ColumnKey) ? (
                  <SortableHeaderCell
                    key={column.key}
                    columnKey={column.key}
                    label={column.label}
                    style={{ ...HEAD_STYLE, textAlign: column.align ?? "left" }}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                  />
                ) : null
              )}
              {columns.isVisible("action") && (
                <PlainHeaderCell style={{ ...HEAD_STYLE, textAlign: "right", ...ACTIONS_COLUMN_STYLE }}>
                  Action
                </PlainHeaderCell>
              )}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <TableStateRow colSpan={visibleColumnCount}>
                <ErrorBanner message={error} className="mx-auto my-6 max-w-lg" />
              </TableStateRow>
            ) : isLoading && filteredRows.length === 0 ? (
              <TableStateRow colSpan={visibleColumnCount}>
                <LoadingState label="Loading your batches..." />
              </TableStateRow>
            ) : pagedBatches.length === 0 ? (
              <TableStateRow colSpan={visibleColumnCount}>
                {hasActiveFilters ? (
                  <EmptyState
                    icon={<Search className="h-5 w-5" aria-hidden="true" />}
                    title="No batches match your filters"
                    description="Clear the search or filter selections to see all your batches."
                    action={
                      <Button size="sm" variant="outline" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={<Layers className="h-5 w-5" aria-hidden="true" />}
                    title="No batches assigned to you yet"
                    description={
                      canCreateBatch
                        ? "Create one, then open it to build its timetable."
                        : "Batches assigned to you will appear here."
                    }
                    action={
                      canCreateBatch && onCreateBatch ? (
                        <Button size="sm" onClick={onCreateBatch}>
                          <UserPlus className="h-4 w-4" aria-hidden="true" />
                          <span>Add New Batch</span>
                        </Button>
                      ) : null
                    }
                  />
                )}
              </TableStateRow>
            ) : (
              pagedBatches.map((batch) => (
                <BatchRow key={batch.id} batch={batch} columns={columns} onOpenBatchDetail={onOpenBatchDetail} />
              ))
            )}
          </tbody>
        </table>
      </FullscreenTable>
    </div>
  );
}
