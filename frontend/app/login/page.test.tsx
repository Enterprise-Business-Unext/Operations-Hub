import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

vi.mock("@/context/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/components/Navbar", () => ({ BRAND_GRADIENT: "linear-gradient(90deg, #000, #fff)" }));

describe("LoginPage", () => {
  const login = vi.fn();

  beforeEach(() => {
    login.mockReset();
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      login,
      isLoading: false,
      logout: vi.fn(),
      refreshAccessToken: vi.fn(),
    });
  });

  it("explains that a 423 lockout is temporary and shows the retry time", async () => {
    login.mockRejectedValue(
      new ApiError(
        "Account temporarily locked after 10 unsuccessful sign-in attempts. Try again after 18:00:00 IST",
        423
      )
    );
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Corporate Email Address"), {
      target: { value: "user@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "incorrect-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your account is temporarily locked after too many unsuccessful sign-in attempts."
    );
    expect(screen.getByRole("alert")).toHaveTextContent("10 unsuccessful sign-in attempts");
    expect(screen.getByRole("alert")).toHaveTextContent("Try again after 18:00:00 IST");
  });
});
