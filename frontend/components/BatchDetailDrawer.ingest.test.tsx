import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const getBatch = vi.fn();
const getBatchOptions = vi.fn();
const getFacultyTypes = vi.fn();
const getVerticals = vi.fn();
const getProgramTypes = vi.fn();
const getSessions = vi.fn();
const getScheduledSessions = vi.fn();
const ingestScheduleFile = vi.fn();
const applySchedule = vi.fn();
const getCoordinators = vi.fn();

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
      ingestScheduleFile: (...a: unknown[]) => ingestScheduleFile(...a),
      applySchedule: (...a: unknown[]) => applySchedule(...a),
      getCoordinators: (...a: unknown[]) => getCoordinators(...a),
    },
  };
});

import { BatchDetailDrawer } from "./BatchDetailDrawer";
import { ConfirmProvider } from "./ConfirmProvider";
import { Batch } from "@/lib/api";

const batch = {
  id: "b-1",
  batch_id: "BATCH_001",
  category: "Bootcamp",
  program_name: "Full Stack Python",
  delivery_mode: "Online",
  status: "Approval 1 Pending",
  is_schema_locked: false,
  created_at: "2027-01-01T00:00:00Z",
  updated_at: "2027-01-01T00:00:00Z",
} as Batch;

const extractedRow = {
  date_of_training: "2027-01-04T00:00:00.000Z",
  topic: "Module 1: Foundations",
  faculty_name: "Kiran Menon",
  no_of_hours: 8,
};

function renderDrawer() {
  return render(
    <ConfirmProvider>
      <BatchDetailDrawer batch={batch} isOpen onClose={() => {}} initialTab="sessions" />
    </ConfirmProvider>
  );
}

/** Opens the ingest dialog, picks a file and parses it, landing on the preview. */
async function openParsedPreview() {
  fireEvent.click(screen.getByRole("button", { name: /Ingest Timetable/i }));
  await screen.findByRole("dialog", { name: /Timetable Ingestion/i });

  // The dialog is portalled onto document.body, so the hidden file input is not
  // inside the render container.
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, {
    target: { files: [new File(["a,b,c"], "schedule.csv", { type: "text/csv" })] },
  });

  const parseButton = screen.getByRole("button", { name: /Parse Timetable/i });
  expect(parseButton).not.toBeDisabled();
  // jsdom does not run implicit submission from a submit-button click, so the
  // form is submitted directly.
  fireEvent.submit(parseButton.closest("form") as HTMLFormElement);

  await waitFor(() => {
    expect(screen.getByText("Module 1: Foundations")).toBeTruthy();
  });
}

describe("Timetable ingestion preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBatch.mockResolvedValue(batch);
    getBatchOptions.mockResolvedValue([]);
    getFacultyTypes.mockResolvedValue([]);
    getVerticals.mockResolvedValue([]);
    getProgramTypes.mockResolvedValue([]);
    getCoordinators.mockResolvedValue([]);
    getSessions.mockResolvedValue([]);
    getScheduledSessions.mockResolvedValue([]);
    ingestScheduleFile.mockResolvedValue({
      success: true,
      message: "Timetable processed.",
      extracted_rows: 1,
      failed_rows: 0,
      items: [extractedRow],
      extracted_schedule: [extractedRow],
      errors: [],
    });
    applySchedule.mockResolvedValue({ success: true, applied_rows: 1, session_ids: [] });
  });

  it("lists every parsed row in ingest order", async () => {
    ingestScheduleFile.mockResolvedValue({
      success: true,
      message: "Timetable processed.",
      extracted_rows: 2,
      failed_rows: 0,
      items: [extractedRow, { ...extractedRow, topic: "Module 2: Services" }],
      extracted_schedule: [extractedRow, { ...extractedRow, topic: "Module 2: Services" }],
      errors: [],
    });

    renderDrawer();
    await openParsedPreview();

    const rows = screen.getAllByRole("row");
    const topics = rows.map((row) => row.textContent || "");
    expect(topics.findIndex((text) => text.includes("Module 1: Foundations"))).toBeLessThan(
      topics.findIndex((text) => text.includes("Module 2: Services"))
    );
  });

  it("removes an extracted timetable row from the preview", async () => {
    renderDrawer();
    await openParsedPreview();

    fireEvent.click(screen.getByRole("button", { name: "Delete timetable row 1" }));

    await waitFor(() => {
      expect(screen.queryByText("Module 1: Foundations")).toBeNull();
      expect(screen.getByText("No schedule rows were extracted")).toBeTruthy();
    });
  });

  it("keeps no search, filter, sort, column, export or conflict control", async () => {
    renderDrawer();
    await openParsedPreview();

    // The conflict engine is gone, so its dry-run check must not come back.
    expect(screen.queryByRole("button", { name: /Conflict/i })).toBeNull();
    expect(screen.queryByText(/All Clear:/i)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Columns/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Export/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Full Screen/i })).toBeNull();
    expect(screen.queryByText(/Timetable preview pages/i)).toBeNull();
  });

  it("still lets a parsed row be corrected and applies the whole file", async () => {
    renderDrawer();
    await openParsedPreview();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const topicInput = screen.getByLabelText("Topic for parsed row 1");
    fireEvent.change(topicInput, { target: { value: "Module 1: Corrected" } });

    expect(screen.getByDisplayValue("Module 1: Corrected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Apply & Schedule All/i }));

    await waitFor(() => {
      expect(applySchedule).toHaveBeenCalledTimes(1);
    });
    const [appliedItems] = applySchedule.mock.calls[0];
    expect(appliedItems[0].topic).toBe("Module 1: Corrected");
  });

  it("keeps the shared viewport centring instead of overriding position", async () => {
    renderDrawer();

    fireEvent.click(screen.getByRole("button", { name: /Ingest Timetable/i }));
    const dialog = await screen.findByRole("dialog", { name: /Timetable Ingestion/i });

    // The dialog used to set `position: relative` inline, which silently replaced
    // the shared `fixed left-1/2 top-1/2 translate-[-50%,-50%]` centring and pinned
    // the box to the top of the page. jsdom has no layout engine, so this guards
    // the CSS contract that produces correct centring rather than a pixel.
    expect(dialog.style.position).toBe("");
    expect(dialog.className).toContain("fixed");
    expect(dialog.className).toContain("left-[50%]");
    expect(dialog.className).toContain("translate-x-[-50%]");
  });

  it("returns to the upload step", async () => {
    renderDrawer();
    await openParsedPreview();

    fireEvent.click(screen.getByRole("button", { name: /Back to Upload/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Parse Timetable/i })).toBeTruthy();
    });
    expect(screen.getByText("schedule.csv")).toBeTruthy();
  });
});
