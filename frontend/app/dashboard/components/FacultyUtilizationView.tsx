"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { TrainingSession } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/dateUtils";
import { PaginationControls } from "@/components/PaginationControls";
import {
  ColumnsMenu,
  CopyButton,
  ExportButton,
  FullscreenTable,
  PlainHeaderCell,
  RefreshButton,
  SortableHeaderCell,
  TableCaption,
  TableFilters,
  TableStateRow,
  TABLE_CONTROL_STYLE,
} from "@/components/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CountBadge,
  EmptyState,
  ErrorBanner,
  LoadingState,
  NAVBAR_HEIGHT,
  PanelTitle,
} from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/statusBadge";
import { useColumnVisibility, type UseColumnVisibilityResult } from "@/hooks/useColumnVisibility";
import { usePersistentState, reviveNumber } from "@/hooks/usePersistentState";
import { useTableFilters } from "@/hooks/useTableFilters";
import { useTableSort } from "@/hooks/useTableSort";
import {
  buildFilterFields,
  buildSearchAccessor,
  buildSortAccessors,
  buildSortOptions,
  isSortable,
  type TableColumnDef,
} from "@/lib/tableColumns";
import { ALL_FILTER_VALUE, isBlankTableValue } from "@/lib/tableUtils";
import type { CsvColumn } from "@/lib/csv";

const FEEDBACK_FILTER_ID = "faculty-utilization-feedback-filter";
const START_DATE_FILTER_ID = "faculty-utilization-start-date";
const END_DATE_FILTER_ID = "faculty-utilization-end-date";

// Bumped to v3 with the compact six-column default. A stored layout deliberately wins
// over `DEFAULT_HIDDEN`, so without a new key anyone who has opened this view
// keeps the wider layout and never sees the fix.
const COLUMN_STORAGE_KEY = "ops.table.faculty-utilization.columns.v3";
const PAGE_SIZE_STORAGE_KEY = "ops.table.faculty-utilization.pageSize";
const DEFAULT_PAGE_SIZE = 15;

const TH_STYLE: React.CSSProperties = { padding: "12px 14px" };

const TD_STYLE: React.CSSProperties = {
  padding: "12px 14px",
  color: "var(--text-main)",
  fontSize: "0.825rem",
  verticalAlign: "top",
};

const MONO_STYLE: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: "0.75rem" };

const ELLIPSIS_STYLE: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 240,
};
const SHORT_ELLIPSIS_STYLE: React.CSSProperties = { ...ELLIPSIS_STYLE, maxWidth: 160 };
const MUTED_STYLE: React.CSSProperties = { color: "var(--text-muted)" };
const BOLD_NOWRAP_STYLE: React.CSSProperties = { fontWeight: 600, whiteSpace: "nowrap" };

interface UtilizationColumnDef extends TableColumnDef<TrainingSession> {
  minWidth?: number;
}

/** Floor for a visible column with no declared width, so it cannot collapse. */
const DEFAULT_COLUMN_MIN_WIDTH = 120;

type UtilizationColumn = TableColumnDef<TrainingSession, ColumnKey> & { minWidth?: number };

/**
 * The one column definition the whole table is derived from: sort accessors,
 * sort options, filter fields, the search haystack, the ColumnsMenu list and
 * the header/body cell order all come from here, so a column cannot be visible
 * without being sortable, or hidden from the filters but on screen.
 *
 * Order is the order a reader scans a delivery ledger: when, who, which batch,
 * what, how long, how it went, and only then the batch attributes. It also
 * decides which column the sticky first-column slot is spent on, so the
 * highest-value anchor (the training date) has to lead. The six primary
 * columns come first and the optional details that `DEFAULT_HIDDEN` switches
 * off follow.
 */
