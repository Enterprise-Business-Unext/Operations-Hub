"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Columns3, Download, MoreHorizontal, RefreshCw } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { downloadCsv, type CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/utils";

/** Every panel-level table control is `sm`, i.e. the toolbar control height. */
const TOOL_BUTTON = "h-9 shrink-0";

function useDismissOnOutside(ref: React.RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, open, onClose]);
}

const POPOVER_CLASS = cn(
  "absolute right-0 top-full z-40 mt-1.5 min-w-[13rem] rounded-xl border border-border bg-popover p-1.5 shadow-lg",
  "animate-fade-in"
);

export interface MenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  tone?: "default" | "destructive";
  description?: string;
}

/**
 * Overflow menu for table-level actions that do not deserve a permanent button
 * next to the toolbar (bulk utilities, secondary flows).
 */
export function TableMenu({
  items,
  label = "More actions",
  triggerLabel,
}: {
  items: readonly MenuItem[];
  label?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useDismissOnOutside(rootRef, open, close);

  useEffect(() => {
    if (!open) return;
    const firstItem = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [open]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(current + direction + items.length) % items.length].focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? items[0] : items[items.length - 1]).focus();
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        className={TOOL_BUTTON}
        ref={triggerRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onMouseDown={(e) => e.preventDefault()}
        onFocus={(e) => e.preventDefault()}
        title={label}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        {triggerLabel ? <span>{triggerLabel}</span> : <span className="sr-only">{label}</span>}
      </Button>

      {open && (
        <div id={menuId} role="menu" className={POPOVER_CLASS} onKeyDown={handleMenuKeyDown}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                item.onSelect();
              }}
              onMouseDown={(e) => e.preventDefault()}
              onFocus={(e) => e.preventDefault()}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors hover:bg-accent",
                item.tone === "destructive" && "text-destructive hover:bg-destructive/10"
              )}
            >
              {item.icon && <span className="shrink-0 text-muted-foreground">{item.icon}</span>}
              <span className="min-w-0">
                <span className="block">{item.label}</span>
                {item.description && (
                  <span className="block text-xs font-normal text-muted-foreground">{item.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Column show/hide picker; the table renders only the checked columns. */
export function ColumnsMenu<K extends string>({
  columns,
  hidden,
  onToggle,
  onShowAll,
}: {
  columns: readonly { key: K; label: string }[];
  hidden: ReadonlySet<K>;
  onToggle: (key: K) => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const hiddenCount = hidden.size;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useDismissOnOutside(rootRef, open, close);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        className={TOOL_BUTTON}
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onMouseDown={(e) => e.preventDefault()}
        onFocus={(e) => e.preventDefault()}
        title="Choose visible columns"
      >
        <Columns3 className="h-4 w-4" aria-hidden="true" />
        <span>Columns</span>
        {hiddenCount > 0 && (
          <span className="rounded-full bg-primary/10 px-1.5 text-[0.7rem] font-bold text-primary">
            {columns.length - hiddenCount}/{columns.length}
          </span>
        )}
      </Button>

      {open && (
        <div id={menuId} role="group" aria-labelledby={`${menuId}-label`} className={POPOVER_CLASS}>
          <p className="px-2.5 pb-1 pt-0.5 text-[0.62rem] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
            <span id={`${menuId}-label`}>
            Visible columns
            </span>
          </p>
          <div className="max-h-64 overflow-y-auto">
            {columns.map((column) => {
              const checked = !hidden.has(column.key);
              return (
                <label
                  key={column.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(column.key)}
                    onMouseDown={(e) => e.preventDefault()}
                    onFocus={(e) => e.preventDefault()}
                    className="h-4 w-4 rounded border-input accent-[hsl(214_88%_27%)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{column.label}</span>
                  {checked && <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
                </label>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onShowAll();
                close();
              }}
              onMouseDown={(e) => e.preventDefault()}
              onFocus={(e) => e.preventDefault()}
              className="mt-1 w-full rounded-lg border-t border-border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              Show all columns
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Exports the rows currently visible to the table (after search and filters). */
export function ExportButton<T>({
  filename,
  columns,
  rows,
  label = "Export CSV",
  ...buttonProps
}: {
  filename: string;
  columns: readonly CsvColumn<T>[];
  rows: readonly T[];
  label?: string;
} & Omit<ButtonProps, "onClick" | "children">) {
  const handleExport = () => downloadCsv(filename, columns, rows);

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 shrink-0 gap-1.5 px-2 text-xs"
      onClick={handleExport}
      onMouseDown={(e) => e.preventDefault()}
      onFocus={(e) => e.preventDefault()}
      disabled={rows.length === 0}
      title={rows.length === 0 ? "Nothing to export with the current filters" : `${label} (${rows.length} rows)`}
      {...buttonProps}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      <span>Export</span>
    </Button>
  );
}

export function RefreshButton({
  onClick,
  isLoading,
  label = "Refresh",
}: {
  onClick: () => void;
  isLoading?: boolean;
  label?: string;
}) {
  return (
    <Button variant="outline" size="sm" className={TOOL_BUTTON} onClick={onClick} onMouseDown={(e) => e.preventDefault()} onFocus={(e) => e.preventDefault()} disabled={isLoading}>
      <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} aria-hidden="true" />
      <span>{isLoading ? "Refreshing…" : label}</span>
    </Button>
  );
}