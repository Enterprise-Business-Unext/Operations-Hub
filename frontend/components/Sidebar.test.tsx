import React, { useEffect, useState } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

const logout = vi.fn();

const mockUser = {
  full_name: "Ananya Sharma",
  email: "lead@enterprise-ops.com",
  role: "coordinator",
  role_detail: { name: "Coordinator" },
  team_name: "Delivery",
  direct_reports_count: 0,
  is_manager: false,
  is_configured_approver: false,
};

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, logout }),
}));

import { Sidebar, type DashboardView } from "./Sidebar";

/**
 * Stands in for `app/page.tsx`: it owns `activeView` and applies the same
 * role-based landing redirect on login, which is what puts the sidebar's URL
 * store and the page's view state out of step on first paint.
 */
function DashboardHarness({ initialView }: { initialView: DashboardView }) {
  const [activeView, setActiveView] = useState<DashboardView>(initialView);

  useEffect(() => {
    if (mockUser.role === "coordinator" && activeView === "active_batches") {
      setActiveView("my_batches");
    }
  }, [activeView]);

  return <Sidebar activeView={activeView} setActiveView={setActiveView} />;
}

function setLocationSearch(search: string) {
  window.history.replaceState(null, "", `/${search}`);
}

describe("Sidebar view/URL reconciliation", () => {
  beforeEach(() => {
    logout.mockClear();
    setLocationSearch("");
    mockUser.team_name = "Delivery";
    mockUser.is_configured_approver = false;
  });

  it("applies the role landing redirect and records it in the URL without looping", () => {
    // "Maximum update depth exceeded" (React error #185) came from this exact
    // combination: the landing redirect moved `activeView`, the sidebar wrote
    // that to the URL, the URL was then read back as a request to restore the
    // view it had just replaced, and the two effects traded the value back and
    // forth every commit until React aborted. The render itself throwing is the
    // regression check.
    setLocationSearch("?view=active_batches");

    expect(() => render(<DashboardHarness initialView="active_batches" />)).not.toThrow();

    expect(screen.getByRole("button", { name: "My Batches" })).toHaveAttribute("aria-current", "page");
    expect(window.location.search).toBe("?view=my_batches");
  });

  it("follows the URL on a Back navigation", () => {
    setLocationSearch("?view=faculty");
    render(<DashboardHarness initialView="faculty" />);
    expect(screen.getByRole("button", { name: "Faculty Utilization" })).toHaveAttribute("aria-current", "page");

    // Back/Forward moves the URL out from under a view that did not change,
    // which is the one disagreement the URL is authoritative for.
    act(() => {
      window.history.replaceState(null, "", "/?view=my_batches");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("button", { name: "My Batches" })).toHaveAttribute("aria-current", "page");
    expect(window.location.search).toBe("?view=my_batches");
  });

  it("does not let a hand-edited ?view= widen a coordinator's access", () => {
    // Manager Board is not in a coordinator's nav, so the URL is rewritten to a
    // view they are entitled to rather than adopted.
    setLocationSearch("?view=manager_board");

    render(<DashboardHarness initialView="active_batches" />);

    expect(window.location.search).not.toContain("manager_board");
    expect(screen.queryByRole("button", { name: "Manager Board" })).toBeNull();
  });

  it("pushes one history entry and settles on the clicked view", () => {
    render(<DashboardHarness initialView="active_batches" />);

    const pushState = vi.spyOn(window.history, "pushState");
    act(() => {
      screen.getByRole("button", { name: "Faculty Utilization" }).click();
    });

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?view=faculty");
    pushState.mockRestore();
  });
});

describe("All Batches visibility", () => {
  beforeEach(() => {
    logout.mockClear();
    setLocationSearch("");
    mockUser.team_name = "Delivery";
    mockUser.is_configured_approver = false;
  });

  it("is offered to the configured approvers, who are not on the Finance team", () => {
    mockUser.is_configured_approver = true;

    render(<Sidebar activeView="active_batches" setActiveView={() => {}} />);

    expect(screen.getByRole("button", { name: "All Batches" })).toBeInTheDocument();
  });

  it("is offered to the Finance team", () => {
    mockUser.team_name = "Finance";

    render(<Sidebar activeView="active_batches" setActiveView={() => {}} />);

    expect(screen.getByRole("button", { name: "All Batches" })).toBeInTheDocument();
  });

  it("stays hidden from a Delivery user who is neither", () => {
    render(<Sidebar activeView="active_batches" setActiveView={() => {}} />);

    expect(screen.queryByRole("button", { name: "All Batches" })).toBeNull();
  });
});

describe("Top-level manager tabs", () => {
  beforeEach(() => {
    logout.mockClear();
    setLocationSearch("");
    mockUser.team_name = "Delivery";
    mockUser.is_configured_approver = false;
    mockUser.role = "manager";
    mockUser.manager_id = undefined;
    mockUser.is_manager = true;
    mockUser.direct_reports_count = 1;
  });

  it("shows every tab except the Approval Queue", () => {
    render(<Sidebar activeView="active_batches" setActiveView={() => {}} />);

    expect(screen.getByRole("button", { name: "All Batches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My Batches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Active Batches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manager Board" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faculty Utilization" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Team Analytics" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approval Queue" })).toBeNull();
  });

  it("hides All Batches and the Approval Queue when the manager has a manager above and is not an approver", () => {
    mockUser.manager_id = "mgr-above";
    mockUser.is_configured_approver = false;

    render(<Sidebar activeView="active_batches" setActiveView={() => {}} />);

    expect(screen.queryByRole("button", { name: "All Batches" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approval Queue" })).toBeNull();
  });

  it("shows All Batches and the Approval Queue for a non-top-level manager who is a configured approver", () => {
    mockUser.manager_id = "mgr-above";
    mockUser.is_configured_approver = true;

    render(<Sidebar activeView="active_batches" setActiveView={() => {}} />);

    expect(screen.getByRole("button", { name: "All Batches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approval Queue" })).toBeInTheDocument();
  });
});