const UTILIZATION_COLUMN_DEFS = [
  { key: "dateOfTraining", label: "Date of Training", accessor: (row: TrainingSession) => row.date_of_training || "", minWidth: 150 },
  {
    key: "facultyName",
    label: "Faculty Full Name",
    accessor: (row: TrainingSession) => row.faculty_name || "",
    filterable: true,
    minWidth: 170,
  },
  {
    key: "batchCode",
    label: "Batch ID",
    accessor: (row: TrainingSession) => row.batch_code || "",
    search: [(row: TrainingSession) => row.batch_id || ""],
    minWidth: 180,
  },
  { key: "topic", label: "Topic", accessor: (row: TrainingSession) => row.topic || "", minWidth: 240 },
  { key: "noOfHours", label: "No. of Hours", accessor: (row: TrainingSession) => row.no_of_hours ?? null, align: "right" },
  { key: "status", label: "Status", accessor: (row: TrainingSession) => row.status || "", filterable: true },
  {
    key: "modeOfDelivery",
    label: "Mode of Delivery",
    accessor: (row: TrainingSession) => row.mode_of_delivery || "",
    filterable: true,
  },
  {
    key: "feedbackRating",
    label: "Feedback Rating",
    accessor: (row: TrainingSession) => row.feedback_rating ?? null,
    align: "right",
  },
  { key: "client", label: "Client", accessor: (row: TrainingSession) => row.client || "", filterable: true, minWidth: 150 },
  { key: "category", label: "Category", accessor: (row: TrainingSession) => row.category || "", filterable: true },
  {
    key: "coordinator",
    label: "Coordinator",
    accessor: (row: TrainingSession) => row.coordinator || "",
    filterable: true,
    minWidth: 150,
  },
  {
    key: "locationCity",
    label: "Location/City",
    accessor: (row: TrainingSession) => row.location_city || "",
    filterable: true,
    minWidth: 140,
  },
  { key: "venue", label: "Venue", accessor: (row: TrainingSession) => row.venue || "", minWidth: 150 },
  {
    key: "moduleFeedback",
    label: "Module Feedback",
    accessor: (row: TrainingSession) => row.module_feedback || "",
    sortable: false,
  },
  {
    key: "facultyTypeName",
    label: "Faculty Type",
    accessor: (row: TrainingSession) => row.faculty_type_name || "",
    filterable: true,
    minWidth: 150,
  },
  {
    key: "vertical",
    label: "Vertical",
    accessor: (row: TrainingSession) => row.vertical || "",
    filterable: true,
    minWidth: 140,
  },
  { key: "startTime", label: "Start Time", accessor: (row: TrainingSession) => row.start_time || "", sortable: false },
  { key: "endTime", label: "End Time", accessor: (row: TrainingSession) => row.end_time || "", sortable: false },
  {
    key: "feedbackSubmitted",
    label: "Feedback Submitted",
    accessor: (row: TrainingSession) => row.feedback_submitted,
    sortable: false,
  },
  { key: "createdAt", label: "Created At", accessor: (row: TrainingSession) => row.created_at || "" },
  { key: "updatedAt", label: "Updated At", accessor: (row: TrainingSession) => row.updated_at || "", sortable: false },
  {
    key: "trainingSessionId",
    label: "Training Session ID",
    accessor: (row: TrainingSession) => row.training_session_id || "",
    sortable: false,
    minWidth: 170,
  },
  {
    key: "outcomeReason",
    label: "Outcome Reason",
    accessor: (row: TrainingSession) => row.outcome_reason || "",
    sortable: false,
    minWidth: 150,
  },
  {
    key: "outcomeAt",
    label: "Outcome At",
    accessor: (row: TrainingSession) => row.outcome_at || "",
    sortable: false,
    minWidth: 150,
  },
  {
    key: "outcomeBy",
    label: "Outcome By",
    accessor: (row: TrainingSession) => row.outcome_by || "",
    sortable: false,
    minWidth: 140,
  },
  {
    key: "programType",
    label: "Program Type",
    accessor: (row: TrainingSession) => row.program_type_id || "",
    sortable: false,
    minWidth: 140,
  },
  {
    key: "batchId",
    label: "Batch ID",
    accessor: (row: TrainingSession) => row.batch_id || "",
    sortable: false,
    minWidth: 150,
  },
] as const satisfies readonly UtilizationColumnDef[];

type ColumnKey = (typeof UTILIZATION_COLUMN_DEFS)[number]["key"];

// The `as const` tuple above is what keeps `ColumnKey` a literal union, and an
// inferred tuple only carries `minWidth`/`align` on the entries that declare
// them. This widened alias is the view the header and row walks read, so both
// can ask for either property unconditionally.
const UTILIZATION_COLUMNS: readonly UtilizationColumn[] = UTILIZATION_COLUMN_DEFS;

