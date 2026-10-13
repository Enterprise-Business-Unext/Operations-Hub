import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MyBatchesView } from "./MyBatchesView";
import { Batch } from "@/lib/api";

function makeBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: "b-1",
    batch_id: "BATCH_001",
    category: "Bootcamp",
    residential_type: "Residential",
    program_name: "Full Stack Python",
    delivery_mode: "Online",
    training_days: 5,
    total_hours: 40,
    total_enrollments: 30,
    status: "Approval 1 Pending",
    is_schema_locked: false,
    created_at: "2027-01-01T00:00:00Z",
    updated_at: "2027-01-01T00:00:00Z",
    ...overrides,
  } as Batch;
}

function renderView(props: Partial<React.ComponentProps<typeof MyBatchesView>> = {}) {
  const onOpenBatchDetail = vi.fn();
  const onPageChange = vi.fn();
  const onPageSizeChange = vi.fn();

  render(
    <MyBatchesView
      data={[]}
      isLoading={false}
      error={null}
      onOpenBatchDetail={onOpenBatchDetail}
      page={1}
      pageSize={10}
      onPageChange={onPageChange}
      onPageSizeChange={onPageSizeChange}
      {...props}
    />
  );

  return { onOpenBatchDetail, onPageChange, onPageSizeChange };
}

describe("MyBatchesView schedule column", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags a batch with no timetable as Not scheduled", () => {
    renderView({ data: [makeBatch({ scheduled_session_count: 0 })] });

    expect(screen.getByText("Not scheduled")).toBeTruthy();
    expect(screen.queryByText(/^\d+ days?$/)).toBeNull();
  });

  it("treats a missing count as unscheduled rather than rendering NaN", () => {
    renderView({ data: [makeBatch()] });

    expect(screen.getByText("Not scheduled")).toBeTruthy();
  });

  it("shows the scheduled day count once a timetable exists", () => {
    renderView({ data: [makeBatch({ training_days: 12, scheduled_session_count: 12 })] });

    expect(screen.getByText("12 days")).toBeTruthy();
    expect(screen.queryByText("Not scheduled")).toBeNull();
  });

  it("uses the singular form for a single scheduled day", () => {
    renderView({ data: [makeBatch({ training_days: 1, scheduled_session_count: 1 })] });

    expect(screen.getByText("1 day")).toBeTruthy();
  });

  it("warns when scheduled days exceed the batch training-day limit", () => {
    renderView({ data: [makeBatch({ training_days: 15, scheduled_session_count: 16 })] });

    expect(screen.getByText("16 / 15 days")).toBeTruthy();
  });
});

describe("MyBatchesView row actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the batch detail for the row whose Manage Schedule was clicked", async () => {
    const user = userEvent.setup();
    const target = makeBatch({ id: "b-target", batch_id: "TARGET_BATCH", scheduled_session_count: 4 });
    const other = makeBatch({ id: "b-other", batch_id: "OTHER_BATCH" });
    const { onOpenBatchDetail } = renderView({ data: [other, target] });

    const buttons = screen.getAllByRole("button", { name: /Manage Schedule/i });
    await user.click(buttons[1]);

    expect(onOpenBatchDetail).toHaveBeenCalledTimes(1);
    expect(onOpenBatchDetail).toHaveBeenCalledWith(target);
  });

  it("opens the batch detail when the row body itself is clicked", async () => {
    const user = userEvent.setup();
    const target = makeBatch({ id: "b-target", batch_id: "TARGET_BATCH" });
    const { onOpenBatchDetail } = renderView({ data: [target] });

    await user.click(screen.getByText("TARGET_BATCH"));

    expect(onOpenBatchDetail).toHaveBeenCalledWith(target);
  });
});

describe("MyBatchesView empty state", () => {
  it("keeps Add New Batch on its own row outside the table header", () => {
    const onCreateBatch = vi.fn();
    renderView({ data: [makeBatch()], canCreateBatch: true, onCreateBatch });

    const createButton = screen.getByRole("button", { name: /Add New Batch/i });
    expect(createButton.closest("[data-fullscreen]")).toBeNull();
    expect(createButton.parentElement).toHaveClass("flex", "justify-end");
  });

  it("offers Add New Batch when the user can create batches", () => {
    const onCreateBatch = vi.fn();
    renderView({ data: [], canCreateBatch: true, onCreateBatch });

    expect(screen.getByText("No batches assigned to you yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add New Batch/i })).toBeInTheDocument();
  });

  it("omits the create pointer when the user cannot create batches", () => {
    renderView({ data: [], canCreateBatch: false });

    expect(screen.getByText("No batches assigned to you yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add New Batch/i })).toBeNull();
  });
});

describe("MyBatchesView column visibility", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("hides a column the user switched off and shows it again", async () => {
    const user = userEvent.setup();
    renderView({ data: [makeBatch()] });

    expect(screen.getByRole("columnheader", { name: /Training Days/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("checkbox", { name: "Training Days" }));

    expect(screen.queryByRole("columnheader", { name: /Training Days/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Batch & Program/ })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Show all columns/ }));
    expect(screen.getByRole("columnheader", { name: /Training Days/ })).toBeTruthy();
  });
});

describe("MyBatchesView filters", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const acme = makeBatch({
    id: "b-acme",
    batch_id: "ACME_001",
    client_name: "Acme Corp",
    delivery_mode: "Online",
    status: "Approved",
  });
  const globex = makeBatch({
    id: "b-globex",
    batch_id: "GLOBEX_001",
    client_name: "Globex",
    delivery_mode: "F2F",
    status: "Approved",
  });

  it("narrows rows by client", async () => {
    const user = userEvent.setup();
    renderView({ data: [acme, globex] });

    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.selectOptions(screen.getByLabelText("Client"), "Globex");

    expect(screen.getByText("GLOBEX_001")).toBeTruthy();
    expect(screen.queryByText("ACME_001")).toBeNull();
  });

  it("narrows rows by delivery mode", async () => {
    const user = userEvent.setup();
    renderView({ data: [acme, globex] });

    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.selectOptions(screen.getByLabelText("Delivery Mode"), "F2F");

    expect(screen.getByText("GLOBEX_001")).toBeTruthy();
    expect(screen.queryByText("ACME_001")).toBeNull();
  });

  it("offers the distinct values of every filterable column as options", async () => {
    const user = userEvent.setup();
    renderView({ data: [acme, globex] });
    await user.click(screen.getByRole("button", { name: "Filters" }));

    // A dropdown rendered without options cannot be used, which is exactly what
    // happened when a select's key had no matching filter field.
    expect(screen.getByLabelText("Client")).toHaveTextContent("Acme Corp");
    expect(screen.getByLabelText("Client")).toHaveTextContent("Globex");
    expect(screen.getByLabelText("Delivery Mode")).toHaveTextContent("Online");
    expect(screen.getByLabelText("Delivery Mode")).toHaveTextContent("F2F");
  });

  it("clears every filter back to the full set", async () => {
    const user = userEvent.setup();
    renderView({ data: [acme, globex] });

    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.selectOptions(screen.getByLabelText("Client"), "Globex");
    expect(screen.queryByText("ACME_001")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Clear/i }));

    expect(screen.getByText("ACME_001")).toBeTruthy();
    expect(screen.getByText("GLOBEX_001")).toBeTruthy();
  });

  it("returns to page 1 when the sort column changes", async () => {
    const user = userEvent.setup();
    const { onPageChange } = renderView({ data: [acme, globex], page: 3 });

    onPageChange.mockClear();
    await user.selectOptions(screen.getByLabelText("Sort by"), "startDate");

    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
