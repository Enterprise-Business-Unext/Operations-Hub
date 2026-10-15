"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FullscreenTableProps {
  children: React.ReactNode;
  /** Heading shown on its own line above the toolbar row. */
  title?: React.ReactNode;
  /** Usually a `<TableFilters />` instance; takes the free width on the toolbar row. */
  toolbar?: React.ReactNode;
  /** Right-aligned controls (create, export, refresh, ...). */
  actions?: React.ReactNode;
  /** Rendered after the scroll area, e.g. `<PaginationControls />`. */
  footer?: React.ReactNode;
  panelClassName?: string;
  className?: string;
  style?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
  titleStyle?: React.CSSProperties;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  showFullscreenButton?: boolean;
  fullscreenLabel?: string;
  exitFullscreenLabel?: string;
  fullscreenBackground?: string;
  /** Uses the browser Fullscreen API rather than the page-level overlay. */
  nativeFullscreen?: boolean;
  /**
   * "fixed" covers the viewport. "absolute" fills the nearest positioned
   * ancestor instead — required for tables rendered inside a dialog/drawer,
   * where a transformed ancestor turns `fixed` into a local positioning box.
   */
  strategy?: "fixed" | "absolute";
  initialFullscreen?: boolean;
  onFullscreenChange?: (isFullscreen: boolean) => void;
  /**
   * Pins the whole panel below `stickyTop` (the shared Navbar) and scrolls the
   * table body inside it, so the toolbar, the primary actions and the column
   * headings stay on screen no matter how long the table is.
   */
  stickyHeader?: boolean;
  /** Height of whatever global header sits above the table. */
  stickyTop?: number;
  /** Pins `<thead>` directly under the sticky header. Implied by `stickyHeader`. */
  stickyThead?: boolean;
}

const HEADER_PADDING = "14px 20px";
const TOOLBAR_ROW_GAP = 10;

/**
 * Panel wrapper that gives any table overlay or browser-native fullscreen,
 * body scroll locking and a header that holds the title, the filter toolbar and
 * the row/table actions. It only controls layout — the table markup stays with
 * the consumer.
 */
