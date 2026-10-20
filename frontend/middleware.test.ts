import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

/**
 * The middleware gates protected navigation using the backend's HttpOnly
 * `ops_session` cookie.
 */
function makeRequest(pathname: string, hasSession: boolean) {
  const request = new NextRequest(new URL(pathname, "http://localhost:3000"));
  if (hasSession) {
    request.cookies.set("ops_session", "1");
  }
  return request;
}

describe("route protection middleware", () => {
  it("redirects anonymous users away from protected routes to /login", () => {
    const response = middleware(makeRequest("/", false));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("preserves the intended destination via ?next", () => {
    const response = middleware(makeRequest("/admin", false));
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fadmin");
  });

  it("lets authenticated users through", () => {
    const response = middleware(makeRequest("/", true));
    expect(response.status).toBe(200);
  });

  it("does not append ?next for the root path", () => {
    const response = middleware(makeRequest("/", false));
    expect(response.headers.get("location")).not.toContain("next=");
  });

  it("allows anonymous access to /login", () => {
    const response = middleware(makeRequest("/login", false));
    expect(response.status).toBe(200);
  });

  it("allows /login even when a session cookie is present so the client can validate it", () => {
    const response = middleware(makeRequest("/login", true));
    expect(response.status).toBe(200);
  });

  it("gates /admin like any other protected route", () => {
    expect(middleware(makeRequest("/admin", false)).status).toBe(307);
    expect(middleware(makeRequest("/admin", true)).status).toBe(200);
  });
});
