"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog";
import { PaginationControls } from "@/components/PaginationControls";
import {
  Batch, TrainingSession, ExtractedScheduleRow, CreateSessionPayload,
  api, BatchOption, ScheduledSession, FacultyType, Vertical, ProgramType, User
} from "@/lib/api";
import { formatDate as formatDateDMY } from "@/lib/dateUtils";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useConfirm, usePrompt } from "@/components/ConfirmProvider";
import {
  ColumnsMenu, ExportButton, FullscreenTable, PlainHeaderCell, SortableHeaderCell,
  TableCaption, TableFilters, TableMenu, TableStateRow, type MenuItem
} from "@/components/table";
import {
  ACTIONS_COLUMN_STYLE, CountBadge, EmptyState, ErrorBanner, LoadingState,
  PanelTitle, ROW_ACTION_BUTTON, RowActions
} from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/statusBadge";
import { useTableSort } from "@/hooks/useTableSort";
import { useTableFilters } from "@/hooks/useTableFilters";
import { useColumnVisibility } from "@/hooks/useColumnVisibility";
import { usePersistentState, reviveNumber } from "@/hooks/usePersistentState";
import {
  buildFilterFields, buildSearchAccessor, buildSortAccessors, buildSortOptions,
  type TableColumnDef
} from "@/lib/tableColumns";
import type { CsvColumn } from "@/lib/csv";
import {
  X, Calendar, Users, Clock, CheckCircle2,
  Lock, Building2, Plus, Upload, AlertCircle, AlertTriangle,
  PlayCircle, RefreshCw, FileSpreadsheet, ShieldAlert, Sparkles, Check,
  Edit3, GraduationCap, Mail, Search, Trash2,
  PauseCircle, Ban
} from "lucide-react";

const UTIL_LABEL: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--text-muted)",
  marginBottom: 4,
};

const UTIL_HINT: React.CSSProperties = {
  fontSize: "0.72rem",
  color: "var(--text-dim)",
  marginTop: 4,
  display: "block",
};

const TIMETABLE_TH_STYLE: React.CSSProperties = {
  padding: "8px 12px",
};

const TIMETABLE_TD_STYLE: React.CSSProperties = { padding: "8px 12px" };

/** Keeps the original index so inline row editing never follows a re-sorted row. */
interface ExtractedTimetableRowView {
  row: ExtractedScheduleRow;
  index: number;
}

const TIMETABLE_COLUMN_DEFS: readonly TableColumnDef<ExtractedTimetableRowView>[] = [
  { key: "date", label: "Date", accessor: (view) => view.row.date_of_training || "" },
  { key: "topic", label: "Topic", accessor: (view) => view.row.topic || "" },
  { key: "faculty", label: "Faculty", accessor: (view) => view.row.faculty_name || "", filterable: true },
  {
    key: "hours",
    label: "Hours",
    accessor: (view) => (typeof view.row.no_of_hours === "number" ? view.row.no_of_hours : null),
    align: "center",
  },
  { key: "action", label: "Action", accessor: (view) => String(view.index), sortable: false },
];

const TIMETABLE_ACCESSORS = buildSortAccessors(TIMETABLE_COLUMN_DEFS);
const TIMETABLE_SORT_OPTIONS = buildSortOptions(TIMETABLE_COLUMN_DEFS);
const TIMETABLE_FILTER_FIELDS = buildFilterFields(TIMETABLE_COLUMN_DEFS);
const TIMETABLE_SEARCH_ACCESSOR = buildSearchAccessor(TIMETABLE_COLUMN_DEFS);

const TIMETABLE_COLUMN_KEYS = TIMETABLE_COLUMN_DEFS.map((column) => ({ key: column.key, label: column.label }));
type TimetableColumnKey = (typeof TIMETABLE_COLUMN_KEYS)[number]["key"];

const TIMETABLE_EXPORT_COLUMNS: readonly CsvColumn<ExtractedTimetableRowView>[] = [
  { key: "row", label: "Date of Training", value: (view) => view.row.date_of_training || "" },
  { key: "topic", label: "Topic", value: (view) => view.row.topic || "" },
  { key: "faculty", label: "Faculty", value: (view) => view.row.faculty_name || "" },
  {
    key: "hours",
    label: "No. of Hours",
    value: (view) => (typeof view.row.no_of_hours === "number" ? view.row.no_of_hours : null),
  },
];

const TIMETABLE_DESC_FIRST_KEYS = ["date"];

interface ParsedRemarkItem {
  id: number;
  isAudit: boolean;
  timestamp: string | null;
  action: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  actor?: string | null;
  message: string;
  raw: string;
}

