"use client";

import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TABLE_CONTROL_HEIGHT } from "@/components/table/TableFilters";

interface PaginationControlsProps {
  currentPage: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** Visible label for assistive tech, e.g. "Staff directory pages". */
  label?: string;
  /** Accent for the current-page button; defaults to the theme primary. */
  color?: string;
}

// Toolbar metrics shared with `TableFilters` so the footer sits on the same grid
// as the header controls.
const CONTROL_HEIGHT = TABLE_CONTROL_HEIGHT;
const CONTROL_CLASS =
  "h-9 rounded-md border border-input bg-background text-[0.8rem] font-semibold text-foreground hover:bg-accent hover:text-accent-foreground";

export function PaginationControls({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  label = "Table pagination",
  color,
}: PaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(Math.max(1, currentPage), totalPages);

  // Several tables can share one view, and `label` is not guaranteed to be
  // unique, so the control ids come from useId rather than from the label. A
  // duplicate id silently breaks the "Rows" label/select association.
  const instanceId = React.useId();
  const pageSizeId = `${instanceId}-page-size`;

  // Clamping happens in an effect: doing it during render schedules a state
  // update from inside the render pass.
  useEffect(() => {
    if (currentPage !== validPage) onPageChange(validPage);
  }, [currentPage, validPage, onPageChange]);

  if (totalItems === 0) return null;

  const startItem = (validPage - 1) * pageSize + 1;
  const endItem = Math.min(validPage * pageSize, totalItems);
  const atStart = validPage <= 1;
  const atEnd = validPage >= totalPages;

  const pageNumbers: (number | string)[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
  } else {
    pageNumbers.push(1);
    if (validPage > 3) pageNumbers.push("...");
    const from = Math.max(2, validPage - 1);
    const to = Math.min(totalPages - 1, validPage + 1);
    for (let i = from; i <= to; i++) pageNumbers.push(i);
    if (validPage < totalPages - 2) pageNumbers.push("...");
    pageNumbers.push(totalPages);
  }

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5 text-[0.8rem] text-muted-foreground"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Showing <strong className="font-semibold text-foreground">{startItem}</strong> to{" "}
          <strong className="font-semibold text-foreground">{endItem}</strong> of{" "}
          <strong className="font-semibold text-foreground">{totalItems}</strong> entries
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5">
            <label htmlFor={pageSizeId} className="text-xs">
              Rows
            </label>
            <select
              id={pageSizeId}
              value={pageSize}
              onChange={(event) => {
                onPageSizeChange(Number(event.target.value));
                onPageChange(1);
              }}
              style={{ height: CONTROL_HEIGHT }}
              className="rounded-md border border-input bg-background px-2 text-[0.8rem] font-semibold text-foreground"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className={CONTROL_CLASS}
          onClick={() => onPageChange(validPage - 1)}
          onMouseDown={(e) => e.preventDefault()}
          onFocus={(e) => e.preventDefault()}
          disabled={atStart}
          title="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span>Prev</span>
        </Button>

        {pageNumbers.map((entry, index) => {
          if (entry === "...") {
            return (
              <span key={`dots-${index}`} className="px-1 text-muted-foreground">
                &hellip;
              </span>
            );
          }
          const isCurrent = entry === validPage;
          return (
            <Button
              key={entry}
              variant={isCurrent ? "default" : "outline"}
              size="sm"
              className={CONTROL_CLASS}
              onClick={() => onPageChange(Number(entry))}
              onMouseDown={(e) => e.preventDefault()}
              onFocus={(e) => e.preventDefault()}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={`Page ${entry}`}
              style={isCurrent ? { backgroundColor: color ?? "var(--color-primary)" } : undefined}
            >
              {entry}
            </Button>
          );
        })}

        <Button
          variant="outline"
          size="sm"
          className={CONTROL_CLASS}
          onClick={() => onPageChange(validPage + 1)}
          onMouseDown={(e) => e.preventDefault()}
          onFocus={(e) => e.preventDefault()}
          disabled={atEnd}
          title="Next page"
        >
          <span>Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}