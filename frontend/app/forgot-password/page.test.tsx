import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ForgotPasswordPage from "./page";
import { api } from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/Navbar", () => ({ BRAND_GRADIENT: "linear-gradient(90deg, #000, #fff)" }));
vi.mock("@/lib/api", () => ({
  api: { forgotPassword: vi.fn() },
}));

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.mocked(api.forgotPassword).mockReset();
  });

  it("shows the success state after submitting and uses readable copy", async () => {
    vi.mocked(api.forgotPassword).mockResolvedValue({ detail: "If an account exists, a reset link has been sent." });
    render(<ForgotPasswordPage />);

    const emailInput = screen.getByLabelText("Corporate Email Address");
    expect(emailInput).toBeInTheDocument();
    expect(document.querySelector("svg.lucide-mail")).not.toBeInTheDocument();
    expect(screen.getByText("Enter your corporate email and we'll send you a password reset link")).toBeInTheDocument();

    fireEvent.change(emailInput, { target: { value: " User@Example.com " } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(screen.getByText("If an account with that email exists, we've sent a password reset link to it.")).toBeInTheDocument();
    expect(api.forgotPassword).toHaveBeenCalledWith("user@example.com");
  });

  it("shows an error and keeps the form available when the request fails", async () => {
    vi.mocked(api.forgotPassword).mockRejectedValue(new Error("Email service unavailable"));
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText("Corporate Email Address"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Email service unavailable");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /send reset link/i })).toBeEnabled();
    });
  });
});