const UTILIZATION_COLUMN_KEYS: readonly { key: ColumnKey; label: string }[] = UTILIZATION_COLUMN_DEFS.map(
  (column) => ({ key: column.key, label: column.label })
);

const UTILIZATION_ACCESSORS = buildSortAccessors(UTILIZATION_COLUMN_DEFS);
const UTILIZATION_SORT_OPTIONS = buildSortOptions(UTILIZATION_COLUMN_DEFS);
const UTILIZATION_FILTER_FIELDS = buildFilterFields(UTILIZATION_COLUMN_DEFS);
const UTILIZATION_SEARCH_ACCESSOR = buildSearchAccessor(UTILIZATION_COLUMN_DEFS);
const UTILIZATION_DESC_FIRST_KEYS = ["dateOfTraining", "createdAt"] as const;

/**
 * Raw database ids, audit stamps, the outcome trail and the two columns no
 * seeder ever populates (`vertical`, `faculty_type_name`) are one click away
 * rather than shipped visible: a column that renders an em-dash in every row
 * costs horizontal space and says nothing. The six primary columns ship
 * visible so the ledger stays readable without forcing horizontal scrolling.
 */
const DEFAULT_HIDDEN: readonly ColumnKey[] = [
  "modeOfDelivery",
  "feedbackRating",
  "client",
  "category",
  "coordinator",
  "locationCity",
  "venue",
  "moduleFeedback",
  "facultyTypeName",
  "vertical",
  "startTime",
  "endTime",
  "feedbackSubmitted",
  "createdAt",
  "updatedAt",
  "trainingSessionId",
  "outcomeReason",
  "outcomeAt",
  "outcomeBy",
  "programType",
  "batchId",
];

// Mirrors the on-screen column order so the file reads the same way as the
// table, then the raw ids last so a spreadsheet keeps the join keys without
// pushing the readable fields off the row.
const EXPORT_COLUMNS: readonly CsvColumn<TrainingSession>[] = [
  { key: "date_of_training", label: "Date of Training" },
  { key: "faculty_name", label: "Faculty Full Name" },
  { key: "batch_code", label: "Batch ID" },
  { key: "topic", label: "Topic" },
  { key: "no_of_hours", label: "No. of Hours" },
  { key: "status", label: "Status" },
  { key: "mode_of_delivery", label: "Mode of Delivery" },
  { key: "feedback_rating", label: "Feedback Rating" },
  { key: "client", label: "Client" },
  { key: "category", label: "Category" },
  { key: "coordinator", label: "Coordinator" },
  { key: "location_city", label: "Location/City" },
  { key: "venue", label: "Venue" },
  { key: "module_feedback", label: "Module Feedback" },
  { key: "faculty_type_name", label: "Faculty Type" },
  { key: "vertical", label: "Vertical" },
  { key: "start_time", label: "Start Time" },
  { key: "end_time", label: "End Time" },
  { key: "feedback_submitted", label: "Feedback Submitted" },
  { key: "created_at", label: "Created At" },
  { key: "updated_at", label: "Updated At" },
  { key: "training_session_id", label: "Training Session ID" },
  { key: "outcome_reason", label: "Outcome Reason" },
  { key: "outcome_at", label: "Outcome At" },
  { key: "outcome_by", label: "Outcome By" },
  { key: "program_type_id", label: "Program Type" },
  { key: "batch_id", label: "Batch ID" },
];

