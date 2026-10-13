import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const getBatch = vi.fn();
const getBatchOptions = vi.fn();
const getFacultyTypes = vi.fn();
const getVerticals = vi.fn();
const getProgramTypes = vi.fn();
const getSessions = vi.fn();
const getScheduledSessions = vi.fn();
const deleteScheduledSession = vi.fn();
const updateBatch = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getBatch: (...a: unknown[]) => getBatch(...a),
      getBatchOptions: (...a: unknown[]) => getBatchOptions(...a),
      getFacultyTypes: (...a: unknown[]) => getFacultyTypes(...a),
      getVerticals: (...a: unknown[]) => getVerticals(...a),
      getProgramTypes: (...a: unknown[]) => getProgramTypes(...a),
      getSessions: (...a: unknown[]) => getSessions(...a),
      getScheduledSessions: (...a: unknown[]) => getScheduledSessions(...a),
      deleteScheduledSession: (...a: unknown[]) => deleteScheduledSession(...a),
      updateBatch: (...a: unknown[]) => updateBatch(...a),
    },
  };
});

import { BatchDetailDrawer } from "./BatchDetailDrawer";
import { ConfirmProvider } from "./ConfirmProvider";
import { Batch, ScheduledSession } from "@/lib/api";

const batch = {
  id: "b-1",
  batch_id: "BATCH_001",
  category: "Bootcamp",
  residential_type: "Residential",
  program_name: "Full Stack Python",
  client_name: "Example Client",
  sow_number: "SOW-001",
  delivery_mode: "Online",
  training_days: 4,
  total_hours: 16,
  total_enrollments: 30,
  start_date: "2027-01-01T00:00:00Z",
  end_date: "2027-01-20T00:00:00Z",
  status: "Upcoming",
  is_schema_locked: true,
  created_at: "2027-01-01T00:00:00Z",
  updated_at: "2027-01-01T00:00:00Z",
} as Batch;

function scheduledSession(
  id: string,
  sessionDate: string,
  module: string,
  extra: Partial<ScheduledSession> = {}
): ScheduledSession {
  return {
    id,
    batch_id: batch.id,
    session_date: sessionDate,
    day_name: "Monday",
    duration_hours: 4,
    module,
    trainer_name: "Kiran Menon",
    status: "Scheduled",
    created_at: "2027-01-01T00:00:00Z",
    updated_at: "2027-01-01T00:00:00Z",
    utilization_logged: false,
    ...extra,
  } as ScheduledSession;
}

const inWindow = [
  scheduledSession("sched-1", "2027-01-05", "Module one"),
  scheduledSession("sched-2", "2027-01-08", "Module two"),
];
const outOfWindow = [
  scheduledSession("sched-3", "2027-01-15", "Module three"),
  scheduledSession("sched-4", "2027-01-18", "Module four"),
];

const REDUCED_END_DATE = "2027-01-10";

function renderDrawer() {
  return render(
    <ConfirmProvider>
      <BatchDetailDrawer batch={batch} isOpen onClose={() => {}} initialTab="sessions" />
    </ConfirmProvider>
  );
}

async function openEditModal() {
  const buttons = screen.getAllByRole("button", { name: /Edit Batch/i });
  fireEvent.click(buttons[buttons.length - 1]);
  return screen.findByRole("dialog", { name: /Edit Batch Details/i });
}

async function reduceConclusionDate(dialog: HTMLElement, value: string) {
  const dateInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="date"]');
  fireEvent.change(dateInputs[1], { target: { value } });
}

