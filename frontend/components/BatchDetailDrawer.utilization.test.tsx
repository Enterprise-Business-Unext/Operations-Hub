import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const getBatch = vi.fn();
const getBatchOptions = vi.fn();
const getFacultyTypes = vi.fn();
const getProgramTypes = vi.fn();
const getVerticals = vi.fn();
const getSessions = vi.fn();
const getScheduledSessions = vi.fn();
const getFacultyList = vi.fn();
const createSession = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getBatch: (...a: unknown[]) => getBatch(...a),
      getBatchOptions: (...a: unknown[]) => getBatchOptions(...a),
      getFacultyTypes: (...a: unknown[]) => getFacultyTypes(...a),
      getProgramTypes: (...a: unknown[]) => getProgramTypes(...a),
      getVerticals: (...a: unknown[]) => getVerticals(...a),
      getSessions: (...a: unknown[]) => getSessions(...a),
      getScheduledSessions: (...a: unknown[]) => getScheduledSessions(...a),
      getFacultyList: (...a: unknown[]) => getFacultyList(...a),
      createSession: (...a: unknown[]) => createSession(...a),
    },
  };
});

import { BatchDetailDrawer, BatchDetailTab } from "./BatchDetailDrawer";
import { ConfirmProvider } from "./ConfirmProvider";
import { Batch, ScheduledSession } from "@/lib/api";

const batch = {
  id: "b-1",
  batch_id: "BATCH_001",
  client_name: "Acme Corp",
  category: "Bootcamp",
  program_name: "Full Stack Python",
  delivery_mode: "Online",
  location_city: "Pune",
  training_days: 5,
  total_hours: 40,
  total_enrollments: 30,
  residential_enrollments: 30,
  non_residential_enrollments: 0,
  status: "Ongoing",
  faculty_assigned_text: "Kiran Menon",
  is_schema_locked: false,
  created_at: "2027-01-01T00:00:00Z",
  updated_at: "2027-01-01T00:00:00Z",
} as Batch;

const scheduledSession = {
  id: "s-1",
  batch_id: "b-1",
  sequence_number: 1,
  session_date: "2027-01-04",
  day_name: "Monday",
  start_time: "09:30:00",
  end_time: "17:30:00",
  duration_hours: 8,
  module: "Module 1: Orientation",
  trainer_name: "Kiran Menon",
  status: "Scheduled",
  utilization_logged: false,
} as unknown as ScheduledSession;

function renderDrawer() {
  return render(
    <ConfirmProvider>
      <BatchDetailDrawer
        batch={batch}
        isOpen
        onClose={() => {}}
        initialTab={"sessions" as BatchDetailTab}
      />
    </ConfirmProvider>
  );
}

/** Same wiring the dashboard uses: `onClose` really does drop the drawer. */
function renderDrawerWired() {
  function Host() {
    const [open, setOpen] = React.useState<Batch | null>(batch);
    return (
      <ConfirmProvider>
        <BatchDetailDrawer
          batch={open}
          isOpen={!!open}
          onClose={() => setOpen(null)}
          initialTab={"sessions" as BatchDetailTab}
        />
      </ConfirmProvider>
    );
  }
  return render(<Host />);
}

/** The drawer is now itself a Radix dialog, so the modal is found by name. */
const utilDialog = () => screen.getByRole("dialog", { name: /log faculty utilization/i }) as HTMLElement;
const queryUtilDialog = () => screen.queryByRole("dialog", { name: /log faculty utilization/i });

/** Opens the modal and returns queries scoped to the dialog itself. */
async function openLogUtilization() {
  renderDrawer();
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Log Utilization/i })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("button", { name: /Log Utilization/i }));
  await waitFor(() => {
    expect(utilDialog()).toBeTruthy();
  });
  const dialog = utilDialog();
  return {
    dialog,
    q: within(dialog),
    field: (label: RegExp) => within(dialog).getByLabelText(label) as HTMLInputElement,
    button: (name: RegExp) => within(dialog).getByRole("button", { name }),
  };
}

