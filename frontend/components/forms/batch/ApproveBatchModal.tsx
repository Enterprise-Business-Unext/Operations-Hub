"use client";

import React, { useEffect, useState } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { api, Batch, BatchEditHistoryEntry, ScheduledSession } from "@/lib/api";
import { formatDate } from "@/lib/dateUtils";
import { Lock, CheckCircle2, AlertCircle, XCircle, type LucideIcon } from "lucide-react";
import { FormModal } from "@/components/forms/modal/FormModal";
import { approveBatchSchema, type ApproveBatchInput } from "@/lib/validation/schemas";
import { TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/statusBadge";
import { errorMessage } from "@/lib/notify";
import { cn } from "@/lib/utils";

type Decision = "approve" | "reject";

interface DecisionOption {
  value: Decision;
  label: string;
  icon: LucideIcon;
  /** Tokens only: `--color-success*` / `--color-destructive*`, never a raw palette colour. */
  selected: string;
}

/**
 * Label/value grid shared by the batch summary and the approver status block.
 * `sm:grid-cols-2` rather than a fixed `grid-cols-2`, so the modal is usable at
 * the narrow widths the dialog shell allows on tablets.
 */
function DetailGrid({
  items,
  className,
}: {
  items: Array<[string, React.ReactNode]>;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 rounded-lg border bg-background p-4 sm:grid-cols-2", className)}>
      {items.map(([label, value]) => (
        <div key={label} className="space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase font-semibold">{label}</p>
          <p className="text-sm font-medium">{value}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * The approval decision is a mutually exclusive choice, so it is a real radio
 * group: one roving-tabindex group, `role="radio"` + `aria-checked` per option,
 * and APG keyboard support (arrows/Home/End move and select, Enter/Space select
 * the focused option). Rendering it as two submit-adjacent buttons made it
 * unreachable for keyboard users and duplicated the same RHF rule twice.
 */
function DecisionRadioGroup({ level }: { level: number }) {
  const { control, formState } = useFormContext();
  const groupId = React.useId();
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const options: DecisionOption[] = [
    {
      value: "approve",
      label: `Approve Level ${level}`,
      icon: CheckCircle2,
      selected:
        "border-2 border-success bg-success-light text-success hover:bg-success-light hover:text-success",
    },
    {
      value: "reject",
      label: `Reject Level ${level}`,
      icon: XCircle,
      selected:
        "border-2 border-destructive bg-destructive-light text-destructive hover:bg-destructive-light hover:text-destructive",
    },
  ];

  return (
    <Controller
      name="decision"
      control={control}
      rules={{ required: "Decision is required" }}
      render={({ field }) => {
        const selectedIndex = Math.max(
          0,
          options.findIndex((option) => option.value === field.value)
        );
        const selected = options[selectedIndex];
        const errorId = `${groupId}-error`;
        const errorMessageText = formState.errors["decision"]?.message as string | undefined;

        const select = (index: number) => {
          const option = options[index];
          if (!option) return;
          field.onChange(option.value);
          optionRefs.current[index]?.focus();
        };

        const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
          const last = options.length - 1;
          switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
              event.preventDefault();
              select(index === last ? 0 : index + 1);
              break;
            case "ArrowLeft":
            case "ArrowUp":
              event.preventDefault();
              select(index === 0 ? last : index - 1);
              break;
            case "Home":
              event.preventDefault();
              select(0);
              break;
            case "End":
              event.preventDefault();
              select(last);
              break;
            case "Enter":
            case " ":
              // `role="radio"` is not a native control, so activation is
              // implemented here rather than left to the button default, which
              // would submit the form through the footer button instead.
              event.preventDefault();
              select(index);
              break;
          }
        };

        return (
          <div className="space-y-2">
            <label
              id={`${groupId}-label`}
              htmlFor={`${groupId}-${selected.value}`}
              className="block text-sm font-medium text-foreground"
            >
              Authorization Decision
              <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </label>
            <div
              id={groupId}
              role="radiogroup"
              aria-labelledby={`${groupId}-label`}
              aria-required="true"
              aria-invalid={errorMessageText ? "true" : undefined}
              aria-describedby={errorMessageText ? errorId : undefined}
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {options.map((option, index) => {
                const OptionIcon = option.icon;
                const isSelected = option.value === field.value;
                return (
                  <Button
                    key={option.value}
                    id={`${groupId}-${option.value}`}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    variant="outline"
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => select(index)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    className={cn(
                      "h-auto gap-2 rounded-lg p-3 text-sm font-semibold",
                      isSelected
                        ? option.selected
                        : "border-border bg-card hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <OptionIcon className="h-4 w-4" aria-hidden="true" />
                    <span>{option.label}</span>
                  </Button>
                );
              })}
            </div>
            {errorMessageText && (
              <p id={errorId} className="text-sm text-destructive flex items-center gap-1" role="alert">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {errorMessageText}
              </p>
            )}
          </div>
        );
      }}
    />
  );
}

interface ApproveBatchModalProps {
  batch: Batch | null;
  isOpen: boolean;
  onClose: () => void;
  onBatchApproved: () => void;
  canApprove: boolean;
}

export const ApproveBatchModal: React.FC<ApproveBatchModalProps> = ({
  batch,
  isOpen,
  onClose,
  onBatchApproved,
  canApprove,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [editHistory, setEditHistory] = useState<BatchEditHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSession[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !batch || !canApprove) {
      return;
    }

    let isCurrent = true;
    setHistoryLoading(true);
    setHistoryError(null);
    api.getBatchEditHistory(batch.id)
      .then((history) => {
        if (isCurrent) setEditHistory(history);
      })
      .catch((error) => {
        if (isCurrent) setHistoryError(errorMessage(error, "Unable to load batch change history"));
      })
      .finally(() => {
        if (isCurrent) setHistoryLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen, batch?.id, canApprove]);

  useEffect(() => {
    if (!isOpen || !batch || !canApprove) {
      return;
    }

    let isCurrent = true;
    setScheduledSessions([]);
    setScheduleLoading(true);
    setScheduleError(null);
    api.getScheduledSessions(batch.id)
      .then((sessions) => {
        if (isCurrent) setScheduledSessions(sessions);
      })
      .catch((error) => {
        if (isCurrent) setScheduleError(errorMessage(error, "Unable to load scheduled sessions"));
      })
      .finally(() => {
        if (isCurrent) setScheduleLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [isOpen, batch?.id, canApprove]);

  // `FormModal` returns `null` when closed, which discards its `useForm` state
  // anyway; keeping this subtree mounted across opens would retain the previous
  // decision and reject reason because `initialData` only seeds `defaultValues`
  // on mount. Unmounting is the correct behaviour for this flow.
  if (!isOpen || !batch || !canApprove) return null;

  const currentLevel = batch.approver_1_status === "Approved" ? 2 : 1;

  const handleDecisionSubmit = async (data: ApproveBatchInput) => {
    setIsLoading(true);
    try {
      if (data.decision === "reject") {
        await api.decideBatch(batch.id, currentLevel, "reject", data.reject_reason?.trim());
      } else {
        await api.decideBatch(batch.id, currentLevel, "approve");
      }
      onBatchApproved();
      onClose();
    } catch (err) {
      // Rethrown untouched so `FormModal` can prefer `err.detail` over
      // `err.message`; only a non-`Error` rejection needs a wrapper.
      throw err instanceof Error ? err : new Error(errorMessage(err, "Failed to process approval decision"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleDecisionSubmit}
      schema={approveBatchSchema}
      title="Two-Level Batch Governance Approval"
      description={`Evaluating Level ${currentLevel} authorization checkpoint`}
      submitLabel={`Authorize Level ${currentLevel}`}
      loading={isLoading}
      initialData={{ decision: "approve" }}
      size="xl"
      render={(form) => {
        const decision = form.watch("decision");

        return (
          <>
            {/* Batch Summary */}
            <div className="space-y-4 mb-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Lock className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Target Batch</p>
                  <p className="font-bold text-lg text-primary">{batch.batch_id}</p>
                  <p className="text-sm text-muted-foreground">
                    {batch.program_name} • {batch.client_name || "Enterprise Client"} ({batch.domain || "IT/ITES"})
                  </p>
                </div>
              </div>
            </div>

            {/* Batch Details Grid */}
            <DetailGrid
              className="mb-4"
              items={[
                ["Program", batch.program_name],
                ["Client", batch.client_name || "Enterprise Client"],
                ["Technology", batch.technology || "Not specified"],
                ["Category", batch.category || "Not specified"],
                ["Delivery mode", batch.delivery_mode || "Not specified"],
                ["Location", batch.location_city || "Remote"],
                ["Start date", formatDate(batch.start_date, "Not set")],
                ["End date", formatDate(batch.end_date, "Not set")],
                ["Training days", String(batch.training_days ?? 0)],
                ["Total hours", String(batch.total_hours ?? 0)],
                ["Enrollments", String(batch.total_enrollments ?? 0)],
                ["Faculty", batch.faculty_assigned_text || "Not assigned"],
                ["Sales SPOC", batch.sales_spoc?.full_name || "Not assigned"],
                ["Manager SPOC", batch.primary_manager?.full_name || "Not assigned"],
                ["Coordinator", batch.coordinator?.full_name || "Not assigned"],
                ["Batch status", <StatusBadge key="batch-status" status={batch.status} />],
              ]}
            />

            <section className="mb-4 space-y-3 rounded-lg border p-4" aria-label="Scheduled sessions">
              <h3 className="text-sm font-semibold">Uploaded Schedule</h3>
              {scheduleLoading && (
                <p className="text-sm text-muted-foreground" role="status">
                  Loading scheduled sessions…
                </p>
              )}
              {scheduleError && (
                <p className="text-sm text-destructive" role="alert">{scheduleError}</p>
              )}
              {!scheduleLoading && !scheduleError && scheduledSessions.length === 0 && (
                <p className="text-sm text-muted-foreground">No scheduled sessions have been uploaded for this batch.</p>
              )}
              {!scheduleLoading && !scheduleError && scheduledSessions.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {scheduledSessions.length} {scheduledSessions.length === 1 ? "session" : "sessions"}
                  </p>
                  <ol className="max-h-64 space-y-2 overflow-y-auto">
                    {scheduledSessions.map((session, index) => (
                      <li key={session.id} className="rounded-md bg-muted/50 p-3 text-sm">
                        <p className="font-medium">
                          Session {index + 1}: {session.module || "Module not specified"}
                        </p>
                        <p className="text-muted-foreground">
                          {formatDate(session.session_date)}
                          {session.day_name ? ` (${session.day_name})` : ""}
                          {" · "}
                          {session.start_time ? String(session.start_time).slice(0, 5) : "Time not set"}
                          {session.end_time ? `–${String(session.end_time).slice(0, 5)}` : ""}
                          {" · "}
                          {session.duration_hours} hours
                        </p>
                        <p className="text-muted-foreground">
                          Faculty: {session.trainer_name || batch.faculty_assigned_text || "Not assigned"}
                        </p>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>

            {/* Approver Status */}
            <DetailGrid
              className="mb-4"
              items={[
                [
                  "Approver 1 Status",
                  <StatusBadge key="approver-1" status={batch.approver_1_status} emptyLabel="Pending" />,
                ],
                [
                  "Approver 2 Status",
                  <StatusBadge key="approver-2" status={batch.approver_2_status} emptyLabel="Pending" />,
                ],
                ...(batch.is_reapproval
                  ? ([["Reapproval", `#${batch.reapproval_count ?? 1}`]] as Array<[string, React.ReactNode]>)
                  : []),
              ]}
            />

            {historyLoading && (
              <p className="mb-4 text-sm text-muted-foreground" role="status">
                Loading change history…
              </p>
            )}
            {historyError && (
              <p className="mb-4 text-sm text-destructive" role="alert">{historyError}</p>
            )}
            {!historyLoading && !historyError && editHistory.length > 0 && (
              <section className="mb-4 space-y-3 rounded-lg border p-4" aria-label="Batch change history">
                <h3 className="text-sm font-semibold">Changes requiring reapproval</h3>
                {editHistory.map((entry) => (
                  <div key={entry.id} className="space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
                    <p className="text-xs text-muted-foreground">
                      {entry.editor_name || "User"} · {new Date(entry.created_at).toLocaleString()}
                    </p>
                    <ul className="space-y-1.5">
                      {Object.entries(entry.changed_fields).map(([field, change]) => (
                        <li key={field} className="text-sm">
                          <span className="font-medium">{field.replaceAll("_", " ")}:</span>{" "}
                          <span className="text-muted-foreground">
                            {change.before == null
                              ? "Not set"
                              : typeof change.before === "object"
                                ? JSON.stringify(change.before)
                                : String(change.before)}
                          </span>
                          {" → "}
                          <span>
                            {change.after == null
                              ? "Not set"
                              : typeof change.after === "object"
                                ? JSON.stringify(change.after)
                                : String(change.after)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}

            {/* Decision Selection */}
            <DecisionRadioGroup level={currentLevel} />

            {/* Reject Reason */}
            {decision === "reject" && (
                <div className="space-y-2 mt-4">
                  <TextField
                    name="reject_reason"
                    label="Reason for Rejection *"
                    placeholder="Explain the reason for rejection..."
                    type="text"
                    required
                    helperText="Minimum 3 characters required"
                  />
                </div>
            )}
          </>
        );
      }}
    />
  );
};