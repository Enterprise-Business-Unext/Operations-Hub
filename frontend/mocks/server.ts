import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * MSW handlers mirror the real endpoints in `lib/api.ts` and return payloads
 * shaped like the interfaces declared there.
 */
const makeUser = (overrides: Record<string, unknown> = {}) => ({
  id: "u-1",
  email: "test@example.com",
  full_name: "Test User",
  role: "Admin",
  role_id: "r-1",
  team_id: "t-1",
  team_name: "Ops",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

const makeBatch = (overrides: Record<string, unknown> = {}) => ({
  id: "b-1",
  batch_id: "TEST_BATCH_001",
  program_name: "Test Program",
  category: "Bootcamp",
  residential_type: "NR",
  delivery_mode: "Online",
  training_days: 1,
  total_hours: 8,
  total_enrollments: 5,
  is_schema_locked: false,
  status: "Requested",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...overrides,
});

export const handlers = [
  // Auth
  http.post("*/api/v1/auth/login", async () =>
    HttpResponse.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      user: makeUser(),
    })
  ),
  http.post("*/api/v1/auth/refresh", async () =>
    HttpResponse.json({
      access_token: "access-token-2",
      refresh_token: "refresh-token-2",
      user: makeUser(),
    })
  ),
  http.get("*/api/v1/auth/me", async () => HttpResponse.json(makeUser())),

  // Batches
  http.get("*/api/v1/batches", async () => HttpResponse.json([makeBatch()])),
  http.get("*/api/v1/batches/:id", async () => HttpResponse.json(makeBatch())),
  http.post("*/api/v1/batches", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(makeBatch({ ...body, id: "b-new" }), { status: 201 });
  }),
  http.patch("*/api/v1/batches/:id", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(makeBatch(body));
  }),
  http.delete("*/api/v1/batches/:id", async () => new HttpResponse(null, { status: 204 })),
  http.post("*/api/v1/batches/:id/submit", async () =>
    HttpResponse.json(makeBatch({ status: "Approval 1 Pending" }))
  ),

  // Faculty — `getFacultyList` returns a bare array, not a wrapped object.
  http.get("*/api/v1/faculty", async () =>
    HttpResponse.json([
      { id: "f-1", full_name: "Dr. Test Faculty", domain: "Data", faculty_type: "Internal" },
    ])
  ),

  // Taxonomy
  http.get("*/api/v1/batch-options/:type", async () =>
    HttpResponse.json([{ id: "o-1", name: "Sample", is_active: true }])
  ),
];

export const server = setupServer(...handlers);