describe("Log Faculty Utilization modal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBatch.mockResolvedValue(batch);
    getBatchOptions.mockResolvedValue([]);
    getFacultyTypes.mockResolvedValue([{ id: "ft-1", name: "Internal Full-time" }]);
    getProgramTypes.mockResolvedValue([{ id: "pt-1", name: "RBT" }]);
    getVerticals.mockResolvedValue([{ id: "v-1", name: "IT/ITES" }]);
    getSessions.mockResolvedValue([]);
    getScheduledSessions.mockResolvedValue([scheduledSession]);
    getFacultyList.mockResolvedValue([{ full_name: "Kiran Menon" }]);
    createSession.mockResolvedValue({});
  });

  // Regression: the overlay used to close the modal on mousedown, so pressing any
  // field that opens a native popup (the datalist, a select, the date/time picker)
  // dismissed the dialog before anything could be edited.
  // Regression: the modal is a sibling of the drawer panel, so without a propagation
  // guard every press in the form reached the drawer's click-to-close overlay and
  // unmounted the whole drawer mid-edit.
  it("survives field presses when the drawer can actually close", async () => {
    renderDrawerWired();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Log Utilization/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /Log Utilization/i }));
    await waitFor(() => {
      expect(utilDialog()).toBeTruthy();
    });
    const dialog = utilDialog();

    const topic = within(dialog).getByLabelText(/Training Topic/i) as HTMLInputElement;
    fireEvent.mouseDown(topic);
    fireEvent.click(topic);
    fireEvent.change(topic, { target: { value: "Module 1: Orientation" } });

    expect(utilDialog()).toBeTruthy();
    expect(topic.value).toBe("Module 1: Orientation");

    // The backdrop press must not take the drawer down either.
    fireEvent.click(dialog.parentElement!);
    expect(utilDialog()).toBeTruthy();
  });

  it("stays open when a press lands on the overlay while editing a field", async () => {
    const { dialog, field } = await openLogUtilization();

    fireEvent.change(field(/Training Topic/i), { target: { value: "Module 1: Orientation" } });

    const overlay = dialog.parentElement!;
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);

    expect(utilDialog()).toBeTruthy();
    expect(field(/Training Topic/i).value).toBe("Module 1: Orientation");
  });

  it("stays open when fields are pressed and edited", async () => {
    const { field } = await openLogUtilization();

    const faculty = field(/Actual Faculty/i);
    fireEvent.mouseDown(faculty);
    // Must differ from the prefilled "Kiran Menon": React's value tracker suppresses
    // onChange when the value is unchanged.
    fireEvent.change(faculty, { target: { value: "Rohan Dutta" } });
    const hours = field(/Actual Hours/i);
    fireEvent.mouseDown(hours);
    fireEvent.change(hours, { target: { value: "6" } });

    expect(utilDialog()).toBeTruthy();
    expect(field(/Actual Faculty/i).value).toBe("Rohan Dutta");
    expect(field(/Actual Hours/i).value).toBe("6");
  });

  it("asks before discarding an edited form, and keeps it open on keep editing", async () => {
    const { q, field, button } = await openLogUtilization();

    fireEvent.change(field(/Actual Faculty/i), { target: { value: "Rohan Dutta" } });
    fireEvent.click(button(/^Cancel$/i));

    expect(q.getByText(/Discard the changes you made/i)).toBeTruthy();
    expect(utilDialog()).toBeTruthy();

    fireEvent.click(button(/Keep Editing/i));
    expect(q.queryByText(/Discard the changes you made/i)).toBeNull();
    expect(utilDialog()).toBeTruthy();
  });

  it("closes on Cancel when nothing was edited", async () => {
    const { button } = await openLogUtilization();
    fireEvent.click(button(/^Cancel$/i));
    await waitFor(() => {
      expect(queryUtilDialog()).toBeNull();
    });
  });

  it("closes on Escape", async () => {
    await openLogUtilization();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(queryUtilDialog()).toBeNull();
    });
  });

  it("closes on the close button", async () => {
    const { button } = await openLogUtilization();
    fireEvent.click(button(/^Close log utilization dialog$/i));
    await waitFor(() => {
      expect(queryUtilDialog()).toBeNull();
    });
  });

  it("rejects an inverted time window before calling the API", async () => {
    const { q, field } = await openLogUtilization();

    fireEvent.change(field(/Start Time/i), { target: { value: "17:30" } });
    fireEvent.change(field(/End Time/i), { target: { value: "09:30" } });

    expect(q.getAllByText(/End time must be later than start time/i).length).toBeGreaterThan(0);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("warns when the hours do not match the time window", async () => {
    const { q, field } = await openLogUtilization();

    fireEvent.change(field(/Actual Hours/i), { target: { value: "4" } });

    expect(q.getAllByText(/does not match the/i).length).toBeGreaterThan(0);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("captures the selected program type id on submit", async () => {
    const { q, field, button } = await openLogUtilization();

    fireEvent.click(q.getByRole("button", { name: "Yes" }));
    fireEvent.change(field(/Faculty Type/i), { target: { value: "ft-1" } });
    fireEvent.change(field(/Vertical/i), { target: { value: "IT/ITES" } });
    fireEvent.change(field(/Program Type/i), { target: { value: "pt-1" } });
    fireEvent.click(button(/Save Faculty Utilization/i));

    await waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(1);
    });
    expect(createSession.mock.calls[0][0]).toMatchObject({ program_type_id: "pt-1", faculty_type_id: "ft-1" });
  });

  it("requires a program type before logging utilization", async () => {
    const { q, field } = await openLogUtilization();

    fireEvent.click(q.getByRole("button", { name: "Yes" }));
    fireEvent.change(field(/Faculty Type/i), { target: { value: "ft-1" } });
    fireEvent.change(field(/Vertical/i), { target: { value: "IT/ITES" } });
    // Submit the form directly: the select's `required` attribute makes jsdom
    // block the click-based submit exactly as a browser would, so this exercises
    // the handler's own guard (the same defense-in-depth path as "Vertical is
    // required") rather than the native constraint UI.
    fireEvent.submit(document.getElementById("log-utilization-form") as HTMLFormElement);

    expect(q.getAllByText(/Program Type is required/i).length).toBeGreaterThan(0);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("requires a faculty type before logging utilization", async () => {
    const { q, field } = await openLogUtilization();

    fireEvent.click(q.getByRole("button", { name: "Yes" }));
    fireEvent.change(field(/Vertical/i), { target: { value: "IT/ITES" } });
    fireEvent.change(field(/Program Type/i), { target: { value: "pt-1" } });
    fireEvent.submit(document.getElementById("log-utilization-form") as HTMLFormElement);

    expect(q.getAllByText(/Faculty Type is required/i).length).toBeGreaterThan(0);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("offers only Scheduled and Completed as delivery statuses", async () => {
    const { field } = await openLogUtilization();

    const status = field(/Delivery Status/i) as unknown as HTMLSelectElement;
    expect(Array.from(status.options).map((o) => o.value)).toEqual(["Scheduled", "Completed"]);
  });
});