describe("BatchDetailDrawer edit modal end-date reduction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBatch.mockResolvedValue(batch);
    getBatchOptions.mockResolvedValue([]);
    getFacultyTypes.mockResolvedValue([]);
    getVerticals.mockResolvedValue([]);
    getProgramTypes.mockResolvedValue([]);
    getSessions.mockResolvedValue([]);
    getScheduledSessions.mockResolvedValue([]);
    deleteScheduledSession.mockResolvedValue(undefined);
    updateBatch.mockResolvedValue(batch);
  });

  // First fetch returns the opening schedule, every later fetch (e.g. the
  // post-delete refresh) returns `refreshed`, so the panel can be observed
  // clearing. `mockReset` is required: `vi.clearAllMocks()` leaves queued
  // `...Once` implementations in place, which leak into the next test.
  async function renderWithSchedule(sessions: ScheduledSession[], refreshed: ScheduledSession[] = sessions) {
    let call = 0;
    getScheduledSessions.mockReset();
    getScheduledSessions.mockImplementation(() => {
      const payload = call === 0 ? sessions : refreshed;
      call += 1;
      return Promise.resolve(payload);
    });
    renderDrawer();
    // Wait for the drawer's initial schedule load so the modal opens with the
    // blocker list already in state.
    await waitFor(() => {
      expect(screen.getByText(`Curriculum Schedule (${sessions.length} Sessions)`)).toBeTruthy();
    });
    return openEditModal();
  }

  it("lists the out-of-window sessions and disables Save when the end date is reduced", async () => {
    const dialog = await renderWithSchedule([...inWindow, ...outOfWindow]);

    await reduceConclusionDate(dialog, REDUCED_END_DATE);

    expect(screen.getByText("Conclusion date is being reduced")).toBeTruthy();
    expect(screen.getByText(/2 scheduled session\(s\) fall after/)).toBeTruthy();
    expect(within(dialog).getByText(/Module three/)).toBeTruthy();
    expect(within(dialog).getByText(/Module four/)).toBeTruthy();
    expect(within(dialog).getAllByText(/Kiran Menon/)).toHaveLength(2);
    expect(within(dialog).queryByText(/Module one/)).toBeNull();

    const saveButton = screen.getByRole("button", { name: /Save Changes/i });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    const deleteButton = screen.getByRole("button", { name: "Delete 2 sessions" });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("deletes every deletable blocker, refreshes the schedule and clears the panel", async () => {
    const dialog = await renderWithSchedule([...inWindow, ...outOfWindow], inWindow);

    await reduceConclusionDate(dialog, REDUCED_END_DATE);
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 sessions" }));

    fireEvent.click(await screen.findByRole("button", { name: "Delete sessions" }));

    await waitFor(() => {
      expect(deleteScheduledSession).toHaveBeenCalledTimes(2);
    });
    expect(deleteScheduledSession).toHaveBeenNthCalledWith(1, "sched-3");
    expect(deleteScheduledSession).toHaveBeenNthCalledWith(2, "sched-4");
    expect(getScheduledSessions.mock.calls.length).toBeGreaterThan(1);

    await waitFor(() => {
      expect(screen.queryByText(/must be deleted before the batch end date can be reduced/)).toBeNull();
    });
    expect(screen.getByText(/Match the schedule: 2 training days, 8 hours/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Save Changes/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps Save disabled and explains why when a blocker was already delivered", async () => {
    const dialog = await renderWithSchedule([
      ...inWindow,
      scheduledSession("sched-3", "2027-01-15", "Delivered module", { status: "Completed" }),
      scheduledSession("sched-4", "2027-01-18", "Logged module", { utilization_logged: true }),
    ]);

    await reduceConclusionDate(dialog, REDUCED_END_DATE);

    expect(screen.getAllByText(/Already delivered — cannot be deleted/)).toHaveLength(2);
    expect(
      screen.getByText(/Completed or delivered sessions cannot be deleted; the end date cannot move past them/)
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Delete 0 sessions" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Save Changes/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("prefills training days and total hours from the remaining sessions on Apply", async () => {
    const dialog = await renderWithSchedule(inWindow);

    await reduceConclusionDate(dialog, REDUCED_END_DATE);

    expect(screen.getByText(/Match the schedule: 2 training days, 8 hours/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const numberInputs = dialog.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(numberInputs[0].value).toBe("2");
    expect(numberInputs[1].value).toBe("8");
  });

  it("surfaces the server rejection in the edit error banner", async () => {
    const dialog = await renderWithSchedule(inWindow);

    await reduceConclusionDate(dialog, REDUCED_END_DATE);
    updateBatch.mockRejectedValue(
      new Error("Total hours cannot exceed training_days × max_hours_per_day (4 × 8 = 32)")
    );

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(updateBatch).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Total hours cannot exceed training_days × max_hours_per_day (4 × 8 = 32)"
    );
    expect(within(dialog).getByRole("button", { name: /Save Changes/i })).toBeTruthy();
  });
});
