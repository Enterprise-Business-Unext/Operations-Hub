"use client";

import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { SortDir } from "@/lib/tableUtils";

const ACCENT = "#0b5cab";

export const SORTABLE_TH_STYLE: React.CSSProperties = {
  padding: "12px 16px",
  // `th` defaults to centred in the UA stylesheet and Tailwind's preflight does
  // not reset it, so every heading must opt in or it floats over its cells.
  textAlign: "left",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  // 0.975rem, not 0.78rem: the app renders at 80% scale, so this holds the
  // physical size these headings had before. This is the only heading size the
  // drawer's local `TIMETABLE_TH_STYLE` inherits, since it does not spread
  // `TABLE_TH_STYLE`.
  fontSize: "0.975rem",
  color: "#111827",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 800,
};

const TRIGGER_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "transparent",
  border: "none",
  margin: 0,
  padding: 0,
  font: "inherit",
  letterSpacing: "inherit",
  textTransform: "inherit",
  cursor: "pointer",
};

export interface SortableHeaderCellProps
  extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "onClick" | "children"> {
  columnKey: string;
  label: React.ReactNode;
  sortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
  activeColor?: string;
  /** Minimum column width in px, used by the wide ledgers. */
  minWidth?: number;
}

/**
 * `<th>` that toggles its column's sort direction (unsorted -> asc -> desc -> unsorted).
 * Use next to `PlainHeaderCell` for columns that are not sortable.
 */
export function SortableHeaderCell({
  columnKey,
  label,
  sortKey,
  sortDir,
  onSort,
  activeColor = ACCENT,
  minWidth,
  style,
  ...rest
}: SortableHeaderCellProps) {
  const isActive = sortKey === columnKey && sortDir !== null;
  const labelText = typeof label === "string" ? label : "";
  const Icon = sortDir === "asc" ? ArrowUp : sortDir === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <th
      scope="col"
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      style={{
        ...SORTABLE_TH_STYLE,
        ...(minWidth ? { minWidth } : null),
        ...(isActive ? { color: activeColor } : null),
        ...style,
      }}
      {...rest}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        onMouseDown={(e) => e.preventDefault()}
        onFocus={(e) => e.preventDefault()}
        title={
          isActive
            ? `Sorted ${sortDir === "asc" ? "ascending" : "descending"} — click to change`
            : `Sort by ${labelText || "column"}`
        }
        style={{ ...TRIGGER_STYLE, color: isActive ? activeColor : "inherit" }}
      >
        <span>{label}</span>
        <Icon size={12} aria-hidden="true" style={{ flexShrink: 0, opacity: isActive ? 1 : 0.45 }} />
      </button>
    </th>
  );
}

export interface PlainHeaderCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Minimum column width in px, used by the wide ledgers. */
  minWidth?: number;
}

/** Non-sortable header cell that matches `SortableHeaderCell` styling. */
export function PlainHeaderCell({ children, minWidth, style, ...rest }: PlainHeaderCellProps) {
  return (
    <th
      scope="col"
      style={{ ...SORTABLE_TH_STYLE, ...(minWidth ? { minWidth } : null), ...style }}
      {...rest}
    >
      {children}
    </th>
  );
}