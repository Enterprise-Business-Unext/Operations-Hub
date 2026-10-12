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

import { BatchDetailDrawer, BatchDetailTab } from "./BatchDetailDrawer";
import { ConfirmProvider } from "./ConfirmProvider";
import { Batch } from "@/lib/api";

const batch = {
  id: "b-1",
  batch_id: "BATCH_001",
  category: "Bootcamp",
  residential_type: "Residential",
  program_name: "Full Stack Python",
  client_name: "Example Client",
  sow_number: "SOW-001",
  delivery_mode: "Online",
  training_days: 5,
  total_hours: 40,
  total_enrollments: 30,
  residential_enrollments: 30,
  non_residential_enrollments: 0,
  status: "Approval 1 Pending",
  is_schema_locked: false,
  created_at: "2027-01-01T00:00:00Z",
  updated_at: "2027-01-01T00:00:00Z",
} as Batch;

function renderDrawer(initialTab?: BatchDetailTab) {
  return render(
    <ConfirmProvider>
      <BatchDetailDrawer batch={batch} isOpen onClose={() => {}} initialTab={initialTab} />
    </ConfirmProvider>
  );
}

describe("BatchDetailDrawer initialTab", () => {
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

  it("lands on the timetable when initialTab is sessions", async () => {
    renderDrawer("sessions");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ingest Timetable/i })).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /Add Session/i })).toBeTruthy();
    expect(screen.queryByText("Curriculum / Program Title")).toBeNull();
  });

  it("lands on the overview when initialTab is omitted", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Ingest Timetable/i })).toBeNull();
  });

  it("re-applies the requested tab when a different batch is opened", async () => {
    const { rerender } = renderDrawer("overview");

    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });

    const second = { ...batch, id: "b-2", batch_id: "BATCH_002" };
    getBatch.mockResolvedValue(second);

    rerender(
      <ConfirmProvider>
        <BatchDetailDrawer batch={second} isOpen onClose={() => {}} initialTab="sessions" />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ingest Timetable/i })).toBeTruthy();
    });
  });
});

