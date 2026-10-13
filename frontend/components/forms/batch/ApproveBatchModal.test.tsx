import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { api, Batch } from "@/lib/api";
import { ApproveBatchModal } from "./ApproveBatchModal";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getBatchEditHistory: vi.fn(),
      getScheduledSessions: vi.fn(),
    },
  };
});

const batch = {
  id: "batch-id",
  batch_id: "BATCH-001",
  program_name: "Python Training",
  client_name: "Example Client",
  delivery_mode: "Online",
  status: "Approval 1 Pending",
  approver_1_status: "Pending",
  approver_2_status: "Pending",
  training_days: 2,
  total_hours: 16,
  total_enrollments: 20,
  faculty_assigned_text: "Dr. Assigned Faculty",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
} as Batch;

describe("ApproveBatchModal schedule", () => {
  beforeEach(() => {
    vi.mocked(api.getBatchEditHistory).mockResolvedValue([]);
    vi.mocked(api.getScheduledSessions).mockResolvedValue([
      {
        id: "session-id",
        batch_id: batch.id,
        session_date: "2026-10-12",
        day_name: "Monday",
        start_time: "09:00:00",
        end_time: "17:00:00",
        duration_hours: 8,
        module: "Introduction to Python",
        trainer_name: "Dr. Session Faculty",
        status: "Scheduled",
        created_at: "2026-10-01T00:00:00Z",
        updated_at: "2026-10-01T00:00:00Z",
      },
    ]);
  });

  it("shows uploaded scheduled sessions to approvers", async () => {
    render(
      <ApproveBatchModal
        batch={batch}
        isOpen
        onClose={() => {}}
        onBatchApproved={() => {}}
        canApprove
      />
    );

    await waitFor(() => {
      expect(api.getScheduledSessions).toHaveBeenCalledWith(batch.id);
    });
    expect(await screen.findByText(/Introduction to Python/)).toBeTruthy();
    expect(screen.getByText(/12-10-2026 \(Monday\)/)).toBeTruthy();
    expect(screen.getByText(/09:00–17:00 · 8 hours/)).toBeTruthy();
    expect(screen.getByText("Faculty: Dr. Session Faculty")).toBeTruthy();
  });
});
