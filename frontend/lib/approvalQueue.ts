import type { Batch } from "./api";

/**
 * Label for the approval-queue "Reapproval" state, shared by the column
 * accessor (sort/filter/search) and the CSV export so the filter dropdown and
 * the exported file can never disagree after a future edit.
 */
export function approvalReapprovalLabel(batch: Batch): string {
  return batch.is_reapproval
    ? `Reapproval #${batch.reapproval_count ?? 1}`
    : "First submission";
}