export function FullscreenTable({
  children,
  title,
  toolbar,
  actions,
  footer,
  panelClassName = "glass-panel",
  className,
  style,
  headerStyle,
  titleStyle,
  contentClassName,
  contentStyle,
  showFullscreenButton = true,
  fullscreenLabel = "Full Screen",
  exitFullscreenLabel = "Exit Full Screen",
  fullscreenBackground = "#f8fbff",
  nativeFullscreen = false,
  strategy = "fixed",
  initialFullscreen = false,
  onFullscreenChange,
  stickyHeader = false,
  stickyTop = 0,
  stickyThead,
}: FullscreenTableProps) {
  const [isFullscreen, setIsFullscreen] = useState(initialFullscreen);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [canPortal, setCanPortal] = useState(true);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const applyFullscreen = useCallback(
    (next: boolean) => {
      setIsFullscreen(next);
      onFullscreenChange?.(next);
    },
    [onFullscreenChange]
  );

  const toggleFullscreen = useCallback(async () => {
    if (!nativeFullscreen) {
      applyFullscreen(!isFullscreen);
      return;
    }

    setFullscreenError(null);
    try {
      if (document.fullscreenElement === panelRef.current) {
        await document.exitFullscreen();
      } else if (isFullscreen) {
        applyFullscreen(false);
      } else if (panelRef.current?.requestFullscreen) {
        await panelRef.current.requestFullscreen();
      } else {
        throw new Error("This browser does not support fullscreen mode.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (document.fullscreenElement !== panelRef.current) {
        applyFullscreen(true);
        setFullscreenError(`Browser fullscreen was unavailable; using expanded view instead. ${message}`);
      } else {
        setFullscreenError(message);
      }
    }
  }, [applyFullscreen, isFullscreen, nativeFullscreen]);

  useEffect(() => {
    if (!nativeFullscreen) return;
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === panelRef.current;
      setIsNativeFullscreen(active);
      applyFullscreen(active);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [applyFullscreen, nativeFullscreen]);

  // Escape is the expected way out of a fullscreen overlay.
  useEffect(() => {
    if (!isFullscreen || (nativeFullscreen && isNativeFullscreen)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") applyFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, isNativeFullscreen, nativeFullscreen, applyFullscreen]);

  // Keep the page behind the overlay from scrolling while it is open.
  useEffect(() => {
    if (!isFullscreen || strategy !== "fixed") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFullscreen, strategy]);

  // With a pinned header the table body becomes the scroll container, so the
  // header stays on screen without any viewport math and `<thead>` can stick to
  // the top of that container instead of to the page.
  const scrollBody = stickyHeader || isFullscreen;
  const pinThead = stickyThead ?? stickyHeader;

  const panel = (
    <div
      ref={panelRef}
      className={cn(panelClassName, isFullscreen ? "table-fullscreen-panel" : null, className)}
      data-fullscreen={isFullscreen ? "true" : "false"}
      style={{
        padding: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        ...(isFullscreen
          ? {
              position: strategy,
              inset: 0,
              zIndex: 1000,
              borderRadius: 0,
              padding: 16,
              overflow: "hidden",
              background: fullscreenBackground,
              ...(strategy === "fixed"
                ? {
                    boxSizing: "border-box",
                    width: "100vw",
                    height: "100dvh",
                    maxWidth: "100vw",
                    maxHeight: "100dvh",
                  }
                : null),
            }
          : null),
        ...(stickyHeader && !isFullscreen
          ? {
              position: "sticky",
              top: stickyTop,
              zIndex: 20,
              maxHeight: `calc(100vh - ${stickyTop}px - 24px)`,
            }
          : null),
        ...style,
      }}
    >
      {(title || toolbar || actions || showFullscreenButton) && (
        <div
          style={{
            padding: HEADER_PADDING,
            borderBottom: "1px solid var(--border-subtle)",
            background: isFullscreen ? "#ffffff" : "var(--color-card)",
            ...headerStyle,
            // Structural layout is owned by this component and re-declared after
            // the spread, so a caller's `headerStyle` can theme the padding,
            // background and border but can never reorder the header rows.
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            justifyContent: "flex-start",
            gap: TOOLBAR_ROW_GAP,
            flexShrink: 0,
            position: "relative",
            zIndex: 10,
          }}
        >
          {title && (
            <div
              style={{
                fontSize: "1rem",
                fontWeight: 700,
                color: "var(--text-main)",
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                ...titleStyle,
              }}
            >
              {title}
            </div>
          )}

          {fullscreenError && (
            <div role="alert" className="mx-5 mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Fullscreen notice: {fullscreenError}
            </div>
          )}

          {(toolbar || actions || showFullscreenButton) && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: TOOLBAR_ROW_GAP,
                minWidth: 0,
              }}
            >
              {toolbar ? (
                <div style={{ flex: "1 1 380px", minWidth: 0, display: "flex" }}>{toolbar}</div>
              ) : (
                <span style={{ flex: "1 1 auto" }} />
              )}

              <div
                role="group"
                aria-label="Table actions"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 8,
                  flexWrap: "nowrap",
                  marginLeft: "auto",
                  flexShrink: 0,
                  paddingBottom: 2,
                  position: "relative",
                }}
              >
                {actions}
{showFullscreenButton && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={toggleFullscreen}
                      onMouseDown={(e) => e.preventDefault()}
                      onFocus={(e) => e.preventDefault()}
                      aria-pressed={isFullscreen}
                      title={isFullscreen ? exitFullscreenLabel : fullscreenLabel}
                    >
                    {isFullscreen ? (
                      <Minimize2 className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Maximize2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{isFullscreen ? exitFullscreenLabel : fullscreenLabel}</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div
        className={cn("table-scroll-wrapper", pinThead && "table-pin-thead", contentClassName)}
        style={{
          overflowX: "auto",
          overflowY: scrollBody ? "auto" : "visible",
          minHeight: 0,
          width: "100%",
          // The content wrapper owns vertical scrolling in pinned and fullscreen
          // modes; the outer panel remains a single viewport.
          ...(scrollBody ? { flex: "1 1 auto" } : null),
          ...contentStyle,
        }}
      >
        {children}
      </div>

      {footer}
    </div>
  );

  return isFullscreen &&
    strategy === "fixed" &&
    canPortal &&
    (!nativeFullscreen || !isNativeFullscreen)
    ? createPortal(panel, document.body)
    : panel;
}