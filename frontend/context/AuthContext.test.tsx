import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { api } from "@/lib/api";
import type { User } from "@/lib/api";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getMe: vi.fn(),
      refreshToken: vi.fn(),
      logout: vi.fn(),
      setTokenRefreshListener: vi.fn(),
    },
  };
});

function AuthStatus() {
  const { user, isLoading } = useAuth();
  return <div>{isLoading ? "Loading session" : user ? "Signed in" : "Signed out"}</div>;
}

describe("AuthProvider session restoration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.cookie = "";
  });

  it("restores a valid HttpOnly-cookie session without reading document.cookie", async () => {
    const profile = { id: "user-1", email: "user@example.com", role: "Coordinator" } as User;
    vi.mocked(api.getMe).mockResolvedValue(profile);

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("Signed in")).toBeInTheDocument());
    expect(api.getMe).toHaveBeenCalledOnce();
    expect(api.logout).not.toHaveBeenCalled();
  });

  it("finishes bootstrap when there is no valid session", async () => {
    vi.mocked(api.getMe).mockRejectedValue(new Error("Could not validate credentials"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AuthProvider>
        <AuthStatus />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText("Signed out")).toBeInTheDocument());
    expect(api.getMe).toHaveBeenCalledOnce();
  });
});
