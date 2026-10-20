import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { api, ApiError } from "@/lib/api";

/**
 * The API client previously threw bare `Error`s with no status, no details and
 * no timeout, which meant callers could not distinguish a 403 from a 500 or a
 * network failure. These tests lock in the typed `ApiError` behaviour.
 */
describe("ApiService error handling", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws a typed ApiError carrying the HTTP status and detail", async () => {
    server.use(
      http.get("*/api/v1/batches", () =>
        HttpResponse.json({ detail: "You do not have permission to view batches" }, { status: 403 })
      )
    );

    const error = await api.getBatches().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toBe("You do not have permission to view batches");
    expect(error.retryable).toBe(false);
  });

  it("stringifies structured validation details", async () => {
    server.use(
      http.post("*/api/v1/batches", () =>
        HttpResponse.json(
          { detail: [{ loc: ["body"], msg: "At least one faculty member required" }] },
          { status: 422 }
        )
      )
    );

    const error = await api
      .createBatch({
        batch_id: "X",
        program_name: "X",
        delivery_mode: "Online",
        primary_manager_id: "m1",
        coordinator_id: "c1",
        sales_spoc_id: "s1",
      })
      .catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.message).toContain("At least one faculty member required");
  });

  it("marks server errors as retryable", async () => {
    server.use(
      http.get("*/api/v1/batches", () => HttpResponse.json({ detail: "boom" }, { status: 503 }))
    );

    const error = await api.getBatches().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.retryable).toBe(true);
  });

  it("falls back to a status message when the body is not JSON", async () => {
    server.use(
      http.get("*/api/v1/batches", () => new HttpResponse("<html>Bad Gateway</html>", { status: 502 }))
    );

    const error = await api.getBatches().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).toContain("502");
  });

  it("returns undefined for an empty 200 body instead of throwing a SyntaxError", async () => {
    server.use(http.get("*/api/v1/batches/empty", () => new HttpResponse("", { status: 200 })));

    const result = await api.getBatch("empty");

    expect(result).toBeUndefined();
  });

  it("returns undefined for 204 No Content", async () => {
    server.use(http.delete("*/api/v1/batches/gone", () => new HttpResponse(null, { status: 204 })));

    const result = await api.deleteBatch("gone");

    expect(result).toBeUndefined();
  });

  it("reports an unreachable server as a network ApiError with status 0", async () => {
    server.use(http.get("*/api/v1/batches", () => HttpResponse.error()));

    const error = await api.getBatches().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.retryable).toBe(true);
  });
});

describe("ApiService auth token handling", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("attaches the stored bearer token to requests", async () => {
    localStorage.setItem("auth_token", "test-access-token");
    let seen: string | null = null;

    server.use(
      http.get("*/api/v1/batches", ({ request }) => {
        seen = request.headers.get("Authorization");
        return HttpResponse.json([]);
      })
    );

    await api.getBatches();

    expect(seen).toBe("Bearer test-access-token");
  });

  it("refreshes once on 401 and retries the original request", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("refresh_token", "valid-refresh-token");

    let batchCalls = 0;
    server.use(
      http.get("*/api/v1/batches", ({ request }) => {
        batchCalls += 1;
        if (request.headers.get("Authorization") === "Bearer access-token-2") {
          return HttpResponse.json([{ id: "b-1" }]);
        }
        return HttpResponse.json({ detail: "expired" }, { status: 401 });
      })
    );

    const result = await api.getBatches();

    expect(batchCalls).toBe(2);
    expect(localStorage.getItem("auth_token")).toBe("access-token-2");
    expect(result).toEqual([{ id: "b-1" }]);
  });

  it("refreshes from the HttpOnly cookie when localStorage has no refresh token", async () => {
    let batchCalls = 0;
    let refreshCalls = 0;
    server.use(
      http.get("*/api/v1/batches", () => {
        batchCalls += 1;
        return batchCalls === 1
          ? HttpResponse.json({ detail: "expired" }, { status: 401 })
          : HttpResponse.json([{ id: "b-cookie-session" }]);
      }),
      http.post("*/api/v1/auth/refresh", () => {
        refreshCalls += 1;
        return HttpResponse.json({
          access_token: "cookie-refreshed-access",
          refresh_token: "cookie-refreshed-refresh",
          user: { id: "u-1", email: "user@example.com", role: "Coordinator" },
        });
      })
    );

    const result = await api.getBatches();

    expect(refreshCalls).toBe(1);
    expect(batchCalls).toBe(2);
    expect(result).toEqual([{ id: "b-cookie-session" }]);
  });

  it("notifies the registered listener when a silent refresh occurs", async () => {
    localStorage.setItem("auth_token", "expired-token");
    localStorage.setItem("refresh_token", "valid-refresh-token");
    const listener = vi.fn();
    api.setTokenRefreshListener(listener);

    server.use(
      http.get("*/api/v1/batches", ({ request }) =>
        request.headers.get("Authorization") === "Bearer access-token-2"
          ? HttpResponse.json([])
          : HttpResponse.json({ detail: "expired" }, { status: 401 })
      )
    );

    await api.getBatches();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "access-token-2" })
    );

    api.setTokenRefreshListener(null);
  });

  it("surfaces a 401 when no refresh token is available", async () => {
    localStorage.setItem("auth_token", "expired-token");
    server.use(
      http.get("*/api/v1/batches", () => HttpResponse.json({ detail: "nope" }, { status: 401 })),
      http.post("*/api/v1/auth/refresh", () =>
        HttpResponse.json({ detail: "Refresh token is missing or expired" }, { status: 401 })
      )
    );

    const error = await api.getBatches().catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
  });
});

describe("ApiService getBatches ownership scope", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sends mine=true when the caller asks for its own batches", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/v1/batches", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      })
    );

    await api.getBatches({ mine: true });

    expect(seen!.get("mine")).toBe("true");
  });

  it("omits mine entirely when it is not requested", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/api/v1/batches", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      })
    );

    await api.getBatches({});

    expect(seen!.has("mine")).toBe(false);
  });
});
