import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ActiveBatchesView } from "./ActiveBatchesView";
import type { ActiveBatchItem, ActiveBatchesResponse, ActiveSessionItem } from "@/lib/api";

function makeBatch(overrides: Partial<ActiveBatchItem> = {}): ActiveBatchItem {
  return {
    id: "b-1",
    batch_id: "BATCH_001",
    program_name: "Full Stack Python",
    client_name: "Acme",
    category: "Bootcamp",
    delivery_mode: "Online",
    location_city: "Pune",
    start_date: "2026-09-01",
    end_date: "2026-09-30",
    status: "Ongoing",
    total_enrollments: 30,
    training_days: 5,
    sessions_conducted: 2,
    progress: 40,
    ...overrides,
  };
}

function makeSession(overrides: Partial<ActiveSessionItem> = {}): ActiveSessionItem {
  return {
    id: "s-1",
    batch_id: "BATCH_001",
    batch_name: "Full Stack Python",
    session_type: "scheduled",
    module: "Python Basics",
    session_date: "2026-09-20",
    start_time: "2026-09-20T10:00:00",
    end_time: "2026-09-20T12:30:00",
    duration_hours: 2.5,
    status: "Scheduled",
    mode_of_delivery: "Online",
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ActiveBatchesResponse> = {}): ActiveBatchesResponse {
  const batches = overrides.batches ?? [makeBatch()];
  const sessions = overrides.sessions ?? [makeSession()];
  return {
    filter_date: "2026-09-20",
    batches,
    sessions,
    total_batches: batches.length,
    total_sessions: sessions.length,
    skip: 0,
    limit: 100,
    ...overrides,
  };
}

function renderView(props: Partial<React.ComponentProps<typeof ActiveBatchesView>> = {}) {
  const onFilterDateChange = vi.fn();
  const onRefresh = vi.fn();

  render(
    <ActiveBatchesView
      filterDate="2026-09-20"
      onFilterDateChange={onFilterDateChange}
      data={null}
      isLoading={false}
      batchPage={1}
      batchPageSize={10}
      onBatchPageChange={vi.fn()}
      onBatchPageSizeChange={vi.fn()}
      sessionPage={1}
      sessionPageSize={10}
      onSessionPageChange={vi.fn()}
      onSessionPageSizeChange={vi.fn()}
      onRefresh={onRefresh}
      {...props}
    />
  );

  return { onFilterDateChange, onRefresh };
}

/** StatCard renders label, value and hint as siblings, so the value is the
 *  middle child of the label's parent. The batch table heading repeats some
 *  card labels, hence the multi-match fallback to the first (card) hit. */
function metricValue(label: string): string {
  const labelEl = screen.getAllByText(label)[0];
  return labelEl.parentElement?.children[1]?.textContent?.trim() ?? "";
}

// The column menus persist their layout, so one test's toggle would otherwise
// decide what the next test renders.
beforeEach(() => {
  window.localStorage.clear();
});

describe("ActiveBatchesView summary metrics", () => {
  it("sums scheduled hours and counts distinct faculty", () => {
    const trainer = "Prof Sharma";
    const data: ActiveBatchesResponse = {
      filter_date: "2026-09-20",
      batches: [],
      sessions: [
        makeSession({ id: "s-1", trainer_name: trainer, duration_hours: 2.5 }),
        makeSession({ id: "s-2", trainer_name: trainer, duration_hours: 1.5 }),
        makeSession({
          id: "s-3",
          session_type: "actual",
          faculty_name: "Dr Rao",
          trainer_name: null,
          duration_hours: 3,
        }),
      ],
      total_batches: 0,
      total_sessions: 3,
      skip: 0,
      limit: 100,
    };

    renderView({ data });

    expect(metricValue("Scheduled Hours")).toBe("4.0 hrs");
    // "Dr Rao" plus the two scheduled rows, which share a trainer name.
    expect(metricValue("Faculty Deployed")).toBe("2");
  });

  it("does not count delivered hours toward the scheduled total", () => {
    const data: ActiveBatchesResponse = {
      filter_date: "2026-09-20",
      batches: [],
      sessions: [makeSession({ id: "s-1", session_type: "actual", faculty_name: "Dr Rao", duration_hours: 8 })],
      total_batches: 0,
      total_sessions: 1,
      skip: 0,
      limit: 100,
    };

    renderView({ data });

    expect(metricValue("Scheduled Hours")).toBe("0.0 hrs");
  });

  it("shows zeros rather than NaN when there is no data", () => {
    renderView({ data: null });

    expect(metricValue("Scheduled Hours")).toBe("0.0 hrs");
    expect(metricValue("Ongoing Batches")).toBe("0");
    expect(screen.queryByText("Delivery Sites")).toBeNull();
    expect(screen.queryByText("Enrolled Learners")).toBeNull();
  });
});

describe("ActiveBatchesView header controls", () => {
  it("renders the date filter and refresh in the top-right control group", () => {
    const { onRefresh } = renderView();

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-09-20");
    expect(screen.getByTitle("Refresh active batches")).toBeTruthy();
    // The date group, plus one refresh / columns / export per table panel.
    expect(screen.getAllByRole("button", { name: /Refresh/i }).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole("button", { name: /Columns/i })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /Export/i })).toHaveLength(2);
    expect(screen.queryByText(/^\d+ scheduled$/)).toBeNull();
    expect(screen.queryByText(/^\d+ actual$/)).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("reports the picked date and triggers a refresh", async () => {
    const user = userEvent.setup();
    const { onFilterDateChange, onRefresh } = renderView();

    // The input is controlled by the parent, so the pick is fired directly
    // rather than typed character by character.
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-09-21" } });
    expect(onFilterDateChange).toHaveBeenLastCalledWith("2026-09-21");

    await user.click(screen.getByTitle("Refresh active batches"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("resets both tables to the first page when the date changes", () => {
    const onBatchPageChange = vi.fn();
    const onSessionPageChange = vi.fn();
    const view = (filterDate: string) => (
      <ActiveBatchesView
        filterDate={filterDate}
        onFilterDateChange={vi.fn()}
        data={makeResponse()}
        isLoading={false}
        batchPage={1}
        batchPageSize={10}
        onBatchPageChange={onBatchPageChange}
        onBatchPageSizeChange={vi.fn()}
        sessionPage={1}
        sessionPageSize={10}
        onSessionPageChange={onSessionPageChange}
        onSessionPageSizeChange={vi.fn()}
      />
    );

    const { rerender } = render(view("2026-09-20"));
    // Mounting already resets, so only the later date change is observed here.
    onBatchPageChange.mockClear();
    onSessionPageChange.mockClear();

    rerender(view("2026-09-21"));

    expect(onBatchPageChange).toHaveBeenCalledWith(1);
    expect(onSessionPageChange).toHaveBeenCalledWith(1);
  });

  it("resets both tables when the sort column changes at the same direction", async () => {
    const user = userEvent.setup();
    const onBatchPageChange = vi.fn();
    const onSessionPageChange = vi.fn();
    render(
      <ActiveBatchesView
        filterDate="2026-09-20"
        onFilterDateChange={vi.fn()}
        data={makeResponse()}
        isLoading={false}
        // Both tables sit on a later page, so a missed reset is visible.
        batchPage={2}
        batchPageSize={10}
        onBatchPageChange={onBatchPageChange}
        onBatchPageSizeChange={vi.fn()}
        sessionPage={2}
        sessionPageSize={10}
        onSessionPageChange={onSessionPageChange}
        onSessionPageSizeChange={vi.fn()}
      />
    );

    onBatchPageChange.mockClear();
    onSessionPageChange.mockClear();

    const [batchSort, sessionSort] = screen.getAllByLabelText("Sort by") as unknown as HTMLSelectElement[];

    // Both "Program" and "Client" default to ascending. The sort still fully
    // reorders the rows, so the page offset has to reset with it.
    await user.selectOptions(batchSort, "program");
    expect(onBatchPageChange).toHaveBeenCalledWith(1);

    onBatchPageChange.mockClear();
    await user.selectOptions(batchSort, "client");
    expect(onBatchPageChange).toHaveBeenCalledWith(1);

    await user.selectOptions(sessionSort, "module");
    await user.selectOptions(sessionSort, "person");
    expect(onSessionPageChange).toHaveBeenCalledWith(1);
  });
});

describe("ActiveBatchesView column visibility", () => {
  it("starts with the suggested columns hidden", () => {
    renderView({ data: makeResponse() });

    expect(screen.queryByRole("columnheader", { name: /Sessions Conducted/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Delivery Mode/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Enrollments/ })).toBeTruthy();
  });

  it("hides a column the user switched off and shows it again", async () => {
    const user = userEvent.setup();
    renderView({ data: makeResponse() });

    const [batchColumnsButton] = screen.getAllByRole("button", { name: /Columns/ });
    await user.click(batchColumnsButton);
    await user.click(screen.getByRole("checkbox", { name: "Enrollments" }));

    expect(screen.queryByRole("columnheader", { name: /Enrollments/ })).toBeNull();
    // The cell goes with the heading, so the row keeps its remaining columns.
    expect(screen.getByRole("columnheader", { name: /Batch & Program/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Show all columns/ }));
    expect(screen.getByRole("columnheader", { name: /Enrollments/ })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /Sessions Conducted/ })).toBeTruthy();
  });

  it("keeps the ongoing sessions table controls working in fullscreen", async () => {
    const user = userEvent.setup();
    renderView({
      data: makeResponse({
        sessions: [
          makeSession({ id: "s-1", session_type: "scheduled" }),
          makeSession({ id: "s-2", session_type: "actual", module: "Advanced Python" }),
        ],
      }),
    });

    const [, sessionFullscreenButton] = screen.getAllByRole("button", { name: /Full Screen/ });
    const sessionPanel = sessionFullscreenButton.closest("[data-fullscreen]");
    expect(sessionPanel).toHaveAttribute("data-fullscreen", "false");

    const [, sessionFiltersButton] = screen.getAllByRole("button", { name: /^Filters/ });
    await user.click(sessionFiltersButton);

    await user.click(sessionFullscreenButton);
    // The expanded overlay is portalled out of the panel's own position, so it
    // is looked up on the body rather than through the original node.
    const fullscreenPanel = document.body.querySelector('[data-fullscreen="true"]');
    expect(fullscreenPanel).not.toBeNull();
    expect((fullscreenPanel as HTMLElement).parentElement).toBe(document.body);
    expect((fullscreenPanel as HTMLElement).style.position).toBe("fixed");
    expect((fullscreenPanel as HTMLElement).style.width).toBe("100vw");
    expect((fullscreenPanel as HTMLElement).style.height).toBe("100dvh");
    expect((fullscreenPanel as HTMLElement).style.zIndex).toBe("1000");
    expect(document.body.style.overflow).toBe("hidden");

    // Column visibility toggle works in fullscreen
    const [, sessionColumnsButton] = screen.getAllByRole("button", { name: /Columns/ });
    await user.click(sessionColumnsButton);
    await user.click(screen.getByRole("checkbox", { name: "Module" }));

    expect(screen.queryByRole("columnheader", { name: "Module" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Show all columns/ }));
    expect(screen.getByRole("columnheader", { name: "Module" })).toBeTruthy();

    // Escape is the way out of the CSS overlay the same way it is out of
    // native fullscreen, so the sessions table has to answer it too.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.body.querySelector('[data-fullscreen="true"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(screen.queryByRole("button", { name: /Exit Full Screen/ })).toBeNull();
    const [, collapsedSessionButton] = screen.getAllByRole("button", { name: /Full Screen/ });
    expect(collapsedSessionButton.closest("[data-fullscreen]")).toHaveAttribute("data-fullscreen", "false");

    // The exit button still takes the panel back down afterwards.
    await user.click(collapsedSessionButton);
    expect(document.body.querySelector('[data-fullscreen="true"]')).not.toBeNull();
    await user.click(screen.getByRole("button", { name: /Exit Full Screen/ }));
    expect(document.body.querySelector('[data-fullscreen="true"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("ActiveBatchesView row click", () => {
  it("opens the batch detail on click and from the keyboard", async () => {
    const user = userEvent.setup();
    const onOpenBatchDetail = vi.fn();
    const batch = makeBatch();
    renderView({ data: makeResponse({ batches: [batch] }), onOpenBatchDetail });

    // The fixture's session shares the batch code, so the query is scoped to
    // the batches table rather than matching both rows.
    const [batchTable] = screen.getAllByRole("table");
    const row = within(batchTable).getByRole("row", { name: "Open details for batch BATCH_001" });
    await user.click(row);
    expect(onOpenBatchDetail).toHaveBeenCalledWith("BATCH_001");

    row.focus();
    await user.keyboard("{Enter}");
    expect(onOpenBatchDetail).toHaveBeenCalledTimes(2);

    await user.keyboard(" ");
    expect(onOpenBatchDetail).toHaveBeenCalledTimes(3);
  });

  it("opens the parent batch from a session row", async () => {
    const user = userEvent.setup();
    const onOpenBatchDetail = vi.fn();
    renderView({
      data: makeResponse({
        sessions: [makeSession({ id: "s-1", batch_id: "BATCH_002", batch_name: "Data Engineering" })],
      }),
      onOpenBatchDetail,
    });

    const [, sessionTable] = screen.getAllByRole("table");
    const row = within(sessionTable).getByRole("row", { name: "Open details for batch BATCH_002" });
    await user.click(row);
    expect(onOpenBatchDetail).toHaveBeenCalledWith("BATCH_002");

    row.focus();
    await user.keyboard("{Enter}");
    expect(onOpenBatchDetail).toHaveBeenCalledTimes(2);

    await user.keyboard(" ");
    expect(onOpenBatchDetail).toHaveBeenCalledTimes(3);
  });

  it("leaves session rows without a batch code inert", async () => {
    const user = userEvent.setup();
    const onOpenBatchDetail = vi.fn();
    renderView({
      data: makeResponse({ sessions: [makeSession({ id: "s-1", batch_id: "" })] }),
      onOpenBatchDetail,
    });

    const [, sessionTable] = screen.getAllByRole("table");
    expect(within(sessionTable).queryByRole("row", { name: /Open details for batch/ })).toBeNull();

    const row = within(sessionTable).getByText("Python Basics").closest("tr") as HTMLElement;
    await user.click(row);
    expect(onOpenBatchDetail).not.toHaveBeenCalled();
  });

  it("leaves session rows inert when no detail handler is supplied", () => {
    renderView({ data: makeResponse() });

    const [, sessionTable] = screen.getAllByRole("table");
    expect(within(sessionTable).queryByRole("row", { name: /Open details for batch/ })).toBeNull();
  });

  it("leaves rows inert when no detail handler is supplied", () => {
    renderView({ data: makeResponse() });

    expect(screen.queryByRole("row", { name: /Open details for batch/ })).toBeNull();
  });
});

describe("ActiveBatchesView empty states", () => {
  it("says nothing is running yet when the date has no batches or sessions", () => {
    renderView({ data: makeResponse({ batches: [], sessions: [], total_batches: 0, total_sessions: 0 }) });

    expect(screen.getByText("No ongoing batches for this date")).toBeTruthy();
    expect(screen.getByText("No sessions scheduled for this date")).toBeTruthy();
  });

  it("offers a way back when the filters hid everything", async () => {
    const user = userEvent.setup();
    renderView({ data: makeResponse() });

    const [batchSearch] = screen.getAllByRole("searchbox");
    await user.type(batchSearch, "no-such-batch");

    expect(screen.getByText("No batches match the current filters")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByText("No batches match the current filters")).toBeNull();
  });

  it("says every status is shown when the date has no sessions", () => {
    renderView({ data: makeResponse({ batches: [], sessions: [], total_batches: 0, total_sessions: 0 }) });

    expect(
      screen.getByText("All statuses for this date are shown, including cancelled, not conducted, and completed.")
    ).toBeTruthy();
  });

  it("counts cancelled and completed sessions toward the scheduled hours", () => {
    renderView({
      data: makeResponse({
        sessions: [
          makeSession({ id: "s-1", status: "Cancelled", duration_hours: 2 }),
          makeSession({ id: "s-2", status: "Completed", duration_hours: 1.5 }),
        ],
      }),
    });

    expect(metricValue("Scheduled Hours")).toBe("3.5 hrs");
  });

  it("renders cancelled, not conducted and completed sessions as rows", () => {
    renderView({
      data: makeResponse({
        sessions: [
          makeSession({ id: "s-1", status: "Cancelled" }),
          makeSession({ id: "s-2", status: "Not Conducted", module: "Advanced Python" }),
          makeSession({ id: "s-3", status: "Completed", module: "Capstone" }),
        ],
      }),
    });

    const [, sessionTable] = screen.getAllByRole("table");
    expect(within(sessionTable).getByText("Cancelled")).toBeTruthy();
    expect(within(sessionTable).getByText("Not Conducted")).toBeTruthy();
    expect(within(sessionTable).getByText("Completed")).toBeTruthy();
  });
});