interface FacultyUtilizationViewProps {
  data: TrainingSession[];
  isLoading: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

interface FilterConfig {
  key: string;
  label: string;
  allLabel: string;
  width: number;
}

/**
 * Nine option-list filters plus a feedback bucket and a date range is twelve
 * controls: laid end to end they need roughly 2,300px, so on any normal screen
 * they wrapped into three ragged rows. The four that answer "which delivery, and
 * who ran it" stay on the primary row with the search box; the batch attributes
 * and the predicates move into the expanded panel, where they are still one
 * click away and still counted by the toolbar's Clear action.
 */
const PRIMARY_FILTERS: readonly FilterConfig[] = [
  { key: "facultyName", label: "Faculty", allLabel: "All faculty", width: 165 },
  { key: "status", label: "Status", allLabel: "All statuses", width: 140 },
  { key: "modeOfDelivery", label: "Mode", allLabel: "All modes", width: 140 },
  { key: "client", label: "Client", allLabel: "All clients", width: 150 },
];

const SECONDARY_FILTERS: readonly FilterConfig[] = [
  // `vertical` is deliberately absent: neither seeder ever populates it, so a
  // dropdown over it would be a dead control. `facultyTypeName` is the same
  // story today, but it is one populated value away from being useful, and
  // `TableFilters` hides any option-list filter with no options on its own.
  { key: "facultyTypeName", label: "Faculty Type", allLabel: "All faculty types", width: 170 },
  { key: "coordinator", label: "Coordinator", allLabel: "All coordinators", width: 170 },
  { key: "category", label: "Category", allLabel: "All categories", width: 160 },
  { key: "locationCity", label: "City", allLabel: "All cities", width: 160 },
];

interface CellDef {
  style?: React.CSSProperties;
  title?: string;
  content: React.ReactNode;
}

/** Shown wherever the ledger has no value, always in `MUTED_STYLE`. */
const EMPTY_PLACEHOLDER = "—";

/**
 * Placeholder for a cell the ledger has no value for. Muted, because a column
 * that is empty everywhere is background noise: an em-dash at full text weight
 * draws as much attention as real data. `isBlankTableValue` rather than a falsy
 * check so `0` and `false` still render as themselves.
 */
function empty(): CellDef {
  return { style: MUTED_STYLE, content: EMPTY_PLACEHOLDER };
}

function text(value?: string | null): CellDef {
  return isBlankTableValue(value) ? empty() : { content: value as string };
}

/** Emphasis cell for the identifying columns; blank falls back to the muted placeholder. */
function boldText(value?: string | null): CellDef {
  return isBlankTableValue(value)
    ? { ...empty(), style: { ...BOLD_NOWRAP_STYLE, ...MUTED_STYLE } }
    : { style: BOLD_NOWRAP_STYLE, content: value as string };
}

/** Numeric cell. `isBlankTableValue` keeps `0` rendering as `0`, not as blank. */
function numberCell(value: number | null | undefined, align: "left" | "right" = "right"): CellDef {
  return isBlankTableValue(value)
    ? { style: { textAlign: align, ...MUTED_STYLE }, content: EMPTY_PLACEHOLDER }
    : { style: { textAlign: align }, content: value };
}

/**
 * Single-line cell that truncates with an ellipsis and carries the full text in
 * `title`. Free-wrapping these columns made row heights swing from one to four
 * lines, so a column's height stopped being comparable across rows; the tooltip
 * keeps the full value reachable.
 */
function ellipsis(
  value: string | null | undefined,
  style: React.CSSProperties,
  muted = false
): CellDef {
  if (isBlankTableValue(value)) return empty();
  return {
    style: muted ? { ...style, ...MUTED_STYLE } : style,
    title: value as string,
    content: value,
  };
}

function shortId(value?: string | null): string {
  if (isBlankTableValue(value)) return EMPTY_PLACEHOLDER;
  const raw = value as string;
  return raw.length > 8 ? `${raw.slice(0, 8)}…` : raw;
}

/** Raw-uuid column: monospace, truncated, full value in the tooltip. */
function monoId(value?: string | null): CellDef {
  if (isBlankTableValue(value)) return { ...empty(), style: { ...MONO_STYLE, ...MUTED_STYLE } };
  return { style: MONO_STYLE, title: value as string, content: shortId(value) };
}

/** `HH:MM` for a timestamp, or `null` when the ledger has no usable time. */
function formatTime(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const timeMatch = trimmed.match(/T(\d{2}):(\d{2})/);
  if (timeMatch) return `${timeMatch[1]}:${timeMatch[2]}`;
  const plainMatch = trimmed.match(/^(\d{2}):(\d{2})/);
  if (plainMatch) return `${plainMatch[1]}:${plainMatch[2]}`;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return `${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function YesNo({ value }: { value?: boolean | null }) {
  if (!value) return <span style={{ color: "var(--text-dim)" }}>No</span>;
  return <span style={{ color: "var(--color-success)", fontWeight: 700 }}>Yes</span>;
}

/**
 * Body cell per column. A `Record` over the column keys, so a column cannot be
 * declared without a matching cell: the header and the row stay 1:1 by
 * construction, and the compiler catches a missing cell instead of leaving a
 * short row behind.
 */
const CELL_DEFS: Record<ColumnKey, (row: TrainingSession) => CellDef> = {
  vertical: (row) => text(row.vertical),
  client: (row) => ellipsis(row.client, SHORT_ELLIPSIS_STYLE),
  category: (row) => text(row.category),
  batchCode: (row) => {
    // The code is the readable form; the raw id is the tooltip and the fallback
    // when no seeder wrote a code.
    if (!isBlankTableValue(row.batch_id)) {
      const title = row.batch_id as string;
      return {
        style: BOLD_NOWRAP_STYLE,
        title,
        content: isBlankTableValue(row.batch_code) ? shortId(row.batch_id) : (row.batch_code as string),
      };
    }
    return isBlankTableValue(row.batch_code)
      ? { ...empty(), style: { ...BOLD_NOWRAP_STYLE, ...MUTED_STYLE } }
      : { style: BOLD_NOWRAP_STYLE, content: row.batch_code as string };
  },
  dateOfTraining: (row) => boldText(formatDate(row.date_of_training) || null),
  topic: (row) => ellipsis(row.topic, ELLIPSIS_STYLE),
  facultyName: (row) => boldText(row.faculty_name),
  facultyTypeName: (row) => text(row.faculty_type_name),
  noOfHours: (row) => numberCell(row.no_of_hours, "right"),
  moduleFeedback: (row) => ellipsis(row.module_feedback, ELLIPSIS_STYLE, true),
  venue: (row) => ellipsis(row.venue, SHORT_ELLIPSIS_STYLE),
  locationCity: (row) => text(row.location_city),
  modeOfDelivery: (row) =>
    isBlankTableValue(row.mode_of_delivery) ? (
      empty()
    ) : (
      { content: <Badge variant="info" size="sm">{row.mode_of_delivery as string}</Badge> }
    ),
  coordinator: (row) => boldText(row.coordinator),
  status: (row) => ({ content: <StatusBadge status={row.status} /> }),
  startTime: (row) => boldText(formatTime(row.start_time)),
  endTime: (row) => boldText(formatTime(row.end_time)),
  feedbackSubmitted: (row) => ({ content: <YesNo value={row.feedback_submitted} /> }),
  feedbackRating: (row) => numberCell(row.feedback_rating),
  createdAt: (row) => boldText(formatDateTime(row.created_at, "") || null),
  updatedAt: (row) => boldText(formatDateTime(row.updated_at, "") || null),
  trainingSessionId: (row) => text(row.training_session_id),
  outcomeReason: (row) => text(row.outcome_reason),
  outcomeAt: (row) => text(row.outcome_at),
  outcomeBy: (row) => text(row.outcome_by),
  programType: (row) => text(row.program_type_id),
  batchId: (row) => text(row.batch_id),
};

function UtilizationRow({
  row,
  columns,
}: {
  row: TrainingSession;
  columns: UseColumnVisibilityResult<ColumnKey>;
}) {
  return (
    <tr style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.825rem" }}>
      {UTILIZATION_COLUMNS.map((column) => {
        if (!columns.isVisible(column.key)) return null;
        const cell = CELL_DEFS[column.key](row);
        return (
          <td key={column.key} style={{ ...TD_STYLE, ...cell.style }} title={cell.title}>
            {cell.content}
          </td>
        );
      })}
    </tr>
  );
}

export function FacultyUtilizationView({ data, isLoading, error, onRefresh }: FacultyUtilizationViewProps) {
  const rows = useMemo(() => data ?? [], [data]);

  const { sortKey, sortDir, sortedRows, toggleSort, applySort, sortVersion } = useTableSort(
    rows,
    UTILIZATION_ACCESSORS,
    { initialKey: "dateOfTraining", initialDir: "desc", descFirstKeys: UTILIZATION_DESC_FIRST_KEYS }
  );

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
  } = useTableFilters(sortedRows, UTILIZATION_FILTER_FIELDS, UTILIZATION_SEARCH_ACCESSOR);

  // The synthetic feedback bucket and the training-date range are predicates, not
  // option lists, so they cannot be expressed as shared filter fields.
  const [feedbackFilter, setFeedbackFilter] = useState(ALL_FILTER_VALUE);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const columns = useColumnVisibility<ColumnKey>({
    columns: UTILIZATION_COLUMN_KEYS,
    defaultHidden: DEFAULT_HIDDEN,
    storageKey: COLUMN_STORAGE_KEY,
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistentState<number>(
    PAGE_SIZE_STORAGE_KEY,
    DEFAULT_PAGE_SIZE,
    reviveNumber
  );

  useEffect(() => {
    setPage(1);
  }, [filtersVersion, feedbackFilter, startDate, endDate, sortVersion, rows.length]);

  const matchedRows = useMemo(() => {
    if (!feedbackFilter && !startDate && !endDate) return filteredRows;
    return filteredRows.filter((row) => {
      if (feedbackFilter === "SUBMITTED" && !row.feedback_submitted) return false;
      if (feedbackFilter === "PENDING" && row.feedback_submitted) return false;
      const day = row.date_of_training ? row.date_of_training.slice(0, 10) : "";
      if (startDate && (!day || day < startDate)) return false;
      if (endDate && (!day || day > endDate)) return false;
      return true;
    });
  }, [filteredRows, feedbackFilter, startDate, endDate]);

  const bespokeFilterCount = (feedbackFilter ? 1 : 0) + (startDate ? 1 : 0) + (endDate ? 1 : 0);
  const filtersActive = hasActiveFilters || bespokeFilterCount > 0;
  const totalFilterCount = activeFilterCount + bespokeFilterCount;

  const clearAllFilters = () => {
    clearFilters();
    setFeedbackFilter(ALL_FILTER_VALUE);
    setStartDate("");
    setEndDate("");
  };

  const start = (page - 1) * pageSize;
  const paginatedRows = useMemo(() => matchedRows.slice(start, start + pageSize), [matchedRows, start, pageSize]);

  const visibleColumnCount = UTILIZATION_COLUMN_KEYS.filter((column) => columns.isVisible(column.key)).length;

  // The width a column needs is only known when it renders, so a hardcoded
  // minimum either wastes space (too low, columns stretch) or forces a
  // horizontal scrollbar nobody asked for (too high). Deriving it from the
  // visible set means the default 12 fit a wide screen and the table only
  // scrolls once the reader switches the hidden columns back on.
  const tableMinWidth = useMemo(
    () =>
      UTILIZATION_COLUMNS.filter((column) => columns.isVisible(column.key)).reduce(
        (sum, column) => sum + (column.minWidth ?? DEFAULT_COLUMN_MIN_WIDTH),
        0
      ),
    [columns]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: 1 }}>
      <FullscreenTable
        stickyHeader
        stickyTop={NAVBAR_HEIGHT}
        title={
          <PanelTitle
            title="Faculty Utilization"
            description="Every row of the faculty_utilization delivery ledger, as stored."
            meta={
              <CountBadge
                value={`${matchedRows.length} of ${rows.length}`}
                label={matchedRows.length === rows.length ? "records" : "records match"}
              />
            }
          />
        }
        toolbar={
          <TableFilters
            search={{
              value: search,
              onChange: setSearch,
              placeholder: "Search faculty, topic, venue, city, batch...",
              width: 280,
            }}
            selects={[...PRIMARY_FILTERS, ...SECONDARY_FILTERS].map((filter) => ({
              key: filter.key,
              label: filter.label,
              value: getFilter(filter.key),
              onChange: (value) => setFilter(filter.key, value),
              options: optionsFor(filter.key),
              allLabel: filter.allLabel,
              width: filter.width,
            }))}
            sort={{
              options: UTILIZATION_SORT_OPTIONS,
              sortKey,
              sortDir,
              onChange: applySort,
              width: 210,
            }}
            onClear={clearAllFilters}
            hasActiveFilters={filtersActive}
            activeFilterCount={totalFilterCount}
            bespoke={[
              {
                key: "feedback",
                label: "Feedback",
                htmlFor: FEEDBACK_FILTER_ID,
                width: 165,
                chipValue: feedbackFilter === "SUBMITTED" ? "Submitted" : feedbackFilter === "PENDING" ? "Pending" : null,
                onClear: () => setFeedbackFilter(ALL_FILTER_VALUE),
                content: (
                  <select
                    id={FEEDBACK_FILTER_ID}
                    value={feedbackFilter}
                    onChange={(event) => setFeedbackFilter(event.target.value)}
                    className="glass-input"
                    style={TABLE_CONTROL_STYLE}
                  >
                    <option value={ALL_FILTER_VALUE}>All feedback</option>
                    <option value="SUBMITTED">Feedback submitted</option>
                    <option value="PENDING">Feedback pending</option>
                  </select>
                ),
              },
              {
                key: "startDate",
                label: "Date From",
                htmlFor: START_DATE_FILTER_ID,
                width: 160,
                chipValue: startDate || null,
                onClear: () => setStartDate(""),
                content: (
                  <input
                    id={START_DATE_FILTER_ID}
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="glass-input"
                    title="Training date from"
                    style={TABLE_CONTROL_STYLE}
                  />
                ),
              },
              {
                key: "endDate",
                label: "Date To",
                htmlFor: END_DATE_FILTER_ID,
                width: 160,
                chipValue: endDate || null,
                onClear: () => setEndDate(""),
                content: (
                  <input
                    id={END_DATE_FILTER_ID}
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="glass-input"
                    title="Training date to"
                    style={TABLE_CONTROL_STYLE}
                  />
                ),
              },
            ]}
          />
        }
        actions={
          <>
            <ColumnsMenu
              columns={UTILIZATION_COLUMN_KEYS}
              hidden={columns.hidden}
              onToggle={columns.toggle}
              onShowAll={columns.showAll}
            />
            <ExportButton filename="faculty-utilization" columns={EXPORT_COLUMNS} rows={matchedRows} />
            <CopyButton columns={EXPORT_COLUMNS} rows={matchedRows} />
            {onRefresh && <RefreshButton onClick={onRefresh} isLoading={isLoading} label="Refresh" />}
          </>
        }
        footer={
          <PaginationControls
            label="Faculty utilization pages"
            currentPage={page}
            totalItems={matchedRows.length}
            pageSize={pageSize}
            pageSizeOptions={[15, 25, 50, 100]}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
          />
        }
      >
        <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: tableMinWidth }}>
          <TableCaption>Faculty utilization delivery ledger records</TableCaption>
          <thead>
            <tr>
              {UTILIZATION_COLUMNS.map((column) => {
                if (!columns.isVisible(column.key)) return null;
                const style: React.CSSProperties = { ...TH_STYLE, textAlign: column.align ?? "left" };
                return isSortable(column) ? (
                  <SortableHeaderCell
                    key={column.key}
                    columnKey={column.key}
                    label={column.label}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    minWidth={column.minWidth}
                    style={style}
                  />
                ) : (
                  <PlainHeaderCell key={column.key} minWidth={column.minWidth} style={style}>
                    {column.label}
                  </PlainHeaderCell>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {error ? (
              <TableStateRow colSpan={visibleColumnCount}>
                <ErrorBanner message={error} className="mx-auto my-6 max-w-lg" />
              </TableStateRow>
            ) : isLoading && rows.length === 0 ? (
              <TableStateRow colSpan={visibleColumnCount}>
                <LoadingState label="Loading utilization records..." />
              </TableStateRow>
            ) : rows.length === 0 ? (
              <TableStateRow colSpan={visibleColumnCount}>
                <EmptyState
                  icon={<Users className="h-5 w-5" aria-hidden="true" />}
                  title="No utilization records in the ledger yet"
                  description="Faculty sessions appear here as soon as they are recorded."
                />
              </TableStateRow>
            ) : paginatedRows.length === 0 ? (
              <TableStateRow colSpan={visibleColumnCount}>
                <EmptyState
                  icon={<Search className="h-5 w-5" aria-hidden="true" />}
                  title="No records match the current filters"
                  description="Adjust or clear the filters above to see the rest of the ledger."
                  action={
                    <Button size="sm" variant="outline" onClick={clearAllFilters}>
                      Clear filters
                    </Button>
                  }
                />
              </TableStateRow>
            ) : (
              paginatedRows.map((row) => <UtilizationRow key={row.id} row={row} columns={columns} />)
            )}
          </tbody>
        </table>
      </FullscreenTable>
    </div>
  );
}