const parseRemarksList = (rawRemarks?: string | null): ParsedRemarkItem[] => {
  if (!rawRemarks || !rawRemarks.trim()) return [];

  // 1. Normalize legacy UTC timestamps to IST
  const normalized = rawRemarks.replace(
    /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})\s+UTC/g,
    (_match, d, m, y, h, min) => {
      const dt = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d), parseInt(h), parseInt(min)));
      const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
      const istDate = new Date(dt.getTime() + istOffsetMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${pad(istDate.getUTCDate())}-${pad(istDate.getUTCMonth() + 1)}-${istDate.getUTCFullYear()} ${pad(istDate.getUTCHours())}:${pad(istDate.getUTCMinutes())} IST`;
    }
  );

  // 2. Split into entries either by newlines or by lookahead before '[' timestamp pattern
  const chunks = normalized
    .split(/\r?\n+|(?<=\S)\s*(?=\[\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(?:IST|UTC))/)
    .map((s) => s.trim())
    .filter(Boolean);

  return chunks.map((item, idx) => {
    // Audit format: [DD-MM-YYYY HH:MM IST/UTC - ACTION]: MESSAGE
    const auditRegex = /^\[(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}\s+(?:IST|UTC))\s*-\s*([^\]]+)\]:\s*([\s\S]*)$/;
    const match = item.match(auditRegex);

    if (match) {
      const timestamp = match[1].replace("UTC", "IST");
      const actionText = match[2].trim();
      const message = match[3].trim();

      const statusRegex = /^Status changed from '([^']+)' to '([^']+)' by (.+)$/i;
      const statusMatch = actionText.match(statusRegex);

      if (statusMatch) {
        return {
          id: idx + 1,
          isAudit: true,
          timestamp,
          action: actionText,
          fromStatus: statusMatch[1],
          toStatus: statusMatch[2],
          actor: statusMatch[3],
          message,
          raw: item,
        };
      }

      return {
        id: idx + 1,
        isAudit: true,
        timestamp,
        action: actionText,
        message,
        raw: item,
      };
    }

    return {
      id: idx + 1,
      isAudit: false,
      timestamp: null,
      action: null,
      message: item,
      raw: item,
    };
  });
};

interface ConflictDetail {
  row_index: number;
  field: string;
  message: string;
  suggested_fix?: string;
}

export type BatchDetailTab = "overview" | "sessions" | "quality_gates";

const DRAWER_TABS: { id: BatchDetailTab; label: string; icon?: React.ReactNode }[] = [
  { id: "overview", label: "Overview & Details" },
  { id: "sessions", label: "Sessions & Timetable" },
  { id: "quality_gates", label: "Quality Checkpoints", icon: <Sparkles size={15} aria-hidden="true" /> },
];

interface BatchDetailDrawerProps {
  batch: Batch | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenApprove?: (batch: Batch) => void;
  canApprove?: boolean;
  onBatchUpdated?: () => void;
  initialTab?: BatchDetailTab;
}

export const BatchDetailDrawer: React.FC<BatchDetailDrawerProps> = ({
  batch,
  isOpen,
  onClose,
  onOpenApprove,
  canApprove = false,
  onBatchUpdated,
  initialTab = "overview",
}) => {
  // Guard before any hooks: when the drawer is closed or has no batch, render
  // nothing without running hooks so the closed -> open transition never
  // triggers React's "Rendered more hooks than during the previous render"
  // error. The closed/unmounted UX is preserved — callers keep the drawer
  // permanently mounted and only flip `batch`/`isOpen`.
  if (!isOpen || !batch) return null;

  const [currentBatch, setCurrentBatch] = useState<Batch | null>(batch);
  // Every read and every write in this drawer goes through this one value, so an
  // in-drawer mutation (which only calls `setCurrentBatch`) is reflected
  // everywhere instead of half the tabs reading a stale `batch` prop.
  const activeBatch: Batch = currentBatch || batch!;
  const [options, setOptions] = useState<{
    entities: BatchOption[];
    categories: BatchOption[];
    accommodations: BatchOption[];
    delivery_modes: BatchOption[];
    faculty_types: FacultyType[];
    program_types: ProgramType[];
    verticals: Vertical[];
    coordinators: User[];
  }>({ entities: [], categories: [], accommodations: [], delivery_modes: [], faculty_types: [], program_types: [], verticals: [], coordinators: [] });

  const requestText = usePrompt();
  const confirmAction = useConfirm();

  const [activeTab, setActiveTab] = useState<BatchDetailTab>(initialTab);

  const batchId = batch?.id ?? null;

  useEffect(() => {
    setCurrentBatch(batch);
    // Reopening the drawer for a different batch must not carry the previous
    // batch's tab forward, so the requested landing tab is re-applied here.
    // Keyed on the id, not the object: every parent re-render that produces a new
    // `batch` reference would otherwise reset the tab the user picked and
    // re-fetch — including the `onBatchUpdated()` calls made by this drawer's own
    // mutations.
    setActiveTab(initialTab);
    if (batchId) {
      api.getBatch(batchId)
        .then((fresh) => {
          if (fresh) setCurrentBatch(fresh);
        })
        .catch((err) => console.error("Failed to load fresh batch details:", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId, initialTab]);

  useEffect(() => {
    if (isOpen) {
      Promise.all([
        api.getBatchOptions("entities").catch(() => []),
        api.getBatchOptions("categories").catch(() => []),
        api.getBatchOptions("accommodations").catch(() => []),
        api.getBatchOptions("delivery-modes").catch(() => []),
        api.getFacultyTypes().catch(() => []),
        api.getProgramTypes().catch(() => []),
        api.getVerticals().catch(() => []),
        api.getCoordinators().catch(() => []),
      ]).then(([entities, categories, accommodations, delivery_modes, faculty_types, program_types, verticals, coordinators]) => {
        setOptions({ entities, categories, accommodations, delivery_modes, faculty_types, program_types, verticals, coordinators });
      });
    }
  }, [isOpen]);

  // Edit Batch state
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Batch>>({});
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isDeletingBlockers, setIsDeletingBlockers] = useState(false);
  const [blockerDeleteError, setBlockerDeleteError] = useState<string | null>(null);

  const openEditModal = () => {
    const target = activeBatch;
    if (!target) return;
    const deliveryModeVal = target.delivery_mode || (target.delivery_mode_id ? options.delivery_modes.find((m) => m.id === target.delivery_mode_id)?.name : null) || "Online";
    setEditForm({
      program_name: target.program_name,
      client_name: target.client_name,
      sow_number: target.sow_number,
      domain: target.domain,
      technology: target.technology,
      delivery_mode: deliveryModeVal,
      delivery_mode_id: target.delivery_mode_id,
      location_city: target.location_city,
      start_date: target.start_date ? target.start_date.split("T")[0] : "",
      end_date: target.end_date ? target.end_date.split("T")[0] : "",
      training_days: target.training_days,
      total_hours: target.total_hours,
      total_enrollments: target.total_enrollments,
      faculty_assigned_text: target.faculty_assigned_text,
      remarks: target.remarks,
    });
    setEditError(null);
    setBlockerDeleteError(null);
    if (scheduledSessions.length === 0 && !isLoadingSessions) loadSessions();
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = activeBatch;
    if (!target) return;
    if (editEndDateBlockers.length > 0) {
      setEditError(
        `${editEndDateBlockers.length} scheduled session(s) still fall after the new conclusion date. Delete them below before saving.`
      );
      return;
    }
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const payload: Partial<Batch> = {
        program_name: editForm.program_name,
        client_name: editForm.client_name,
        sow_number: editForm.sow_number ? String(editForm.sow_number).trim() : undefined,
        domain: editForm.domain,
        technology: editForm.technology,
        delivery_mode_id: editForm.delivery_mode_id,
        location_city: editForm.location_city,
        start_date: editForm.start_date ? new Date(editForm.start_date).toISOString() : undefined,
        end_date: editForm.end_date ? new Date(editForm.end_date).toISOString() : undefined,
        training_days: Number(editForm.training_days) || 0,
        total_hours: Number(editForm.total_hours) || 0,
        total_enrollments: Number(editForm.total_enrollments) || 0,
        faculty_assigned_text: editForm.faculty_assigned_text,
        remarks: editForm.remarks,
      };
      const updated = await api.updateBatch(target.id, payload);
      setCurrentBatch(updated);
      setIsEditModalOpen(false);
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setEditError(err.message || "Failed to update batch details");
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Lifecycle Status Modal State (OnHold / Cancelled / Resume)
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string>("");
  const [statusReason, setStatusReason] = useState("");
  const [isSubmittingStatus, setIsSubmittingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const getResumedStatus = (target: Batch): string => {
    if (target.approver_1_status === "Pending") {
      return "Approval 1 Pending";
    }
    if (target.approver_1_status === "Approved" && target.approver_2_status === "Pending") {
      return "Approval 2 Pending";
    }
    if (target.approver_1_status === "Rejected" || target.approver_2_status === "Rejected") {
      return "Rejected";
    }
    if (target.approver_1_status === "Approved" && target.approver_2_status === "Approved") {
      return "Approved";
    }
    return "Approval 1 Pending";
  };

  const openStatusModal = (newStatus: "OnHold" | "Cancelled" | "Resume" | string) => {
    const target = activeBatch;
    let effectiveStatus = newStatus;
    if (newStatus === "Resume" && target) {
      effectiveStatus = getResumedStatus(target);
    }
    setTargetStatus(effectiveStatus);
    setStatusReason("");
    setStatusError(null);
    setIsStatusModalOpen(true);
  };

  const handleSaveStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = activeBatch;
    if (!target || !targetStatus) return;
    if (!statusReason.trim() || statusReason.trim().length < 3) {
      setStatusError("A reason (minimum 3 characters) is required.");
      return;
    }
    setIsSubmittingStatus(true);
    setStatusError(null);
    try {
      const updated = await api.updateBatchLifecycleStatus(target.id, targetStatus, statusReason.trim());
      setCurrentBatch(updated);
      setIsStatusModalOpen(false);
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setStatusError(err.message || "Failed to update batch status");
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Sessions & Curriculum Schedule state
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const scheduledSessionCount = scheduledSessions.length;

  // Helper to compute sequence number (1-based index from sorted scheduledSessions)
  const getSequenceNumber = (session: ScheduledSession): number => {
    const index = scheduledSessions.findIndex((s) => s.id === session.id);
    return index >= 0 ? index + 1 : 0;
  };

  // Helper to compute week from batch.start_date
  const computeWeek = (batchStartDate: string | undefined, sessionDate: string | undefined): string => {
    if (!batchStartDate || !sessionDate) return "—";
    const start = new Date(batchStartDate);
    const session = new Date(sessionDate);
    const diffDays = Math.floor((session.getTime() - start.getTime()) / (7 * 86400000));
    return `Week ${diffDays + 1}`;
  };

  // End-date reduction blockers. ISO `YYYY-MM-DD` strings compare
  // lexicographically, so the reduction is a plain string compare against the
  // stored batch window; only a strictly-earlier date counts as a reduction.
  const editEndDate = typeof editForm.end_date === "string" ? editForm.end_date : "";
  const isReducingEndDate = Boolean(
    editEndDate && activeBatch.end_date && editEndDate < activeBatch.end_date.split("T")[0]
  );
  const editEndDateBlockers = useMemo(
    () =>
      isReducingEndDate
        ? scheduledSessions.filter((session) => session.session_date > editEndDate)
        : [],
    [isReducingEndDate, scheduledSessions, editEndDate]
  );
  const deletableBlockers = useMemo(
    () =>
      editEndDateBlockers.filter(
        (session) => session.status !== "Completed" && !session.utilization_logged
      ),
    [editEndDateBlockers]
  );
  const remainingInWindowSessions = useMemo(
    () =>
      isReducingEndDate
        ? scheduledSessions.filter((session) => session.session_date <= editEndDate)
        : [],
    [isReducingEndDate, scheduledSessions, editEndDate]
  );
  const suggestedWindowHours = useMemo(
    () =>
      Math.round(
        remainingInWindowSessions.reduce((sum, session) => sum + (session.duration_hours || 0), 0) * 100
      ) / 100,
    [remainingInWindowSessions]
  );

  // Computed session stats
  // Checkpoint 1 progress is derived from the two datasets the drawer already
  // loads: `scheduledSessions` is the planned curriculum, `sessions` the actual
  // delivery ledger. The batch average itself is never recomputed here — the
  // backend writes it once and is the authority.
  const TERMINAL_DELIVERY_STATUSES = ["Completed", "Cancelled", "Not Conducted"];
  const checkpoint1Progress = useMemo(() => {
    const plannedDays = scheduledSessions;
    const planned = plannedDays.length;
    const closed = plannedDays.filter((s) => TERMINAL_DELIVERY_STATUSES.includes(s.status)).length;
    return { planned, closed };
  }, [scheduledSessions]);
  const allSessionsTerminal = useMemo(() => {
    return [...scheduledSessions.map((session) => session.status), ...sessions.map((session) => session.status)]
      .every((status) => TERMINAL_DELIVERY_STATUSES.includes(status));
  }, [scheduledSessions, sessions]);

  // Log Faculty Utilization on Session Day Modal
  const [isLogUtilizationOpen, setIsLogUtilizationOpen] = useState(false);
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<ScheduledSession | null>(null);
  const [utilFacultyName, setUtilFacultyName] = useState("");
  const [utilDate, setUtilDate] = useState("");
  const [utilStartTime, setUtilStartTime] = useState("09:30");
  const [utilEndTime, setUtilEndTime] = useState("17:30");
  const [utilTopic, setUtilTopic] = useState("");
  const [utilHours, setUtilHours] = useState(8);
  const [utilDeliveryMode, setUtilDeliveryMode] = useState("Online");
  const [utilVenue, setUtilVenue] = useState("");
  const [utilCity, setUtilCity] = useState("");
  const [utilStatus, setUtilStatus] = useState("Scheduled");
  const [utilFeedbackCollected, setUtilFeedbackCollected] = useState<"yes" | "no" | null>(null);
  const [utilFeedbackRating, setUtilFeedbackRating] = useState("");
  const [utilFeedbackNotes, setUtilFeedbackNotes] = useState("");
  const [utilVertical, setUtilVertical] = useState("");
  const [utilFacultyTypeId, setUtilFacultyTypeId] = useState("");
  // Program type is an FK (`program_type_id`), so the select binds the option id
  // — unlike Vertical, which stores the name because `Batch.vertical` is a String.
  const [utilProgramTypeId, setUtilProgramTypeId] = useState("");
  const [utilCoordinatorId, setUtilCoordinatorId] = useState("");
  const [isSubmittingUtil, setIsSubmittingUtil] = useState(false);
  const [utilError, setUtilError] = useState<string | null>(null);
  const [utilConflicts, setUtilConflicts] = useState<string[]>([]);
  const [showDiscardPrompt, setShowDiscardPrompt] = useState(false);
  const utilTopicRef = useRef<HTMLInputElement | null>(null);
  const [isUtilDirty, setIsUtilDirty] = useState(false);

  // Trainer names to suggest: everyone on the faculty roster first, then names
  // already present in the ledger. The ledger stores a free-text name, so a typo
  // silently forks a trainer into two identities and splits their utilization.
  const [rosteredFacultyNames, setRosteredFacultyNames] = useState<string[]>([]);
  const [ledgerFacultyNames, setLedgerFacultyNames] = useState<string[]>([]);

  useEffect(() => {
    if (!isLogUtilizationOpen) return;
    api.getFacultyList()
      .then((list) => setRosteredFacultyNames(list.map((f) => f.full_name).filter(Boolean)))
      .catch(() => setRosteredFacultyNames([]));
    api.getSessions()
      .then((rows) => setLedgerFacultyNames([...new Set(rows.map((r) => r.faculty_name).filter(Boolean))] as string[]))
      .catch(() => setLedgerFacultyNames([]));
  }, [isLogUtilizationOpen]);

  const facultyNameSuggestions = useMemo(() => {
    const merged = [...rosteredFacultyNames, ...ledgerFacultyNames];
    return [...new Set(merged)].sort((a, b) => a.localeCompare(b));
  }, [rosteredFacultyNames, ledgerFacultyNames]);

  const markUtilDirty = () => setIsUtilDirty(true);

  const closeUtilModal = (force = false) => {
    if (!force && isUtilDirty) {
      setShowDiscardPrompt(true);
      return;
    }
    setIsLogUtilizationOpen(false);
    setIsUtilDirty(false);
    setShowDiscardPrompt(false);
    setUtilError(null);
    setUtilConflicts([]);
  };

  const openLogUtilizationModal = (day: ScheduledSession) => {
    const target = activeBatch;
    setSelectedScheduleDay(day);
    setUtilFacultyName(day.trainer_name || target?.faculty_assigned_text || "");
    setUtilDate(String(day.session_date).slice(0, 10));
    setUtilStartTime(day.start_time ? String(day.start_time).slice(0, 5) : "09:30");
    setUtilEndTime(day.end_time ? String(day.end_time).slice(0, 5) : "17:30");
    setUtilTopic(day.module || "");
    setUtilHours(Number(day.duration_hours) || 8);
    const defMode = target?.delivery_mode || (target?.delivery_mode_id ? options.delivery_modes.find(m => m.id === target.delivery_mode_id)?.name : null) || "Online";
    setUtilDeliveryMode(defMode);
    // Venue is free text and is not derivable from the batch. Inventing
    // "<city> Center" or "Virtual MS Teams" wrote plausible-looking fiction
    // into the ledger, so it starts empty and the coordinator fills it in.
    setUtilVenue("");
    setUtilCity(target?.location_city || "");
    setUtilStatus("Scheduled");
    setUtilFeedbackCollected(null);
    setUtilFeedbackRating("");
    setUtilFeedbackNotes("");
    setUtilVertical("");
    setUtilFacultyTypeId("");
    setUtilProgramTypeId("");
    // Default coordinator to batch's coordinator if available
    setUtilCoordinatorId(target?.coordinator?.id || "");
    setUtilError(null);
    setUtilConflicts([]);
    setShowDiscardPrompt(false);
    setIsUtilDirty(false);
    setIsLogUtilizationOpen(true);
  };

  // Radix owns Escape and the scroll lock now; only the initial focus is ours.
  useEffect(() => {
    if (!isLogUtilizationOpen) return;
    utilTopicRef.current?.focus();
  }, [isLogUtilizationOpen]);

  // The time window must be a real interval. The conflict engine only tests for
  // overlap, so an inverted window was persisted and then matched against every
  // other booking on the day.
  const utilTimeError = useMemo(() => {
    if (!utilStartTime || !utilEndTime) return null;
    if (utilEndTime <= utilStartTime) {
      return "End time must be later than start time.";
    }
    const start = new Date(`2000-01-01T${utilStartTime}:00`);
    const end = new Date(`2000-01-01T${utilEndTime}:00`);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    if (Math.abs(hours - utilHours) > 0.01) {
      return `Hours (${utilHours}) does not match the ${utilStartTime}–${utilEndTime} window (${hours}h).`;
    }
    return null;
  }, [utilStartTime, utilEndTime, utilHours]);

  const handleLogUtilizationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = activeBatch;
    if (!selectedScheduleDay || !target) return;
    if (utilFeedbackCollected === null) {
      setUtilError("Please select whether feedback was collected");
      return;
    }
    if (!utilFacultyName.trim()) {
      setUtilError("Faculty / trainer name is required");
      return;
    }
    if (!utilTopic.trim()) {
      setUtilError("Training topic is required");
      return;
    }
    if (utilTimeError) {
      setUtilError(utilTimeError);
      return;
    }
    if (!options.verticals.length) {
      setUtilError("No delivery verticals are configured. Ask an admin to add one in Settings, then reload.");
      return;
    }
    if (!options.program_types.length) {
      setUtilError("No program types are configured. Ask an admin to add one in Settings, then reload.");
      return;
    }
    if (!utilProgramTypeId) {
      setUtilError("Program Type is required");
      return;
    }
    if (!utilFacultyTypeId) {
      setUtilError("Faculty Type is required");
      return;
    }
    if (!utilVertical) {
      setUtilError("Vertical is required");
      return;
    }
    setIsSubmittingUtil(true);
    setUtilError(null);
    setUtilConflicts([]);
    try {
      // date_of_training is a timestamptz but is only ever used as a calendar day
      // (daily-hours bucketing, filters, display) — the clock time lives in
      // start_time/end_time. Building it from the browser's local timezone made
      // the stored day shift by the user's UTC offset, so anchor it at UTC
      // midnight and keep the day they actually taught.
      const dateOfTrainingIso = utilDate
        ? `${utilDate}T00:00:00.000Z`
        : new Date().toISOString();
      const ratingValue = utilFeedbackRating.trim() === "" ? null : Number(utilFeedbackRating);
      if (ratingValue !== null && (Number.isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5)) {
        setUtilError("Feedback rating must be between 1 and 5");
        return;
      }
      const feedbackEntered = utilFeedbackCollected === "yes" && ratingValue !== null;
      const payload: CreateSessionPayload = {
        batch_id: target.id,
        training_session_id: selectedScheduleDay.id,
        date_of_training: dateOfTrainingIso,
        start_time: utilStartTime,
        end_time: utilEndTime,
        topic: utilTopic.trim(),
        faculty_name: utilFacultyName.trim(),
        no_of_hours: Number(utilHours) || 8,
        venue: utilVenue.trim() || undefined,
        location_city: utilCity.trim() || target.location_city || undefined,
        mode_of_delivery: utilDeliveryMode,
        status: utilStatus,
        feedback_submitted: feedbackEntered,
        feedback_rating: feedbackEntered ? ratingValue : undefined,
        feedback_notes: utilFeedbackCollected === "yes" && utilFeedbackNotes.trim() ? utilFeedbackNotes.trim() : undefined,
        vertical: utilVertical,
        faculty_type_id: utilFacultyTypeId,
        program_type_id: utilProgramTypeId || undefined,
        coordinator_id: utilCoordinatorId || undefined,
      };
      await api.createSession(payload);
      setIsLogUtilizationOpen(false);
      setIsUtilDirty(false);
      setUtilError(null);
      setUtilConflicts([]);
      await loadSessions();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setUtilError(err.message || "Failed to log faculty utilization");
      // The conflict engine returns a list of structured conflicts; rendering the
      // raw JSON blob in a one-line error box told the coordinator nothing.
      const details = Array.isArray(err?.details) ? err.details : null;
      if (details) {
        setUtilConflicts(
          details.map((d: any) => d?.message || d?.reason || "Scheduling conflict").filter(Boolean)
        );
      }
    } finally {
      setIsSubmittingUtil(false);
    }
  };

  // Add Session Modal
  const [isAddSessionOpen, setIsAddSessionOpen] = useState(false);
  const [sessionTopic, setSessionTopic] = useState("");
  const [sessionDate, setSessionDate] = useState("");
  const [sessionStartTime, setSessionStartTime] = useState("09:00");
  const [sessionEndTime, setSessionEndTime] = useState("17:00");
  const [sessionHours, setSessionHours] = useState(8);
  const [sessionFacultyName, setSessionFacultyName] = useState("");
  const [isSubmittingSession, setIsSubmittingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Curriculum row correction state
  const [editingScheduledSession, setEditingScheduledSession] = useState<ScheduledSession | null>(null);
  const [scheduledEditForm, setScheduledEditForm] = useState({
    module: "", session_date: "", start_time: "09:00", end_time: "17:00", duration_hours: 8, trainer_name: ""
  });
  const [isSavingScheduledEdit, setIsSavingScheduledEdit] = useState(false);
  const [scheduledEditError, setScheduledEditError] = useState<string | null>(null);
  const [deletingScheduledSessionId, setDeletingScheduledSessionId] = useState<string | null>(null);

  // Gate 1 Feedback Modal
  const [completingSession, setCompletingSession] = useState<TrainingSession | null>(null);
  const [gate1Rating, setGate1Rating] = useState<number>(4.5);
  const [gate1Feedback, setGate1Feedback] = useState("");
  const [gate1StudentsPresent, setGate1StudentsPresent] = useState<number>(30);
  const [isSubmittingGate1, setIsSubmittingGate1] = useState(false);
  const [gate1Error, setGate1Error] = useState<string | null>(null);

  // Gate 2 Closure Modal
  const [isGate2ModalOpen, setIsGate2ModalOpen] = useState(false);
  const [gate2Promoters, setGate2Promoters] = useState<number>(0);
  const [gate2Passives, setGate2Passives] = useState<number>(0);
  const [gate2Detractors, setGate2Detractors] = useState<number>(0);
  const [gate2NpsAvailable, setGate2NpsAvailable] = useState<boolean>(true);
  const [gate2NpsReason, setGate2NpsReason] = useState<string>("");
  const [isSubmittingGate2, setIsSubmittingGate2] = useState(false);
  const [gate2Error, setGate2Error] = useState<string | null>(null);

  // The index is only ever computed, never entered. These are for the live
  // preview in the modal; the server recomputes and stores the authoritative
  // value on submit.
  const gate2ResponseTotal = gate2Promoters + gate2Passives + gate2Detractors;
  const gate2PromoterPct = gate2ResponseTotal ? (gate2Promoters / gate2ResponseTotal) * 100 : 0;
  const gate2PassivePct = gate2ResponseTotal ? (gate2Passives / gate2ResponseTotal) * 100 : 0;
  const gate2DetractorPct = gate2ResponseTotal ? (gate2Detractors / gate2ResponseTotal) * 100 : 0;
  const gate2NpsPreview = gate2PromoterPct - gate2DetractorPct;

  // Gate 2 NPS not available preview
  const gate2NpsNotAvailablePreview = gate2NpsReason.trim().length >= 3 ? gate2NpsReason : "";

  // Timetable Ingestion Modal
  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [ingestFile, setIngestFile] = useState<File | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [extractedRows, setExtractedRows] = useState<ExtractedScheduleRow[]>([]);
  const [hasParsedTimetable, setHasParsedTimetable] = useState(false);
  const [validationConflicts, setValidationConflicts] = useState<ConflictDetail[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [hasValidated, setHasValidated] = useState(false);
  const [isApplyingSchedule, setIsApplyingSchedule] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestSummary, setIngestSummary] = useState<{ message: string; extractedRows: number; failedRows: number; errors: string[] } | null>(null);
  const [editingParsedRow, setEditingParsedRow] = useState<number | null>(null);

  // Each view keeps its original index, so sorting/filtering the preview can
  // never make an in-flight edit write into a different row.
  const timetableRows = useMemo<ExtractedTimetableRowView[]>(
    () => extractedRows.map((row, index) => ({ row, index })),
    [extractedRows]
  );
  const timetableSort = useTableSort(timetableRows, TIMETABLE_ACCESSORS, {
    descFirstKeys: TIMETABLE_DESC_FIRST_KEYS,
  });
  const timetableFilters = useTableFilters(
    timetableSort.sortedRows,
    TIMETABLE_FILTER_FIELDS,
    TIMETABLE_SEARCH_ACCESSOR
  );
  const timetableColumns = useColumnVisibility<TimetableColumnKey>({
    columns: TIMETABLE_COLUMN_KEYS,
    storageKey: "ops.table.timetable-preview.columns",
  });
  const [timetablePage, setTimetablePage] = useState(1);
  const [timetablePageSize, setTimetablePageSize] = usePersistentState(
    "ops.table.timetable-preview.page-size",
    10,
    reviveNumber
  );
  const timetableVisibleColumnCount = TIMETABLE_COLUMN_KEYS.filter((column) =>
    timetableColumns.isVisible(column.key)
  ).length;

  const removeExtractedScheduleRow = (index: number) => {
    setExtractedRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
    setEditingParsedRow((editingIndex) => {
      if (editingIndex === null || editingIndex === index) return null;
      return editingIndex > index ? editingIndex - 1 : editingIndex;
    });
    setHasValidated(false);
    setValidationConflicts([]);
  };

  useEffect(() => {
    setTimetablePage(1);
  }, [timetableFilters.filtersVersion]);

  const timetableSortedFilteredRows = timetableFilters.filteredRows;
  const timetableVisibleSet = useMemo(
    () => new Set(timetableSortedFilteredRows),
    [timetableSortedFilteredRows]
  );
  // While a row is being edited the display order is pinned to the ingest order
  // so the focused inputs never jump out from under the caret.
  const timetableVisibleRows = useMemo(
    () =>
      editingParsedRow === null
        ? timetableSortedFilteredRows
        : timetableRows.filter((view) => timetableVisibleSet.has(view)),
    [editingParsedRow, timetableSortedFilteredRows, timetableRows, timetableVisibleSet]
  );
  const timetablePagedRows = useMemo(() => {
    const start = (timetablePage - 1) * timetablePageSize;
    const page = timetableVisibleRows.slice(start, start + timetablePageSize);
    if (editingParsedRow === null) return page;
    // Paging must never scroll the row being edited off screen.
    const editing = timetableVisibleRows.find((view) => view.index === editingParsedRow);
    return editing && !page.includes(editing) ? [editing, ...page] : page;
  }, [timetableVisibleRows, timetablePage, timetablePageSize, editingParsedRow]);

  useEffect(() => {
    // A shorter page size can strand the user on a page that no longer exists.
    const totalPages = Math.max(1, Math.ceil(timetableVisibleRows.length / timetablePageSize));
    if (timetablePage > totalPages) setTimetablePage(totalPages);
  }, [timetableVisibleRows.length, timetablePage, timetablePageSize]);

  const openScheduledSessionEdit = (session: ScheduledSession) => {
    setEditingScheduledSession(session);
    setScheduledEditForm({
      module: session.module || "",
      session_date: session.session_date ? String(session.session_date).slice(0, 10) : "",
      start_time: session.start_time ? String(session.start_time).slice(0, 5) : "09:00",
      end_time: session.end_time ? String(session.end_time).slice(0, 5) : "17:00",
      duration_hours: Number(session.duration_hours) || 8,
      trainer_name: session.trainer_name || "",
    });
    setScheduledEditError(null);
  };

  const saveScheduledSessionEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingScheduledSession) return;
    setIsSavingScheduledEdit(true);
    setScheduledEditError(null);
    try {
      await api.updateScheduledSession(editingScheduledSession.id, {
        module: scheduledEditForm.module.trim(),
        session_date: scheduledEditForm.session_date,
        start_time: scheduledEditForm.start_time,
        end_time: scheduledEditForm.end_time,
        duration_hours: scheduledEditForm.duration_hours,
        trainer_name: scheduledEditForm.trainer_name.trim() || undefined,
      });
      setEditingScheduledSession(null);
      await loadSessions();
    } catch (err: any) {
      setScheduledEditError(err.message || "Failed to update scheduled session");
    } finally {
      setIsSavingScheduledEdit(false);
    }
  };

  // Load sessions when drawer opens or tab switches
  const loadSessions = async () => {
    const target = activeBatch;
    if (!target) return;
    setIsLoadingSessions(true);
    setSessionsError(null);
    try {
      // Settled, not `all`: one failing request must not blank the other, but it
      // must also never be swallowed — a rejected fetch used to render as "No
      // Sessions Scheduled Yet", which reads as "nothing was ever delivered".
      const [utilResult, schedResult] = await Promise.allSettled([
        api.getSessions({ batch_id: target.id }),
        api.getScheduledSessions(target.id),
      ]);
      const failures = [utilResult, schedResult].filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        const reasons = failures
          .map((failure) => (failure as PromiseRejectedResult).reason?.message)
          .filter(Boolean);
        setSessionsError(reasons.length > 0 ? reasons.join("; ") : "Failed to load sessions for this batch.");
      }
      setSessions(utilResult.status === "fulfilled" ? utilResult.value || [] : []);
      setScheduledSessions(schedResult.status === "fulfilled" ? schedResult.value || [] : []);
    } catch (err) {
      console.error("Failed to load sessions:", err);
      setSessionsError("Failed to load sessions for this batch.");
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const deleteScheduledSession = async (session: ScheduledSession) => {
    const confirmed = await confirmAction({
      title: "Delete scheduled session?",
      description: `This permanently removes "${session.module}" from the batch timetable. A session with a linked delivery record cannot be deleted.`,
      confirmLabel: "Delete session",
      destructive: true,
    });
    if (!confirmed) return;

    setDeletingScheduledSessionId(session.id);
    try {
      await api.deleteScheduledSession(session.id);
      await loadSessions();
      notifySuccess("Scheduled session deleted");
    } catch (error) {
      notifyError("Failed to delete scheduled session", error);
    } finally {
      setDeletingScheduledSessionId(null);
    }
  };

  // Bulk escape hatch for a reduced conclusion date: every out-of-window row
  // must go before the batch PATCH can succeed. Deletions go through the
  // per-row endpoint, so a mid-loop failure reloads whatever remains and the
  // panel re-renders with the still-blocking rows.
  const handleDeleteOutOfWindowSessions = async () => {
    const targets = deletableBlockers;
    if (targets.length === 0) return;
    const confirmed = await confirmAction({
      title: `Delete ${targets.length} scheduled session(s)?`,
      description: `This permanently removes ${targets
        .map((session) => `${session.session_date} "${session.module}"`)
        .join(", ")} from the batch timetable. A session with a linked delivery record cannot be deleted.`,
      confirmLabel: "Delete sessions",
      destructive: true,
    });
    if (!confirmed) return;

    setIsDeletingBlockers(true);
    setBlockerDeleteError(null);
    try {
      for (const session of targets) {
        await api.deleteScheduledSession(session.id);
      }
      await loadSessions();
      notifySuccess(`Deleted ${targets.length} scheduled session(s)`);
    } catch (error) {
      setBlockerDeleteError("Some sessions could not be deleted. Remaining sessions still block the save.");
      notifyError("Failed to delete scheduled sessions", error);
      await loadSessions();
    } finally {
      setIsDeletingBlockers(false);
    }
  };

  useEffect(() => {
    if (isOpen && batchId) {
      loadSessions();
    }
  }, [isOpen, batchId]);

  const formatDate = (dStr?: string | null) => {
    return formatDateDMY(dStr, "Not set");
  };

  const getEntityName = (id?: string | null) => {
    if (!id) return null;
    const found = options.entities.find((e) => e.id === id);
    return found ? found.name : null;
  };

  const getAccommodationName = (id?: string | null, resType?: string | null) => {
    if (id) {
      const found = options.accommodations.find((a) => a.id === id);
      if (found?.name) return found.name;
    }
    if (resType === "R") return "Residential / Hotel Provided";
    if (resType === "NR") return "Non-Residential / Local Trainer";
    return resType || "Non-Residential";
  };

  const getDeliveryModeName = (id?: string | null, mode?: string | null) => {
    if (mode && mode.trim()) return mode;
    if (id) {
      const found = options.delivery_modes.find((m) => m.id === id);
      if (found?.name) return found.name;
    }
    return mode || "Online";
  };

  const calculatedCalendarDays =
    activeBatch.calendar_days ??
    (activeBatch.start_date && activeBatch.end_date
      ? Math.max(
          0,
          Math.round(
            (new Date(activeBatch.end_date).getTime() - new Date(activeBatch.start_date).getTime()) / 86400000
          )
        )
      : null);

  const facultyChips = activeBatch.faculty_assigned_text
    ? activeBatch.faculty_assigned_text
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  // Parsed once per remarks change: the audit list is read five times per render
  // otherwise, each read running two regex passes and a lookbehind split.
  const remarkEntries = useMemo(() => parseRemarksList(activeBatch.remarks), [activeBatch.remarks]);

  // Roving-tabindex arrow-key navigation, as the ARIA tabs pattern requires.
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, current: BatchDetailTab) => {
    const index = DRAWER_TABS.findIndex((tab) => tab.id === current);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % DRAWER_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + DRAWER_TABS.length) % DRAWER_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = DRAWER_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveTab(DRAWER_TABS[nextIndex].id);
    document.getElementById(`batch-tab-${DRAWER_TABS[nextIndex].id}`)?.focus();
  };

  const openGate1Modal = (session: TrainingSession) => {
    setCompletingSession(session);
    setGate1Rating(4.5);
    setGate1Feedback("");
  };

  const handleSessionOutcome = async (
    session: TrainingSession,
    outcome: "cancel" | "not-conducted",
  ) => {
    const reason = await requestText({
      title: outcome === "cancel" ? "Cancel session" : "Mark session not conducted",
      defaultValue: "",
      confirmLabel: "Save outcome",
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      notifyError("A reason of at least 3 characters is required");
      return;
    }
    try {
      if (outcome === "cancel") {
        await api.cancelSession(session.id, reason.trim());
      } else {
        await api.markSessionNotConducted(session.id, reason.trim());
      }
      await loadSessions();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      notifyError("Failed to update session outcome", err);
    }
  };

  const handleRescheduleSession = async (session: TrainingSession) => {
    const date = await requestText({
      title: "Reschedule session date (YYYY-MM-DD)",
      defaultValue: session.date_of_training.slice(0, 10),
      confirmLabel: "Continue",
    });
    if (date === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || Number.isNaN(Date.parse(`${date.trim()}T00:00:00Z`))) {
      notifyError("Enter a valid date in YYYY-MM-DD format");
      return;
    }
    const reason = await requestText({
      title: "Reason for rescheduling",
      defaultValue: "",
      confirmLabel: "Reschedule",
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      notifyError("A reason of at least 3 characters is required");
      return;
    }
    try {
      await api.rescheduleSession(session.id, {
        date_of_training: `${date.trim()}T00:00:00Z`,
        start_time: session.start_time || undefined,
        end_time: session.end_time || undefined,
        reason: reason.trim(),
      });
      await loadSessions();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      notifyError("Failed to reschedule session", err);
    }
  };

  // Handle Add Single Session
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setSessionError(null);
    setIsSubmittingSession(true);

    try {
      await api.createScheduledSession({
        batch_id: activeBatch.id,
        session_date: sessionDate,
        start_time: sessionStartTime,
        end_time: sessionEndTime,
        module: sessionTopic.trim(),
        trainer_name: sessionFacultyName.trim() || undefined,
        duration_hours: Number(sessionHours),
      });

      setIsAddSessionOpen(false);
      setSessionTopic("");
      setSessionDate("");
      await loadSessions();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setSessionError(err.message || "Failed to schedule session");
    } finally {
      setIsSubmittingSession(false);
    }
  };

  // Handle Gate 1 Submission
  const handleCompleteGate1 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completingSession) return;
    const topicFeedback = gate1Feedback.trim();
    if (topicFeedback.length < 3) {
      setGate1Error("Topic feedback is required and must contain at least 3 characters.");
      return;
    }
    setGate1Error(null);
    setIsSubmittingGate1(true);

    try {
      await api.completeSessionGate1(completingSession.id, {
        rating: Number(gate1Rating),
        topic_feedback: topicFeedback,
        total_students_present: Number(gate1StudentsPresent),
      });

      setCompletingSession(null);
      setGate1Feedback("");
      await loadSessions();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      let message = err.message || "Failed to submit Gate 1 feedback";
      try {
        const details = JSON.parse(message);
        const firstError = Array.isArray(details) ? details[0] : details?.errors?.[0];
        if (firstError?.msg) message = firstError.msg;
      } catch {
        // Keep the server message when it is not JSON.
      }
      setGate1Error(message);
    } finally {
      setIsSubmittingGate1(false);
    }
  };

  const handleEditSession = async (session: TrainingSession) => {
    const topic = await requestText({
      title: "Edit session topic",
      defaultValue: session.topic,
      confirmLabel: "Save topic",
    });
    if (topic === null || topic === session.topic) return;
    try {
      await api.updateSession(session.id, { topic });
      await loadSessions();
    } catch (err: any) {
      notifyError("Failed to edit session", err);
    }
  };

  // Handle Gate 2 Batch Closure
  const handleCloseBatchGate2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setGate2Error(null);
    setIsSubmittingGate2(true);

    try {
      await api.closeBatchGate2(activeBatch.id, {
        promoters_count: gate2Promoters,
        passive_count: gate2Passives,
        detractors_count: gate2Detractors,
        nps_available: gate2NpsAvailable,
        nps_unavailable_reason: gate2NpsAvailable ? undefined : gate2NpsReason.trim(),
      });

      setIsGate2ModalOpen(false);
      if (onBatchUpdated) onBatchUpdated();
      onClose();
    } catch (err: any) {
      setGate2Error(err.message || "Failed to close batch via Gate 2");
    } finally {
      setIsSubmittingGate2(false);
    }
  };

  // Handle Ingest File Upload
  const handleIngestFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingestFile) return;
    setIngestError(null);
    setIngestSummary(null);
    setIsIngesting(true);
    setHasValidated(false);
    setValidationConflicts([]);

    try {
      const res = await api.ingestScheduleFile(ingestFile, activeBatch.batch_id);
      const rows = Array.isArray(res.extracted_schedule) && res.extracted_schedule.length > 0
        ? res.extracted_schedule
        : Array.isArray(res.items) ? res.items : [];
      setExtractedRows(rows);
      setHasParsedTimetable(true);
      setIngestSummary({
        message: res.message || "Timetable processed.",
        extractedRows: res.extracted_rows ?? rows.length,
        failedRows: res.failed_rows ?? 0,
        errors: (res.errors || []).map((error) => `Row ${error.source_row}: ${error.message}`),
      });
      if (rows.length === 0 && (res.errors || []).length === 0) {
        setIngestError("The file was accepted, but no schedule rows were extracted. Check the column names and date values.");
      }
    } catch (err: any) {
      setIngestError(err.message || "Failed to parse timetable file");
    } finally {
      setIsIngesting(false);
    }
  };

  // Handle Validate Extracted Schedule (Conflict Engine)
  const handleValidateSchedule = async () => {
    if (extractedRows.length === 0) return;
    setIsValidating(true);
    setIngestError(null);

    try {
      const validationPayload = extractedRows.map((r) => ({
        batch_id: activeBatch.batch_id,
        date_of_training: r.date_of_training,
        no_of_hours: r.no_of_hours,
        faculty_name: r.faculty_name || activeBatch.faculty_assigned_text || undefined,
        topic: r.topic,
        mode_of_delivery: r.mode_of_delivery,
      }));

      const res = await api.validateScheduleSlots(validationPayload, activeBatch.batch_id);
      setValidationConflicts(res.conflicts || []);
      setHasValidated(true);
    } catch (err: any) {
      setIngestError(err.message || "Conflict validation failed");
    } finally {
      setIsValidating(false);
    }
  };

  // Handle Apply All Extracted Sessions to Batch
  const handleApplyExtractedSchedule = async () => {
    if (extractedRows.length === 0) return;
    setIsApplyingSchedule(true);
    setIngestError(null);

    try {
      await api.applySchedule(
        extractedRows.map((row) => ({
          ...row,
          start_time: row.start_time || "09:00",
          end_time: row.end_time || "17:00",
          faculty_name: row.faculty_name || activeBatch.faculty_assigned_text || undefined,
          venue: row.venue || activeBatch.location_city || undefined,
          location_city: row.location_city || activeBatch.location_city || undefined,
          mode_of_delivery: row.mode_of_delivery || activeBatch.delivery_mode,
          batch_id: activeBatch.batch_id,
        })),
        activeBatch.batch_id,
        ingestFile?.name,
      );

      setIsIngestModalOpen(false);
      setExtractedRows([]);
      setHasParsedTimetable(false);
      setIngestFile(null);
      await loadSessions();
      if (onBatchUpdated) onBatchUpdated();
    } catch (err: any) {
      setIngestError(err.message || "Failed to create sessions from timetable");
    } finally {
      setIsApplyingSchedule(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="glass-panel flex max-h-none flex-col gap-0 overflow-hidden p-0 [&>button]:hidden"
        style={{
          width: "100%",
          maxWidth: "min(1560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 32px)",
          background: "#ffffff",
          borderRadius: 20,
          border: "1px solid rgba(160, 190, 223, 0.8)",
          boxShadow: "0 24px 48px rgba(15, 23, 42, 0.2), 0 8px 16px rgba(0, 0, 0, 0.08)",
        }}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Modal Header */}
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0 border-b px-6 py-4" style={{
          background: "linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(246, 250, 255, 0.94) 100%)",
          borderColor: "var(--border-subtle)",
        }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Full Batch Details & Governance Hub
              </span>
              <StatusBadge status={activeBatch.status} />
            </div>
            <DialogTitle className="text-xl font-bold font-display" style={{ color: "#0b5cab" }}>
              {activeBatch.batch_id}
            </DialogTitle>
          </div>
          <button
            onClick={onClose}
            aria-label="Close details"
            className="p-2 rounded-lg transition-all hover:bg-accent"
            style={{
              background: "rgba(226, 232, 240, 0.6)",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s ease",
              flexShrink: 0,
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </DialogHeader>

        {/* Tab Navigation */}
        <div
          role="tablist"
          aria-label="Batch detail sections"
          className="flex gap-3 overflow-x-auto px-6 border-b shrink-0"
          style={{
            borderBottom: "1px solid var(--border-subtle)",
            background: "#ffffff",
          }}
        >
          {DRAWER_TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`batch-tab-${tab.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`batch-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                className={cn(
                  "px-4 py-3 text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap",
                  "border-b-2 -mb-px",
                  selected
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.id === "sessions" && (
                  <span
                    className={cn(
                      "px-2 py-0.5 text-xs font-bold rounded-full",
                      selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <span aria-hidden>{scheduledSessionCount} sessions / {sessions.length} logged</span>
                    <span className="sr-only">
                      {scheduledSessionCount} scheduled sessions, {sessions.length} logged utilization sessions
                    </span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Modal Body — positioned so `strategy="absolute"` fullscreen tables fill the drawer, not the viewport.
            The shared `.modal-scroll-content` height cap is overridden: this panel is already a
            flex column with its own max height, so the body just takes the remaining space. */}
        <div
          id={`batch-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`batch-tab-${activeTab}`}
          tabIndex={0}
          className="modal-scroll-content flex-1 px-6 py-6 space-y-6"
          style={{ position: "relative", maxHeight: "none" }}
        >

          {/* TAB 1: OVERVIEW */}
          {activeTab === "overview" && (
            <>
              {/* OnHold Notice Banner */}
              {activeBatch.status === "OnHold" && (
                <div
                  style={{
                    background: "rgba(245, 158, 11, 0.1)",
                    border: "1px solid rgba(245, 158, 11, 0.4)",
                    borderRadius: 14,
                    padding: "16px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <PauseCircle size={22} color="#d97706" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 800, color: "#b45309", fontSize: "0.95rem" }}>
                        Batch is Currently ON HOLD
                      </div>
                      <p style={{ fontSize: "0.82rem", color: "var(--text-main)", margin: "4px 0 0 0" }}>
                        Delivery operations, faculty sessions, and schedule milestones are temporarily paused.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openStatusModal("Resume")}
                    className="btn btn-primary"
                    style={{ background: "#059669", padding: "7px 14px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                  >
                    <PlayCircle size={15} /> Resume Batch
                  </button>
                </div>
              )}

              {/* Cancelled Notice Banner */}
              {activeBatch.status === "Cancelled" && (
                <div
                  style={{
                    background: "rgba(225, 29, 72, 0.08)",
                    border: "1px solid rgba(225, 29, 72, 0.35)",
                    borderRadius: 14,
                    padding: "16px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <Ban size={22} color="#e11d48" style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 800, color: "#be123c", fontSize: "0.95rem" }}>
                        Batch is CANCELLED
                      </div>
                      <p style={{ fontSize: "0.82rem", color: "var(--text-main)", margin: "4px 0 0 0" }}>
                        This batch has been marked as cancelled. Scheduled delivery is terminated.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openStatusModal("Resume")}
                    className="btn btn-secondary"
                    style={{ padding: "7px 14px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                  >
                    <RefreshCw size={14} /> Reopen Batch
                  </button>
                </div>
              )}

              {/* Rejection / Revision Notice */}
              {activeBatch.remarks && activeBatch.status === "Rejected" && (
                <div
                  style={{
                    background: "rgba(244, 63, 94, 0.1)",
                    border: "1px solid rgba(244, 63, 94, 0.3)",
                    borderRadius: 14,
                    padding: "16px 18px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, color: "#e11d48" }}>
                      <AlertCircle size={18} />
                      <span>Approval Rejection Feedback</span>
                    </div>
                    <button
                      type="button"
                      onClick={openEditModal}
                      className="btn btn-secondary"
                      style={{ padding: "4px 10px", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Edit3 size={13} /> Edit Batch
                    </button>
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "var(--text-main)", marginTop: 8, fontWeight: 500 }}>
                    {activeBatch.remarks}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                    Make the requested adjustments via &ldquo;Edit Batch&rdquo;. New batches are sent to approval automatically after creation.
                  </div>
                </div>
              )}

              {/* Program & Client Context */}
              <div className="glass-panel" style={{ padding: "18px 22px", background: "#ffffff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>
                      Curriculum / Program Title
                    </div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--text-main)", marginTop: 4, lineHeight: 1.3 }}>
                      {activeBatch.program_name}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginTop: 10, fontSize: "0.85rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-main)", fontWeight: 700 }}>
                        <Building2 size={16} color="#0b5cab" />
                        <span>{activeBatch.client_name || "Enterprise Client"}</span>
                      </div>
                      <span style={{ color: "var(--border-subtle)" }}>•</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>Entity:</span>
                        <span style={{ fontWeight: 600, color: "#0b5cab", background: "rgba(11, 92, 171, 0.08)", padding: "2px 8px", borderRadius: 6, fontSize: "0.8rem" }}>
                          {getEntityName(activeBatch.entity_id) || "Corporate Enterprise"}
                        </span>
                      </div>
                      <span style={{ color: "var(--border-subtle)" }}>•</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>Domain:</span>
                        <span style={{ color: "#7c3aed", fontWeight: 700, background: "rgba(124, 58, 237, 0.08)", padding: "2px 8px", borderRadius: 6, fontSize: "0.8rem" }}>
                          {activeBatch.domain || "Technology"}
                        </span>
                      </div>
                      <span style={{ color: "var(--border-subtle)" }}>•</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "var(--text-dim)", fontSize: "0.78rem" }}>Category:</span>
                        <span style={{ fontWeight: 600, color: "var(--text-main)", background: "#f1f5f9", padding: "2px 8px", borderRadius: 6, fontSize: "0.8rem" }}>
                          {activeBatch.category || "Bootcamp"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={openEditModal}
                    className="btn btn-secondary"
                    style={{ padding: "8px 14px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                  >
                    <Edit3 size={14} /> Edit Batch
                  </button>
                </div>
              </div>

              {/* Commercial & Contractual Identifiers */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                <div className="glass-panel" style={{ padding: "14px 16px", background: "#ffffff" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
                    Client SOW / PO Number
                  </div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 700, color: activeBatch.sow_number ? "var(--text-main)" : "var(--text-muted)", marginTop: 4, fontFamily: "monospace" }}>
                    {activeBatch.sow_number || "Not specified"}
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: "14px 16px", background: "#ffffff" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
                    Financial Approval ID
                  </div>
                  <div style={{ fontSize: "0.95rem", fontWeight: 700, color: activeBatch.approval_id ? "#0b5cab" : "#d97706", marginTop: 4 }}>
                    {activeBatch.approval_id || "Pending Level 1/2 Approval"}
                  </div>
                </div>

                <div className="glass-panel" style={{ padding: "14px 16px", background: "#ffffff" }}>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
                    Governance Lock
                  </div>
                  <div style={{
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    color: activeBatch.is_schema_locked ? "#16a34a" : "#d97706",
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 6
                  }}>
                    {activeBatch.is_schema_locked ? <Lock size={15} /> : <ShieldAlert size={15} />}
                    <span>{activeBatch.is_schema_locked ? "Schema Locked" : "Unlocked (Editable)"}</span>
                  </div>
                </div>
              </div>

              {/* Delivery Logistics & Schedule Details */}
              <div className="glass-panel" style={{ padding: "18px 20px", background: "#ffffff" }}>
                <h4 style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700, marginBottom: 14, letterSpacing: "0.04em" }}>
                  Schedule, Mode & Delivery Logistics
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, fontSize: "0.85rem" }}>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Delivery Mode</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>
                      {getDeliveryModeName(activeBatch.delivery_mode_id, activeBatch.delivery_mode)}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Training Venue / City</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>
                      {activeBatch.location_city || (getDeliveryModeName(activeBatch.delivery_mode_id, activeBatch.delivery_mode) === "Online" ? "Remote (Online)" : "Not specified")}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Faculty Accommodation</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>
                      {getAccommodationName(activeBatch.accommodation_id, activeBatch.residential_type)}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Training Category</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>{activeBatch.category || "Bootcamp"}</div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Commencement Date</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>{formatDate(activeBatch.start_date)}</div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Conclusion Date</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>{formatDate(activeBatch.end_date)}</div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Calendar Duration</span>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 2 }}>
                      {calculatedCalendarDays !== null ? `${calculatedCalendarDays} Calendar Days` : "Not set"}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.75rem", textTransform: "uppercase", fontWeight: 600 }}>Active Training Hours</span>
                    <div style={{ fontWeight: 700, color: "#0b5cab", marginTop: 2 }}>
                      {activeBatch.training_days} Days ({activeBatch.total_hours} Hours)
                    </div>
                  </div>
                </div>
              </div>

              {/* Headcount Breakdown & Assigned Faculty */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {/* Headcount */}
                <div className="glass-panel" style={{ padding: "18px 20px", background: "#ffffff" }}>
                  <h4 style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700, marginBottom: 12, letterSpacing: "0.04em" }}>
                    Candidate Headcount
                  </h4>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, textAlign: "center" }}>
                    <div style={{ background: "#f8fafc", padding: "12px 8px", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                      <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", fontWeight: 600 }}>Total Headcount</div>
                      <div style={{ fontSize: "1.4rem", fontWeight: 800, color: "#0b5cab", marginTop: 2 }}>
                        {activeBatch.total_enrollments}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Faculty Assignment */}
                <div className="glass-panel" style={{ padding: "18px 20px", background: "#ffffff" }}>
                  <h4 style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700, marginBottom: 10, letterSpacing: "0.04em" }}>
                    Proposed & Assigned Faculty
                  </h4>
                  {facultyChips.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                      {facultyChips.map((name) => (
                        <span
                          key={name}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            background: "rgba(11, 92, 171, 0.08)",
                            color: "#0b5cab",
                            border: "1px solid rgba(11, 92, 171, 0.25)",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: "0.825rem",
                            fontWeight: 600,
                          }}
                        >
                          <GraduationCap size={14} />
                          {name}
                        </span>
                      ))}
                    </div>
                  ) : activeBatch.faculty_assigned_text ? (
                    <div style={{ fontSize: "0.875rem", color: "var(--text-main)", fontWeight: 600, marginTop: 6 }}>
                      {activeBatch.faculty_assigned_text}
                    </div>
                  ) : (
                    <div style={{ fontSize: "0.825rem", color: "var(--text-dim)", fontStyle: "italic", marginTop: 6 }}>
                      No faculty members assigned yet. You can assign trainers via Edit Batch or during Timetable ingestion.
                    </div>
                  )}

                  <div style={{ marginTop: 14, borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 600 }}>
                      Technology Stack & Modules
                    </div>
                    <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-main)", marginTop: 2 }}>
                      {activeBatch.technology || "Not specified"}
                    </div>
                  </div>
                </div>
              </div>

              {/* Stakeholder Role Assignments & Governance Clearance */}
              <div className="glass-panel" style={{ padding: "18px 20px", background: "#ffffff" }}>
                <h4 style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700, marginBottom: 14, letterSpacing: "0.04em" }}>
                  Stakeholder Role Assignments & Approvals
                </h4>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, fontSize: "0.85rem" }}>
                  <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
                      Sales Account SPOC
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 4 }}>
                      {activeBatch.sales_spoc?.full_name || "Unassigned"}
                    </div>
                    {activeBatch.sales_spoc?.email && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <Mail size={12} /> {activeBatch.sales_spoc.email}
                      </div>
                    )}
                  </div>

                  <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
                      Operations Coordinator
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 4 }}>
                      {activeBatch.coordinator?.full_name || "Unassigned"}
                    </div>
                    {activeBatch.coordinator?.email && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <Mail size={12} /> {activeBatch.coordinator.email}
                      </div>
                    )}
                  </div>

                  <div style={{ background: "#f8fafc", padding: "12px 14px", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700 }}>
                      Delivery Manager
                    </div>
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginTop: 4 }}>
                      {activeBatch.primary_manager?.full_name || "Unassigned"}
                    </div>
                    {activeBatch.primary_manager?.email && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                        <Mail size={12} /> {activeBatch.primary_manager.email}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 12, fontSize: "0.825rem" }}>
                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "#ffffff", border: "1px solid var(--border-subtle)" }}>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Requested On:</span>
                    <div style={{ fontWeight: 600, color: "var(--text-main)", marginTop: 2 }}>
                      {formatDate(activeBatch.batch_request_date || activeBatch.created_at)}
                    </div>
                  </div>

                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "#ffffff", border: "1px solid var(--border-subtle)" }}>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Approver 1 Status:</span>
                    <div style={{ fontWeight: 700, color: activeBatch.approver_1_status === "Approved" ? "#16a34a" : activeBatch.approver_1_status === "Rejected" ? "#e11d48" : "#d97706", marginTop: 2 }}>
                      {activeBatch.approver_1_status || "Pending"}
                      {activeBatch.approver_1_approved_at && (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>
                          ({formatDate(activeBatch.approver_1_approved_at)})
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ padding: "10px 12px", borderRadius: 8, background: "#ffffff", border: "1px solid var(--border-subtle)" }}>
                    <span style={{ color: "var(--text-dim)", fontSize: "0.72rem", textTransform: "uppercase", fontWeight: 700 }}>Approver 2 Status:</span>
                    <div style={{ fontWeight: 700, color: activeBatch.approver_2_status === "Approved" ? "#16a34a" : activeBatch.approver_2_status === "Rejected" ? "#e11d48" : "#d97706", marginTop: 2 }}>
                      {activeBatch.approver_2_status || "Pending"}
                      {activeBatch.approver_2_approved_at && (
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400, marginLeft: 6 }}>
                          ({formatDate(activeBatch.approver_2_approved_at)})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Operational Remarks & Special Instructions */}
              <div className="glass-panel" style={{ padding: "18px 20px", background: "#ffffff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h4 style={{ fontSize: "0.85rem", textTransform: "uppercase", color: "var(--text-dim)", fontWeight: 700, margin: 0, letterSpacing: "0.04em" }}>
                      Operational Remarks & Special Instructions
                    </h4>
                    {remarkEntries.length > 0 && (
                      <Badge variant="secondary" size="sm" className="normal-case tracking-normal">
                        {remarkEntries.length} {remarkEntries.length === 1 ? "entry" : "entries"}
                      </Badge>
                    )}
                  </div>
                </div>

                {remarkEntries.length === 0 ? (
                  <div style={{
                    fontSize: "0.875rem",
                    color: "var(--text-dim)",
                    fontStyle: "italic",
                    lineHeight: 1.5,
                    background: "#f8fafc",
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle)",
                  }}>
                    No operational remarks or special instructions provided.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {remarkEntries.map((entry, idx) => (
                      <div
                        key={entry.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 12,
                          padding: "12px 14px",
                          borderRadius: 8,
                          background: entry.isAudit ? "#f8fafc" : "#ffffff",
                          border: "1px solid var(--border-subtle)",
                          borderLeft: entry.isAudit
                            ? entry.toStatus === "OnHold"
                              ? "4px solid #d97706"
                              : entry.toStatus === "Cancelled"
                              ? "4px solid #e11d48"
                              : "4px solid #3b82f6"
                            : "4px solid #10b981",
                          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                        }}
                      >
                        {/* Number Indicator */}
                        <div
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: entry.isAudit ? "#eff6ff" : "#ecfdf5",
                            color: entry.isAudit ? "#2563eb" : "#059669",
                            border: `1px solid ${entry.isAudit ? "#bfdbfe" : "#a7f3d0"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "0.75rem",
                            fontWeight: 700,
                            flexShrink: 0,
                            marginTop: 1,
                          }}
                        >
                          {idx + 1}
                        </div>

                        {/* Detail Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {entry.isAudit ? (
                            <>
                              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                {/* Timestamp Pill in IST */}
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    color: "#1e40af",
                                    background: "#dbeafe",
                                    padding: "2px 8px",
                                    borderRadius: 4,
                                    letterSpacing: "0.01em",
                                  }}
                                >
                                  <Clock size={12} />
                                  {entry.timestamp}
                                </span>

                                {/* Status Transition or Action Text */}
                                {entry.fromStatus && entry.toStatus ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-main)" }}>
                                    <span style={{
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: "#f1f5f9",
                                      border: "1px solid #cbd5e1",
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                      color: "#475569"
                                    }}>
                                      {entry.fromStatus}
                                    </span>
                                    <span style={{ color: "#94a3b8", fontWeight: 700 }}>&rarr;</span>
                                    <span style={{
                                      padding: "1px 6px",
                                      borderRadius: 4,
                                      background: entry.toStatus === "OnHold" ? "#fef3c7" : entry.toStatus === "Cancelled" ? "#fee2e2" : "#dbeafe",
                                      color: entry.toStatus === "OnHold" ? "#b45309" : entry.toStatus === "Cancelled" ? "#b91c1c" : "#1d4ed8",
                                      border: `1px solid ${entry.toStatus === "OnHold" ? "#fde68a" : entry.toStatus === "Cancelled" ? "#fca5a5" : "#bfdbfe"}`,
                                      fontSize: "0.75rem",
                                      fontWeight: 700
                                    }}>
                                      {entry.toStatus}
                                    </span>
                                    {entry.actor && (
                                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginLeft: 2 }}>
                                        by <strong>{entry.actor}</strong>
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontWeight: 500 }}>
                                    {entry.action}
                                  </span>
                                )}
                              </div>

                              {/* Message / Reason */}
                              {entry.message && (
                                <div
                                  style={{
                                    fontSize: "0.85rem",
                                    color: "var(--text-main)",
                                    lineHeight: 1.5,
                                    padding: "8px 12px",
                                    borderRadius: 6,
                                    background: "#ffffff",
                                    border: "1px solid #e2e8f0",
                                  }}
                                >
                                  <span style={{ fontWeight: 600, color: "var(--text-muted)", marginRight: 6 }}>Reason:</span>
                                  <span style={{ color: "#1e293b" }}>{entry.message}</span>
                                </div>
                              )}
                            </>
                          ) : (
                            <div>
                              <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#059669", marginBottom: 4 }}>
                                Note / Instruction
                              </div>
                              <div style={{ fontSize: "0.85rem", color: "var(--text-main)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                                {entry.message}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: SESSIONS & TIMETABLE */}
          {activeTab === "sessions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
                    Scheduled Sessions
                  </h3>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "2px 0 0 0" }}>
                    Manage delivery sessions or ingest timetable spreadsheet with conflict checks.
                  </p>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setIsIngestModalOpen(true)}
                    className="btn btn-secondary"
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.825rem", padding: "6px 12px" }}
                  >
                    <FileSpreadsheet size={15} color="#16a34a" />
                    <span>Ingest Timetable (Excel)</span>
                  </button>

                  <button
                    onClick={() => setIsAddSessionOpen(true)}
                    className="btn btn-primary"
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.825rem", padding: "6px 12px" }}
                  >
                    <Plus size={15} />
                    <span>Add Session</span>
                  </button>
                </div>
              </div>

              {sessionsError && <ErrorBanner message={sessionsError} />}

              {isLoadingSessions ? (
                <LoadingState label="Loading curriculum schedule and sessions..." />
              ) : scheduledSessions.length === 0 && sessions.length === 0 ? (
                <div style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  background: "#f8fafc",
                  borderRadius: 8,
                  border: "1px dashed var(--border-subtle)",
                  color: "var(--text-muted)"
                }}>
                  <Clock size={28} style={{ margin: "0 auto 10px", color: "var(--text-dim)" }} />
                  <div style={{ fontWeight: 600 }}>No Sessions Scheduled Yet</div>
                  <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
                    Use <strong>Add Session</strong> to schedule manually or <strong>Ingest Timetable</strong> to import from Excel.
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {/* SECTION 1: INGESTED CURRICULUM SCHEDULE */}
                  {scheduledSessions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, background: "#f8fafc", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                        <PanelTitle
                          title={`Curriculum Schedule (${scheduledSessionCount} ${scheduledSessionCount === 1 ? "Session" : "Sessions"})`}
                        />
                        <div style={{ display: "flex", gap: 8 }}>
                          <Badge variant="success" size="sm" className="normal-case tracking-normal">
                            {scheduledSessions.filter((s) => s.utilization_logged).length} Delivered
                          </Badge>
                          <Badge variant="warning" size="sm" className="normal-case tracking-normal">
                            {scheduledSessions.filter((s) => !s.utilization_logged).length} Pending
                          </Badge>
                        </div>
                      </div>

                      {scheduledSessions.map((s, idx) => (
                        <div
                          key={s.id}
                          className="glass-panel"
                          style={{
                            padding: "14px 16px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 12,
                            background: "#ffffff",
                            borderLeft: s.utilization_logged ? "4px solid #16a34a" : "4px solid #f59e0b",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{
                              width: 44,
                              height: 44,
                              borderRadius: 8,
                              background: s.utilization_logged ? "#f0fdf4" : "#fffbeb",
                              color: s.utilization_logged ? "#16a34a" : "#d97706",
                              border: `1px solid ${s.utilization_logged ? "#bbf7d0" : "#fde68a"}`,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 700,
                              fontSize: "0.75rem",
                              flexShrink: 0
                            }}>
                              <span style={{ fontSize: "0.65rem", textTransform: "uppercase", opacity: 0.8 }}>Session</span>
                              <span style={{ fontSize: "0.95rem" }}>{idx + 1}</span>
                            </div>

                            <div>
                              <div style={{ fontWeight: 700, fontSize: "0.925rem", color: "var(--text-main)" }}>
                                {s.module}
                              </div>
                              <div style={{ fontSize: "0.775rem", color: "var(--text-muted)", marginTop: 3, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: "0.775rem", color: "var(--text-muted)" }}> {formatDate(s.session_date)} ({s.day_name || ""}) |  {s.start_time ? String(s.start_time).slice(0, 5) : "09:30"} - {s.end_time ? String(s.end_time).slice(0, 5) : "17:30"} ({s.duration_hours} hrs) |  Scheduled: {s.trainer_name || activeBatch.faculty_assigned_text || "Faculty assigned"}</span>
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            {s.utilization_logged ? (
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                                <span style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 5,
                                  background: "#f0fdf4",
                                  color: "#166534",
                                  border: "1px solid #bbf7d0",
                                  padding: "4px 10px",
                                  borderRadius: 6,
                                  fontSize: "0.775rem",
                                  fontWeight: 700
                                }}>
                                  <CheckCircle2 size={14} color="#16a34a" />
                                  Delivered & Logged
                                </span>
                                {s.actual_trainer && (
                                  <span style={{ fontSize: "0.725rem", color: "var(--text-muted)", marginTop: 2 }}>
                                    By {s.actual_trainer} ({s.actual_hours}h)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  background: "#fffbeb",
                                  color: "#b45309",
                                  border: "1px solid #fde68a",
                                  padding: "4px 8px",
                                  borderRadius: 6,
                                  fontSize: "0.75rem",
                                  fontWeight: 600
                                }}>
                                  <Clock size={12} />
                                  Pending Delivery
                                </span>
                                <button
                                  type="button"
                                  onClick={() => openScheduledSessionEdit(s)}
                                  className="btn btn-secondary"
                                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", fontSize: "0.8rem" }}
                                  title="Edit parsed timetable row"
                                >
                                  <Edit3 size={14} />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteScheduledSession(s)}
                                  className="btn btn-secondary"
                                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px", fontSize: "0.8rem" }}
                                  title="Delete scheduled session"
                                  aria-label={`Delete scheduled session ${idx + 1}: ${s.module}`}
                                  disabled={deletingScheduledSessionId === s.id}
                                >
                                  <Trash2 size={14} />
                                  <span>{deletingScheduledSessionId === s.id ? "Deleting…" : "Delete"}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openLogUtilizationModal(s)}
                                  className="btn btn-primary"
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 5,
                                    padding: "6px 12px",
                                    fontSize: "0.8rem",
                                    background: "#2563eb"
                                  }}
                                >
                                  <span>Log Utilization</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SECTION 2: SESSION LEDGER — actual delivery records with status */}
                  {sessions.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ background: "#f8fafc", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
                        <PanelTitle
                          title={`Session Ledger (${sessions.length} ${sessions.length === 1 ? "Record" : "Records"})`}
                          description="Actual delivery logs from the utilization ledger, keyed by the batch session id."
                        />
                      </div>
                      <div style={{ overflow: "auto", border: "1px solid var(--border-subtle)", borderRadius: 6, background: "#ffffff" }}>
                        <table className="glass-table w-full border-collapse" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                          <thead>
                            <tr>
                              <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Date</PlainHeaderCell>
                              <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Topic</PlainHeaderCell>
                              <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Faculty</PlainHeaderCell>
                              <PlainHeaderCell style={{ ...TIMETABLE_TH_STYLE, textAlign: "center" }}>Hours</PlainHeaderCell>
                              <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Mode</PlainHeaderCell>
                              <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Session Status</PlainHeaderCell>
                              <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Actions</PlainHeaderCell>
                            </tr>
                          </thead>
                          <tbody>
                            {sessions.map((s) => (
                              <tr key={s.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                                <td style={{ ...TIMETABLE_TD_STYLE, fontWeight: 600 }}>{formatDate(s.date_of_training)}</td>
                                <td style={TIMETABLE_TD_STYLE}>{s.topic}</td>
                                <td style={TIMETABLE_TD_STYLE}>{s.faculty_name}</td>
                                <td style={{ ...TIMETABLE_TD_STYLE, textAlign: "center" }}>{s.no_of_hours}h</td>
                                <td style={TIMETABLE_TD_STYLE}>{s.mode_of_delivery}</td>
                                <td style={TIMETABLE_TD_STYLE}>{s.status}</td>
                                <td style={{ ...TIMETABLE_TD_STYLE, whiteSpace: "nowrap" }}>
                                  {s.status !== "Completed" && (
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      {(s.status === "Scheduled" || s.status === "InProgress") && (
                                        <>
                                          <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={() => openGate1Modal(s)}
                                            style={{ padding: "5px 8px", fontSize: "0.75rem" }}
                                          >
                                            Submit Feedback
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => handleSessionOutcome(s, "cancel")}
                                            style={{ padding: "5px 8px", fontSize: "0.75rem" }}
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            className="btn btn-secondary"
                                            onClick={() => handleSessionOutcome(s, "not-conducted")}
                                            style={{ padding: "5px 8px", fontSize: "0.75rem" }}
                                          >
                                            Not Conducted
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => handleRescheduleSession(s)}
                                        style={{ padding: "5px 8px", fontSize: "0.75rem" }}
                                      >
                                        Reschedule
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* TAB 3: QUALITY CHECKPOINTS */}
          {activeTab === "quality_gates" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Average Batch Feedback Summary */}
              <div className="glass-panel" style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "#e8f2fb",
                    color: "#0b5cab",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "0.75rem"
                  }}>
                    1
                  </div>
                  <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
                    Average Batch Feedback: Module & Session Feedback
                  </h4>
                </div>
                <p style={{ fontSize: "0.825rem", color: "var(--text-muted)", margin: "0 0 12px 0" }}>
                  Triggered at session completion. Captures student attendance and student feedback ratings (1.0 to 5.0).
                </p>

                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Average Batch Feedback Rating</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: 800, marginTop: 2 }}>
                      {activeBatch.batch_avg_feedback != null ? (
                        <span style={{ color: "#b45309" }}>{activeBatch.batch_avg_feedback} / 5.0</span>
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>No feedback submitted</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Delivery Progress</div>
                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: checkpoint1Progress.closed === checkpoint1Progress.planned ? "#16a34a" : "#0b5cab", marginTop: 2 }}>
                      {checkpoint1Progress.closed} / {checkpoint1Progress.planned}
                      {checkpoint1Progress.closed === checkpoint1Progress.planned && checkpoint1Progress.planned > 0 && (
                        <span style={{ fontSize: "0.7rem", marginLeft: 6, color: "#16a34a", fontWeight: 700 }}>✓ All Outcomes Recorded</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* NPS Closure Summary & Closure Action */}
              <div className="glass-panel" style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: "#f0fdf4",
                    color: "#16a34a",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 800,
                    fontSize: "0.75rem"
                  }}>
                    2
                  </div>
                  <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
                    NPS Closure: Final Batch NPS & Retrospective Closure
                  </h4>
                </div>
                <p style={{ fontSize: "0.825rem", color: "var(--text-muted)", margin: "0 0 14px 0" }}>
                  Enter the final promoter, passive and detractor response counts. The system calculates the NPS index and closes the batch.
                </p>

                 {activeBatch.status === "Completed" ? (
                   <div style={{
                     background: "#f0fdf4",
                     border: "1px solid #bbf7d0",
                     borderRadius: 6,
                     padding: "14px 16px"
                   }}>
                     <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#16a34a", fontWeight: 700 }}>
                       <CheckCircle2 size={16} />
                       <span>NPS Closure Completed & Batch Formally Closed</span>
                     </div>
                     <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
                       <div>
                         <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Final Batch NPS</div>
                         <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#16a34a" }}>
                           {activeBatch.batch_nps != null ? `${activeBatch.batch_nps > 0 ? "+" : ""}${activeBatch.batch_nps}` : "—"}
                         </div>
                       </div>
                       <div>
                         <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Total Responses</div>
                         <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--text-main)" }}>
                           {activeBatch.nps_total_responses ?? 0}
                         </div>
                       </div>
                       <div>
                         <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Promoters (9-10)</div>
                         <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#16a34a" }}>
                           {activeBatch.nps_promoters ?? 0}
                         </div>
                       </div>
                       <div>
                         <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Passives (7-8)</div>
                         <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "var(--text-main)" }}>
                           {activeBatch.nps_passives ?? 0}
                         </div>
                       </div>
                       <div>
                         <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Detractors (0-6)</div>
                         <div style={{ fontSize: "1.25rem", fontWeight: 800, color: "#b91c1c" }}>
                           {activeBatch.nps_detractors ?? 0}
                         </div>
                       </div>
                     </div>
                   </div>
                 ) : (
                   <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                     {activeBatch.batch_avg_feedback == null && (
                       <div style={{
                         background: "#fffbeb",
                         border: "1px solid #fde68a",
                         borderRadius: 6,
                         padding: "12px 14px",
                         display: "flex",
                         alignItems: "center",
                         gap: 8,
                         color: "#b45309",
                         fontSize: "0.82rem",
                         fontWeight: 600,
                       }}>
                         <Lock size={15} />
                         <span>Quality Checkpoint 1 requires at least one completed session with a feedback rating.</span>
                       </div>
                     )}
                     {activeBatch.batch_avg_feedback != null && !allSessionsTerminal && (
                       <div style={{
                         background: "#fffbeb",
                         border: "1px solid #fde68a",
                         borderRadius: 6,
                         padding: "12px 14px",
                         display: "flex",
                         alignItems: "center",
                         gap: 8,
                         color: "#b45309",
                         fontSize: "0.82rem",
                         fontWeight: 600,
                       }}>
                         <Lock size={15} />
                         <span>Every scheduled and logged session needs a terminal outcome before Gate 2 closure.</span>
                       </div>
                     )}
                     <button
                       onClick={() => setIsGate2ModalOpen(true)}
                       disabled={activeBatch.batch_avg_feedback == null || !allSessionsTerminal}
                       className="btn btn-primary"
                       style={{ display: "flex", alignItems: "center", gap: 6, opacity: activeBatch.batch_avg_feedback == null || !allSessionsTerminal ? 0.55 : 1 }}
                     >
                       <Sparkles size={16} />
                       <span>Execute NPS Closure (Close Batch)</span>
                     </button>
                   </div>
                 )}
              </div>
            </div>
          )}

        </div>

        {/* Drawer Footer Actions */}
        <div className="shrink-0 px-6 py-4 border-t flex flex-wrap items-center justify-between gap-4" style={{
          borderTop: "1px solid var(--border-subtle)",
          background: "#f8fafc",
        }}>
          <Button variant="outline" onClick={onClose}>
            Close Details
          </Button>

          <div className="flex flex-wrap items-center gap-3">
            {/* Batch Lifecycle Status Actions (OnHold / Cancelled / Resume) */}
            {activeBatch.status !== "Cancelled" && (
              <>
                {activeBatch.status !== "OnHold" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openStatusModal("OnHold")}
                    className="flex items-center gap-2"
                    style={{
                      color: "#b45309",
                      borderColor: "#fcd34d",
                      background: "#fffbeb",
                    }}
                    title="Place batch delivery on hold"
                  >
                    <PauseCircle size={15} color="#b45309" />
                    <span>Put On Hold</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openStatusModal("Resume")}
                    className="flex items-center gap-2"
                    style={{
                      color: "#059669",
                      borderColor: "#a7f3d0",
                      background: "#ecfdf5",
                    }}
                    title="Resume and reactivate batch"
                  >
                    <PlayCircle size={15} color="#059669" />
                    <span>Resume Batch</span>
                  </Button>
                )}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => openStatusModal("Cancelled")}
                  className="flex items-center gap-2"
                  style={{
                    color: "#b91c1c",
                    borderColor: "#fca5a5",
                    background: "#fef2f2",
                  }}
                  title="Cancel batch"
                >
                  <Ban size={15} color="#b91c1c" />
                  <span>Cancel Batch</span>
                </Button>
              </>
            )}

            {activeBatch.status === "Cancelled" && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => openStatusModal("Resume")}
                className="flex items-center gap-2"
                style={{
                  color: "#0b5cab",
                  borderColor: "#93c5fd",
                  background: "#eff6ff",
                }}
                title="Reopen cancelled batch"
              >
                <RefreshCw size={15} color="#0b5cab" />
                <span>Reopen Batch</span>
              </Button>
            )}

            {/* Edit Batch (Always available for active editing and post-approval adjustments) */}
            <Button
              onClick={openEditModal}
              variant="secondary"
              className="flex items-center gap-2"
            >
              <Edit3 size={15} />
              <span>Edit Batch</span>
            </Button>

            {canApprove && ["Requested", "Approval 1 Pending", "Approval 2 Pending"].includes(activeBatch.status) && onOpenApprove && (
              <Button
                onClick={() => {
                  onClose();
                  onOpenApprove(activeBatch);
                }}
                className="flex items-center gap-2"
                style={{ background: "linear-gradient(135deg, #0f7a5a 0%, #169570 100%)" }}
              >
                <CheckCircle2 size={16} />
                <span>Approve Batch</span>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>

      {/* Modal: Add Single Session */}
      <Dialog open={isAddSessionOpen} onOpenChange={(next) => { if (!next) setIsAddSessionOpen(false); }}>
        <DialogContent
          className="glass-panel max-h-[calc(100vh-32px)] gap-0 overflow-y-auto p-6 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 480, background: "#ffffff", borderRadius: 16 }}
        >
          <DialogHeader className="block space-y-0 border-b-0 p-0">
            <DialogTitle className="text-xl font-bold" style={{ color: "var(--text-main)" }}>
              Schedule Session
            </DialogTitle>
            <DialogDescription className="mb-4">
              Add a single delivery slot to <strong>{activeBatch.batch_id}</strong>.
            </DialogDescription>
          </DialogHeader>

          {sessionError && <ErrorBanner message={sessionError} className="mb-3.5" />}

          <form onSubmit={handleCreateSession} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Session Topic / Module *
                </label>
                <input
                  type="text"
                  value={sessionTopic}
                  onChange={(e) => setSessionTopic(e.target.value)}
                  placeholder="e.g. Day 1: Architecture & Containerization"
                  className="glass-input"
                  style={{ width: "100%" }}
                  required
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Date *
                  </label>
                  <input
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Duration (Hours) *
                  </label>
                  <input
                    type="number"
                    value={sessionHours}
                    onChange={(e) => setSessionHours(Number(e.target.value))}
                    min={1}
                    max={12}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={sessionStartTime}
                    onChange={(e) => setSessionStartTime(e.target.value)}
                    className="glass-input"
                    style={{ width: "100%" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    End Time
                  </label>
                  <input
                    type="time"
                    value={sessionEndTime}
                    onChange={(e) => setSessionEndTime(e.target.value)}
                    className="glass-input"
                    style={{ width: "100%" }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Assigned Faculty Name
                </label>
                <input
                  type="text"
                  value={sessionFacultyName}
                  onChange={(e) => setSessionFacultyName(e.target.value)}
                  placeholder={activeBatch.faculty_assigned_text || "e.g. Lead Trainer"}
                  className="glass-input"
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button type="button" onClick={() => setIsAddSessionOpen(false)} className="btn btn-secondary" style={{ padding: "8px 14px" }}>
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingSession} className="btn btn-primary" style={{ padding: "8px 14px" }}>
                  {isSubmittingSession ? "Scheduling..." : "Schedule Session"}
                </button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingScheduledSession} onOpenChange={(next) => { if (!next) setEditingScheduledSession(null); }}>
        <DialogContent
          className="glass-panel max-h-[calc(100vh-32px)] gap-0 overflow-y-auto p-6 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 520, background: "#ffffff", borderRadius: 16 }}
        >
          <DialogHeader className="block space-y-0 border-b-0 p-0">
            <DialogTitle className="text-lg font-bold" style={{ color: "var(--text-main)" }}>Edit Scheduled Session</DialogTitle>
            <DialogDescription className="mb-4">Correct any missing or incorrectly parsed timetable details.</DialogDescription>
          </DialogHeader>
          {scheduledEditError && <ErrorBanner message={scheduledEditError} className="mb-3" />}
          <form onSubmit={saveScheduledSessionEdit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Module / Topic *<input required value={scheduledEditForm.module} className="glass-input" style={{ width: "100%", marginTop: 4 }} onChange={(e) => setScheduledEditForm({ ...scheduledEditForm, module: e.target.value })} /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Date *<input required type="date" value={scheduledEditForm.session_date} className="glass-input" style={{ width: "100%", marginTop: 4 }} onChange={(e) => setScheduledEditForm({ ...scheduledEditForm, session_date: e.target.value })} /></label>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Hours *<input required type="number" min={1} max={24} value={scheduledEditForm.duration_hours} className="glass-input" style={{ width: "100%", marginTop: 4 }} onChange={(e) => setScheduledEditForm({ ...scheduledEditForm, duration_hours: Number(e.target.value) })} /></label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Start time<input type="time" value={scheduledEditForm.start_time} className="glass-input" style={{ width: "100%", marginTop: 4 }} onChange={(e) => setScheduledEditForm({ ...scheduledEditForm, start_time: e.target.value })} /></label>
                <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>End time<input type="time" value={scheduledEditForm.end_time} className="glass-input" style={{ width: "100%", marginTop: 4 }} onChange={(e) => setScheduledEditForm({ ...scheduledEditForm, end_time: e.target.value })} /></label>
              </div>
              <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Faculty<input value={scheduledEditForm.trainer_name} className="glass-input" style={{ width: "100%", marginTop: 4 }} onChange={(e) => setScheduledEditForm({ ...scheduledEditForm, trainer_name: e.target.value })} /></label>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button type="button" className="btn btn-secondary" onClick={() => setEditingScheduledSession(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={isSavingScheduledEdit}>{isSavingScheduledEdit ? "Saving..." : "Save Changes"}</button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Average Batch Feedback Completion */}
      <Dialog open={!!completingSession} onOpenChange={(next) => { if (!next) setCompletingSession(null); }}>
        <DialogContent
          className="glass-panel max-h-[calc(100vh-32px)] gap-0 overflow-y-auto p-6 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 460, background: "#ffffff", borderRadius: 16 }}
        >
          <DialogHeader className="block space-y-0 border-b-0 p-0">
            <DialogTitle className="text-xl font-bold" style={{ color: "var(--text-main)" }}>
              Average Batch Feedback: Complete Session
            </DialogTitle>
            <DialogDescription className="mb-4">
              Submit verified module feedback for <strong>{completingSession?.topic}</strong>.
            </DialogDescription>
          </DialogHeader>

          {gate1Error && <ErrorBanner message={gate1Error} className="mb-3.5" />}

          <form onSubmit={handleCompleteGate1} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Student Module Rating (1.0 to 5.0) *
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="5.0"
                  value={gate1Rating}
                  onChange={(e) => setGate1Rating(Number(e.target.value))}
                  className="glass-input"
                  style={{ width: "100%" }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Students Present
                </label>
                <input
                  type="number"
                  min="1"
                  value={gate1StudentsPresent}
                  onChange={(e) => setGate1StudentsPresent(Number(e.target.value))}
                  className="glass-input"
                  style={{ width: "100%" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Topic Feedback / Notes *
                </label>
                <textarea
                  value={gate1Feedback}
                  onChange={(e) => setGate1Feedback(e.target.value)}
                  placeholder="Student comprehension, lab completion notes..."
                  className="glass-input"
                  style={{ width: "100%", minHeight: 70, resize: "vertical" }}
                  required
                />
                <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4, display: "block" }}>
                  Add at least 3 characters before completing the session.
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => setCompletingSession(null)} className="btn btn-secondary" style={{ padding: "8px 14px" }}>
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingGate1 || gate1Feedback.trim().length < 3} className="btn btn-primary" style={{ padding: "8px 14px" }}>
                  {isSubmittingGate1 ? "Completing..." : "Submit Average Batch Feedback & Complete"}
                </button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* Modal: NPS Closure */}
      <Dialog open={isGate2ModalOpen} onOpenChange={(next) => { if (!next) setIsGate2ModalOpen(false); }}>
        <DialogContent
          className="glass-panel max-h-[calc(100vh-32px)] gap-0 overflow-y-auto p-6 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 500, background: "#ffffff", borderRadius: 16 }}
        >
          <DialogHeader className="block space-y-0 border-b-0 p-0">
            <DialogTitle className="text-xl font-bold" style={{ color: "var(--text-main)" }}>
              NPS Closure: Batch NPS Closure
            </DialogTitle>
            <DialogDescription className="mb-4">
              Finalize batch performance metrics and close <strong>{activeBatch.batch_id}</strong>.
            </DialogDescription>
          </DialogHeader>

          {gate2Error && <ErrorBanner message={gate2Error} className="mb-3.5" />}

          <form onSubmit={handleCloseBatchGate2} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* NPS Availability Toggle */}
            <div style={{ background: "#f8fafc", border: "1px solid var(--border-subtle)", borderRadius: 8, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-main)" }}>NPS Responses Available</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.8rem", fontWeight: 500, color: gate2NpsAvailable ? "#0b5cab" : "var(--text-muted)" }}>
                    <input
                      type="radio"
                      name="gate2-nps-available"
                      checked={gate2NpsAvailable}
                      onChange={() => setGate2NpsAvailable(true)}
                      style={{ accentColor: "#0b5cab", width: 16, height: 16 }}
                    />
                    Yes
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.8rem", fontWeight: 500, color: !gate2NpsAvailable ? "#b45309" : "var(--text-muted)" }}>
                    <input
                      type="radio"
                      name="gate2-nps-available"
                      checked={!gate2NpsAvailable}
                      onChange={() => { setGate2NpsAvailable(false); setGate2NpsReason(""); }}
                      style={{ accentColor: "#b45309", width: 16, height: 16 }}
                    />
                    Not Available
                  </label>
                </div>
              </div>
              <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: 0 }}>
                {gate2NpsAvailable
                  ? "Enter promoter, passive, and detractor counts to calculate the final NPS score."
                  : "Provide a reason why NPS responses are not available (minimum 3 characters)."}
              </p>
            </div>

            {/* NPS Available: Promoter/Passive/Detractor Inputs */}
            {gate2NpsAvailable && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Promoters (9-10)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={gate2Promoters}
                    onChange={(e) => setGate2Promoters(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  />
                  <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: "4px 0 0 0" }}>
                    Loyal brand advocates who are likely to recommend your product or service. Votes from 9-10.
                  </p>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Passives (7-8)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={gate2Passives}
                    onChange={(e) => setGate2Passives(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  />
                  <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: "4px 0 0 0" }}>
                    Satisfied but unenthusiastic customers who are vulnerable to competitive offerings. Votes from 7-8.
                  </p>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Detractors (0-6)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={gate2Detractors}
                    onChange={(e) => setGate2Detractors(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  />
                  <p style={{ fontSize: "0.7rem", color: "var(--text-dim)", margin: "4px 0 0 0" }}>
                    Unhappy customers who can damage your brand and impede growth through negative word-of-mouth. Votes from 0-6.
                  </p>
                </div>
              </div>
            )}

            {/* NPS Not Available: Reason Field */}
            {!gate2NpsAvailable && (
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Reason for NPS Unavailable <span style={{ color: "#e11d48" }}>*</span>
                </label>
                <textarea
                  value={gate2NpsReason}
                  onChange={(e) => setGate2NpsReason(e.target.value)}
                  placeholder="e.g. Survey not conducted, client declined, no responses received..."
                  className="glass-input"
                  style={{ width: "100%", minHeight: 80, resize: "vertical" }}
                  required
                  minLength={3}
                />
                <p style={{ fontSize: "0.7rem", color: gate2NpsReason.length > 0 && gate2NpsReason.length < 3 ? "#e11d48" : "var(--text-dim)", margin: "4px 0 0 0" }}>
                  {gate2NpsReason.length > 0 && gate2NpsReason.length < 3
                    ? "Reason must be at least 3 characters."
                    : "Minimum 3 characters required."}
                </p>
              </div>
            )}

            {/* Preview Section */}
            <div style={{ background: "#f8fafc", border: "1px solid var(--border-subtle)", borderRadius: 6, padding: "10px 12px", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {gate2NpsAvailable ? (
                gate2ResponseTotal === 0 ? (
                  <span style={{ color: "#b45309", fontWeight: 600 }}>
                    Enter at least one response to calculate the NPS.
                  </span>
                ) : (
                  <span>
                    Total responses <strong style={{ color: "var(--text-main)" }}>{gate2ResponseTotal}</strong>
                    {"  ·  "}Promoters <strong style={{ color: "var(--text-main)" }}>{gate2PromoterPct.toFixed(1)}%</strong>
                    {"  ·  "}Passives <strong style={{ color: "var(--text-main)" }}>{gate2PassivePct.toFixed(1)}%</strong>
                    {"  ·  "}Detractors <strong style={{ color: "var(--text-main)" }}>{gate2DetractorPct.toFixed(1)}%</strong>
                    {"  ·  "}NPS = promoters% − detractors% = <strong style={{ color: gate2NpsPreview >= 0 ? "#16a34a" : "#b91c1c" }}>{gate2NpsPreview > 0 ? "+" : ""}{gate2NpsPreview.toFixed(2)}</strong>
                  </span>
                )
              ) : (
                <span style={{ color: "#b45309", fontWeight: 600 }}>
                  {gate2NpsReason.trim().length >= 3
                    ? `NPS: Not Available — ${gate2NpsReason.trim()}`
                    : "NPS: Not Available (enter reason above)"}
                </span>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <button type="button" onClick={() => setIsGate2ModalOpen(false)} className="btn btn-secondary" style={{ padding: "8px 14px" }}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isSubmittingGate2 ||
                  (gate2NpsAvailable && gate2ResponseTotal === 0) ||
                  (!gate2NpsAvailable && gate2NpsReason.trim().length < 3)
                }
                className="btn btn-primary"
                style={{ padding: "8px 14px", background: "#16a34a" }}
              >
                {isSubmittingGate2 ? "Closing Batch..." : gate2NpsAvailable ? "Formally Close Batch (NPS Closure)" : "Formally Close Batch (NPS Not Available)"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Timetable Excel Ingestion & Conflict Engine */}
      <Dialog open={isIngestModalOpen} onOpenChange={(next) => { if (!next) setIsIngestModalOpen(false); }}>
        <DialogContent
          className="glass-panel flex max-h-[calc(100vh-32px)] flex-col gap-0 overflow-hidden p-6 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 760, background: "#ffffff", borderRadius: 16 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
            <DialogHeader className="block space-y-0 border-b-0 p-0">
              <DialogTitle className="text-xl font-bold" style={{ color: "var(--text-main)" }}>
                Workflow 2: Timetable Ingestion & Conflict Engine
              </DialogTitle>
              <DialogDescription className="mt-1">
                Upload `.xlsx` / `.csv` schedule, run dry-run conflict check, and batch schedule.
              </DialogDescription>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <a
                  href="/batch_schedule_january_2027.xlsx"
                  download="batch_schedule_january_2027.xlsx"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    color: "#1e40af",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    padding: "4px 10px",
                    borderRadius: 6,
                    textDecoration: "none",
                  }}
                >
                  <FileSpreadsheet size={14} color="#2563eb" />
                  <span>Download January 2027 Schedule Template (.xlsx)</span>
                </a>
              </div>
            </DialogHeader>
            <button
              onClick={() => setIsIngestModalOpen(false)}
              aria-label="Close timetable ingestion"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-dim)", flexShrink: 0 }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {ingestError && <ErrorBanner message={ingestError} className="mb-3" />}

          {/* File Upload Section */}
          {!hasParsedTimetable ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {ingestSummary && (
                  <div style={{
                    background: ingestSummary.extractedRows > 0 ? "#f0fdf4" : "#fff7ed",
                    border: `1px solid ${ingestSummary.extractedRows > 0 ? "#bbf7d0" : "#fed7aa"}`,
                    color: ingestSummary.extractedRows > 0 ? "#166534" : "#9a3412",
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontSize: "0.8rem",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700 }}>
                      {ingestSummary.extractedRows > 0 ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                      <span>{ingestSummary.message}</span>
                    </div>
                    <div style={{ marginTop: 5 }}>
                      Parsed {ingestSummary.extractedRows} row(s); skipped {ingestSummary.failedRows}.
                    </div>
                    {ingestSummary.errors.length > 0 && (
                      <ul style={{ margin: "6px 0 0 18px", padding: 0, maxHeight: 120, overflowY: "auto" }}>
                        {ingestSummary.errors.slice(0, 20).map((error, index) => <li key={index}>{error}</li>)}
                      </ul>
                    )}
                  </div>
                )}
                <form onSubmit={handleIngestFileSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{
                  border: "2px dashed var(--border-subtle)",
                  borderRadius: 8,
                  padding: "32px 20px",
                  textAlign: "center",
                  background: "#f8fafc",
                  cursor: "pointer"
                }}>
                  <Upload size={32} style={{ margin: "0 auto 10px", color: "#0b5cab" }} />
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)" }}>
                    {ingestFile ? ingestFile.name : "Select Timetable Spreadsheet"}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 6 }}>
                    {ingestFile ? `${(ingestFile.size / 1024 / 1024).toFixed(2)} MB selected` : "Excel or CSV, up to 10 MB"}
                  </div>
                  <label className="btn btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 14, cursor: "pointer" }}>
                    <FileSpreadsheet size={15} />
                    <span>{ingestFile ? "Choose another file" : "Browse files"}</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => {
                        const selected = e.target.files?.[0] || null;
                        if (selected && selected.size > 10 * 1024 * 1024) {
                          setIngestFile(null);
                          setIngestError("File is too large. Choose a timetable smaller than 10 MB.");
                          return;
                        }
                        setIngestFile(selected);
                        setIngestError(null);
                      }}
                      style={{ display: "none" }}
                      required
                    />
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" onClick={() => setIsIngestModalOpen(false)} className="btn btn-secondary">
                    Cancel
                  </button>
                  <button type="submit" disabled={!ingestFile || isIngesting} className="btn btn-primary">
                    {isIngesting ? "Extracting timetable..." : "Parse Timetable"}
                  </button>
                </div>
                </form>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", gap: 12 }}>
                {/* Extracted preview — a focused row-review table with no search,
                    filter, sort, column-visibility, export, or conflict-check chrome. */}
                <div style={{ padding: "14px 16px", background: "#f8fafc", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
                  <PanelTitle
                    title={`Extracted ${extractedRows.length} Delivery Slot${extractedRows.length === 1 ? "" : "s"}`}
                    description="Review every parsed row before scheduling. Correct any errors below before applying."
                  />
                </div>

                <div style={{ flex: 1, overflow: "auto", minHeight: 0, border: "1px solid var(--border-subtle)", borderRadius: 6, background: "#ffffff" }}>
                  <table className="glass-table w-full border-collapse" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                    <TableCaption>Rows parsed from the uploaded timetable file</TableCaption>
                    <thead>
                      <tr>
                        <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Date</PlainHeaderCell>
                        <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Topic</PlainHeaderCell>
                        <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Faculty</PlainHeaderCell>
                        <PlainHeaderCell style={{ ...TIMETABLE_TH_STYLE, textAlign: "center" }}>Hours</PlainHeaderCell>
                        <PlainHeaderCell style={TIMETABLE_TH_STYLE}>Action</PlainHeaderCell>
                      </tr>
                    </thead>
                    <tbody>
                      {timetableRows.length === 0 ? (
                        <TableStateRow colSpan={5}>
                          <EmptyState
                            icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
                            title="No schedule rows were extracted"
                            description="Check the column names and date values, then parse the file again."
                          />
                        </TableStateRow>
                      ) : (
                        timetableRows.map(({ row: r, index: i }) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                            <td style={{ ...TIMETABLE_TD_STYLE, fontWeight: 600 }}>
                              {editingParsedRow === i ? <input type="date" aria-label={`Date of training for parsed row ${i + 1}`} value={r.date_of_training.slice(0, 10)} className="glass-input" onChange={(e) => setExtractedRows(rows => rows.map((row, index) => index === i ? { ...row, date_of_training: e.target.value } : row))} /> : formatDate(r.date_of_training)}
                            </td>
                            <td style={TIMETABLE_TD_STYLE}>
                              {editingParsedRow === i ? <input aria-label={`Topic for parsed row ${i + 1}`} value={r.topic} className="glass-input" style={{ minWidth: 220 }} onChange={(e) => setExtractedRows(rows => rows.map((row, index) => index === i ? { ...row, topic: e.target.value } : row))} /> : r.topic}
                            </td>
                            <td style={TIMETABLE_TD_STYLE}>
                              {editingParsedRow === i ? <input aria-label={`Faculty for parsed row ${i + 1}`} value={r.faculty_name || ""} className="glass-input" onChange={(e) => setExtractedRows(rows => rows.map((row, index) => index === i ? { ...row, faculty_name: e.target.value } : row))} /> : r.faculty_name || "—"}
                            </td>
                            <td style={{ ...TIMETABLE_TD_STYLE, textAlign: "center" }}>
                              {editingParsedRow === i ? <input aria-label={`Hours for parsed row ${i + 1}`} type="number" min={1} max={24} value={r.no_of_hours} className="glass-input" style={{ width: 72 }} onChange={(e) => setExtractedRows(rows => rows.map((row, index) => index === i ? { ...row, no_of_hours: Number(e.target.value) } : row))} /> : `${r.no_of_hours}h`}
                            </td>
                            <td style={TIMETABLE_TD_STYLE}>
                              <button type="button" className="btn btn-secondary" style={{ padding: "5px 9px", display: "inline-flex", alignItems: "center", gap: 4 }} onClick={() => { setEditingParsedRow(editingParsedRow === i ? null : i); setHasValidated(false); setValidationConflicts([]); }}>
                                {editingParsedRow === i ? <Check size={13} aria-hidden="true" /> : <Edit3 size={13} aria-hidden="true" />}
                                {editingParsedRow === i ? "Done" : "Edit"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: "5px 9px", display: "inline-flex", alignItems: "center", gap: 4 }}
                                aria-label={`Delete timetable row ${i + 1}`}
                                onClick={() => removeExtractedScheduleRow(i)}
                              >
                                <Trash2 size={13} aria-hidden="true" />
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      setExtractedRows([]);
                      setHasParsedTimetable(false);
                      setHasValidated(false);
                      setValidationConflicts([]);
                    }}
                    className="btn btn-secondary"
                  >
                    Back to Upload
                  </button>
                  <button
                    onClick={handleApplyExtractedSchedule}
                    disabled={isApplyingSchedule}
                    className="btn btn-primary"
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Check size={16} />
                    <span>{isApplyingSchedule ? "Scheduling..." : "Apply & Schedule All"}</span>
                  </button>
                </div>
              </div>
            )}
        </DialogContent>
      </Dialog>

      {/* Modal: Edit Batch */}
      <Dialog open={isEditModalOpen} onOpenChange={(next) => { if (!next) setIsEditModalOpen(false); }}>
        <DialogContent
          className="glass-panel max-h-[calc(100vh-32px)] gap-0 overflow-y-auto p-6 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 660, background: "#ffffff", borderRadius: 16 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
            <DialogHeader className="block space-y-0 border-b-0 p-0">
              <DialogTitle className="text-xl font-bold" style={{ color: "var(--text-main)" }}>
                Edit Batch Details
              </DialogTitle>
              <DialogDescription className="mt-1">
                Modifying <strong>{activeBatch.batch_id}</strong>
              </DialogDescription>
            </DialogHeader>
            <button
              onClick={() => setIsEditModalOpen(false)}
              aria-label="Close edit batch"
              style={{ background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, flexShrink: 0 }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {editError && <ErrorBanner message={editError} className="mb-3.5" />}

            <form onSubmit={handleSaveEdit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Curriculum / Program Title *
                </label>
                <input
                  type="text"
                  value={editForm.program_name || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, program_name: e.target.value }))}
                  className="glass-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Client Account Name *
                </label>
                <input
                  type="text"
                  value={editForm.client_name || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, client_name: e.target.value }))}
                  className="glass-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Client SOW / PO Number *
                </label>
                <input
                  type="text"
                  value={editForm.sow_number || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, sow_number: e.target.value }))}
                  className="glass-input"
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Technology Domain
                </label>
                <input
                  type="text"
                  value={editForm.domain || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, domain: e.target.value }))}
                  className="glass-input"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Technology Stack
                </label>
                <input
                  type="text"
                  value={editForm.technology || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, technology: e.target.value }))}
                  className="glass-input"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Delivery Mode
                </label>
                <select
                  value={editForm.delivery_mode || "Online"}
                  onChange={(e) => {
                    const selectedName = e.target.value;
                    const matched = options.delivery_modes.find((m) => m.name === selectedName);
                    setEditForm((prev) => ({
                      ...prev,
                      delivery_mode: selectedName,
                      delivery_mode_id: matched ? matched.id : prev.delivery_mode_id,
                    }));
                  }}
                  className="glass-input"
                >
                  {options.delivery_modes.length > 0 ? (
                    options.delivery_modes.map((mode) => (
                      <option key={mode.id} value={mode.name}>
                        {mode.name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="Online">Online</option>
                      <option value="F2F">F2F</option>
                      <option value="Blended">Blended</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Training Venue / City
                </label>
                <input
                  type="text"
                  value={editForm.location_city || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, location_city: e.target.value }))}
                  className="glass-input"
                  placeholder="e.g. Bengaluru"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Commencement Date
                </label>
                <input
                  type="date"
                  value={editForm.start_date || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, start_date: e.target.value }))}
                  className="glass-input"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Conclusion Date
                </label>
                <input
                  type="date"
                  value={editForm.end_date || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, end_date: e.target.value }))}
                  className="glass-input"
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Active Training Days
                </label>
                <input
                  type="number"
                  value={editForm.training_days || 0}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, training_days: Number(e.target.value) }))}
                  className="glass-input"
                  min={0}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Total Training Hours
                </label>
                <input
                  type="number"
                  value={editForm.total_hours || 0}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, total_hours: Number(e.target.value) }))}
                  className="glass-input"
                  min={0}
                  step={0.5}
                />
              </div>

              {isReducingEndDate && (
                <div style={{ gridColumn: "1 / -1", background: "#f8fafc", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: "12px 14px" }}>
                  {editEndDateBlockers.length > 0 ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", fontWeight: 700, color: "var(--text-main)" }}>
                        <AlertTriangle size={15} aria-hidden="true" style={{ color: "#b45309" }} />
                        Conclusion date is being reduced
                      </div>
                      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "6px 0 10px" }}>
                        {editEndDateBlockers.length} scheduled session(s) fall after {formatDate(editForm.end_date)} and must be
                        deleted before the batch end date can be reduced.
                      </p>
                      <div style={{ maxHeight: 150, overflowY: "auto", display: "grid", gap: 6 }}>
                        {editEndDateBlockers.map((session) => {
                          const deletable = session.status !== "Completed" && !session.utilization_logged;
                          return (
                            <div
                              key={session.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                                fontSize: "0.78rem",
                                background: "#ffffff",
                                border: "1px solid var(--border-subtle)",
                                borderRadius: 8,
                                padding: "6px 10px",
                              }}
                            >
                              <span style={{ color: "var(--text-main)", fontWeight: 600 }}>
                                {formatDate(session.session_date)} · {session.module}
                                {session.trainer_name ? ` · ${session.trainer_name}` : ""}
                              </span>
                              {!deletable && (
                                <span style={{ color: "#b45309", fontWeight: 600, whiteSpace: "nowrap" }}>
                                  Already delivered — cannot be deleted
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {deletableBlockers.length < editEndDateBlockers.length && (
                        <p style={{ fontSize: "0.75rem", color: "#b45309", margin: "8px 0 0" }}>
                          Completed or delivered sessions cannot be deleted; the end date cannot move past them.
                        </p>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={deletableBlockers.length === 0 || isDeletingBlockers}
                          onClick={handleDeleteOutOfWindowSessions}
                        >
                          {isDeletingBlockers ? "Deleting..." : `Delete ${deletableBlockers.length} sessions`}
                        </button>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
                          To keep a session, reschedule it into the window from the Curriculum Schedule tab instead.
                        </span>
                      </div>
                      {blockerDeleteError && <ErrorBanner message={blockerDeleteError} className="mt-2" />}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--text-main)" }}>
                        Conclusion date is being reduced
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                          Match the schedule: {remainingInWindowSessions.length} training days, {suggestedWindowHours} hours
                        </span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => setEditForm((prev) => ({
                            ...prev,
                            training_days: remainingInWindowSessions.length,
                            total_hours: suggestedWindowHours,
                          }))}
                        >
                          Apply
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Total Candidate Headcount
                </label>
                <input
                  type="number"
                  value={editForm.total_enrollments || 0}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, total_enrollments: Number(e.target.value) }))}
                  className="glass-input"
                  min={1}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Proposed Faculty Member(s)
                </label>
                <input
                  type="text"
                  value={editForm.faculty_assigned_text || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, faculty_assigned_text: e.target.value }))}
                  placeholder="e.g. Dr. Srinivas Rao, Ananya Sharma"
                  className="glass-input"
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Operational Remarks
                </label>
                <textarea
                  value={editForm.remarks || ""}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, remarks: e.target.value }))}
                  rows={2}
                  className="glass-input"
                  style={{ resize: "vertical" }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit || editEndDateBlockers.length > 0}
                  className="btn btn-primary"
                >
                  {isSavingEdit ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Batch Lifecycle Status Transition (OnHold / Cancelled / Resume) */}
      <Dialog open={isStatusModalOpen} onOpenChange={(next) => { if (!next) setIsStatusModalOpen(false); }}>
        <DialogContent
          className="glass-panel max-h-[calc(100vh-32px)] gap-0 overflow-y-auto p-0 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 490, background: "#ffffff", borderRadius: 14 }}
        >
            {/* Modal Header */}
          <div style={{
            padding: "18px 22px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            background: targetStatus === "Cancelled" ? "#fef2f2" : targetStatus === "OnHold" ? "#fffbeb" : "#f0fdf4",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {targetStatus === "Cancelled" ? (
                <Ban size={22} color="#e11d48" aria-hidden="true" />
              ) : targetStatus === "OnHold" ? (
                <PauseCircle size={22} color="#d97706" aria-hidden="true" />
              ) : (
                <PlayCircle size={22} color="#16a34a" aria-hidden="true" />
              )}
              <DialogHeader className="block space-y-0 border-b-0 p-0">
                <DialogTitle className="text-base font-bold" style={{ color: "var(--text-main)" }}>
                  {targetStatus === "Cancelled" ? "Cancel Batch" : targetStatus === "OnHold" ? "Put Batch On Hold" : "Reactivate / Resume Batch"}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs">
                  Batch Reference: <strong>{activeBatch.batch_id}</strong>
                </DialogDescription>
              </DialogHeader>
            </div>
            <button
              type="button"
              onClick={() => setIsStatusModalOpen(false)}
              aria-label="Close status change"
              style={{ background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, flexShrink: 0 }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {/* Modal Form */}
          <form onSubmit={handleSaveStatus} style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
            {statusError && <ErrorBanner message={statusError} />}

              <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
                {targetStatus === "Cancelled" ? (
                  <span>
                    Are you sure you want to cancel this batch? This will halt operations and record an official cancellation note.
                  </span>
                ) : targetStatus === "OnHold" ? (
                  <span>
                    Placing this batch on hold will pause delivery milestones and notify coordinators and managers.
                  </span>
                ) : (
                  <span>
                    Resuming this batch will continue its workflow at <strong>{targetStatus}</strong>.
                  </span>
                )}
              </div>

              {targetStatus !== "OnHold" && targetStatus !== "Cancelled" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                    Target Resumed Status *
                  </label>
                  <select
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value)}
                    className="glass-input"
                    style={{ width: "100%" }}
                  >
                    {activeBatch.approver_1_status !== "Approved" && (
                      <option value="Approval 1 Pending">Approval 1 Pending (Approver 1 Review)</option>
                    )}
                    {activeBatch.approver_1_status === "Approved" && activeBatch.approver_2_status !== "Approved" && (
                      <option value="Approval 2 Pending">Approval 2 Pending (Approver 2 Review)</option>
                    )}
                    {activeBatch.approver_1_status === "Approved" && activeBatch.approver_2_status === "Approved" && (
                      <>
                        <option value="Approved">Approved</option>
                        <option value="Upcoming">Upcoming</option>
                        <option value="Ongoing">Ongoing</option>
                      </>
                    )}
                    {(activeBatch.approver_1_status === "Rejected" || activeBatch.approver_2_status === "Rejected") && (
                      <option value="Requested">Requested (Revisions Needed)</option>
                    )}
                  </select>
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>
                  Reason / Justification *
                </label>
                <textarea
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  placeholder={
                    targetStatus === "Cancelled"
                      ? "e.g. Client cancelled training contract due to internal budget reallocation..."
                      : targetStatus === "OnHold"
                      ? "e.g. Client requested start date deferral until curriculum revision is finalized..."
                      : "e.g. Client confirmed new schedule and faculty availability verified..."
                  }
                  rows={3}
                  className="glass-input"
                  style={{ width: "100%", resize: "vertical" }}
                  required
                />
                <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4, display: "block" }}>
                  A clear reason (minimum 3 characters) is required for audit and governance compliance.
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--border-subtle)" }}>
              <button
                type="button"
                onClick={() => setIsStatusModalOpen(false)}
                className="btn btn-secondary"
                style={{ padding: "8px 14px", fontSize: "0.85rem" }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmittingStatus || statusReason.trim().length < 3}
                className="btn btn-primary"
                style={{
                  padding: "8px 16px",
                  fontSize: "0.85rem",
                  background: targetStatus === "Cancelled" ? "#e11d48" : targetStatus === "OnHold" ? "#d97706" : "#059669",
                }}
              >
                {isSubmittingStatus ? "Saving..." : targetStatus === "Cancelled" ? "Confirm Cancellation" : targetStatus === "OnHold" ? "Confirm On Hold" : "Confirm Resume"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Log Faculty Utilization on Session Day */}
      {/* This dialog renders in a portal above the drawer, so no press inside it can
          reach the drawer's dismiss layer — the previous hand-rolled overlay was a
          sibling of the drawer panel and every field press unmounted the whole drawer,
          including the native popups (faculty datalist, selects, date and time pickers)
          whose presses on Windows land outside the field. Backdrop presses are refused
          outright so a stray click cannot throw away a half-filled timesheet; X, Cancel
          and Escape all route through the discard guard instead. */}
      <Dialog
        open={isLogUtilizationOpen && !!selectedScheduleDay}
        onOpenChange={(next) => { if (!next) closeUtilModal(); }}
      >
        <DialogContent
          className="glass-panel flex max-h-[calc(100vh-32px)] flex-col gap-0 overflow-hidden p-0 [&>button]:hidden"
          style={{ width: "100%", maxWidth: 720, background: "#ffffff", borderRadius: 14 }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          {/* Modal Header */}
          <div
            style={{
              padding: "16px 22px",
              borderBottom: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: "#f8fafc",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: "#eff6ff",
                  color: "#2563eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Calendar size={20} aria-hidden="true" />
              </div>
              <DialogHeader className="block min-w-0 space-y-0 border-b-0 p-0">
                <DialogTitle className="text-base font-bold" style={{ color: "var(--text-main)" }}>
                  Log Faculty Utilization
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs">
                  Day {selectedScheduleDay ? getSequenceNumber(selectedScheduleDay) : "—"} &bull; {formatDate(selectedScheduleDay?.session_date)}
                  {selectedScheduleDay && activeBatch?.start_date ? ` • ${computeWeek(activeBatch.start_date, selectedScheduleDay.session_date)}` : ""}
                  {activeBatch?.batch_id ? ` • ${activeBatch.batch_id}` : ""}
                </DialogDescription>
              </DialogHeader>
            </div>
            <button
              type="button"
              onClick={() => closeUtilModal()}
              aria-label="Close log utilization dialog"
              style={{ background: "transparent", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: 4, flexShrink: 0 }}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>

          {/* Scrollable body. The submit button lives in the sticky footer and
              targets this form, so Enter-to-submit still works. */}
          <form
            id="log-utilization-form"
            onSubmit={handleLogUtilizationSubmit}
            style={{ overflowY: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16, flex: 1, minHeight: 0 }}
          >
            {utilError && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ErrorBanner message={utilError} />
                {utilConflicts.length > 0 && (
                  <ErrorBanner message={utilConflicts.join("  •  ")} />
                )}
              </div>
)}

              {/* Batch context, read-only. These are facts about the batch, so the
                  ledger resolves them through the relationship rather than asking
                  the coordinator to retype them on every delivery. */}
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: "0.825rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px 16px" }}>
                  {[
                    ["Batch ID", activeBatch?.batch_id],
                    ["Client", activeBatch?.client_name],
                    ["Category", activeBatch?.category],
                    ["Vertical", utilVertical || "— set below —"],
                    ["Coordinator", activeBatch?.coordinator?.full_name || "Unassigned"],
                  ].map(([label, value]) => (
                    <div key={label as string} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#1d4ed8", fontWeight: 700 }}>
                        {label}
                      </div>
                      <div style={{ color: "#1e293b", fontWeight: 600, overflowWrap: "anywhere" }}>
                        {value || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Planned values, read-only. Everything below is the actual delivery. */}
              <div style={{ padding: "12px 14px", borderRadius: 8, background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: "0.825rem" }}>
                <div style={{ fontWeight: 700, color: "#475569", textTransform: "uppercase", fontSize: "0.7rem", letterSpacing: "0.05em" }}>
                  Planned &mdash; from the timetable
                </div>
                <div style={{ color: "#1e293b", fontWeight: 600, marginTop: 4 }}>
                  {selectedScheduleDay?.module || "—"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 5, color: "#475569", fontSize: "0.775rem" }}>
                  <span>Trainer: <strong>{selectedScheduleDay?.trainer_name || activeBatch?.faculty_assigned_text || "Unassigned"}</strong></span>
                  <span>&bull;</span>
                  <span>Hours: <strong>{selectedScheduleDay?.duration_hours}</strong></span>
                  <span>&bull;</span>
                  <span>
                    Window: <strong>{utilStartTime}&ndash;{utilEndTime}</strong>
                  </span>
                </div>
              </div>

              {/* Delivery */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label htmlFor="util-topic" style={UTIL_LABEL}>
                    Training Topic / Module *
                  </label>
                  <input
                    id="util-topic"
                    ref={utilTopicRef}
                    type="text"
                    value={utilTopic}
                    onChange={(e) => { setUtilTopic(e.target.value); markUtilDirty(); }}
                    placeholder={selectedScheduleDay?.module || "Topic delivered"}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  />
                </div>

                <div>
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label htmlFor="util-date" style={UTIL_LABEL}>Training Date *</label>
                      <input
                        id="util-date"
                        type="date"
                        value={utilDate}
                        onChange={(e) => { setUtilDate(e.target.value); markUtilDirty(); }}
                        className="glass-input"
                        style={{ width: "100%" }}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="util-start" style={UTIL_LABEL}>Start Time *</label>
                      <input
                        id="util-start"
                        type="time"
                        value={utilStartTime}
                        onChange={(e) => { setUtilStartTime(e.target.value); markUtilDirty(); }}
                        className="glass-input"
                        style={{ width: "100%" }}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="util-end" style={UTIL_LABEL}>End Time *</label>
                      <input
                        id="util-end"
                        type="time"
                        value={utilEndTime}
                        onChange={(e) => { setUtilEndTime(e.target.value); markUtilDirty(); }}
                        className="glass-input"
                        style={{ width: "100%" }}
                        aria-invalid={Boolean(utilTimeError)}
                        required
                      />
                    </div>
                  </div>
                  {utilTimeError && (
                    <div style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 5, display: "flex", alignItems: "center", gap: 5 }}>
                      <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                      {utilTimeError}
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="util-hours" style={UTIL_LABEL}>Actual Hours Delivered *</label>
                  <input
                    id="util-hours"
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="24"
                    value={utilHours}
                    onChange={(e) => { setUtilHours(parseFloat(e.target.value) || 0); markUtilDirty(); }}
                    className="glass-input"
                    style={{ width: 160 }}
                    required
                  />
                  <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginLeft: 8 }}>
                    Partial days are fine &mdash; log the hours actually delivered.
                  </span>
                </div>

                <div>
                  <label htmlFor="util-faculty" style={UTIL_LABEL}>Actual Faculty / Trainer *</label>
                  <input
                    id="util-faculty"
                    type="text"
                    list="util-faculty-options"
                    value={utilFacultyName}
                    onChange={(e) => { setUtilFacultyName(e.target.value); markUtilDirty(); }}
                    placeholder="Start typing a trainer name"
                    className="glass-input"
                    style={{ width: "100%" }}
                    autoComplete="off"
                    required
                  />
                  <datalist id="util-faculty-options">
                    {facultyNameSuggestions.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4, display: "block" }}>
                    {facultyNameSuggestions.length > 0
                      ? "Pick an existing trainer where possible — a new spelling creates a separate trainer in the ledger."
                      : "No existing trainers found. This name will be added to the ledger as typed."}
                  </span>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="util-faculty-type" style={UTIL_LABEL}>Faculty Type *</label>
                    <select
                      id="util-faculty-type"
                      value={utilFacultyTypeId}
                      onChange={(e) => { setUtilFacultyTypeId(e.target.value); markUtilDirty(); }}
                      className="glass-input"
                      style={{ width: "100%" }}
                      required
                    >
                      <option value="" disabled>Select Faculty Type</option>
                      {options.faculty_types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    {options.faculty_types.length === 0 && (
                      <span style={{ fontSize: "0.72rem", color: "#b45309", marginTop: 4, display: "block" }}>
                        No faculty types configured. An admin can add them in Settings.
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="util-program-type" style={UTIL_LABEL}>Program Type *</label>
                    <select
                      id="util-program-type"
                      value={utilProgramTypeId}
                      onChange={(e) => { setUtilProgramTypeId(e.target.value); markUtilDirty(); }}
                      className="glass-input"
                      style={{ width: "100%" }}
                      required
                    >
                      <option value="">Select Program Type</option>
                      {options.program_types.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    {options.program_types.length === 0 && (
                      <span style={{ fontSize: "0.72rem", color: "#b91c1c", marginTop: 4, display: "block" }}>
                        No program types configured. An admin must add one in Settings before utilization can be logged.
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="util-vertical" style={UTIL_LABEL}>Vertical *</label>
                    <select
                      id="util-vertical"
                      value={utilVertical}
                      onChange={(e) => { setUtilVertical(e.target.value); markUtilDirty(); }}
                      className="glass-input"
                      style={{ width: "100%" }}
                      required
                    >
                      <option value="">Select Vertical</option>
                      {options.verticals.map((v) => (
                        <option key={v.id} value={v.name}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    {options.verticals.length === 0 && (
                      <span style={{ fontSize: "0.72rem", color: "#b91c1c", marginTop: 4, display: "block" }}>
                        No verticals configured. An admin must add one in Settings before utilization can be logged.
                      </span>
                    )}
                  </div>

                  <div>
                    <label htmlFor="util-coordinator" style={UTIL_LABEL}>Coordinator</label>
                    <select
                      id="util-coordinator"
                      value={utilCoordinatorId}
                      onChange={(e) => { setUtilCoordinatorId(e.target.value); markUtilDirty(); }}
                      className="glass-input"
                      style={{ width: "100%" }}
                    >
                      <option value="">Select Coordinator (Optional)</option>
                      {options.coordinators.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.full_name}
                        </option>
                      ))}
                    </select>
                    {options.coordinators.length === 0 && (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: 4, display: "block" }}>
                        No coordinators available
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label htmlFor="util-mode" style={UTIL_LABEL}>Delivery Mode *</label>
                    <select
                      id="util-mode"
                      value={utilDeliveryMode}
                      onChange={(e) => { setUtilDeliveryMode(e.target.value); markUtilDirty(); }}
                      className="glass-input"
                      style={{ width: "100%" }}
                      required
                    >
                      {options.delivery_modes.length > 0 ? (
                        options.delivery_modes.map((m) => (
                          <option key={m.id} value={m.name}>{m.name}</option>
                        ))
                      ) : (
                        <>
                          <option value="Online">Online</option>
                          <option value="F2F">F2F</option>
                          <option value="Blended">Blended</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="util-city" style={UTIL_LABEL}>Location City</label>
                    <input
                      id="util-city"
                      type="text"
                      value={utilCity}
                      onChange={(e) => { setUtilCity(e.target.value); markUtilDirty(); }}
                      placeholder="e.g. Bengaluru"
                      className="glass-input"
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="util-venue" style={UTIL_LABEL}>Venue / Room</label>
                  <input
                    id="util-venue"
                    type="text"
                    value={utilVenue}
                    onChange={(e) => { setUtilVenue(e.target.value); markUtilDirty(); }}
                    placeholder="e.g. Lab 3, or the meeting link for online delivery"
                    className="glass-input"
                    style={{ width: "100%" }}
                  />
                </div>

                <div>
                  <label htmlFor="util-status" style={UTIL_LABEL}>Delivery Status *</label>
                  <select
                    id="util-status"
                    value={utilStatus}
                    onChange={(e) => { setUtilStatus(e.target.value); markUtilDirty(); }}
                    className="glass-input"
                    style={{ width: "100%" }}
                    required
                  >
                    <option value="Scheduled">Scheduled</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              {/* Feedback */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                <div>
                  <span style={UTIL_LABEL}>Was Feedback Collected? *</span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {(["yes", "no"] as const).map((value) => {
                      const selected = utilFeedbackCollected === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => { setUtilFeedbackCollected(value); markUtilDirty(); }}
                          aria-pressed={selected}
                          style={{
                            padding: "7px 16px",
                            borderRadius: 8,
                            border: `1px solid ${selected ? "#0b5cab" : "var(--border-subtle)"}`,
                            background: selected ? "#e8f2fb" : "#ffffff",
                            color: selected ? "#0b5cab" : "var(--text-main)",
                            fontWeight: selected ? 700 : 500,
                            fontSize: "0.85rem",
                            cursor: "pointer",
                          }}
                        >
                          {value === "yes" ? "Yes" : "No"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {utilFeedbackCollected === "yes" && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, alignItems: "start" }}>
                      <div>
                        <label htmlFor="util-rating" style={UTIL_LABEL}>Rating (1-5)</label>
                        <select
                          id="util-rating"
                          value={utilFeedbackRating}
                          onChange={(e) => { setUtilFeedbackRating(e.target.value); markUtilDirty(); }}
                          className="glass-input"
                          style={{ width: "100%" }}
                        >
                          <option value="">Not rated</option>
                          {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1].map((score) => (
                            <option key={score} value={score.toFixed(2)}>{score.toFixed(2)}</option>
                          ))}
                        </select>
                        <span style={UTIL_HINT}>Feeds the batch average.</span>
                      </div>
                      <div>
                        <label htmlFor="util-module-feedback" style={UTIL_LABEL}>Module Feedback</label>
                        <textarea
                          id="util-module-feedback"
                          value={utilFeedbackNotes}
                          onChange={(e) => { setUtilFeedbackNotes(e.target.value); markUtilDirty(); }}
                          placeholder="Feedback on the module delivered: learner uptake, observations, anything for audit review"
                          className="glass-input"
                          style={{ width: "100%", minHeight: 72, resize: "vertical" }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </form>

            {/* Sticky footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 10,
                padding: "14px 22px",
                borderTop: "1px solid var(--border-subtle)",
                background: "#f8fafc",
                flexShrink: 0,
              }}
            >
              {showDiscardPrompt ? (
                <>
                  <span style={{ fontSize: "0.825rem", color: "#b45309", fontWeight: 600, marginRight: "auto" }}>
                    Discard the changes you made?
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowDiscardPrompt(false)}
                    className="btn btn-secondary"
                    style={{ padding: "8px 14px", fontSize: "0.85rem" }}
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    onClick={() => closeUtilModal(true)}
                    className="btn btn-primary"
                    style={{ padding: "8px 14px", fontSize: "0.85rem", background: "#b91c1c", borderColor: "#b91c1c" }}
                  >
                    Discard
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => closeUtilModal()}
                    className="btn btn-secondary"
                    style={{ padding: "8px 14px", fontSize: "0.85rem" }}
                    disabled={isSubmittingUtil}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    form="log-utilization-form"
                    disabled={isSubmittingUtil || Boolean(utilTimeError) || options.verticals.length === 0 || options.program_types.length === 0 || options.faculty_types.length === 0}
                    className="btn btn-primary"
                    style={{ padding: "8px 18px", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    {isSubmittingUtil ? "Saving..." : "Save Faculty Utilization"}
                  </button>
                </>
              )}
            </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
