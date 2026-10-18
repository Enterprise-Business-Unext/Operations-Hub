"use client";

import React, { useState, useMemo } from "react";
import {
  TrendingDown, Users, Briefcase, Clock, CheckCircle2,
  AlertTriangle, BarChart3, Calendar, Target, Award, Activity,
  RefreshCw, Shield, PieChart, MapPin, Search, Layers,
  BarChart2, LineChart
} from "lucide-react";
import { Batch, User, ManagerDashboardSummary, TrainingSession } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/dateUtils";
import { PaginationControls } from "./PaginationControls";
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
import { Button } from "@/components/ui/button";
import {
  CountBadge,
  EmptyState,
  NAVBAR_HEIGHT,
  PanelTitle,
  TABLE_TH_STYLE,
} from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/statusBadge";
import { useTableSort } from "@/hooks/useTableSort";
import { useTableFilters } from "@/hooks/useTableFilters";
import { useColumnVisibility, type UseColumnVisibilityResult } from "@/hooks/useColumnVisibility";
import { reviveNumber, usePersistentState } from "@/hooks/usePersistentState";
import {
  buildFilterFields,
  buildSearchAccessor,
  buildSortAccessors,
  buildSortOptions,
  isSortable,
  type TableColumnDef,
} from "@/lib/tableColumns";
import type { CsvColumn } from "@/lib/csv";

interface EnterpriseDashboardProps {
  batches: Batch[];
  users: User[];
  dashboardSummary: ManagerDashboardSummary | null;
  isLoading: boolean;
  currentUser?: User | null;
  facultyUtilizationLedger?: TrainingSession[];
}

type TimePeriod = "daily" | "weekly" | "monthly" | "quarterly" | "all";

const PERIOD_LABELS: Record<TimePeriod, string> = {
  daily: "Today",
  weekly: "This Week",
  monthly: "This Month",
  quarterly: "This Quarter",
  all: "All Time",
};

function parseBatchDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/** Today's date in IST (UTC+5:30) as YYYY-MM-DD, for filtering sessions by training date. */
function istTodayIso(): string {
  const d = new Date(Date.now() + 330 * 60000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function computePeriodRange(period: TimePeriod): { from: Date; to: Date } {
  const now = new Date();
  let from = new Date(now);
  let to = new Date(now);

  if (period === "daily") {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
  } else if (period === "weekly") {
    // Current week: from Monday to Sunday 23:59:59
    const day = now.getDay();
    const diffToMonday = (day + 6) % 7;
    from.setDate(now.getDate() - diffToMonday);
    from.setHours(0, 0, 0, 0);
    to = new Date(from);
    to.setDate(from.getDate() + 6);
    to.setHours(23, 59, 59, 999);
  } else if (period === "monthly") {
    // Current month: 1st of month to last day of month 23:59:59
    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (period === "quarterly") {
    // Current quarter: 1st of quarter to last day of quarter 23:59:59
    const q = Math.floor(now.getMonth() / 3);
    from = new Date(now.getFullYear(), q * 3, 1, 0, 0, 0, 0);
    to = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
  } else {
    from = new Date(2000, 0, 1, 0, 0, 0, 0);
    to = new Date(2099, 11, 31, 23, 59, 59, 999);
  }
  return { from, to };
}

// `isBatchInPeriod` runs five times per batch per render, and a horizon window
// only moves at a day boundary, so each window is built once and rebuilt as soon
// as the cached one stops covering today.
const PERIOD_RANGE_CACHE = new Map<TimePeriod, { from: Date; to: Date }>();

function getPeriodRange(period: TimePeriod): { from: Date; to: Date } {
  const cached = PERIOD_RANGE_CACHE.get(period);
  const now = Date.now();
  if (cached && cached.from.getTime() <= now && now <= cached.to.getTime()) return cached;
  const range = computePeriodRange(period);
  PERIOD_RANGE_CACHE.set(period, range);
  return range;
}

function isBatchInPeriod(batch: Batch, period: TimePeriod): boolean {
  if (period === "all") return true;
  const { from, to } = getPeriodRange(period);

  const start = parseBatchDate(batch.start_date);
  const end = parseBatchDate(batch.end_date);

  // If start and end date exist, check if operational delivery window overlaps [from, to]
  if (start && end) {
    return start <= to && end >= from;
  }
  if (start) {
    return start >= from && start <= to;
  }
  const created = parseBatchDate(batch.created_at);
  if (created) {
    return created >= from && created <= to;
  }
  return false;
}


/** Alpha tint of any CSS colour, so a palette entry can also be a theme token. */
function tint(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}

function KpiCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="glass-panel"
      style={{
        padding: "18px 20px",
        borderLeft: `4px solid ${color}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          {label}
        </div>
        <div style={{ background: tint(color, 0.09), color, borderRadius: 8, padding: "5px 6px", display: "flex" }}>
          <Icon size={14} aria-hidden="true" />
        </div>
      </div>
      <div style={{ fontSize: "2rem", fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

/**
 * Single implementation of the three hand-rolled option strips on this view
 * (horizon, team-analytics tab, workload tab). They previously differed in
 * padding, radius and accent, and exposed no pressed state at all.
 */
function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", gap: 4, background: "var(--color-muted)", borderRadius: 8, padding: 4, flexWrap: "wrap" }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            style={{
              padding: "6px 13px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: "0.78rem",
              fontWeight: 700,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: selected ? "var(--color-primary)" : "transparent",
              color: selected ? "var(--color-primary-foreground)" : "var(--text-dim)",
              transition: "background 0.2s, color 0.2s",
            }}
          >
            <span>{option.label}</span>
            {option.count !== undefined && (
              <span
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 800,
                  padding: "1px 6px",
                  borderRadius: 10,
                  background: selected ? "var(--color-primary-hover)" : "var(--color-border)",
                  color: selected ? "var(--color-primary-foreground)" : "var(--text-dim)",
                }}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function RingProgress({ percent, color, size = 64 }: { percent: number; color: string; size?: number }) {
  const r = size / 2 - 6;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  return (
    <svg
      width={size}
      height={size}
      style={{ transform: "rotate(-90deg)" }}
      role="img"
      aria-label={`${percent}% complete`}
    >
      <title>{`${percent}% complete`}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border)" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
    </svg>
  );
}

function SectionHeader({ title, sub, icon: Icon, badge }: { title: string; sub?: string; icon?: React.ElementType; badge?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {Icon && (
          <div
            style={{
              background: "linear-gradient(135deg,var(--color-primary-light),var(--color-muted))",
              borderRadius: 8,
              padding: "6px 7px",
              display: "flex",
              color: "var(--color-primary)",
            }}
          >
            <Icon size={16} aria-hidden="true" />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>{title}</h3>
          {sub && <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "2px 0 0 0" }}>{sub}</p>}
        </div>
      </div>
      {badge && (
        <span style={{ fontSize: "0.72rem", fontWeight: 700, background: "var(--color-muted)", color: "var(--text-dim)", padding: "3px 9px", borderRadius: 12, flexShrink: 0 }}>
          {badge}
        </span>
      )}
    </div>
  );
}

/**
 * Interactive SVG Donut Chart with center metrics & dynamic legend
 */
function SvgDonutChart({
  data,
  total,
  centerTitle,
  centerSubtitle,
}: {
  data: { label: string; count: number; color: string }[];
  total: number;
  centerTitle: string;
  centerSubtitle: string;
}) {
  const r = 70;
  const circ = 2 * Math.PI * r;

  // Cumulative dash offsets are derived up front; accumulating them inside the
  // render pass mutated a value that lived as long as the component did.
  const segments = useMemo(() => {
    const source = total > 0 ? data.filter((segment) => segment.count > 0) : [];
    return source
      .reduce<{ entries: { color: string; dash: number; offset: number }[]; accumulated: number }>(
        (acc, segment) => {
          const dash = (segment.count / total) * circ;
          acc.entries.push({ color: segment.color, dash, offset: -acc.accumulated });
          acc.accumulated += dash;
          return acc;
        },
        { entries: [], accumulated: 0 }
      )
      .entries;
  }, [data, total, circ]);

  const summary = data.map((segment) => `${segment.label} ${segment.count}`).join(", ");

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", justifyContent: "center" }}>
      <div style={{ position: "relative", width: 180, height: 180, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg
          width="180"
          height="180"
          style={{ transform: "rotate(-90deg)" }}
          role="img"
          aria-label={`${centerTitle} ${centerSubtitle}. ${summary}`}
        >
          <title>{`${centerTitle} ${centerSubtitle}`}</title>
          <circle cx="90" cy="90" r={r} fill="none" stroke="var(--color-muted)" strokeWidth="22" />
          {segments.map((segment, idx) => (
            <circle
              key={idx}
              cx="90"
              cy="90"
              r={r}
              fill="none"
              stroke={segment.color}
              strokeWidth="22"
              strokeDasharray={`${segment.dash} ${circ}`}
              strokeDashoffset={segment.offset}
              style={{ transition: "stroke-dashoffset 0.6s ease, stroke-dasharray 0.6s ease" }}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", textAlign: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--text-main)", lineHeight: 1.1 }}>{centerTitle}</div>
          <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase" }}>
            {centerSubtitle}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 160 }}>
        {data.map((seg) => {
          const pct = total > 0 ? Math.round((seg.count / total) * 100) : 0;
          return (
            <div key={seg.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: "0.8rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
                <span style={{ color: "var(--text-main)", fontWeight: 600 }}>{seg.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 800, color: seg.color }}>{seg.count}</span>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>({pct}%)</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TIMELINE_MONTH_LIMIT = 12;

/**
 * Interactive SVG Area / Velocity Curve Chart
 */
function SvgDeliveryTimeline({
  batches,
}: {
  batches: Batch[];
}) {
  // `useId` yields a value containing colons, which are not valid in a CSS
  // selector and are unreliable inside an SVG `url(#...)` paint reference.
  const gradientId = `velocity-${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`;


  const months = useMemo(() => {
    if (!batches || batches.length === 0) return [];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthCounts: Record<string, { label: string; count: number; hours: number; sortKey: string }> = {};

    batches.forEach((b) => {
      const dateStr = b.start_date || b.created_at;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;
      const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!monthCounts[sortKey]) {
        monthCounts[sortKey] = {
          label: `${monthNames[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`,
          count: 0,
          hours: 0,
          sortKey,
        };
      }
      monthCounts[sortKey].count++;
      monthCounts[sortKey].hours += Number(b.total_hours) || 0;
    });

    return Object.values(monthCounts).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [batches]);

  const points = months.slice(-TIMELINE_MONTH_LIMIT);
  const hiddenMonthCount = months.length - points.length;

  const maxVal = Math.max(...points.map((p) => p.count), 1);
  const width = 540;
  const height = 140;
  const paddingX = 40;
  const paddingY = 24;

  const chartPoints = points.map((p, i) => {
    const x = paddingX + (i / Math.max(points.length - 1, 1)) * (width - 2 * paddingX);
    const y = height - paddingY - (p.count / maxVal) * (height - 2 * paddingY);
    return { ...p, x, y };
  });

  const pathD = chartPoints.reduce((acc, pt, i, arr) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = arr[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");

  const fillD = chartPoints.length > 0
    ? `${pathD} L ${chartPoints[chartPoints.length - 1].x} ${height - paddingY} L ${chartPoints[0].x} ${height - paddingY} Z`
    : "";

  // The counts exist only inside `<text>` nodes, so without this label the chart
  // announced nothing at all.
  const ariaLabel = points.length === 0
    ? "No dated batches to plot"
    : `Batches started per month: ${points.map((point) => `${point.label} ${point.count}`).join(", ")}`;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height + 25}`}
        style={{ width: "100%", minWidth: 380, height: 165 }}
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal gridlines */}
        {[0, 0.5, 1].map((pct, idx) => {
          const y = height - paddingY - pct * (height - 2 * paddingY);
          return (
            <line
              key={idx}
              x1={paddingX}
              y1={y}
              x2={width - paddingX}
              y2={y}
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          );
        })}

        {/* Area fill & smooth bezier curve */}
        {fillD && <path d={fillD} fill={`url(#${gradientId})`} />}
        {pathD && <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth="3" strokeLinecap="round" />}

        {/* Interactive nodes and axis labels */}
        {chartPoints.map((pt, i) => (
          <g key={i}>
            <title>{`${pt.label}: ${pt.count} batch(es), ${Math.round(pt.hours)}h`}</title>
            <circle cx={pt.x} cy={pt.y} r="5" fill="#fff" stroke="#8b5cf6" strokeWidth="3" />
            <text x={pt.x} y={pt.y - 10} textAnchor="middle" fontSize="10" fontWeight="700" fill="#6b21a8">
              {pt.count}
            </text>
            <text x={pt.x} y={height + 14} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-muted-foreground)">
              {pt.label}
            </text>
          </g>
        ))}
      </svg>
      {hiddenMonthCount > 0 && (
        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", margin: "6px 0 0" }}>
          Showing the most recent {TIMELINE_MONTH_LIMIT} months — {hiddenMonthCount} earlier month
          {hiddenMonthCount === 1 ? "" : "s"} of {months.length} not plotted.
        </p>
      )}
    </div>
  );
}

/**
 * SVG Grouped Bar Chart — compare multiple metrics across teams
 */
function SvgGroupedBar({
  groups,
  series,
  height = 180,
}: {
  groups: { label: string; values: number[] }[];
  series: { label: string; color: string }[];
  height?: number;
}) {
  const maxVal = Math.max(...groups.flatMap((g) => g.values), 1);
  const barW = 14;
  const gap = 4;
  const groupGap = 20;
  const paddingL = 36;
  const paddingB = 28;
  const seriesCount = series.length;
  const groupW = seriesCount * (barW + gap) - gap + groupGap;
  const totalW = paddingL + groups.length * groupW + 20;
  const chartH = height - paddingB;

  // The per-bar values exist only inside `<text>` nodes, so without this label
  // the chart announced nothing at all.
  const ariaLabel =
    groups.length === 0
      ? "No groups to compare"
      : `${series.map((entry) => entry.label).join(", ")} by group: ${groups
          .map((group) => `${group.label} ${group.values.join(", ")}`)
          .join("; ")}`;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${totalW} ${height}`}
        style={{ width: "100%", minWidth: Math.min(totalW, 340), height }}
        role="img"
        aria-label={ariaLabel}
      >
        <title>{ariaLabel}</title>
        {/* Y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = 8 + (1 - pct) * (chartH - 8);
          const val = Math.round(pct * maxVal);
          return (
            <g key={i}>
              <line x1={paddingL} y1={y} x2={totalW - 10} y2={y} stroke="var(--color-border)" strokeDasharray="3 3" strokeWidth={1} />
              <text x={paddingL - 4} y={y + 4} textAnchor="end" fontSize={8} fill="var(--color-muted-foreground)">{val}</text>
            </g>
          );
        })}
        {/* Bars */}
        {groups.map((group, gi) => {
          const gX = paddingL + gi * groupW;
          return (
            <g key={gi}>
              {series.map((s, si) => {
                const val = group.values[si] || 0;
                const barH = (val / maxVal) * (chartH - 8);
                const x = gX + si * (barW + gap);
                const y = chartH - barH;
                return (
                  <g key={si}>
                    <title>{`${group.label} — ${s.label}: ${val}`}</title>
                    <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} fill={s.color} rx={3} opacity={0.88} />
                    {val > 0 && (
                      <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fontWeight={700} fill={s.color}>{val}</text>
                    )}
                  </g>
                );
              })}
              {/* The axis label is elided to fit; the full name lives in the tooltip. */}
              <g>
                <title>{group.label}</title>
                <text
                  x={gX + (seriesCount * (barW + gap) - gap) / 2}
                  y={chartH + 12}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={600}
                  fill="var(--text-muted)"
                >
                  {group.label.length > 10 ? group.label.slice(0, 9) + "…" : group.label}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      {/* Legend */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: "0.72rem", fontWeight: 700 }}>
        {series.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ color: "var(--text-main)" }}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Mini role composition donut for each team
 */
function TeamRoleDonut({ counts, size = 56 }: { counts: Record<string, number>; size?: number }) {
  const roleColors: Record<string, string> = {
    Manager: "#0b5cab",
    Coordinator: "#06b6d4",
    Faculty: "#8b5cf6",
    Sales: "#f59e0b",
    Admin: "#ef4444",
  };
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const entries = Object.entries(counts);
  const total = entries.reduce((a, b) => a + b[1], 0);
  const segments = entries.reduce<{ color: string; count: number; dash: number; offset: number }[]>(
    (acc, [role, count]) => {
      const dash = (total > 0 ? count / total : 0) * circ;
      const offset = -acc.reduce((sum, seg) => sum + (seg.dash ?? 0), 0);
      acc.push({ color: roleColors[role] || "var(--color-muted-foreground)", count, dash, offset });
      return acc;
    },
    []
  );
  const ariaLabel =
    total === 0
      ? "No role composition data"
      : `Role mix: ${entries.map(([role, count]) => `${role} ${count}`).join(", ")}`;

  return (
    <svg
      width={size}
      height={size}
      style={{ transform: "rotate(-90deg)", flexShrink: 0 }}
      role="img"
      aria-label={ariaLabel}
    >
      <title>{ariaLabel}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-muted)" strokeWidth={8} />
      {total > 0 &&
        segments.map((seg, i) =>
          seg.count > 0 ? (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none" stroke={seg.color} strokeWidth={8}
              strokeDasharray={`${seg.dash} ${circ}`}
              strokeDashoffset={seg.offset}
            />
          ) : null
        )}
    </svg>
  );
}

/**
 * Horizontal ranked bar — city / location heatmap
 */
function RankedBars({
  data,
  color,
  maxItems = 8,
}: {
  data: { label: string; value: number; sub?: string }[];
  color: string;
  maxItems?: number;
}) {
  const slice = data.slice(0, maxItems);
  const hiddenCount = data.length - slice.length;
  const maxVal = Math.max(...slice.map((d) => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {slice.map((item, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 20, fontSize: "0.7rem", fontWeight: 700, color: "var(--text-dim)", textAlign: "right", flexShrink: 0 }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{item.label}</span>
              <span style={{ fontSize: "0.72rem", fontWeight: 800, color, flexShrink: 0 }}>{item.value}{item.sub}</span>
            </div>
            <div style={{ height: 6, background: "var(--color-muted)", borderRadius: 4 }}>
              <div style={{ width: `${(item.value / maxVal) * 100}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.5s" }} />
            </div>
          </div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <div style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", paddingLeft: 30 }}>
          +{hiddenCount} more · {data.length} total
        </div>
      )}
    </div>
  );
}

/**
 * Quality Scatter — NPS vs Feedback bubble
 */
function QualityBubble({
  data,
}: {
  data: { label: string; nps: number | null; feedback: number | null; batches: number; color: string }[];
}) {
  const w = 380;
  const h = 200;
  const pL = 44, pR = 16, pT = 16, pB = 36;
  const cW = w - pL - pR;
  const cH = h - pT - pB;

  const validData = data.filter((d) => d.nps !== null && d.feedback !== null);
  if (validData.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>
        No NPS / feedback data available yet.
      </div>
    );
  }

  const maxBatches = Math.max(...validData.map((d) => d.batches), 1);

  const ariaLabel =
    `${validData.length} client(s) plotted by average NPS against average batch feedback, sized by batch volume. ` +
    validData
      .map((d) => `${d.label}: NPS ${d.nps!.toFixed(0)}, feedback ${d.feedback!.toFixed(2)} over ${d.batches} batches`)
      .join("; ");

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: "100%", minWidth: 300, height: h }}
        role="img"
        aria-label={ariaLabel}
      >
        <title>Client quality matrix</title>
        <desc>Average NPS on the vertical axis, average batch feedback on the horizontal axis, bubble size is batch volume.</desc>
        {/* Axes */}
        <line x1={pL} y1={pT} x2={pL} y2={pT + cH} stroke="var(--color-border)" strokeWidth={1} />
        <line x1={pL} y1={pT + cH} x2={pL + cW} y2={pT + cH} stroke="var(--color-border)" strokeWidth={1} />
        {/* X axis labels: Feedback 1–5 */}
        {[1, 2, 3, 4, 5].map((v) => (
          <g key={v}>
            <line x1={pL + ((v - 1) / 4) * cW} y1={pT} x2={pL + ((v - 1) / 4) * cW} y2={pT + cH} stroke="var(--color-muted)" strokeWidth={1} />
            <text x={pL + ((v - 1) / 4) * cW} y={pT + cH + 14} textAnchor="middle" fontSize={9} fill="var(--color-muted-foreground)">{v}</text>
          </g>
        ))}
        <text x={pL + cW / 2} y={h - 2} textAnchor="middle" fontSize={9} fill="var(--text-muted)">Average Batch Feedback</text>
        {/* Y axis labels: NPS -100 to 100 */}
        {[-100, -50, 0, 50, 100].map((v) => {
          const y = pT + cH - ((v + 100) / 200) * cH;
          return (
            <g key={v}>
              <line x1={pL} y1={y} x2={pL + cW} y2={y} stroke="var(--color-muted)" strokeWidth={1} />
              <text x={pL - 4} y={y + 4} textAnchor="end" fontSize={8} fill="var(--color-muted-foreground)">{v}</text>
            </g>
          );
        })}
        {/* Zero NPS line */}
        <line x1={pL} y1={pT + cH / 2} x2={pL + cW} y2={pT + cH / 2} stroke="var(--color-border)" strokeDasharray="4 3" strokeWidth={1} />
        {/* Bubbles */}
        {validData.map((d, i) => {
          const cx = pL + ((d.feedback! - 1) / 4) * cW;
          const cy = pT + cH - ((d.nps! + 100) / 200) * cH;
          const r = 6 + (d.batches / maxBatches) * 14;
          return (
            <g key={i}>
              <title>{`${d.label}: NPS ${d.nps!.toFixed(1)}, feedback ${d.feedback!.toFixed(2)}, ${d.batches} batches`}</title>
              <circle cx={cx} cy={cy} r={r} fill={d.color} opacity={0.75} />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">
                {d.label.length > 5 ? d.label.slice(0, 5) + "…" : d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface ManagerWorkloadRow {
  manager: User;
  total: number;
  active: number;
  pending: number;
  completed: number;
  totalHours: number;
  totalEnrollments: number;
}

interface CoordinatorWorkloadRow {
  coordinator: User;
  total: number;
  active: number;
  pending: number;
  completed: number;
  totalHours: number;
  totalEnrollments: number;
}

type ClientStatRow = [string, { batches: number; enrollments: number; hours: number; active: number }];

function loadPercent(active: number, total: number): number {
  return total > 0 ? Math.round((active / total) * 100) : 0;
}

/** Rows still on screen, used for the `colSpan` of a full-width state row. */
function visibleColumnCount<K extends string>(
  keys: readonly { key: K }[],
  columns: UseColumnVisibilityResult<K>
): number {
  return keys.reduce((count, column) => (columns.isVisible(column.key) ? count + 1 : count), 0);
}

/** Column defs are declared `as const`, so optional fields are read through the declared type. */
function columnAlign<T, K extends string>(column: TableColumnDef<T, K>): "left" | "center" | "right" {
  return column.align ?? "left";
}

// Body cells and headings share one padding constant per table so the grid lines
// up; the local header shadows are gone in favour of `TABLE_TH_STYLE`.
const WORKLOAD_TH_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "12px 16px" };
const WORKLOAD_CELL_STYLE: React.CSSProperties = { padding: "12px 16px" };
const PORTFOLIO_TH_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "10px 16px" };
const PORTFOLIO_CELL_STYLE: React.CSSProperties = { padding: "10px 16px" };
const ACTIVITY_FEED_TH_STYLE: React.CSSProperties = { ...TABLE_TH_STYLE, padding: "10px 14px" };
const ACTIVITY_FEED_CELL_STYLE: React.CSSProperties = { padding: "10px 14px" };

const MANAGER_LEDGER_COLUMNS = [
  { key: "manager", label: "Manager", accessor: (row: ManagerWorkloadRow) => row.manager.full_name || "" },
  {
    key: "team",
    label: "Team",
    accessor: (row: ManagerWorkloadRow) => row.manager.team_name || "",
    filterable: true,
  },
  { key: "active", label: "Active", accessor: (row: ManagerWorkloadRow) => row.active },
  { key: "pending", label: "Pending", accessor: (row: ManagerWorkloadRow) => row.pending },
  { key: "completed", label: "Completed", accessor: (row: ManagerWorkloadRow) => row.completed },
  { key: "total", label: "Total", accessor: (row: ManagerWorkloadRow) => row.total },
  { key: "hours", label: "Hours", accessor: (row: ManagerWorkloadRow) => row.totalHours },
  { key: "enrollments", label: "Enrollments", accessor: (row: ManagerWorkloadRow) => row.totalEnrollments },
  { key: "load", label: "Load %", accessor: (row: ManagerWorkloadRow) => loadPercent(row.active, row.total) },
] as const satisfies readonly TableColumnDef<ManagerWorkloadRow>[];

const MANAGER_LEDGER_COLUMN_KEYS = MANAGER_LEDGER_COLUMNS.map((column) => ({
  key: column.key,
  label: column.label,
}));
type ManagerLedgerColumnKey = (typeof MANAGER_LEDGER_COLUMN_KEYS)[number]["key"];
const MANAGER_LEDGER_DEFAULT_HIDDEN: readonly ManagerLedgerColumnKey[] = ["hours", "enrollments"];

const MANAGER_LEDGER_SORT_ACCESSORS = buildSortAccessors(MANAGER_LEDGER_COLUMNS);
const MANAGER_LEDGER_SORT_OPTIONS = buildSortOptions(MANAGER_LEDGER_COLUMNS);
const MANAGER_LEDGER_SEARCH_ACCESSOR = buildSearchAccessor(MANAGER_LEDGER_COLUMNS);
const MANAGER_LEDGER_FILTER_FIELDS = buildFilterFields(MANAGER_LEDGER_COLUMNS);

const MANAGER_LEDGER_CSV: readonly CsvColumn<ManagerWorkloadRow>[] = [
  { key: "manager", label: "Manager", value: (row) => row.manager.full_name },
  { key: "email", label: "Email", value: (row) => row.manager.email },
  { key: "team", label: "Team", value: (row) => row.manager.team_name || "" },
  { key: "active", label: "Active", value: (row) => row.active },
  { key: "pending", label: "Pending", value: (row) => row.pending },
  { key: "completed", label: "Completed", value: (row) => row.completed },
  { key: "total", label: "Total", value: (row) => row.total },
  { key: "hours", label: "Hours", value: (row) => Math.round(row.totalHours) },
  { key: "enrollments", label: "Enrollments", value: (row) => row.totalEnrollments },
  { key: "load", label: "Load %", value: (row) => loadPercent(row.active, row.total) },
];

const COORDINATOR_LEDGER_COLUMNS = [
  {
    key: "coordinator",
    label: "Coordinator",
    accessor: (row: CoordinatorWorkloadRow) => row.coordinator.full_name || "",
  },
  {
    key: "team",
    label: "Team",
    accessor: (row: CoordinatorWorkloadRow) => row.coordinator.team_name || "",
    filterable: true,
  },
  { key: "active", label: "Active", accessor: (row: CoordinatorWorkloadRow) => row.active },
  { key: "pipeline", label: "In Pipeline", accessor: (row: CoordinatorWorkloadRow) => row.pending },
  { key: "completed", label: "Completed", accessor: (row: CoordinatorWorkloadRow) => row.completed },
  { key: "total", label: "Total", accessor: (row: CoordinatorWorkloadRow) => row.total },
  { key: "hours", label: "Hours", accessor: (row: CoordinatorWorkloadRow) => row.totalHours },
  { key: "learners", label: "Enrollments", accessor: (row: CoordinatorWorkloadRow) => row.totalEnrollments },
  {
    key: "capacity",
    label: "Load %",
    accessor: (row: CoordinatorWorkloadRow) => loadPercent(row.active, row.total),
  },
] as const satisfies readonly TableColumnDef<CoordinatorWorkloadRow>[];

const COORDINATOR_LEDGER_COLUMN_KEYS = COORDINATOR_LEDGER_COLUMNS.map((column) => ({
  key: column.key,
  label: column.label,
}));
type CoordinatorLedgerColumnKey = (typeof COORDINATOR_LEDGER_COLUMN_KEYS)[number]["key"];
const COORDINATOR_LEDGER_DEFAULT_HIDDEN: readonly CoordinatorLedgerColumnKey[] = ["hours", "learners"];

const COORDINATOR_LEDGER_SORT_ACCESSORS = buildSortAccessors(COORDINATOR_LEDGER_COLUMNS);
const COORDINATOR_LEDGER_SORT_OPTIONS = buildSortOptions(COORDINATOR_LEDGER_COLUMNS);
const COORDINATOR_LEDGER_SEARCH_ACCESSOR = buildSearchAccessor(COORDINATOR_LEDGER_COLUMNS);
const COORDINATOR_LEDGER_FILTER_FIELDS = buildFilterFields(COORDINATOR_LEDGER_COLUMNS);

const COORDINATOR_LEDGER_CSV: readonly CsvColumn<CoordinatorWorkloadRow>[] = [
  { key: "coordinator", label: "Coordinator", value: (row) => row.coordinator.full_name },
  { key: "email", label: "Email", value: (row) => row.coordinator.email },
  { key: "team", label: "Team", value: (row) => row.coordinator.team_name || "" },
  { key: "active", label: "Active", value: (row) => row.active },
  { key: "pipeline", label: "In Pipeline", value: (row) => row.pending },
  { key: "completed", label: "Completed", value: (row) => row.completed },
  { key: "total", label: "Total", value: (row) => row.total },
  { key: "hours", label: "Hours", value: (row) => Math.round(row.totalHours) },
  { key: "learners", label: "Enrollments", value: (row) => row.totalEnrollments },
  { key: "capacity", label: "Load %", value: (row) => loadPercent(row.active, row.total) },
];

const CLIENT_PORTFOLIO_COLUMNS = [
  // Static rank column: a plain heading, no sort and no search haystack.
  { key: "index", label: "#", sortable: false, accessor: () => "" },
  {
    key: "client",
    label: "Client",
    accessor: (row: ClientStatRow) => row[0],
    filterable: true,
  },
  { key: "batches", label: "Batches", accessor: (row: ClientStatRow) => row[1].batches },
  { key: "active", label: "Active", accessor: (row: ClientStatRow) => row[1].active },
  { key: "enrollments", label: "Enrollments", accessor: (row: ClientStatRow) => row[1].enrollments },
  { key: "hours", label: "Hours", accessor: (row: ClientStatRow) => row[1].hours },
] as const satisfies readonly TableColumnDef<ClientStatRow>[];

const CLIENT_PORTFOLIO_COLUMN_KEYS = CLIENT_PORTFOLIO_COLUMNS.map((column) => ({
  key: column.key,
  label: column.label,
}));
type ClientPortfolioColumnKey = (typeof CLIENT_PORTFOLIO_COLUMN_KEYS)[number]["key"];

const CLIENT_PORTFOLIO_SORT_ACCESSORS = buildSortAccessors(CLIENT_PORTFOLIO_COLUMNS);
const CLIENT_PORTFOLIO_SORT_OPTIONS = buildSortOptions(CLIENT_PORTFOLIO_COLUMNS);
const CLIENT_PORTFOLIO_SEARCH_ACCESSOR = buildSearchAccessor(CLIENT_PORTFOLIO_COLUMNS);
const CLIENT_PORTFOLIO_FILTER_FIELDS = buildFilterFields(CLIENT_PORTFOLIO_COLUMNS);

const CLIENT_PORTFOLIO_CSV: readonly CsvColumn<ClientStatRow>[] = [
  { key: "client", label: "Client", value: (row) => row[0] },
  { key: "batches", label: "Batches", value: (row) => row[1].batches },
  { key: "active", label: "Active", value: (row) => row[1].active },
  { key: "enrollments", label: "Enrollments", value: (row) => row[1].enrollments },
  { key: "hours", label: "Hours", value: (row) => Math.round(row[1].hours) },
];

const ACTIVITY_FEED_COLUMNS = [
  { key: "batchId", label: "Batch ID", accessor: (row: Batch) => row.batch_id || "" },
  {
    key: "client",
    label: "Client",
    accessor: (row: Batch) => row.client_name || "",
    filterable: true,
  },
  { key: "program", label: "Program", accessor: (row: Batch) => row.program_name || "" },
  {
    key: "domain",
    label: "Domain",
    accessor: (row: Batch) => row.domain || "",
    filterable: true,
  },
  {
    key: "mode",
    label: "Mode",
    accessor: (row: Batch) => row.delivery_mode || "",
    filterable: true,
  },
  { key: "startDate", label: "Start Date", accessor: (row: Batch) => row.start_date || "" },
  {
    key: "enrollments",
    label: "Enrollments",
    accessor: (row: Batch) => Number(row.total_enrollments) || 0,
    align: "center",
  },
  {
    key: "hours",
    label: "Hours",
    accessor: (row: Batch) => Number(row.total_hours) || 0,
    align: "center",
  },
  {
    key: "status",
    label: "Status",
    accessor: (row: Batch) => row.status || "",
    filterable: true,
  },
] as const satisfies readonly TableColumnDef<Batch>[];

const ACTIVITY_FEED_COLUMN_KEYS = ACTIVITY_FEED_COLUMNS.map((column) => ({
  key: column.key,
  label: column.label,
}));
type ActivityFeedColumnKey = (typeof ACTIVITY_FEED_COLUMN_KEYS)[number]["key"];
const ACTIVITY_FEED_DEFAULT_HIDDEN: readonly ActivityFeedColumnKey[] = ["domain"];

const ACTIVITY_FEED_SORT_ACCESSORS = buildSortAccessors(ACTIVITY_FEED_COLUMNS);
const ACTIVITY_FEED_SORT_OPTIONS = buildSortOptions(ACTIVITY_FEED_COLUMNS);
const ACTIVITY_FEED_SEARCH_ACCESSOR = buildSearchAccessor(ACTIVITY_FEED_COLUMNS);
const ACTIVITY_FEED_FILTER_FIELDS = buildFilterFields(ACTIVITY_FEED_COLUMNS);
const ACTIVITY_FEED_DESC_FIRST_KEYS = ["startDate"];

const ACTIVITY_FEED_CSV: readonly CsvColumn<Batch>[] = [
  { key: "batch_id", label: "Batch ID" },
  { key: "client_name", label: "Client", value: (row) => row.client_name || "" },
  { key: "program_name", label: "Program" },
  { key: "domain", label: "Domain", value: (row) => row.domain || "" },
  { key: "delivery_mode", label: "Mode" },
  { key: "start_date", label: "Start Date", value: (row) => row.start_date || "" },
  { key: "total_enrollments", label: "Enrollments" },
  { key: "total_hours", label: "Hours" },
  { key: "status", label: "Status" },
];

const PLOTTED_QUALITY_LIMIT = 12;
const PLOTTED_TECH_LIMIT = 10;

export function EnterpriseDashboard({ batches, users, dashboardSummary, isLoading, currentUser, facultyUtilizationLedger }: EnterpriseDashboardProps) {
  const [period, setPeriod] = useState<TimePeriod>("monthly");
  const [workloadTab, setWorkloadTab] = useState<"managers" | "coordinators">("managers");
  const [teamAnalyticsTab, setTeamAnalyticsTab] = useState<"comparison" | "composition" | "quality">("comparison");

  // Pagination states
  const [mgrPage, setMgrPage] = useState(1);
  const [mgrPageSize, setMgrPageSize] = usePersistentState(
    "ops.table.manager-ledger.pageSize",
    5,
    reviveNumber
  );

  const [coordPage, setCoordPage] = useState(1);
  const [coordPageSize, setCoordPageSize] = usePersistentState(
    "ops.table.coordinator-ledger.pageSize",
    10,
    reviveNumber
  );

  const [activityPage, setActivityPage] = useState(1);
  const [activityPageSize, setActivityPageSize] = usePersistentState(
    "ops.table.activity-feed.pageSize",
    10,
    reviveNumber
  );

  const [clientPage, setClientPage] = useState(1);
  const [clientPageSize, setClientPageSize] = usePersistentState(
    "ops.table.client-portfolio.pageSize",
    10,
    reviveNumber
  );

  const coordinatorIdsByManager = useMemo(() => {
    const map = new Map<string, Set<string>>();
    users.filter((u) => u.role === "Manager").forEach((m) => map.set(m.id, new Set()));

    users.forEach((u) => {
      if (u.role !== "Coordinator") return;
      const managerId =
        u.manager_id ||
        users.find((m) => m.role === "Manager" && m.full_name === u.manager_name)?.id ||
        null;
      if (!managerId) return;
      if (!map.has(managerId)) map.set(managerId, new Set());
      map.get(managerId)?.add(u.id);
    });

    return map;
  }, [users]);

  // Find all direct & indirect subordinates strictly BELOW currentUser
  // User Rules:
  // 1. "himself should not be considered" -> currentUser is NEVER in subordinates
  // 2. "and top mangers should not be include" -> any superiors/ancestors are excluded
  // 3. "only below him" -> only descendants in the reporting tree
  const subordinateUserIds = useMemo(() => {
    if (!currentUser) return new Set<string>();

    const subordinates = new Set<string>();
    const visited = new Set<string>([currentUser.id]);
    const queue: string[] = [currentUser.id];

    // Reporting edges resolved once: name matching used to be a `users.find`
    // inside the traversal, so each visited parent rescanned the whole roster.
    const idToParentId = new Map<string, string>();
    const nameToId = new Map<string, string>();
    users.forEach((u) => {
      const name = (u.full_name ?? "").trim().toLowerCase();
      if (name && !nameToId.has(name)) nameToId.set(name, u.id);
    });
    users.forEach((u) => {
      const parentId = u.manager_id || nameToId.get((u.manager_name ?? "").trim().toLowerCase());
      if (parentId) idToParentId.set(u.id, parentId);
    });
    const childIdsByParentId = new Map<string, string[]>();
    idToParentId.forEach((parentId, childId) => {
      const siblings = childIdsByParentId.get(parentId);
      if (siblings) siblings.push(childId);
      else childIdsByParentId.set(parentId, [childId]);
    });

    const enqueue = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      subordinates.add(id);
      queue.push(id);
    };

    for (let cursor = 0; cursor < queue.length; cursor++) {
      const parentId = queue[cursor];
      childIdsByParentId.get(parentId)?.forEach(enqueue);
      coordinatorIdsByManager.get(parentId)?.forEach(enqueue);
    }

    return subordinates;
  }, [currentUser, users, coordinatorIdsByManager]);

  // Subordinate managers strictly below currentUser
  const managers = useMemo(() => {
    return users.filter(
      (u) =>
        u.role === "Manager" &&
        u.id !== currentUser?.id && // himself should not be considered
        subordinateUserIds.has(u.id) // only below him, top managers excluded
    );
  }, [users, currentUser, subordinateUserIds]);

  // Subordinate coordinators strictly below currentUser
  const coordinators = useMemo(() => {
    return users.filter(
      (u) =>
        u.role === "Coordinator" &&
        u.id !== currentUser?.id &&
        subordinateUserIds.has(u.id)
    );
  }, [users, currentUser, subordinateUserIds]);

  // Batches scoped to current user and their subordinates
  const scopedBatches = useMemo(() => {
    if (!currentUser) return batches;

    return batches.filter((b) => {
      // Direct ownership by current user
      if (b.primary_manager_id === currentUser.id) return true;
      // Ownership by subordinate manager
      if (b.primary_manager_id && subordinateUserIds.has(b.primary_manager_id)) return true;
      // Coordinated by subordinate coordinator
      if (b.coordinator_id && subordinateUserIds.has(b.coordinator_id)) return true;
      return false;
    });
  }, [batches, currentUser, subordinateUserIds]);

  // Land on a workload tab that has content, but never bounce a user off the tab
  // they chose just because `users` was re-fetched underneath them.
  React.useEffect(() => {
    setWorkloadTab((current) => {
      if (current === "managers" ? managers.length > 0 : coordinators.length > 0) return current;
      return coordinators.length > 0 ? "coordinators" : "managers";
    });
  }, [managers.length, coordinators.length]);

  // Reset pagination pages on period filter change
  React.useEffect(() => {
    setActivityPage(1);
    setMgrPage(1);
    setCoordPage(1);
    setClientPage(1);
  }, [period]);

  // Precompute live counts for every horizon tab so counts are visible on the buttons
  const periodCounts = useMemo(() => {
    return {
      daily: scopedBatches.filter((b) => isBatchInPeriod(b, "daily")).length,
      weekly: scopedBatches.filter((b) => isBatchInPeriod(b, "weekly")).length,
      monthly: scopedBatches.filter((b) => isBatchInPeriod(b, "monthly")).length,
      quarterly: scopedBatches.filter((b) => isBatchInPeriod(b, "quarterly")).length,
      all: scopedBatches.length,
    };
  }, [scopedBatches]);

  // Active dataset for dashboard and team analytics directly driven by selected period
  const activeBatchesDataset = useMemo(
    () => (period === "all" ? scopedBatches : scopedBatches.filter((b) => isBatchInPeriod(b, period))),
    [scopedBatches, period]
  );

  const statusBuckets = useMemo(() => {
    const counts: Record<string, number> = {};
    activeBatchesDataset.forEach((b) => {
      counts[b.status] = (counts[b.status] || 0) + 1;
    });
    return counts;
  }, [activeBatchesDataset]);

  const domainStats = useMemo(() => {
    const map: Record<string, { total: number; active: number; hours: number; enrollments: number; completed: number }> = {};
    activeBatchesDataset.forEach((b) => {
      const d = b.domain || "Other";
      if (!map[d]) map[d] = { total: 0, active: 0, hours: 0, enrollments: 0, completed: 0 };
      map[d].total++;
      if (["Approved", "Upcoming", "Ongoing"].includes(b.status)) map[d].active++;
      if (b.status === "Completed") map[d].completed++;
      map[d].hours += Number(b.total_hours) || 0;
      map[d].enrollments += Number(b.total_enrollments) || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].active - a[1].active);
  }, [activeBatchesDataset]);

  const managerWorkload: ManagerWorkloadRow[] = useMemo(
    () =>
      managers
        .map((m) => {
          const relatedCoordinatorIds = coordinatorIdsByManager.get(m.id) || new Set<string>();
          const mb = activeBatchesDataset.filter((b) => {
            if (b.primary_manager_id === m.id) return true;
            if (!b.primary_manager_id && b.coordinator_id && relatedCoordinatorIds.has(b.coordinator_id)) return true;
            return false;
          });
          return {
            manager: m,
            total: mb.length,
            active: mb.filter((b) => ["Approved", "Upcoming", "Ongoing"].includes(b.status)).length,
            pending: mb.filter((b) => b.status.includes("Pending") || b.status === "Requested").length,
            completed: mb.filter((b) => b.status === "Completed").length,
            totalHours: mb.reduce((s, b) => s + (Number(b.total_hours) || 0), 0),
            totalEnrollments: mb.reduce((s, b) => s + (Number(b.total_enrollments) || 0), 0),
          };
        })
        .sort((a, b) => b.active - a.active || b.total - a.total),
    [managers, activeBatchesDataset, coordinatorIdsByManager]
  );

  const coordinatorWorkload: CoordinatorWorkloadRow[] = useMemo(
    () =>
      coordinators
        .map((c) => {
          const mb = activeBatchesDataset.filter((b) => b.coordinator_id === c.id);
          return {
            coordinator: c,
            total: mb.length,
            active: mb.filter((b) => ["Approved", "Upcoming", "Ongoing"].includes(b.status)).length,
            pending: mb.filter((b) => b.status.includes("Pending") || b.status === "Requested").length,
            completed: mb.filter((b) => b.status === "Completed").length,
            totalHours: mb.reduce((s, b) => s + (Number(b.total_hours) || 0), 0),
            totalEnrollments: mb.reduce((s, b) => s + (Number(b.total_enrollments) || 0), 0),
          };
        })
        .sort((a, b) => b.active - a.active),
    [coordinators, activeBatchesDataset]
  );

  const clientStats: ClientStatRow[] = useMemo(() => {
    const map: Record<string, { batches: number; enrollments: number; hours: number; active: number }> = {};
    activeBatchesDataset.forEach((b) => {
      const c = b.client_name || "Unassigned";
      if (!map[c]) map[c] = { batches: 0, enrollments: 0, hours: 0, active: 0 };
      map[c].batches++;
      map[c].enrollments += Number(b.total_enrollments) || 0;
      map[c].hours += Number(b.total_hours) || 0;
      if (["Approved", "Upcoming", "Ongoing"].includes(b.status)) map[c].active++;
    });
    return Object.entries(map);
  }, [activeBatchesDataset]);

  // Coordinator sessions scheduled for today (IST) — join ledger → batches → users
  const sessionsToday = useMemo(() => {
    const today = istTodayIso();
    const batchById = new Map<string, Batch>();
    batches.forEach((b) => batchById.set(b.id, b));
    const userById = new Map<string, User>();
    users.forEach((u) => userById.set(u.id, u));

    return (facultyUtilizationLedger ?? [])
      .filter((s) => s.date_of_training === today)
      .map((s) => {
        const batch = batchById.get(s.batch_id);
        const coordinatorId = batch?.coordinator_id ?? s.coordinator_id;
        const coordinator = coordinatorId ? userById.get(coordinatorId) : null;
        return {
          sessionId: s.id,
          batchId: s.batch_id,
          program: s.program ?? batch?.program_name ?? "—",
          coordinator: coordinator?.full_name ?? s.coordinator_name ?? "—",
          faculty: s.faculty_name,
          topic: s.topic,
          time: s.start_time ? `${s.start_time}${s.end_time ? ` – ${s.end_time}` : ""}` : "—",
          status: s.status,
        };
      });
  }, [facultyUtilizationLedger, batches, users]);

  // ── TABLE PIPELINES (raw rows → sorted → filtered → paginated) ────────────────
  const managerSort = useTableSort(managerWorkload, MANAGER_LEDGER_SORT_ACCESSORS, {
    initialKey: "active",
    initialDir: "desc",
  });
  const managerFilters = useTableFilters(
    managerSort.sortedRows,
    MANAGER_LEDGER_FILTER_FIELDS,
    MANAGER_LEDGER_SEARCH_ACCESSOR
  );
  const managerLedgerRows = managerFilters.filteredRows;
  React.useEffect(() => {
    setMgrPage(1);
  }, [managerFilters.filtersVersion, managerSort.sortVersion]);
  const paginatedManagerLedger = useMemo(() => {
    const start = (mgrPage - 1) * mgrPageSize;
    return managerLedgerRows.slice(start, start + mgrPageSize);
  }, [managerLedgerRows, mgrPage, mgrPageSize]);

  const coordinatorSort = useTableSort(coordinatorWorkload, COORDINATOR_LEDGER_SORT_ACCESSORS, {
    initialKey: "active",
    initialDir: "desc",
  });
  const coordinatorFilters = useTableFilters(
    coordinatorSort.sortedRows,
    COORDINATOR_LEDGER_FILTER_FIELDS,
    COORDINATOR_LEDGER_SEARCH_ACCESSOR
  );
  const coordinatorLedgerRows = coordinatorFilters.filteredRows;
  React.useEffect(() => {
    setCoordPage(1);
  }, [coordinatorFilters.filtersVersion, coordinatorSort.sortVersion]);
  const paginatedCoordinatorLedger = useMemo(() => {
    const start = (coordPage - 1) * coordPageSize;
    return coordinatorLedgerRows.slice(start, start + coordPageSize);
  }, [coordinatorLedgerRows, coordPage, coordPageSize]);

  const clientSort = useTableSort(clientStats, CLIENT_PORTFOLIO_SORT_ACCESSORS, {
    initialKey: "batches",
    initialDir: "desc",
  });
  const clientFilters = useTableFilters(
    clientSort.sortedRows,
    CLIENT_PORTFOLIO_FILTER_FIELDS,
    CLIENT_PORTFOLIO_SEARCH_ACCESSOR
  );
  const clientPortfolioRows = clientFilters.filteredRows;
  React.useEffect(() => {
    setClientPage(1);
  }, [clientFilters.filtersVersion, clientSort.sortVersion]);
  const paginatedClientStats = useMemo(() => {
    const start = (clientPage - 1) * clientPageSize;
    return clientPortfolioRows.slice(start, start + clientPageSize);
  }, [clientPortfolioRows, clientPage, clientPageSize]);

  const activitySort = useTableSort(activeBatchesDataset, ACTIVITY_FEED_SORT_ACCESSORS, {
    initialKey: null,
    initialDir: null,
    descFirstKeys: ACTIVITY_FEED_DESC_FIRST_KEYS,
  });
  const activityFilters = useTableFilters(
    activitySort.sortedRows,
    ACTIVITY_FEED_FILTER_FIELDS,
    ACTIVITY_FEED_SEARCH_ACCESSOR
  );
  const activityFeedRows = activityFilters.filteredRows;
  React.useEffect(() => {
    setActivityPage(1);
  }, [activityFilters.filtersVersion, activitySort.sortVersion]);
  const paginatedActivityBatches = useMemo(() => {
    const start = (activityPage - 1) * activityPageSize;
    return activityFeedRows.slice(start, start + activityPageSize);
  }, [activityFeedRows, activityPage, activityPageSize]);

  // The workload bar charts read the same rows as their ledger tables, so a
  // search or filter typed into either table moves both.
  const managerColumns = useColumnVisibility<ManagerLedgerColumnKey>({
    columns: MANAGER_LEDGER_COLUMN_KEYS,
    defaultHidden: MANAGER_LEDGER_DEFAULT_HIDDEN,
    storageKey: "ops.table.manager-ledger.columns",
  });
  const coordinatorColumns = useColumnVisibility<CoordinatorLedgerColumnKey>({
    columns: COORDINATOR_LEDGER_COLUMN_KEYS,
    defaultHidden: COORDINATOR_LEDGER_DEFAULT_HIDDEN,
    storageKey: "ops.table.coordinator-ledger.columns",
  });
  const clientColumns = useColumnVisibility<ClientPortfolioColumnKey>({
    columns: CLIENT_PORTFOLIO_COLUMN_KEYS,
    storageKey: "ops.table.client-portfolio.columns",
  });
  const activityColumns = useColumnVisibility<ActivityFeedColumnKey>({
    columns: ACTIVITY_FEED_COLUMN_KEYS,
    defaultHidden: ACTIVITY_FEED_DEFAULT_HIDDEN,
    storageKey: "ops.table.activity-feed.columns",
  });

  const managerVisibleColumnCount = visibleColumnCount(MANAGER_LEDGER_COLUMN_KEYS, managerColumns);
  const coordinatorVisibleColumnCount = visibleColumnCount(
    COORDINATOR_LEDGER_COLUMN_KEYS,
    coordinatorColumns
  );
  const clientVisibleColumnCount = visibleColumnCount(CLIENT_PORTFOLIO_COLUMN_KEYS, clientColumns);
  const activityVisibleColumnCount = visibleColumnCount(ACTIVITY_FEED_COLUMN_KEYS, activityColumns);

  const modeStats = useMemo(() => {
    const map: Record<string, number> = {};
    activeBatchesDataset.forEach((b) => {
      const m = b.delivery_mode || "Online";
      map[m] = (map[m] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [activeBatchesDataset]);

  const pipelineFunnel = [
    { label: "Requested", status: "Requested", color: "#94a3b8" },
    { label: "Approval 1", status: "Approval 1 Pending", color: "#f59e0b" },
    { label: "Approval 2", status: "Approval 2 Pending", color: "#f97316" },
    { label: "Approved", status: "Approved", color: "#3b82f6" },
    { label: "Upcoming", status: "Upcoming", color: "#8b5cf6" },
    { label: "Ongoing", status: "Ongoing", color: "#06b6d4" },
    { label: "Completed", status: "Completed", color: "#16a34a" },
    { label: "Cancelled", status: "Cancelled", color: "#ef4444" },
    { label: "On Hold", status: "OnHold", color: "#d97706" },
  ].map((s) => ({ ...s, count: statusBuckets[s.status] || 0 }));

  const maxFunnelCount = Math.max(...pipelineFunnel.map((f) => f.count), 1);

  const totalBatches = activeBatchesDataset.length;
  const activeBatchesCount = activeBatchesDataset.filter((b) => ["Approved", "Upcoming", "Ongoing"].includes(b.status)).length;
  const completedBatches = activeBatchesDataset.filter((b) => b.status === "Completed").length;
  const cancelledBatches = activeBatchesDataset.filter((b) => b.status === "Cancelled").length;
  const totalEnrollments = activeBatchesDataset.reduce((s, b) => s + (Number(b.total_enrollments) || 0), 0);
  const totalHours = activeBatchesDataset.reduce((s, b) => s + (Number(b.total_hours) || 0), 0);
  const pendingApprovals = activeBatchesDataset.filter((b) => b.status.includes("Pending")).length;
  const onHoldBatches = activeBatchesDataset.filter((b) => b.status === "OnHold").length;
  const completionRate = totalBatches > 0 ? Math.round((completedBatches / totalBatches) * 100) : 0;
  const activeRate = totalBatches > 0 ? Math.round((activeBatchesCount / totalBatches) * 100) : 0;
  const cancellationRate = totalBatches > 0 ? Math.round((cancelledBatches / totalBatches) * 100) : 0;

  // ── TEAM ANALYTICS DERIVATIONS ──────────────────────────────────────────────

  // Distinct teams from users array
  const teamMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; department: string }>();
    users.forEach((u) => {
      if (u.team_id && u.team_name) {
        map.set(u.team_id, { id: u.team_id, name: u.team_name, department: u.department || "Ops" });
      }
    });
    return map;
  }, [users]);

  // Only include teams that belong to the current manager's own team (e.g. Delivery, not Finance).
  // Finance managers may appear as subordinates of this user, but their team is excluded here.
  const teamList = useMemo(() => {
    const all = Array.from(teamMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    // Derive the manager's own team_id: prefer currentUser.team_id, fallback to looking up
    // the full user record from the users array (which is loaded from the admin API).
    const meInUsers = users.find((u) => u.id === currentUser?.id);
    const myTeamId = currentUser?.team_id ?? meInUsers?.team_id ?? null;

    return all.filter((t) => {
      // EXPLICIT REQUIREMENT: Do not include the Finance team in these analyses
      if (t.name.toLowerCase().includes("finance")) return false;

      // If we know the manager's team, only show that team
      if (myTeamId && t.id !== myTeamId) return false;
      // Must have at least one subordinate (or self) member in this team
      return users.some(
        (u) =>
          u.team_id === t.id &&
          (subordinateUserIds.has(u.id) || u.id === currentUser?.id)
      );
    });
  }, [teamMap, users, subordinateUserIds, currentUser]);


  // Per-team member role composition — scoped to subordinate members only (not the full team roster)
  const teamRoleComposition = useMemo(() => {
    const result = new Map<string, Record<string, number>>();
    teamList.forEach((t) => result.set(t.id, {}));
    users.forEach((u) => {
      if (!u.team_id || !result.has(u.team_id)) return;
      // Only count users in the manager's direct-report hierarchy
      if (!subordinateUserIds.has(u.id) && u.id !== currentUser?.id) return;
      const rec = result.get(u.team_id)!;
      rec[u.role] = (rec[u.role] || 0) + 1;
    });
    return result;
  }, [teamList, users, subordinateUserIds, currentUser]);

  // Per-team batch stats (linked via primary_manager or coordinator who belongs to that team)
  const teamBatchStats = useMemo(() => {
    const userTeamMap = new Map<string, string>(); // userId -> teamId
    users.forEach((u) => { if (u.team_id) userTeamMap.set(u.id, u.team_id); });

    const stats = new Map<string, {
      active: number; completed: number; pipeline: number; total: number;
      hours: number; enrollments: number;
      npsValues: number[]; feedbackValues: number[];
    }>();
    teamList.forEach((t) => stats.set(t.id, { active: 0, completed: 0, pipeline: 0, total: 0, hours: 0, enrollments: 0, npsValues: [], feedbackValues: [] }));

    activeBatchesDataset.forEach((b) => {
      // Attribute batch to team of primary_manager or coordinator
      const ownerTeam =
        (b.primary_manager_id && userTeamMap.get(b.primary_manager_id)) ||
        (b.coordinator_id && userTeamMap.get(b.coordinator_id)) ||
        null;
      if (!ownerTeam || !stats.has(ownerTeam)) return;
      const s = stats.get(ownerTeam)!;
      s.total++;
      s.hours += Number(b.total_hours) || 0;
      s.enrollments += Number(b.total_enrollments) || 0;
      if (["Approved", "Upcoming", "Ongoing"].includes(b.status)) s.active++;
      else if (b.status === "Completed") s.completed++;
      else s.pipeline++;
      if (b.batch_nps !== null && b.batch_nps !== undefined) s.npsValues.push(Number(b.batch_nps));
      if (b.batch_avg_feedback !== null && b.batch_avg_feedback !== undefined) s.feedbackValues.push(Number(b.batch_avg_feedback));
    });
    return stats;
  }, [teamList, activeBatchesDataset, users]);

  // Team KPI cards data
  const teamKpiData = useMemo(() =>
    teamList.map((t) => {
      const s = teamBatchStats.get(t.id) || {
        active: 0,
        completed: 0,
        pipeline: 0,
        total: 0,
        hours: 0,
        enrollments: 0,
        npsValues: [],
        feedbackValues: [],
      };
      const composition = teamRoleComposition.get(t.id) || {};
      const memberCount = Object.values(composition).reduce((a, b) => a + b, 0);
      const avgNps = s.npsValues.length > 0 ? s.npsValues.reduce((a, b) => a + b, 0) / s.npsValues.length : null;
      const avgFeedback = s.feedbackValues.length > 0 ? s.feedbackValues.reduce((a, b) => a + b, 0) / s.feedbackValues.length : null;
      return { team: t, memberCount, ...s, avgNps, avgFeedback };
    }).filter((t) => t.memberCount > 0 || t.total > 0)
  , [teamList, teamBatchStats, teamRoleComposition]);

  // Ranking copies: sorting `teamKpiData` in place reordered the memoised array
  // itself, so the grid below it rendered in whatever order the last render left.
  const teamsByHours = useMemo(
    () => [...teamKpiData].sort((a, b) => b.hours - a.hours),
    [teamKpiData]
  );
  const teamsByNps = useMemo(
    () => teamKpiData.filter((t) => t.avgNps !== null).sort((a, b) => (b.avgNps || 0) - (a.avgNps || 0)),
    [teamKpiData]
  );

  // City / location stats
  const cityStats = useMemo(() => {
    const map: Record<string, { batches: number; hours: number; enrollments: number }> = {};
    activeBatchesDataset.forEach((b) => {
      const city = b.location_city || "Remote / Online";
      if (!map[city]) map[city] = { batches: 0, hours: 0, enrollments: 0 };
      map[city].batches++;
      map[city].hours += Number(b.total_hours) || 0;
      map[city].enrollments += Number(b.total_enrollments) || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].batches - a[1].batches);
  }, [activeBatchesDataset]);

  // Client quality bubble data (NPS vs Feedback)
  const clientQualityData = useMemo(() => {
    const BUBBLE_COLORS = ["#0b5cab", "#8b5cf6", "#06b6d4", "#f59e0b", "#16a34a", "#ef4444", "#f97316", "#ec4899"];
    const map: Record<string, { npsSum: number; npsCount: number; fbSum: number; fbCount: number; batches: number }> = {};
    activeBatchesDataset.forEach((b) => {
      const key = b.client_name || "Unassigned";
      if (!map[key]) map[key] = { npsSum: 0, npsCount: 0, fbSum: 0, fbCount: 0, batches: 0 };
      map[key].batches++;
      if (b.batch_nps !== null && b.batch_nps !== undefined) { map[key].npsSum += Number(b.batch_nps); map[key].npsCount++; }
      if (b.batch_avg_feedback !== null && b.batch_avg_feedback !== undefined) { map[key].fbSum += Number(b.batch_avg_feedback); map[key].fbCount++; }
    });
    return Object.entries(map)
      .filter(([, v]) => v.npsCount > 0 || v.fbCount > 0)
      .sort((a, b) => b[1].batches - a[1].batches)
      .map(([label, v], i) => ({
        label,
        nps: v.npsCount > 0 ? v.npsSum / v.npsCount : null,
        feedback: v.fbCount > 0 ? v.fbSum / v.fbCount : null,
        batches: v.batches,
        color: BUBBLE_COLORS[i % BUBBLE_COLORS.length],
      }));
  }, [activeBatchesDataset]);

  // The matrix is capped, so the overflow is disclosed next to the legend.
  const plottedQualityData = useMemo(
    () => clientQualityData.slice(0, PLOTTED_QUALITY_LIMIT),
    [clientQualityData]
  );
  const hiddenQualityClientCount = clientQualityData.length - plottedQualityData.length;

  // Technology breakdown
  const techStats = useMemo(() => {
    const map: Record<string, { batches: number; hours: number; active: number }> = {};
    activeBatchesDataset.forEach((b) => {
      const tech = b.technology || "General";
      if (!map[tech]) map[tech] = { batches: 0, hours: 0, active: 0 };
      map[tech].batches++;
      map[tech].hours += Number(b.total_hours) || 0;
      if (["Approved", "Upcoming", "Ongoing"].includes(b.status)) map[tech].active++;
    });
    return Object.entries(map).sort((a, b) => b[1].batches - a[1].batches);
  }, [activeBatchesDataset]);

  // Donut chart segments for status
  const donutData = useMemo(() => [
    { label: "Live Delivery", count: activeBatchesDataset.filter((b) => ["Upcoming", "Ongoing"].includes(b.status)).length, color: "#8b5cf6" },
    { label: "Approved (Pre-flight)", count: activeBatchesDataset.filter((b) => b.status === "Approved").length, color: "#3b82f6" },
    { label: "Approval Review", count: activeBatchesDataset.filter((b) => b.status.includes("Pending") || b.status === "Requested").length, color: "#f59e0b" },
    { label: "Completed", count: completedBatches, color: "#16a34a" },
    { label: "Cancelled / Hold", count: activeBatchesDataset.filter((b) => ["Cancelled", "OnHold"].includes(b.status)).length, color: "#ef4444" },
  ], [activeBatchesDataset, completedBatches]);

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "64px 0" }}>
        <RefreshCw className="mx-auto mb-3 animate-spin text-primary" size={32} aria-hidden="true" />
        <div style={{ color: "var(--text-muted)", fontWeight: 600 }}>Loading enterprise analytics...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header & Filter Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 style={{ fontSize: "1.45rem", fontWeight: 800, color: "var(--text-main)", margin: 0 }}>
              Team Analytics & Operations Command
            </h2>
            <span style={{ fontSize: "0.72rem", fontWeight: 700, background: "var(--color-primary-light)", color: "var(--color-primary)", padding: "3px 8px", borderRadius: 12 }}>
              {`Team Scope: ${currentUser?.full_name || "Manager View"}`}
            </span>
          </div>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "4px 0 0 0" }}>
            {`Visual workload analytics strictly scoped to reporting personnel below ${currentUser?.full_name || "your management line"}.`}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Horizon Period Selector with Dynamic Live Counts */}
          <SegmentedControl
            label="Reporting horizon"
            value={period}
            onChange={setPeriod}
            options={(Object.keys(PERIOD_LABELS) as TimePeriod[]).map((p) => ({
              value: p,
              label: PERIOD_LABELS[p],
              count: periodCounts[p],
            }))}
          />

          {/* Active Filter Scope Info / Reset */}
          {period !== "all" ? (
            <button
              type="button"
              onClick={() => setPeriod("all")}
              className="btn btn-secondary"
              style={{
                padding: "6px 12px",
                fontSize: "0.75rem",
                display: "flex",
                alignItems: "center",
                gap: 5,
                color: "var(--color-primary)",
                border: "1px solid var(--color-primary-light)",
                background: "var(--color-primary-light)",
              }}
              title="Reset horizon to show all batches"
            >
              <RefreshCw size={12} aria-hidden="true" />
              <span>Reset (All {batches.length})</span>
            </button>
          ) : (
            <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", fontWeight: 600, padding: "4px 8px" }}>
              Showing All {batches.length} Batches
            </span>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))", gap: 14 }}>
        <KpiCard label="Total Batches" value={totalBatches} sub="Under governance" color="var(--color-primary)" icon={Briefcase} />
        <KpiCard label="Active Batches" value={activeBatchesCount} sub={`${activeRate}% of portfolio`} color="#8b5cf6" icon={Activity} />
        <KpiCard label="Total Enrollments" value={totalEnrollments.toLocaleString()} sub="Learners deployed" color="var(--color-info)" icon={Users} />
        <KpiCard label="Scheduled Hours" value={`${Math.round(totalHours).toLocaleString()}h`} sub="Curriculum delivery" color="var(--color-warning)" icon={Clock} />
        <KpiCard label="Completed" value={completedBatches} sub={`${completionRate}% completion rate`} color="var(--color-success)" icon={CheckCircle2} />
        <KpiCard label="Pending Approvals" value={pendingApprovals} sub="Awaiting signoff" color="#f97316" icon={AlertTriangle} />
        <KpiCard label="On Hold" value={onHoldBatches} sub="Action required" color="#d97706" icon={Shield} />
        <KpiCard label="Cancellations" value={cancelledBatches} sub={`${cancellationRate}% cancellation rate`} color="var(--color-destructive)" icon={TrendingDown} />
      </div>

      {/* Coordinator Sessions Today */}
      {sessionsToday.length > 0 && (
        <FullscreenTable
          stickyHeader
          stickyTop={NAVBAR_HEIGHT}
          title={
            <PanelTitle
              title="Coordinator Sessions Today"
              description="Training sessions scheduled for today (IST), scoped to your reporting hierarchy."
              meta={
                <CountBadge value={sessionsToday.length} label="sessions today" />
              }
            />
          }
          actions={
            <>
              <RefreshButton onClick={() => {}} isLoading={false} label="Refresh" />
            </>
          }
        >
          <table className="glass-table table-pin-first-col w-full border-collapse">
            <TableCaption>Coordinator-led training sessions scheduled for today (IST)</TableCaption>
            <thead>
              <tr>
                <th style={PORTFOLIO_TH_STYLE}>Batch</th>
                <th style={PORTFOLIO_TH_STYLE}>Program</th>
                <th style={PORTFOLIO_TH_STYLE}>Coordinator</th>
                <th style={PORTFOLIO_TH_STYLE}>Faculty</th>
                <th style={PORTFOLIO_TH_STYLE}>Topic</th>
                <th style={PORTFOLIO_TH_STYLE}>Time</th>
                <th style={PORTFOLIO_TH_STYLE}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessionsToday.map((s) => (
                <tr key={s.sessionId} style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.82rem" }}>
                  <td style={{ ...PORTFOLIO_CELL_STYLE, fontWeight: 700, color: "var(--color-primary)", whiteSpace: "nowrap" }}>{s.batchId}</td>
                  <td style={{ ...PORTFOLIO_CELL_STYLE, whiteSpace: "nowrap" }}>{s.program}</td>
                  <td style={{ ...PORTFOLIO_CELL_STYLE, color: "var(--text-muted)" }}>{s.coordinator}</td>
                  <td style={{ ...PORTFOLIO_CELL_STYLE }}>{s.faculty}</td>
                  <td style={{ ...PORTFOLIO_CELL_STYLE, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{s.topic}</td>
                  <td style={{ ...PORTFOLIO_CELL_STYLE, textAlign: "center" }}>{s.time}</td>
                  <td style={{ ...PORTFOLIO_CELL_STYLE, textAlign: "center" }}><StatusBadge status={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </FullscreenTable>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* TEAM ANALYTICS — 5 rich visualizations derived from the DB schema  */}
      {/* ═══════════════════════════════════════════════════════════════════ */}

      {/* Team KPI Cards — one per team */}
      {teamKpiData.length > 0 && (
        <div className="glass-panel" style={{ padding: "22px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
            <SectionHeader
              title="Team Performance Overview"
              sub="Per-team batch delivery KPIs, member breakdown and quality scores"
              icon={Users}
            />
            <span style={{ fontSize: "0.72rem", fontWeight: 700, background: "var(--color-muted)", color: "var(--text-dim)", padding: "3px 9px", borderRadius: 12 }}>
              {teamKpiData.length} Teams
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
            {teamKpiData.map((t, ci) => {
              const CARD_COLORS = ["#0b5cab", "#8b5cf6", "#06b6d4", "#16a34a", "#f59e0b", "#f97316", "#ec4899", "#ef4444"];
              const color = CARD_COLORS[ci % CARD_COLORS.length];
              const composition = teamRoleComposition.get(t.team.id) || {};
              const totalMembers = t.memberCount;
              return (
                <div
                  key={t.team.id}
                  className="min-w-0"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 12,
                    padding: "16px 18px",
                    background: tint(color, 0.03),
                    borderLeft: `4px solid ${color}`,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {/* Team header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 10 }}>
                    <div className="min-w-0">
                      <div style={{ fontWeight: 800, fontSize: "0.92rem", color, lineHeight: 1.2 }}>{t.team.name}</div>
                      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontWeight: 600, marginTop: 2 }}>{t.team.department}</div>
                    </div>
                    <TeamRoleDonut counts={composition} size={48} />
                  </div>

                  {/* 4-grid KPI */}
                  <div className="grid grid-cols-2 gap-2.5" style={{ marginBottom: 12 }}>
                    {[
                      { label: "Members", val: totalMembers, col: color },
                      { label: "Active Batches", val: t.active, col: "#8b5cf6" },
                      { label: "Completed", val: t.completed, col: "var(--color-success)" },
                      { label: "Hours", val: `${Math.round(t.hours)}h`, col: "var(--color-warning)" },
                    ].map(({ label, val, col }) => (
                      <div key={label} style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", fontWeight: 700, textTransform: "uppercase" }}>{label}</div>
                        <div style={{ fontSize: "1.05rem", fontWeight: 800, color: col }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Role pills */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                    {Object.entries(composition).map(([role, count]) => {
                      const roleColors: Record<string, string> = {
                        Manager: "#0b5cab", Coordinator: "#06b6d4",
                        Faculty: "#8b5cf6", Sales: "#f59e0b", Admin: "#ef4444",
                      };
                      const rc = roleColors[role] || "var(--color-muted-foreground)";
                      return (
                        <span key={role} style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: tint(rc, 0.09), color: rc, border: `1px solid ${tint(rc, 0.2)}` }}>
                          {role}: {count}
                        </span>
                      );
                    })}
                  </div>

                  {/* NPS & Feedback */}
                  <div style={{ display: "flex", gap: 14, paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}>
                    <div>
                      <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", fontWeight: 700, textTransform: "uppercase" }}>Avg NPS</div>
                      <div style={{ fontSize: "0.95rem", fontWeight: 800, color: t.avgNps !== null ? (t.avgNps >= 50 ? "var(--color-success)" : t.avgNps >= 0 ? "var(--color-warning)" : "var(--color-destructive)") : "var(--color-muted-foreground)" }}>
                        {t.avgNps !== null ? t.avgNps.toFixed(1) : "—"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", fontWeight: 700, textTransform: "uppercase" }}>Avg Feedback</div>
                      <div style={{ fontSize: "0.95rem", fontWeight: 800, color: t.avgFeedback !== null ? (t.avgFeedback >= 4 ? "var(--color-success)" : t.avgFeedback >= 3 ? "var(--color-warning)" : "var(--color-destructive)") : "var(--color-muted-foreground)" }}>
                        {t.avgFeedback !== null ? t.avgFeedback.toFixed(2) : "—"}
                        {t.avgFeedback !== null && <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontWeight: 500 }}> / 5</span>}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.62rem", color: "var(--text-dim)", fontWeight: 700, textTransform: "uppercase" }}>Enrollments</div>
                      <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--color-info)" }}>{t.enrollments.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Team Comparison Charts — 3-tab panel */}
      <div className="glass-panel" style={{ padding: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <SectionHeader
            title="Team Analytics Deep-Dive"
            sub="Detailed cross-team performance, composition, and quality analysis"
            icon={BarChart3}
          />
          <SegmentedControl
            label="Team analytics view"
            value={teamAnalyticsTab}
            onChange={setTeamAnalyticsTab}
            options={[
              { value: "comparison", label: "📊 Delivery Comparison" },
              { value: "composition", label: "🧩 Role Composition" },
              { value: "quality", label: "⭐ Quality Matrix" },
            ]}
          />
        </div>

        {/* Tab: Delivery Comparison */}
        {teamAnalyticsTab === "comparison" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Left: Grouped bar chart per team */}
            <div className="min-w-0">
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 14 }}>Batch Delivery Status by Team</div>
              {teamKpiData.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: "0.82rem" }}>No team data available.</div>
              ) : (
                <SvgGroupedBar
                  groups={teamKpiData.map((t) => ({
                    label: t.team.name,
                    values: [t.active, t.completed, t.pipeline],
                  }))}
                  series={[
                    { label: "Active", color: "#8b5cf6" },
                    { label: "Completed", color: "#16a34a" },
                    { label: "Pipeline", color: "#f59e0b" },
                  ]}
                  height={200}
                />
              )}
            </div>

            {/* Right: Hours delivered per team */}
            <div className="min-w-0">
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 14 }}>Training Hours Delivered per Team</div>
              {teamKpiData.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "var(--text-muted)", fontSize: "0.82rem" }}>No team data available.</div>
              ) : (
                <RankedBars
                  data={teamsByHours.map((t) => ({ label: t.team.name, value: Math.round(t.hours), sub: "h" }))}
                  color="var(--color-primary)"
                  maxItems={8}
                />
              )}
            </div>
          </div>
        )}

        {/* Tab: Role Composition */}
        {teamAnalyticsTab === "composition" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 24 }}>
              {teamKpiData.map((t, ci) => {
                const CARD_COLORS = ["#0b5cab", "#8b5cf6", "#06b6d4", "#16a34a", "#f59e0b", "#f97316"];
                const color = CARD_COLORS[ci % CARD_COLORS.length];
                const composition = teamRoleComposition.get(t.team.id) || {};
                const total = Object.values(composition).reduce((a, b) => a + b, 0);
                const roleColors: Record<string, string> = { Manager: "#0b5cab", Coordinator: "#06b6d4", Faculty: "#8b5cf6", Sales: "#f59e0b", Admin: "#ef4444" };
                return (
                  <div key={t.team.id} style={{ border: "1px solid var(--border-subtle)", borderRadius: 12, padding: "14px 16px", background: `${color}05`, borderTop: `3px solid ${color}` }}>
                    <div style={{ fontWeight: 800, fontSize: "0.88rem", color, marginBottom: 4 }}>{t.team.name}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 12 }}>{total} members · {t.team.department}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <TeamRoleDonut counts={composition} size={64} />
                      <div style={{ flex: 1 }}>
                        {Object.entries(composition).map(([role, count]) => {
                          const rc = roleColors[role] || "var(--color-muted-foreground)";
                          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                          return (
                            <div key={role} style={{ marginBottom: 5 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                <span style={{ fontSize: "0.68rem", fontWeight: 700, color: rc }}>{role}</span>
                                <span style={{ fontSize: "0.68rem", color: "var(--text-dim)" }}>{count} ({pct}%)</span>
                              </div>
                              <div style={{ height: 4, background: "var(--color-muted)", borderRadius: 2 }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: rc, borderRadius: 2 }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Technology breakdown */}
            <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 18 }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 14 }}>
                <Layers size={14} style={{ marginRight: 6, verticalAlign: "middle" }} aria-hidden="true" />
                Technology Stack Distribution
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
                {techStats.slice(0, PLOTTED_TECH_LIMIT).map(([tech, s], i) => {
                  const TECH_COLORS = ["#0b5cab", "#8b5cf6", "#06b6d4", "#f59e0b", "#16a34a", "#f97316", "#ec4899", "#ef4444", "#64748b", "#a855f7"];
                  const c = TECH_COLORS[i % TECH_COLORS.length];
                  const activePct = s.batches > 0 ? Math.round((s.active / s.batches) * 100) : 0;
                  return (
                    <div key={tech} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)", background: tint(c, 0.03) }}>
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: tint(c, 0.09), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: "0.8rem", fontWeight: 800, color: c }}>{s.batches}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tech}</div>
                        <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{Math.round(s.hours)}h · {activePct}% active</div>
                        <div style={{ height: 3, background: "var(--color-muted)", borderRadius: 2, marginTop: 3 }}>
                          <div style={{ width: `${activePct}%`, height: "100%", background: c, borderRadius: 2 }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {techStats.length > PLOTTED_TECH_LIMIT && (
                <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", marginTop: 10 }}>
                  Showing the top {PLOTTED_TECH_LIMIT} of {techStats.length} technologies.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Tab: Quality Matrix */}
        {teamAnalyticsTab === "quality" && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* NPS vs Feedback bubble chart */}
            <div className="min-w-0">
              <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 8 }}>Client NPS vs Avg Feedback (bubble = batch volume)</div>
              <QualityBubble data={plottedQualityData} />
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 8, display: "flex", flexWrap: "wrap", gap: 12 }}>
                {plottedQualityData.map((d) => (
                  <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: d.color, flexShrink: 0 }} />
                    <span>{d.label}</span>
                  </div>
                ))}
              </div>
              {hiddenQualityClientCount > 0 && (
                <p style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)", marginTop: 8 }}>
                  +{hiddenQualityClientCount} more client{hiddenQualityClientCount === 1 ? "" : "s"} with NPS or feedback data not plotted ({clientQualityData.length} total).
                </p>
              )}
            </div>

            {/* City heatmap + team NPS ranked */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <div>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 12 }}>
                  <MapPin size={13} style={{ marginRight: 5, verticalAlign: "middle" }} aria-hidden="true" />
                  Top Delivery Locations
                </div>
                <RankedBars
                  data={cityStats.map(([city, s]) => ({ label: city, value: s.batches }))}
                  color="var(--color-info)"
                  maxItems={6}
                />
              </div>

              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 12 }}>
                  <Award size={13} style={{ marginRight: 5, verticalAlign: "middle" }} aria-hidden="true" />
                  Team NPS League
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {teamsByNps.map((t, rank) => {
                    const nps = t.avgNps!;
                    const npsColor = nps >= 50 ? "var(--color-success)" : nps >= 0 ? "var(--color-warning)" : "var(--color-destructive)";
                    const pct = Math.max(0, Math.min(100, ((nps + 100) / 200) * 100));
                    return (
                      <div key={t.team.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 22, height: 22, borderRadius: "50%", background: rank < 3 ? npsColor : "var(--color-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", fontWeight: 800, color: rank < 3 ? "var(--color-primary-foreground)" : "var(--text-dim)", flexShrink: 0 }}>
                          {rank + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-main)" }}>{t.team.name}</span>
                            <span style={{ fontSize: "0.78rem", fontWeight: 800, color: npsColor }}>{nps.toFixed(1)}</span>
                          </div>
                          <div style={{ height: 5, background: "var(--color-muted)", borderRadius: 3 }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: npsColor, borderRadius: 3 }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {teamsByNps.length === 0 && (
                    <div style={{ textAlign: "center", padding: "16px 0", color: "var(--text-muted)", fontSize: "0.8rem" }}>No NPS data yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* PRIMARY SECTION: Team Workload Graphs & Visual Distribution */}
      <div className="glass-panel" style={{ padding: "24px", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <SectionHeader
            title="Team Workload & Capacity Comparison Charts"
            sub="Visual composition of active delivery, review pipeline, and completed volume per personnel"
            icon={BarChart2}
          />

          <SegmentedControl
            label="Workload view"
            value={workloadTab}
            onChange={setWorkloadTab}
            options={[
              { value: "managers", label: "Managers", count: managers.length },
              { value: "coordinators", label: "Coordinators", count: coordinators.length },
            ]}
          />
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 18, marginBottom: 20, flexWrap: "wrap", fontSize: "0.75rem", fontWeight: 700 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: "#8b5cf6" }} />
            <span style={{ color: "var(--text-main)" }}>Active Delivery (Approved/Ongoing)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: "#f59e0b" }} />
            <span style={{ color: "var(--text-main)" }}>Pipeline Review / Pending</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: "#16a34a" }} />
            <span style={{ color: "var(--text-main)" }}>Completed Deliveries</span>
          </div>
        </div>

        {/* Stacked Visual Bar Graph — reads the ledger's sorted, filtered and
            paginated rows so the bars and the table below never disagree. */}
        {workloadTab === "managers" ? (
          managerWorkload.length === 0 ? (
            <div style={{ textAlign: "center", padding: "36px 20px", color: "var(--text-muted)", background: "var(--color-background)", borderRadius: 10, border: "1px dashed var(--border-subtle)" }}>
              <Briefcase size={36} className="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
              <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
                No Subordinate Managers
              </div>
              <div style={{ fontSize: "0.83rem", color: "var(--text-muted)", maxWidth: 440, margin: "0 auto 16px" }}>
                There are no managerial personnel reporting below your management line. You are directly managing {coordinators.length} coordinator(s).
              </div>
              {coordinators.length > 0 && (
                <button
                  type="button"
                  onClick={() => setWorkloadTab("coordinators")}
                  className="btn btn-primary"
                  style={{ padding: "6px 16px", fontSize: "0.8rem" }}
                >
                  View Coordinators ({coordinators.length})
                </button>
              )}
            </div>
          ) : paginatedManagerLedger.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", background: "var(--color-background)", borderRadius: 10, border: "1px dashed var(--border-subtle)" }}>
              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
                No managers match your filters
              </div>
              <div style={{ fontSize: "0.83rem", color: "var(--text-muted)", marginBottom: 14 }}>
                Clear the search or team filter in the Manager Workload Ledger to bring the bars back.
              </div>
              <Button size="sm" variant="outline" onClick={managerFilters.clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {paginatedManagerLedger.map((w) => {
                const total = Math.max(w.total, 1);
                const activePct = (w.active / total) * 100;
                const pendingPct = (w.pending / total) * 100;
                const completedPct = (w.completed / total) * 100;
                const load = loadPercent(w.active, w.total);
                const loadColor = load >= 75 ? "var(--color-destructive)" : load >= 45 ? "var(--color-warning)" : "var(--color-success)";
                const loadStatus = load >= 75 ? "Heavy Load" : load >= 45 ? "Optimal" : "Available";

                return (
                  <div key={w.manager.id} style={{ background: "var(--color-background)", borderRadius: 10, padding: "14px 18px", border: "1px solid var(--border-subtle)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-hover))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary-foreground)", fontSize: "0.75rem", fontWeight: 800, flexShrink: 0 }}>
                          {w.manager.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "var(--text-main)" }}>{w.manager.full_name}</span>
                          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: 8 }}>
                            {w.manager.team_name || "Delivery Team"}
                          </span>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                          <strong>{Math.round(w.totalHours)}h</strong> · <strong>{w.totalEnrollments.toLocaleString()}</strong> learners
                        </span>
                        <span style={{ fontSize: "0.7rem", fontWeight: 800, padding: "3px 9px", borderRadius: 12, background: tint(loadColor, 0.09), color: loadColor, border: `1px solid ${tint(loadColor, 0.25)}` }}>
                          {load}% · {loadStatus}
                        </span>
                      </div>
                    </div>

                    {/* Segmented Stacked Bar */}
                    <div style={{ height: 16, background: "var(--color-muted)", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                      {w.active > 0 && (
                        <div
                          style={{ width: `${activePct}%`, background: "#8b5cf6", height: "100%", transition: "width 0.5s ease" }}
                          title={`Active: ${w.active}`}
                        />
                      )}
                      {w.pending > 0 && (
                        <div
                          style={{ width: `${pendingPct}%`, background: "var(--color-warning)", height: "100%", transition: "width 0.5s ease" }}
                          title={`Pending: ${w.pending}`}
                        />
                      )}
                      {w.completed > 0 && (
                        <div
                          style={{ width: `${completedPct}%`, background: "var(--color-success)", height: "100%", transition: "width 0.5s ease" }}
                          title={`Completed: ${w.completed}`}
                        />
                      )}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: "0.72rem", color: "var(--text-dim)" }}>
                      <span>Active: <strong style={{ color: "#8b5cf6" }}>{w.active}</strong></span>
                      <span>In Review: <strong style={{ color: "var(--color-warning)" }}>{w.pending}</strong></span>
                      <span>Completed: <strong style={{ color: "var(--color-success)" }}>{w.completed}</strong></span>
                      <span>Total Batches: <strong>{w.total}</strong></span>
                    </div>
                  </div>
                );
              })}
              {managerLedgerRows.length > mgrPageSize && (
                <PaginationControls
                  label="Manager workload chart pages"
                  currentPage={mgrPage}
                  totalItems={managerLedgerRows.length}
                  pageSize={mgrPageSize}
                  onPageChange={setMgrPage}
                  onPageSizeChange={setMgrPageSize}
                  pageSizeOptions={[3, 5, 10]}
                />
              )}
            </div>
          )
        ) : coordinatorWorkload.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)" }}>No coordinator workload data available in your scope.</div>
        ) : paginatedCoordinatorLedger.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", background: "var(--color-background)", borderRadius: 10, border: "1px dashed var(--border-subtle)" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              No coordinators match your filters
            </div>
            <div style={{ fontSize: "0.83rem", color: "var(--text-muted)", marginBottom: 14 }}>
              Clear the search or team filter in the Coordinator Workload Ledger to bring the bars back.
            </div>
            <Button size="sm" variant="outline" onClick={coordinatorFilters.clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {paginatedCoordinatorLedger.map((w) => {
              const total = Math.max(w.total, 1);
              const activePct = (w.active / total) * 100;
              const pendingPct = (w.pending / total) * 100;
              const completedPct = (w.completed / total) * 100;
              const capacity = loadPercent(w.active, w.total);
              const capColor = capacity >= 80 ? "var(--color-destructive)" : capacity >= 45 ? "var(--color-warning)" : "var(--color-info)";
              const capStatus = capacity >= 80 ? "High Allocation" : capacity >= 45 ? "Optimal" : "Available Capacity";

              return (
                <div key={w.coordinator.id} style={{ background: "var(--color-background)", borderRadius: 10, padding: "14px 18px", border: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#06b6d4,#0891b2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.75rem", fontWeight: 800, flexShrink: 0 }}>
                        {w.coordinator.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "var(--text-main)" }}>{w.coordinator.full_name}</span>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: 8 }}>
                          {w.coordinator.team_name || "Coordination Team"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        <strong>{Math.round(w.totalHours)}h</strong> · <strong>{w.totalEnrollments.toLocaleString()}</strong> learners
                      </span>
                      <span style={{ fontSize: "0.7rem", fontWeight: 800, padding: "3px 9px", borderRadius: 12, background: tint(capColor, 0.09), color: capColor, border: `1px solid ${tint(capColor, 0.25)}` }}>
                        {capacity}% · {capStatus}
                      </span>
                    </div>
                  </div>

                  {/* Segmented Stacked Bar */}
                  <div style={{ height: 16, background: "var(--color-muted)", borderRadius: 8, overflow: "hidden", display: "flex" }}>
                    {w.active > 0 && (
                      <div
                        style={{ width: `${activePct}%`, background: "var(--color-info)", height: "100%", transition: "width 0.5s ease" }}
                        title={`Active: ${w.active}`}
                      />
                    )}
                    {w.pending > 0 && (
                      <div
                        style={{ width: `${pendingPct}%`, background: "var(--color-warning)", height: "100%", transition: "width 0.5s ease" }}
                        title={`Pending: ${w.pending}`}
                      />
                    )}
                    {w.completed > 0 && (
                      <div
                        style={{ width: `${completedPct}%`, background: "var(--color-success)", height: "100%", transition: "width 0.5s ease" }}
                        title={`Completed: ${w.completed}`}
                      />
                    )}
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: "0.72rem", color: "var(--text-dim)" }}>
                    <span>Active Coordinated: <strong style={{ color: "var(--color-info)" }}>{w.active}</strong></span>
                    <span>In Pipeline: <strong style={{ color: "var(--color-warning)" }}>{w.pending}</strong></span>
                    <span>Completed: <strong style={{ color: "var(--color-success)" }}>{w.completed}</strong></span>
                    <span>Total Batches: <strong>{w.total}</strong></span>
                  </div>
                </div>
              );
            })}
            {coordinatorLedgerRows.length > coordPageSize && (
              <PaginationControls
                label="Coordinator workload chart pages"
                currentPage={coordPage}
                totalItems={coordinatorLedgerRows.length}
                pageSize={coordPageSize}
                onPageChange={setCoordPage}
                onPageSizeChange={setCoordPageSize}
                pageSizeOptions={[5, 10, 20]}
              />
            )}
          </div>
        )}
      </div>

      {/* VISUAL REPRESENTATION 2: Lifecycle Donut & Delivery Velocity Timeline */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        {/* SVG Donut Chart */}
        <div className="glass-panel" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Portfolio Lifecycle Distribution" sub="Proportional status share of batches" icon={PieChart} />
          <SvgDonutChart
            data={donutData}
            total={totalBatches}
            centerTitle={String(totalBatches)}
            centerSubtitle="Total Batches"
          />
        </div>

        {/* SVG Velocity Timeline */}
        <div className="glass-panel" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Delivery Trajectory & Timeline" sub="Historical and scheduled batch initiation rate" icon={LineChart} />
          <SvgDeliveryTimeline batches={activeBatchesDataset} />
          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-subtle)", fontSize: "0.75rem", color: "var(--text-muted)" }}>
            <div>Active Delivery Velocity: <strong style={{ color: "#8b5cf6" }}>{activeBatchesCount} batches</strong></div>
            <div>Completion Velocity: <strong style={{ color: "var(--color-success)" }}>{completedBatches} batches</strong></div>
          </div>
        </div>
      </div>

      {/* VISUAL REPRESENTATION 3: Pipeline Funnel + Mode Split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="glass-panel min-w-0" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Batch Pipeline Funnel" sub="Full lifecycle status distribution" icon={BarChart3} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {pipelineFunnel.map((stage) => (
              <div key={stage.status} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 95, fontSize: "0.74rem", fontWeight: 600, color: "var(--text-dim)", textAlign: "right", flexShrink: 0 }}>
                  {stage.label}
                </div>
                <div style={{ flex: 1, background: "var(--color-muted)", borderRadius: 6, height: 22, position: "relative", overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${(stage.count / maxFunnelCount) * 100}%`,
                      height: "100%",
                      background: stage.color,
                      borderRadius: 6,
                      transition: "width 0.5s ease",
                      minWidth: stage.count > 0 ? 8 : 0,
                    }}
                  />
                </div>
                <div style={{ width: 34, textAlign: "center", fontSize: "0.8rem", fontWeight: 800, color: stage.count > 0 ? stage.color : "var(--color-muted-foreground)" }}>
                  {stage.count}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="glass-panel" style={{ padding: "20px 22px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ position: "relative", width: 64, height: 64, flexShrink: 0 }}>
              <RingProgress percent={completionRate} color="var(--color-success)" size={64} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, color: "var(--color-success)" }}>
                {completionRate}%
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim)" }}>Completion Rate</div>
              <div style={{ fontSize: "1.35rem", fontWeight: 800, color: "var(--color-success)" }}>{completedBatches} Done</div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>of {totalBatches} total batches</div>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: "18px 20px", flex: 1 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 12 }}>
              Delivery Mode Split
            </div>
            {modeStats.map(([mode, count]) => {
              const modeColor = mode === "Online" ? "var(--color-info)" : mode === "Offline" ? "#8b5cf6" : "var(--color-warning)";
              return (
                <div key={mode} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: modeColor }} />
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-main)" }}>{mode}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, height: 5, background: "var(--color-muted)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${totalBatches > 0 ? (count / totalBatches) * 100 : 0}%`, height: "100%", background: modeColor, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-dim)", width: 28, textAlign: "right" }}>{count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Domain Intelligence with Proportional Visual Progress Bars */}
      <div className="glass-panel" style={{ padding: "22px 24px" }}>
        <SectionHeader title="Domain Intelligence" sub="Performance breakdown by training vertical" icon={PieChart} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {domainStats.map(([domain, stats], ci) => {
            const domainCompletion = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
            const colors = ["#0b5cab", "#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#16a34a", "#f97316", "#ec4899"];
            const color = colors[ci % colors.length];
            return (
              <div
                key={domain}
                className="min-w-0"
                style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  background: tint(color, 0.03),
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: "0.88rem", fontWeight: 800, color }}>{domain}</span>
                  <span style={{ fontSize: "0.7rem", fontWeight: 700, background: tint(color, 0.09), color, padding: "2px 8px", borderRadius: 10, flexShrink: 0 }}>
                    {stats.active} Active
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Total", val: stats.total },
                    { label: "Completed", val: stats.completed },
                    { label: "Enrollments", val: stats.enrollments.toLocaleString() },
                    { label: "Hours", val: `${Math.round(stats.hours)}h` },
                  ].map(({ label, val }) => (
                    <div key={label} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.65rem", color: "var(--text-dim)", fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
                      <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-main)" }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-dim)" }}>Completion</span>
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, color }}>{domainCompletion}%</span>
                  </div>
                  <div style={{ height: 4, background: "var(--color-muted)", borderRadius: 3 }}>
                    <div style={{ width: `${domainCompletion}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed workload ledger. The "Workload view" control above owns both the
          chart and the matching ledger, so picking Coordinators must not leave the
          Manager ledger on screen underneath coordinator bars. */}
      {workloadTab === "managers" && (
        <FullscreenTable
          stickyHeader
          stickyTop={NAVBAR_HEIGHT}
          title={
            <PanelTitle
              title="Manager Workload Ledger"
              description="Detailed operational responsibility and allocation for each subordinate manager."
              meta={
                <CountBadge
                  value={`${managerLedgerRows.length} of ${managerWorkload.length}`}
                  label={
                    managerLedgerRows.length === managerWorkload.length ? "managers" : "managers match"
                  }
                />
              }
            />
          }
          toolbar={
            <TableFilters
              search={{
                value: managerFilters.search,
                onChange: managerFilters.setSearch,
                placeholder: "Search manager, team...",
              }}
              selects={[
                {
                  key: "team",
                  label: "Team",
                  value: managerFilters.getFilter("team"),
                  onChange: (value) => managerFilters.setFilter("team", value),
                  options: managerFilters.optionsFor("team"),
                  allLabel: "All teams",
                },
              ]}
              sort={{
                options: MANAGER_LEDGER_SORT_OPTIONS,
                sortKey: managerSort.sortKey,
                sortDir: managerSort.sortDir,
                onChange: managerSort.applySort,
              }}
              onClear={managerFilters.clearFilters}
              hasActiveFilters={managerFilters.hasActiveFilters}
              activeFilterCount={managerFilters.activeFilterCount}
            />
          }
          actions={
            <>
              <ColumnsMenu
                columns={MANAGER_LEDGER_COLUMN_KEYS}
                hidden={managerColumns.hidden}
                onToggle={managerColumns.toggle}
                onShowAll={managerColumns.showAll}
              />
              <ExportButton
                filename="manager-workload-ledger"
                columns={MANAGER_LEDGER_CSV}
                rows={managerLedgerRows}
              />
            </>
          }
          footer={
            managerWorkload.length > 0 ? (
              <PaginationControls
                label="Manager ledger pages"
                currentPage={mgrPage}
                totalItems={managerLedgerRows.length}
                pageSize={mgrPageSize}
                onPageChange={setMgrPage}
                onPageSizeChange={setMgrPageSize}
                pageSizeOptions={[5, 10, 20]}
              />
            ) : null
          }
        >
          <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 800 }}>
            <TableCaption>
              Subordinate managers with active, pending and completed batch counts, hours, enrollments and load
            </TableCaption>
            <thead>
              <tr>
                {MANAGER_LEDGER_COLUMNS.map((column) =>
                  managerColumns.isVisible(column.key) ? (
                    <SortableHeaderCell
                      key={column.key}
                      columnKey={column.key}
                      label={column.label}
                      sortKey={managerSort.sortKey}
                      sortDir={managerSort.sortDir}
                      onSort={managerSort.toggleSort}
                      style={WORKLOAD_TH_STYLE}
                    />
                  ) : null
                )}
              </tr>
            </thead>
            <tbody>
              {managerLedgerRows.length === 0 ? (
                <TableStateRow colSpan={managerVisibleColumnCount}>
                  {managerFilters.hasActiveFilters ? (
                    <EmptyState
                      icon={<Search className="h-5 w-5" aria-hidden="true" />}
                      title="No managers match your filters"
                      description="Clear the search or team selection to see every subordinate manager."
                      action={
                        <Button size="sm" variant="outline" onClick={managerFilters.clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
                      title="No subordinate managers"
                      description="There is no managerial personnel reporting below your direct line."
                    />
                  )}
                </TableStateRow>
              ) : (
                paginatedManagerLedger.map((row) => {
                  const { manager, total, active, pending, completed, totalHours, totalEnrollments } = row;
                  const load = loadPercent(active, total);
                  const loadColor = load >= 75 ? "var(--color-destructive)" : load >= 45 ? "var(--color-warning)" : "var(--color-success)";
                  return (
                    <tr key={manager.id} style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.83rem" }}>
                      {managerColumns.isVisible("manager") && (
                        <td style={WORKLOAD_CELL_STYLE}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,var(--color-primary),var(--color-primary-hover))", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-primary-foreground)", fontSize: "0.7rem", fontWeight: 800, flexShrink: 0 }}>
                              {manager.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>{manager.full_name}</div>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{manager.email}</div>
                            </div>
                          </div>
                        </td>
                      )}
                      {managerColumns.isVisible("team") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--text-muted)" }}>{manager.team_name || "—"}</td>
                      )}
                      {managerColumns.isVisible("active") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, fontWeight: 800, color: "#8b5cf6", fontSize: "1rem" }}>{active}</td>
                      )}
                      {managerColumns.isVisible("pending") && (
                        <td style={WORKLOAD_CELL_STYLE}>
                          {pending > 0 ? (
                            <span style={{ color: "var(--color-warning)", fontWeight: 700 }}>{pending}</span>
                          ) : (
                            <span style={{ color: "var(--color-muted-foreground)" }}>—</span>
                          )}
                        </td>
                      )}
                      {managerColumns.isVisible("completed") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--color-success)", fontWeight: 600 }}>{completed}</td>
                      )}
                      {managerColumns.isVisible("total") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, fontWeight: 700 }}>{total}</td>
                      )}
                      {managerColumns.isVisible("hours") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--text-muted)" }}>{Math.round(totalHours)}h</td>
                      )}
                      {managerColumns.isVisible("enrollments") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--text-muted)" }}>{totalEnrollments.toLocaleString()}</td>
                      )}
                      {managerColumns.isVisible("load") && (
                        <td style={WORKLOAD_CELL_STYLE}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            <div style={{ height: 6, width: 72, background: "var(--color-muted)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${load}%`, height: "100%", background: loadColor, borderRadius: 3, transition: "width 0.4s" }} />
                            </div>
                            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: loadColor }}>{load}%</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </FullscreenTable>
      )}

      {workloadTab === "coordinators" && (
        <FullscreenTable
          stickyHeader
          stickyTop={NAVBAR_HEIGHT}
          title={
            <PanelTitle
              title="Coordinator Workload Ledger"
              description="Operational capacity and batch tracking for each coordinator in scope."
              meta={
                <CountBadge
                  value={`${coordinatorLedgerRows.length} of ${coordinatorWorkload.length}`}
                  label={
                    coordinatorLedgerRows.length === coordinatorWorkload.length
                      ? "coordinators"
                      : "coordinators match"
                  }
                />
              }
            />
          }
          toolbar={
            <TableFilters
              search={{
                value: coordinatorFilters.search,
                onChange: coordinatorFilters.setSearch,
                placeholder: "Search coordinator, team...",
              }}
              selects={[
                {
                  key: "team",
                  label: "Team",
                  value: coordinatorFilters.getFilter("team"),
                  onChange: (value) => coordinatorFilters.setFilter("team", value),
                  options: coordinatorFilters.optionsFor("team"),
                  allLabel: "All teams",
                },
              ]}
              sort={{
                options: COORDINATOR_LEDGER_SORT_OPTIONS,
                sortKey: coordinatorSort.sortKey,
                sortDir: coordinatorSort.sortDir,
                onChange: coordinatorSort.applySort,
              }}
              onClear={coordinatorFilters.clearFilters}
              hasActiveFilters={coordinatorFilters.hasActiveFilters}
              activeFilterCount={coordinatorFilters.activeFilterCount}
            />
          }
          actions={
            <>
              <ColumnsMenu
                columns={COORDINATOR_LEDGER_COLUMN_KEYS}
                hidden={coordinatorColumns.hidden}
                onToggle={coordinatorColumns.toggle}
                onShowAll={coordinatorColumns.showAll}
              />
              <ExportButton
                filename="coordinator-workload-ledger"
                columns={COORDINATOR_LEDGER_CSV}
                rows={coordinatorLedgerRows}
              />
            </>
          }
          footer={
            coordinatorWorkload.length > 0 ? (
              <PaginationControls
                label="Coordinator ledger pages"
                currentPage={coordPage}
                totalItems={coordinatorLedgerRows.length}
                pageSize={coordPageSize}
                onPageChange={setCoordPage}
                onPageSizeChange={setCoordPageSize}
                pageSizeOptions={[5, 10, 20, 50]}
              />
            ) : null
          }
        >
          <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 800 }}>
            <TableCaption>
              Coordinators with active, in-pipeline and completed batch counts, hours, enrollments and allocation
            </TableCaption>
            <thead>
              <tr>
                {COORDINATOR_LEDGER_COLUMNS.map((column) =>
                  coordinatorColumns.isVisible(column.key) ? (
                    <SortableHeaderCell
                      key={column.key}
                      columnKey={column.key}
                      label={column.label}
                      sortKey={coordinatorSort.sortKey}
                      sortDir={coordinatorSort.sortDir}
                      onSort={coordinatorSort.toggleSort}
                      style={WORKLOAD_TH_STYLE}
                    />
                  ) : null
                )}
              </tr>
            </thead>
            <tbody>
              {coordinatorLedgerRows.length === 0 ? (
                <TableStateRow colSpan={coordinatorVisibleColumnCount}>
                  {coordinatorFilters.hasActiveFilters ? (
                    <EmptyState
                      icon={<Search className="h-5 w-5" aria-hidden="true" />}
                      title="No coordinators match your filters"
                      description="Clear the search or team selection to see every coordinator in scope."
                      action={
                        <Button size="sm" variant="outline" onClick={coordinatorFilters.clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<Users className="h-5 w-5" aria-hidden="true" />}
                      title="No coordinators in scope"
                      description="No coordinator workload data is available in your scope."
                    />
                  )}
                </TableStateRow>
              ) : (
                paginatedCoordinatorLedger.map((row) => {
                  const { coordinator, total, active, pending, completed, totalHours, totalEnrollments } = row;
                  const capacity = loadPercent(active, total);
                  const capColor = capacity >= 80 ? "var(--color-destructive)" : capacity >= 45 ? "var(--color-warning)" : "var(--color-info)";
                  return (
                    <tr key={coordinator.id} style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.83rem" }}>
                      {coordinatorColumns.isVisible("coordinator") && (
                        <td style={WORKLOAD_CELL_STYLE}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg,#06b6d4,#0891b2)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: "0.7rem", fontWeight: 800, flexShrink: 0 }}>
                              {coordinator.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 700 }}>{coordinator.full_name}</div>
                              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{coordinator.email}</div>
                            </div>
                          </div>
                        </td>
                      )}
                      {coordinatorColumns.isVisible("team") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--text-muted)" }}>{coordinator.team_name || "—"}</td>
                      )}
                      {coordinatorColumns.isVisible("active") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, fontWeight: 800, color: "var(--color-info)", fontSize: "1rem" }}>{active}</td>
                      )}
                      {coordinatorColumns.isVisible("pipeline") && (
                        <td style={WORKLOAD_CELL_STYLE}>
                          {pending > 0 ? (
                            <span style={{ color: "var(--color-warning)", fontWeight: 700 }}>{pending}</span>
                          ) : (
                            <span style={{ color: "var(--color-muted-foreground)" }}>—</span>
                          )}
                        </td>
                      )}
                      {coordinatorColumns.isVisible("completed") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--color-success)", fontWeight: 600 }}>{completed}</td>
                      )}
                      {coordinatorColumns.isVisible("total") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, fontWeight: 700 }}>{total}</td>
                      )}
                      {coordinatorColumns.isVisible("hours") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--text-muted)" }}>{Math.round(totalHours)}h</td>
                      )}
                      {coordinatorColumns.isVisible("learners") && (
                        <td style={{ ...WORKLOAD_CELL_STYLE, color: "var(--text-muted)" }}>{totalEnrollments.toLocaleString()}</td>
                      )}
                      {coordinatorColumns.isVisible("capacity") && (
                        <td style={WORKLOAD_CELL_STYLE}>
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                            <div style={{ height: 6, width: 72, background: "var(--color-muted)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${capacity}%`, height: "100%", background: capColor, borderRadius: 3, transition: "width 0.4s" }} />
                            </div>
                            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: capColor }}>{capacity}%</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </FullscreenTable>
      )}

      {/* Client Portfolio + Executive Quality Panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <FullscreenTable
          className="min-w-0"
          stickyHeader
          stickyTop={NAVBAR_HEIGHT}
          title={
            <PanelTitle
              title="Client Portfolio"
              description="Top clients by batch volume and active deployments."
              meta={
                <CountBadge
                  value={`${clientPortfolioRows.length} of ${clientStats.length}`}
                  label={
                    clientPortfolioRows.length === clientStats.length ? "clients" : "clients match"
                  }
                />
              }
            />
          }
          toolbar={
            <TableFilters
              search={{
                value: clientFilters.search,
                onChange: clientFilters.setSearch,
                placeholder: "Search client...",
              }}
              selects={[
                {
                  key: "client",
                  label: "Client",
                  value: clientFilters.getFilter("client"),
                  onChange: (value) => clientFilters.setFilter("client", value),
                  options: clientFilters.optionsFor("client"),
                  allLabel: "All clients",
                },
              ]}
              sort={{
                options: CLIENT_PORTFOLIO_SORT_OPTIONS,
                sortKey: clientSort.sortKey,
                sortDir: clientSort.sortDir,
                onChange: clientSort.applySort,
              }}
              onClear={clientFilters.clearFilters}
              hasActiveFilters={clientFilters.hasActiveFilters}
              activeFilterCount={clientFilters.activeFilterCount}
            />
          }
          actions={
            <>
              <ColumnsMenu
                columns={CLIENT_PORTFOLIO_COLUMN_KEYS}
                hidden={clientColumns.hidden}
                onToggle={clientColumns.toggle}
                onShowAll={clientColumns.showAll}
              />
              <ExportButton
                filename="client-portfolio"
                columns={CLIENT_PORTFOLIO_CSV}
                rows={clientPortfolioRows}
              />
            </>
          }
          footer={
            clientPortfolioRows.length > clientPageSize ? (
              <PaginationControls
                label="Client portfolio pages"
                currentPage={clientPage}
                totalItems={clientPortfolioRows.length}
                pageSize={clientPageSize}
                onPageChange={setClientPage}
                onPageSizeChange={setClientPageSize}
                pageSizeOptions={[5, 10, 20]}
              />
            ) : null
          }
        >
          <table className="glass-table table-pin-first-col w-full border-collapse">
            <TableCaption>Clients ranked by batch volume, with active deployments, enrollments and hours</TableCaption>
            <thead>
              <tr>
                {CLIENT_PORTFOLIO_COLUMNS.map((column) => {
                  if (!clientColumns.isVisible(column.key)) return null;
                  return !isSortable(column) ? (
                    <PlainHeaderCell key={column.key} style={PORTFOLIO_TH_STYLE}>
                      {column.label}
                    </PlainHeaderCell>
                  ) : (
                    <SortableHeaderCell
                      key={column.key}
                      columnKey={column.key}
                      label={column.label}
                      sortKey={clientSort.sortKey}
                      sortDir={clientSort.sortDir}
                      onSort={clientSort.toggleSort}
                      style={PORTFOLIO_TH_STYLE}
                    />
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {clientPortfolioRows.length === 0 ? (
                <TableStateRow colSpan={clientVisibleColumnCount}>
                  {clientFilters.hasActiveFilters ? (
                    <EmptyState
                      icon={<Search className="h-5 w-5" aria-hidden="true" />}
                      title="No clients match your filters"
                      description="Clear the search or client selection to see the full portfolio."
                      action={
                        <Button size="sm" variant="outline" onClick={clientFilters.clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState
                      icon={<Target className="h-5 w-5" aria-hidden="true" />}
                      title="No client data in this horizon"
                      description="Switch the reporting horizon to a wider window to see client activity."
                    />
                  )}
                </TableStateRow>
              ) : (
                paginatedClientStats.map(([client, stats], i) => (
                  <tr key={client} style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.82rem" }}>
                    {clientColumns.isVisible("index") && (
                      <td style={{ ...PORTFOLIO_CELL_STYLE, color: "var(--text-dim)", fontWeight: 700 }}>
                        {(clientPage - 1) * clientPageSize + i + 1}
                      </td>
                    )}
                    {clientColumns.isVisible("client") && (
                      <td style={{ ...PORTFOLIO_CELL_STYLE, fontWeight: 700 }}>{client}</td>
                    )}
                    {clientColumns.isVisible("batches") && (
                      <td style={{ ...PORTFOLIO_CELL_STYLE, fontWeight: 800, color: "var(--color-primary)" }}>{stats.batches}</td>
                    )}
                    {clientColumns.isVisible("active") && (
                      <td style={PORTFOLIO_CELL_STYLE}>
                        {stats.active > 0 ? (
                          <span style={{ color: "var(--color-success)", fontWeight: 700 }}>{stats.active}</span>
                        ) : (
                          <span style={{ color: "var(--color-muted-foreground)" }}>—</span>
                        )}
                      </td>
                    )}
                    {clientColumns.isVisible("enrollments") && (
                      <td style={{ ...PORTFOLIO_CELL_STYLE, color: "var(--text-muted)" }}>{stats.enrollments.toLocaleString()}</td>
                    )}
                    {clientColumns.isVisible("hours") && (
                      <td style={{ ...PORTFOLIO_CELL_STYLE, color: "var(--text-muted)" }}>{Math.round(stats.hours)}h</td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </FullscreenTable>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {dashboardSummary && (
            <>
              <div className="glass-panel" style={{ padding: "18px 20px", borderLeft: "4px solid var(--color-success)" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>
                  Overall NPS
                </div>
                <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--color-success)" }}>
                  {dashboardSummary.overall_avg_nps !== null ? Number(dashboardSummary.overall_avg_nps).toFixed(1) : "—"}
                  <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--text-muted)" }}> / 10</span>
                </div>
                <div style={{ fontSize: "0.73rem", color: "var(--text-muted)", marginTop: 2 }}>NPS Closure Executive Score</div>
              </div>
              <div className="glass-panel" style={{ padding: "18px 20px", borderLeft: "4px solid var(--color-warning)" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>
                  Average Batch Feedback
                </div>
                <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--color-warning)" }}>
                  {dashboardSummary.overall_avg_feedback !== null ? Number(dashboardSummary.overall_avg_feedback).toFixed(2) : "—"}
                  <span style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--text-muted)" }}> / 5.0</span>
                </div>
                <div style={{ fontSize: "0.73rem", color: "var(--text-muted)", marginTop: 2 }}>Session satisfaction index</div>
              </div>
              <div className="glass-panel" style={{ padding: "18px 20px", borderLeft: "4px solid #8b5cf6" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 6 }}>
                  Faculty Utilization
                </div>
                <div style={{ fontSize: "2.2rem", fontWeight: 800, color: "#8b5cf6" }}>
                  {Number(dashboardSummary.faculty_utilization_ratio).toFixed(1)}%
                </div>
                <div style={{ height: 6, background: "var(--color-muted)", borderRadius: 3, marginTop: 8 }}>
                  <div style={{ width: `${Number(dashboardSummary.faculty_utilization_ratio)}%`, height: "100%", background: "#8b5cf6", borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: "0.73rem", color: "var(--text-muted)", marginTop: 4 }}>Trainer deployment efficiency</div>
              </div>
              <div className="glass-panel" style={{ padding: "16px 18px", background: "var(--color-warning-light)", border: "1px solid var(--color-border)" }}>
                <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "#ea580c", marginBottom: 8 }}>
                  ⚠ Gate Alerts
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                    <span>Pending G1 Feedbacks</span>
                    <span style={{ fontWeight: 800, color: "#ea580c" }}>{dashboardSummary.pending_gate1_feedbacks}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                    <span>Pending G2 Closures</span>
                    <span style={{ fontWeight: 800, color: "#ea580c" }}>{dashboardSummary.pending_gate2_closures}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Period Activity Feed */}
      <FullscreenTable
        stickyHeader
        stickyTop={NAVBAR_HEIGHT}
        title={
          <PanelTitle
            title={`${PERIOD_LABELS[period]} — Batch Activity`}
            description="Every batch in the selected horizon, with client, program and delivery status."
            meta={
              <CountBadge
                value={`${activityFeedRows.length} of ${activeBatchesDataset.length}`}
                label={
                  activityFeedRows.length === activeBatchesDataset.length ? "batches" : "batches match"
                }
              />
            }
          />
        }
        toolbar={
          <TableFilters
            search={{
              value: activityFilters.search,
              onChange: activityFilters.setSearch,
              placeholder: "Search batch, client, program...",
            }}
            selects={[
              {
                key: "client",
                label: "Client",
                value: activityFilters.getFilter("client"),
                onChange: (value) => activityFilters.setFilter("client", value),
                options: activityFilters.optionsFor("client"),
                allLabel: "All clients",
              },
              {
                key: "domain",
                label: "Domain",
                value: activityFilters.getFilter("domain"),
                onChange: (value) => activityFilters.setFilter("domain", value),
                options: activityFilters.optionsFor("domain"),
                allLabel: "All domains",
              },
              {
                key: "mode",
                label: "Mode",
                value: activityFilters.getFilter("mode"),
                onChange: (value) => activityFilters.setFilter("mode", value),
                options: activityFilters.optionsFor("mode"),
                allLabel: "All modes",
              },
              {
                key: "status",
                label: "Status",
                value: activityFilters.getFilter("status"),
                onChange: (value) => activityFilters.setFilter("status", value),
                options: activityFilters.optionsFor("status"),
                allLabel: "All statuses",
              },
            ]}
            sort={{
              options: ACTIVITY_FEED_SORT_OPTIONS,
              sortKey: activitySort.sortKey,
              sortDir: activitySort.sortDir,
              onChange: activitySort.applySort,
            }}
            onClear={activityFilters.clearFilters}
            hasActiveFilters={activityFilters.hasActiveFilters}
            activeFilterCount={activityFilters.activeFilterCount}
          />
        }
        actions={
          <>
            <ColumnsMenu
              columns={ACTIVITY_FEED_COLUMN_KEYS}
              hidden={activityColumns.hidden}
              onToggle={activityColumns.toggle}
              onShowAll={activityColumns.showAll}
            />
            <ExportButton filename="batch-activity" columns={ACTIVITY_FEED_CSV} rows={activityFeedRows} />
          </>
        }
        footer={
          activityFeedRows.length > 0 ? (
            <PaginationControls
              label="Batch activity pages"
              currentPage={activityPage}
              totalItems={activityFeedRows.length}
              pageSize={activityPageSize}
              onPageChange={setActivityPage}
              onPageSizeChange={setActivityPageSize}
              pageSizeOptions={[10, 25, 50, 100]}
            />
          ) : null
        }
      >
        <table className="glass-table table-pin-first-col w-full border-collapse" style={{ minWidth: 700 }}>
          <TableCaption>
            Batch activity for the selected horizon, with client, program, domain, mode, start date and status
          </TableCaption>
          <thead>
            <tr>
              {ACTIVITY_FEED_COLUMNS.map((column) =>
                activityColumns.isVisible(column.key) ? (
                  <SortableHeaderCell
                    key={column.key}
                    columnKey={column.key}
                    label={column.label}
                    sortKey={activitySort.sortKey}
                    sortDir={activitySort.sortDir}
                    onSort={activitySort.toggleSort}
                    style={{ ...ACTIVITY_FEED_TH_STYLE, textAlign: columnAlign(column) }}
                  />
                ) : null
              )}
            </tr>
          </thead>
          <tbody>
            {activityFeedRows.length === 0 ? (
              <TableStateRow colSpan={activityVisibleColumnCount}>
                {activityFilters.hasActiveFilters ? (
                  <EmptyState
                    icon={<Search className="h-5 w-5" aria-hidden="true" />}
                    title="No batches match your filters"
                    description="Clear the search or filter selections to see every batch in this horizon."
                    action={
                      <Button size="sm" variant="outline" onClick={activityFilters.clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
                    title="No batch activity in this horizon"
                    description={`Nothing was scheduled, started or created for ${PERIOD_LABELS[period].toLowerCase()}.`}
                  />
                )}
              </TableStateRow>
            ) : (
              paginatedActivityBatches.map((b) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--border-subtle)", fontSize: "0.81rem" }}>
                  {activityColumns.isVisible("batchId") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, fontWeight: 700, color: "var(--color-primary)", whiteSpace: "nowrap" }}>
                      {b.batch_id}
                    </td>
                  )}
                  {activityColumns.isVisible("client") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, whiteSpace: "nowrap" }}>{b.client_name || "—"}</td>
                  )}
                  {activityColumns.isVisible("program") && (
                    <td
                      style={{ ...ACTIVITY_FEED_CELL_STYLE, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={b.program_name}
                    >
                      {b.program_name}
                    </td>
                  )}
                  {activityColumns.isVisible("domain") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, whiteSpace: "nowrap" }}>{b.domain || "—"}</td>
                  )}
                  {activityColumns.isVisible("mode") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, whiteSpace: "nowrap" }}>{b.delivery_mode}</td>
                  )}
                  {activityColumns.isVisible("startDate") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, whiteSpace: "nowrap" }}>
                      {b.start_date ? formatDate(b.start_date) : "—"}
                    </td>
                  )}
                  {activityColumns.isVisible("enrollments") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, textAlign: "center" }}>{b.total_enrollments}</td>
                  )}
                  {activityColumns.isVisible("hours") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, textAlign: "center" }}>{b.total_hours}</td>
                  )}
                  {activityColumns.isVisible("status") && (
                    <td style={{ ...ACTIVITY_FEED_CELL_STYLE, whiteSpace: "nowrap" }}>
                      <StatusBadge status={b.status} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </FullscreenTable>
    </div>
  );
}
