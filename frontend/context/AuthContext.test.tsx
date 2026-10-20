import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "@/lib/api";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/api", () => ({
  api: {
    getMe: vi.fn(),
    refreshToken: vi.fn(),
    logout: vi.fn(),
    setTokenRefreshListener: vi.fn(),
  },
}));

function AuthStatus() {
  const { user, isLoading } = useAuth();
  return <div>{isLoading ? "Loading session" : user ? "Signed in" : "Signed out"}</div>;
}

describe("AuthProvider session restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = "ops_session=1";
  });

  it("clears the middleware session flag before navigating after restore fails", async () => {
    let finishLogout!: () => void;
    vi.mocked(api.getMe).mockRejectedValue(new Error("Access token expired"));
    vi.mocked(api.refreshToken).mockRejectedValue(new Error("Refresh token expired"));
    vi.mocked(api.logout).mockImplementation(
      () => new Promise<void>((resolve) => { finishLogout = resolve; })
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(document.cookie).not.toContain("ops_session=1");
    expect(screen.getByText("Loading session")).toBeInTheDocument();

    await act(async () => {
      finishLogout();
    });

    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    expect(router.replace).toHaveBeenCalledWith("/login");
  });
});