describe("BatchDetailDrawer shell", () => {
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

  it("submits only fields supported by the batch update API", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: /Edit Batch/i })[1]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Save Changes/i })).toBeTruthy();
    });
    expect(screen.queryByText("Non-Residential Enrollments")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(updateBatch).toHaveBeenCalledTimes(1);
    });
    expect(updateBatch.mock.calls[0][1]).not.toHaveProperty("non_residential_enrollments");
    expect(updateBatch.mock.calls[0][1]).toHaveProperty("total_enrollments", 30);
  });

  it("counts each scheduled session when multiple modules share a date", async () => {
    const sharedDate = "2027-01-04";
    const common = {
      batch_id: batch.id,
      session_date: sharedDate,
      day_name: "Monday",
      duration_hours: 4,
      status: "Scheduled",
      created_at: "2027-01-01T00:00:00Z",
      updated_at: "2027-01-01T00:00:00Z",
      utilization_logged: false,
    };
    getScheduledSessions.mockResolvedValue([
      { ...common, id: "schedule-1", sequence_number: 1, module: "Morning module" },
      { ...common, id: "schedule-2", sequence_number: 2, module: "Afternoon module" },
    ]);
    renderDrawer("sessions");

    await waitFor(() => {
      expect(screen.getByText("Curriculum Schedule (2 Sessions)")).toBeTruthy();
    });
    expect(screen.getByText("2 sessions / 0 logged")).toBeTruthy();
    expect(screen.getAllByText("Session")).toHaveLength(2);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("deletes a pending scheduled session after confirmation", async () => {
    getScheduledSessions.mockResolvedValue([
      {
        id: "schedule-delete",
        batch_id: batch.id,
        sequence_number: 1,
        session_date: "2027-01-04",
        day_name: "Monday",
        duration_hours: 4,
        status: "Scheduled",
        created_at: "2027-01-01T00:00:00Z",
        updated_at: "2027-01-01T00:00:00Z",
        utilization_logged: false,
        module: "Removable module",
      },
    ]);
    renderDrawer("sessions");

    fireEvent.click(await screen.findByRole("button", { name: /Delete scheduled session 1/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));

    await waitFor(() => {
      expect(deleteScheduledSession).toHaveBeenCalledWith("schedule-delete");
    });
    expect(getScheduledSessions).toHaveBeenCalledTimes(2);
  });

  it("is a labelled modal dialog", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });
    // Radix supplies the modal semantics: role, a name from DialogTitle, a focus
    // trap and `aria-hidden` on the page behind it. It deliberately does not set
    // `aria-modal`, which would fight the nested dialogs this drawer opens.
    const dialog = screen.getByRole("dialog", { name: /BATCH_001/i });
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <ConfirmProvider>
        <BatchDetailDrawer batch={batch} isOpen onClose={onClose} />
      </ConfirmProvider>
    );
    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("exposes a real tablist and moves between tabs with the arrow keys", async () => {
    renderDrawer();

    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });

    const tablist = screen.getByRole("tablist", { name: /batch detail sections/i });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");

    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Ingest Timetable/i })).toBeTruthy();
    });
    expect(screen.getByRole("tab", { name: /Sessions & Timetable/i }).getAttribute("aria-selected")).toBe("true");

    // Wraps back around from the last tab to the first.
    fireEvent.keyDown(screen.getByRole("tab", { name: /Sessions & Timetable/i }), { key: "ArrowLeft" });
    await waitFor(() => {
      expect(screen.getByText("Curriculum / Program Title")).toBeTruthy();
    });
  });

  it("keeps the user's tab when the parent re-renders with the same batch", async () => {
    const { rerender } = renderDrawer("sessions");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Session/i })).toBeTruthy();
    });

    // A new object with the same id: an in-drawer `onBatchUpdated()` callback
    // does exactly this, and it used to reset the tab and re-fetch.
    getSessions.mockResolvedValue([
      {
        id: "u-1",
        topic: "Module 1",
        faculty_name: "Kiran Menon",
        date_of_training: "2027-01-04T00:00:00.000Z",
        no_of_hours: 8,
        status: "Completed",
      },
    ]);
    rerender(
      <ConfirmProvider>
        <BatchDetailDrawer batch={{ ...batch }} isOpen onClose={() => {}} initialTab="sessions" />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole("tab", { name: /Quality Checkpoints/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Execute NPS Closure/i })).toBeTruthy();
    });

    rerender(
      <ConfirmProvider>
        <BatchDetailDrawer batch={{ ...batch }} isOpen onClose={() => {}} initialTab="sessions" />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Execute NPS Closure/i })).toBeTruthy();
    });
  });

  it("renders the session status as a real ledger column", async () => {
    getSessions.mockResolvedValue([
      {
        id: "u-1",
        topic: "Module 1",
        faculty_name: "Kiran Menon",
        vertical: "IT/ITES Internal",
        date_of_training: "2027-01-04T00:00:00.000Z",
        no_of_hours: 8,
        mode_of_delivery: "Online",
        status: "Completed",
      },
    ]);
    renderDrawer("sessions");

    await waitFor(() => {
      expect(screen.getByRole("columnheader", { name: /Session Status/i })).toBeTruthy();
    });
    // The faculty vertical is no longer duplicated under a second heading.
    expect(screen.queryByRole("columnheader", { name: /Faculty Vertical/i })).toBeNull();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("surfaces a failed sessions fetch instead of claiming nothing was scheduled", async () => {
    getSessions.mockRejectedValue(new Error("ledger unavailable"));
    renderDrawer("sessions");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    expect(screen.getByText(/ledger unavailable/i)).toBeTruthy();
  });

  it("opens without a hooks-order error when mounted closed first", async () => {
    // page.tsx mounts the drawer permanently and only flips `batch`/`isOpen`, so
    // the closed -> open transition is the shape that actually crashes. A hook
    // below the `!isOpen` guard runs once more on the open render and React
    // throws #310, which this transition now exercises for the first time.
    const { rerender } = render(
      <ConfirmProvider>
        <BatchDetailDrawer batch={null} isOpen={false} onClose={() => {}} initialTab="sessions" />
      </ConfirmProvider>
    );
    expect(screen.queryByText(/Sessions & Timetable/i)).toBeNull();

    rerender(
      <ConfirmProvider>
        <BatchDetailDrawer batch={batch} isOpen onClose={() => {}} initialTab="sessions" />
      </ConfirmProvider>
    );

    await waitFor(() => expect(getSessions).toHaveBeenCalled());
    expect(screen.getAllByText(/Sessions & Timetable/i).length).toBeGreaterThan(0);
  });
});
