// API Client for FastAPI backend

/**
 * Resolved once at module load. A missing `NEXT_PUBLIC_API_URL` is reported as
 * a console warning and falls back to the local development default rather than
 * throwing during module evaluation, which previously produced an opaque boot
 * failure that no error boundary could catch.
 */
function getApiBaseUrl(): string {
  const rawApiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!rawApiUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_API_URL is not set. API calls will fail until this is configured."
      );
    }
    console.warn(
      "NEXT_PUBLIC_API_URL is not set. Falling back to http://127.0.0.1:8000/api/v1 — " +
        "API calls will fail until this is configured."
    );
    return "http://127.0.0.1:8000/api/v1";
  }
  return rawApiUrl.endsWith("/api/v1") ? rawApiUrl : `${rawApiUrl.replace(/\/+$/, "")}/api/v1`;
}

const API_BASE = getApiBaseUrl();

export interface Team {
  id: string;
  name: string;
  department: string;
  description?: string | null;
  is_active: boolean;
  member_count?: number;
  created_at: string;
}

export interface Role {
  id: string;
  name: string;
  system_role: "Admin" | "Manager" | "Coordinator" | "Sales" | "Faculty";
  is_active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: "Admin" | "Manager" | "Coordinator" | "Sales" | "Faculty";
  role_id?: string | null;
  role_detail?: Role | null;
  team_id?: string | null;
  team_detail?: Team | null;
  team_name?: string | null;
  department?: string | null;
  manager_id?: string | null;
  manager_name?: string | null;
  is_manager?: boolean;
  direct_reports_count?: number;
  is_configured_approver?: boolean;
  is_active: boolean;
  created_at: string;
}

export interface UserHierarchyNode {
  id: string;
  full_name: string;
  email: string;
  role: string;
  role_name?: string | null;
  team_name?: string | null;
  department?: string | null;
  manager_id?: string | null;
  direct_reports: UserHierarchyNode[];
}

export interface CreateUserPayload {
  email: string;
  full_name: string;
  password?: string;
  role?: string;
  role_id?: string;
  team_id?: string;
  manager_id?: string;
  is_active?: boolean;
}

export interface AdminUserCreatePayload {
  email: string;
  full_name: string;
  role?: string;
  role_id?: string;
  team_id?: string;
  manager_id?: string;
  is_active?: boolean;
  send_welcome_email?: boolean;
}

export interface AdminUserCreateResponse {
  user: User;
  password: string;
  email_sent: boolean;
}

export interface UpdateUserPayload {
  email?: string;
  full_name?: string;
  password?: string;
  role?: string;
  role_id?: string | null;
  team_id?: string | null;
  manager_id?: string | null;
  is_active?: boolean;
}

export interface CreateRolePayload {
  name: string;
  system_role: string;
  is_active?: boolean;
}

export interface CreateTeamPayload {
  name: string;
  department?: string;
  description?: string;
  is_active?: boolean;
}

export interface CoordinatorMappingPayload {
  coordinator_id: string;
  manager_id: string;
}

export interface CoordinatorMappingRecord {
  id: string;
  coordinator_id: string;
  coordinator_name: string | null;
  coordinator_email: string | null;
  manager_id: string;
  manager_name: string | null;
  manager_email: string | null;
  assigned_at: string;
}

export interface CoordinatorMappingResponse {
  id: string;
  coordinator_id: string;
  manager_id: string;
  assigned_at: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ForgotPasswordResponse {
  detail: string;
}

export interface ResetPasswordPayload {
  token: string;
  new_password: string;
}

export interface ResetPasswordResponse {
  detail: string;
}
export interface Batch {
  id: string;
  batch_id: string;
  sow_number?: string | null;
  approval_id?: string | null;
  entity_id?: string | null;
  entity?: BatchOption | null;
  category: string;
  residential_type: string;
  category_id?: string | null;
  delivery_mode_id?: string | null;
  accommodation_id?: string | null;
  program_name: string;
  technology?: string | null;
  domain?: string | null;
  client_name?: string | null;
  delivery_mode: string;
  location_city?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  batch_request_date?: string | null;
  training_days: number;
  calendar_days?: number | null;
  total_hours: number;
  total_enrollments: number;
  status: "Requested" | "Approval 1 Pending" | "Approval 2 Pending" | "Approved" | "Upcoming" | "Ongoing" | "Completed" | "Cancelled" | "OnHold" | "Rejected";
  is_schema_locked: boolean;
  approver_1_id?: string | null;
  approver_2_id?: string | null;
  approver_1_status?: "Pending" | "Approved" | "Rejected";
  approver_2_status?: "Pending" | "Approved" | "Rejected";
  approver_1_approved_at?: string | null;
  approver_2_approved_at?: string | null;
  is_reapproval?: boolean;
  reapproval_count?: number;
  last_reapproval_at?: string | null;
  last_reapproval_by?: string | null;
  reapproval_changes?: Record<string, { before: unknown; after: unknown }> | null;
  primary_manager_id?: string | null;
  coordinator_id?: string | null;
  sales_spoc_id?: string | null;
  primary_manager?: User | null;
  coordinator?: User | null;
  sales_spoc?: User | null;
  faculty_assigned_text?: string | null;
  finance_status?: string | null;
  finance_status_check_date?: string | null;
  batch_avg_feedback?: number | null;
  batch_nps?: number | null;
  nps_total_responses?: number | null;
  nps_promoters?: number | null;
  nps_passives?: number | null;
  nps_detractors?: number | null;
  remarks?: string | null;
  comments?: string | null;
  sessions_conducted?: number;
  completion_rate?: number;
  scheduled_session_count?: number;
  created_at: string;
  updated_at: string;
}

export interface BatchEditHistoryEntry {
  id: string;
  batch_id: string;
  edited_by?: string | null;
  editor_name?: string | null;
  changed_fields: Record<string, { before: unknown; after: unknown }>;
  created_at: string;
}

export interface ActiveBatchItem {
  id: string;
  batch_id: string;
  program_name: string;
  client_name?: string | null;
  category: string;
  delivery_mode: string;
  location_city?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: string;
  total_enrollments: number;
  training_days: number;
  sessions_conducted: number;
  progress: number;
  batch_avg_feedback?: number | null;
  batch_nps?: number | null;
}

export interface ActiveSessionItem {
  id: string;
  batch_id: string;
  batch_name: string;
  session_type: "scheduled" | "actual";
  module: string;
  trainer_name?: string | null;
  faculty_name?: string | null;
  session_date: string;
  start_time?: string | null;
  end_time?: string | null;
  duration_hours: number;
  status: string;
  venue?: string | null;
  location_city?: string | null;
  mode_of_delivery?: string | null;
}

export interface ActiveBatchesResponse {
  filter_date: string;
  batches: ActiveBatchItem[];
  sessions: ActiveSessionItem[];
  total_batches: number;
  total_sessions: number;
  skip: number;
  limit: number;
  session_skip: number;
  session_limit: number;
}

export interface CreateBatchPayload {
  batch_id: string;
  sow_number?: string;
  program_name: string;
  entity_id?: string;
  category_id?: string;
  delivery_mode_id?: string;
  accommodation_id?: string;
  category?: string;
  technology?: string;
  domain?: string;
  client_name?: string;
  delivery_mode?: string;
  location_city?: string;
  start_date?: string;
  end_date?: string;
  training_days?: number;
  total_hours?: number;
  total_enrollments?: number;
  primary_manager_id: string;
  coordinator_id: string;
  sales_spoc_id: string;
  faculty_assigned_text?: string;
  faculty_members?: Array<{ name?: string }>;
  remarks?: string;
}

export interface BatchOption {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateBatchOptionPayload {
  name: string;
  description?: string;
}

export interface ApprovalConfiguration {
  id: string;
  approver_1_id?: string | null;
  approver_2_id?: string | null;
  updated_at: string;
}

export interface TrainingSession {
  id: string;
  batch_id: string;
  training_session_id?: string | null;
  faculty_name: string;
  date_of_training: string;
  start_time?: string | null;
  end_time?: string | null;
  topic: string;
  no_of_hours: number;
  venue?: string | null;
  location_city?: string | null;
  mode_of_delivery: string;
  status: "Scheduled" | "InProgress" | "Completed" | "Cancelled" | "Not Conducted" | "Rescheduled";
  feedback_submitted: boolean;
  feedback_rating?: number | null;
  feedback_notes?: string | null;
  outcome_reason?: string | null;
  outcome_at?: string | null;
  outcome_by?: string | null;
  vertical?: string | null;
  program_type_id?: string | null;
  faculty_type_id?: string | null;
  faculty_type_name?: string | null;
  created_at: string;
  updated_at?: string | null;
  // Batch-related fields for display
  entity?: string | null;
  category?: string | null;
  client?: string | null;
  program?: string | null;
  batch_code?: string | null;
  coordinator?: string | null;
  // Serialized read-only alias of `feedback_notes` (backend models/session.py),
  // which Gate 1 also writes; the ledger's feedback text lives in one column.
  module_feedback?: string | null;
  coordinator_id?: string | null;
  coordinator_name?: string | null;
}

export interface ScheduledSession {
  id: string;
  batch_id: string;
  session_date: string;
  day_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_hours: number;
  module: string;
  trainer_name?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  utilization_logged?: boolean;
  utilization_id?: string | null;
  actual_trainer?: string | null;
  actual_hours?: number | null;
}

export interface CreateSessionPayload {
  batch_id: string;
  training_session_id?: string;
  date_of_training: string;
  start_time?: string;
  end_time?: string;
  topic: string;
  faculty_name?: string;
  no_of_hours?: number;
  venue?: string;
  location_city?: string;
  mode_of_delivery?: string;
  status?: string;
  feedback_submitted?: boolean;
  feedback_rating?: number;
  feedback_notes?: string;
  outcome_reason?: string;
  vertical?: string;
  program_type_id?: string;
  faculty_type_id: string;
  coordinator_id?: string;
}

export interface SessionFeedbackPayload {
  rating: number; // 1.0 - 5.0
  topic_feedback: string;
  faculty_observations?: string;
  total_students_present?: number;
}

export interface BatchNpsClosurePayload {
  // Only the category counts: the index, the total and the average feedback are
  // derived server-side.
  promoters_count: number;
  passive_count: number;
  detractors_count: number;
  // Optional NPS availability fields for when NPS is not available
  nps_available?: boolean;
  nps_unavailable_reason?: string;
}

// Keys actually returned by PATCH /sessions/{id}/complete (gates/service.py).
export interface Gate1CompleteResponse {
  session_id: string;
  batch_id: string;
  status: string;
  feedback_submitted: boolean;
  rating: number;
  topic_feedback: string;
  total_students_present: number;
  submitted_by?: string;
}

export interface FmsSyncResponse {
  success: boolean;
  message: string;
  faculty_id: string;
  event_type: string;
}

// Analytics Types
export interface VerticalBreakdown {
  vertical: string;
  active_batches: number;
  total_hours: number;
  average_feedback: number;
}

export interface ManagerDashboardSummary {
  total_active_batches: number;
  total_ongoing_sessions: number;
  total_hours_delivered: number;
  overall_avg_nps?: number | null;
  overall_avg_feedback?: number | null;
  faculty_utilization_ratio: number;
  pending_gate1_feedbacks: number;
  pending_gate2_closures: number;
  schedule_not_updated_count: number;
  vertical_distribution: VerticalBreakdown[];
}

// Schedules Types
export interface ExtractedScheduleRow {
  date_of_training: string;
  topic: string;
  faculty_name?: string;
  no_of_hours: number;
  start_time?: string;
  end_time?: string;
  venue?: string;
  location_city?: string;
  mode_of_delivery?: string;
}

export interface ConflictDetail {
  row_index: number;
  field: string;
  message: string;
  suggested_fix?: string;
}

export interface ScheduleIngestResponse {
  success?: boolean;
  message?: string;
  filename?: string;
  batch_id?: string | null;
  source_filename?: string | null;
  sheets_processed?: string[];
  total_rows?: number;
  total_rows_parsed?: number;
  extracted_rows?: number;
  failed_rows?: number;
  items?: ExtractedScheduleRow[];
  extracted_schedule?: ExtractedScheduleRow[];
  errors?: Array<{ source_sheet: string; source_row: number; message: string }>;
}

export interface ScheduleApplyResponse {
  success: boolean;
  target_batch_id: string;
  source_filename?: string | null;
  applied_rows: number;
  session_ids: string[];
}

// Faculty Types
export interface FacultyType extends BatchOption {
}

export interface Vertical extends BatchOption {
}

export interface ProgramType extends BatchOption {
}

export interface FacultyMember {
  id: string;
  full_name: string;
  email: string;
  role: string;
  faculty_type?: string;
  domain?: string;
  is_active: boolean;
}

export interface FacultyUtilizationSummary {
  total_faculty_count: number;
  active_deployed_faculty: number;
  overall_utilization_percentage: number;
  domain_breakdown: Array<{
    domain: string;
    faculty_count: number;
    hours_scheduled: number;
  }>;
}

// FMS Sync Types
export interface FmsSyncLog {
  id: string;
  faculty_id: string;
  event_type: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  response_code?: number | null;
  message?: string | null;
  timestamp: string;
}

export interface AuditLog {
  id: string;
  event_type: string;
  user_id?: string | null;
  user_email?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  details?: string | null;
  created_at: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
  }
}

const REQUEST_TIMEOUT_MS = 30000;

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

class ApiService {
  private getToken(): string | null {
    // Tokens are stored in HttpOnly cookies set by the backend, not localStorage.
    // The browser attaches them automatically via `credentials: "include"`.
    return null;
  }

  // Promise cache for token refresh to prevent race conditions
  private refreshPromise: Promise<{ access_token: string; refresh_token: string; user: User } | null> | null = null;

  /**
   * Invoked whenever a silent token refresh replaces the stored credentials, so
   * AuthContext can resync instead of silently holding stale tokens.
   */
  private onTokensRefreshed: ((tokens: { access_token: string; refresh_token: string; user?: User }) => void) | null = null;

  setTokenRefreshListener(
    listener: ((tokens: { access_token: string; refresh_token: string; user?: User }) => void) | null
  ): void {
    this.onTokensRefreshed = listener;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
    const isMutation = options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
    const csrfToken = isMutation ? getCsrfToken() : null;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers as Record<string, string>),
    };

    const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // Honour a caller-supplied signal as well, so callers can cancel early.
    const externalSignal = options.signal ?? undefined;
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers, credentials: "include", signal: controller.signal });
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        throw new ApiError("The request timed out. Please check your connection and try again.", 0);
      }
      throw new ApiError(
        "Unable to reach the server. Check your network connection and try again.",
        0
      );
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }

    if (!response.ok) {
      let errorMsg = `Error ${response.status}: ${response.statusText}`;
      let details: unknown;
      try {
        const errJson = await response.json();
        details = errJson?.detail;
        if (errJson?.detail) {
          errorMsg =
            typeof errJson.detail === "string"
              ? errJson.detail
              : JSON.stringify(errJson.detail);
        }
      } catch {
        // use default error message
      }

      // Handle token expiration with auto-refresh via HttpOnly cookie rotation
      if (response.status === 401 && retryCount < 1) {
        try {
          const refreshData = await this.performTokenRefresh();
          if (refreshData) {
            this.onTokensRefreshed?.({
              access_token: refreshData.access_token,
              refresh_token: refreshData.refresh_token,
              user: refreshData.user,
            });
            // Retry the original request once (cookie now carries the new token)
            return this.request<T>(endpoint, options, retryCount + 1);
          }
        } catch {
          // Refresh failed, fall through to error
        }
      }

      throw new ApiError(errorMsg, response.status, details);
    }

    // Handle empty responses (204 No Content) and empty bodies.
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError("The server returned an unreadable response.", response.status, text);
    }
  }

  private async performTokenRefresh(): Promise<{ access_token: string; refresh_token: string; user: User } | null> {
    // Backend reads the `refresh_token` HttpOnly cookie and sets a new `auth_token` cookie.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
      });
      if (refreshRes.ok) {
        return await refreshRes.json();
      }
    } catch {
      // Refresh failed
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  }

  /**
   * Authenticated fetch for binary and multipart endpoints, which cannot go
   * through `request()` because it assumes a JSON body. Shares the same 401
   * auto-refresh behaviour and throws the same typed `ApiError`.
   */
  private async fetchWithAuth(
    url: string,
    options: RequestInit = {},
    retryCount = 0
  ): Promise<Response> {
    const isMutation = options.method && !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
    const csrfToken = isMutation ? getCsrfToken() : null;
    const headers: Record<string, string> = {
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...(options.headers as Record<string, string>),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers, credentials: "include", signal: controller.signal });
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        throw new ApiError("The request timed out. Please try again.", 0);
      }
      throw new ApiError("Unable to reach the server. Check your connection and try again.", 0);
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 401 && retryCount < 1) {
      try {
        const refreshData = await this.performTokenRefresh();
        if (refreshData) {
          this.onTokensRefreshed?.({
            access_token: refreshData.access_token,
            refresh_token: refreshData.refresh_token,
            user: refreshData.user,
          });
          return this.fetchWithAuth(url, options, retryCount + 1);
        }
      } catch {
        // Refresh failed, fall through to error
      }
    }

    if (!response.ok) {
      let details: unknown;
      let errorMsg = `Error ${response.status}: ${response.statusText}`;
      try {
        const errJson = await response.json();
        details = errJson?.detail;
        if (errJson?.detail) {
          errorMsg =
            typeof errJson.detail === "string" ? errJson.detail : JSON.stringify(errJson.detail);
        }
      } catch {
        // keep default message
      }
      throw new ApiError(errorMsg, response.status, details);
    }

    return response;
  }

  // Auth & Users APIs
  async login(email: string, password: string): Promise<{ access_token: string; refresh_token: string; user: User }> {
    return this.request<{ access_token: string; refresh_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async refreshToken(): Promise<{ access_token: string; refresh_token: string; user: User }> {
    // Backend reads the `refresh_token` HttpOnly cookie and rotates the `auth_token` cookie.
    return this.request<{ access_token: string; refresh_token: string; user: User }>("/auth/refresh", {
      method: "POST",
    });
  }

  async logout(): Promise<void> {
    // Backend clears the HttpOnly auth cookies via Set-Cookie Max-Age=0.
    await this.fetchWithAuth(`${API_BASE}/auth/logout`, { method: "POST" });
  }

  async getMe(): Promise<User> {
    return this.request<User>("/auth/me");
  }

  async getUsers(): Promise<User[]> {
    return this.request<User[]>("/auth/users");
  }

  async getAssignableUsers(role: "Sales" | "Coordinator" | "Manager", teamName?: string): Promise<User[]> {
    const qs = teamName ? `?role=${role}&team_name=${encodeURIComponent(teamName)}` : `?role=${role}`;
    return this.request<User[]>(`/auth/users/assignable${qs}`);
  }

  async getHierarchy(): Promise<UserHierarchyNode[]> {
    return this.request<UserHierarchyNode[]>("/auth/hierarchy");
  }

  async createUser(payload: CreateUserPayload): Promise<User> {
    return this.request<User>("/auth/users", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async adminCreateUser(payload: AdminUserCreatePayload): Promise<AdminUserCreateResponse> {
    return this.request<AdminUserCreateResponse>("/auth/users/admin-create", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateUser(id: string, payload: UpdateUserPayload): Promise<User> {
    return this.request<User>(`/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteUser(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/auth/users/${id}`, {
      method: "DELETE",
    });
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  }

  async adminChangeUserPassword(userId: string, newPassword: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/auth/users/${userId}/change-password`, {
      method: "POST",
      body: JSON.stringify({ new_password: newPassword }),
    });
  }


  async getCoordinators(): Promise<User[]> {
    return this.request<User[]>("/auth/users/coordinators");
  }

  async assignCoordinator(payload: CoordinatorMappingPayload): Promise<CoordinatorMappingResponse> {
    return this.request<CoordinatorMappingResponse>("/auth/users/coordinator-mapping", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async listCoordinatorMappings(): Promise<CoordinatorMappingRecord[]> {
    return this.request<CoordinatorMappingRecord[]>("/auth/coordinator-mappings");
  }

  async deleteCoordinatorMapping(mappingId: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/auth/coordinator-mappings/${mappingId}`, {
      method: "DELETE",
    });
  }

  async getMyReports(): Promise<User[]> {
    return this.request<User[]>("/auth/my-reports");
  }

  // Roles APIs
  async getRoles(isActive?: boolean): Promise<Role[]> {
    const query = isActive !== undefined ? `?is_active=${isActive}` : "";
    return this.request<Role[]>(`/roles${query}`);
  }

  async createRole(payload: CreateRolePayload): Promise<Role> {
    return this.request<Role>("/roles", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async deleteRole(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/roles/${id}`, {
      method: "DELETE",
    });
  }

  // Teams APIs
  async getTeams(department?: string, isActive?: boolean): Promise<Team[]> {
    const query = new URLSearchParams();
    if (department) query.append("department", department);
    if (isActive !== undefined) query.append("is_active", String(isActive));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request<Team[]>(`/teams${qs}`);
  }

  async createTeam(payload: CreateTeamPayload): Promise<Team> {
    return this.request<Team>("/teams", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateTeam(id: string, payload: Partial<CreateTeamPayload>): Promise<Team> {
    return this.request<Team>(`/teams/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteTeam(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/teams/${id}`, {
      method: "DELETE",
    });
  }

  // Batches APIs
  async getBatches(params?: {
    status?: string;
    domain?: string;
    category?: string;
    client_name?: string;
    search?: string;
    mine?: boolean;
  }): Promise<Batch[]> {
    const query = new URLSearchParams();
    if (params?.status && params.status !== "ALL") query.append("status", params.status);
    if (params?.domain && params.domain !== "ALL") query.append("domain", params.domain);
    if (params?.category && params.category !== "ALL") query.append("category", params.category);
    if (params?.client_name) query.append("client_name", params.client_name);
    if (params?.search) query.append("search", params.search);
    // Ownership is resolved server-side from the bearer token, so this is a
    // boolean scope switch rather than a user id the caller could tamper with.
    if (params?.mine) query.append("mine", "true");

    const queryString = query.toString();
    const endpoint = queryString ? `/batches?${queryString}` : "/batches";
    return this.request<Batch[]>(endpoint);
  }

  async getBatch(id: string): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}`);
  }

  async getBatchEditHistory(id: string): Promise<BatchEditHistoryEntry[]> {
    return this.request<BatchEditHistoryEntry[]>(`/batches/${id}/edit-history`);
  }

  async getActiveBatches(params?: { 
    filterDate?: string; 
    skip?: number; 
    limit?: number; 
    sessionSkip?: number;
    sessionLimit?: number;
  }): Promise<ActiveBatchesResponse> {
    const query = new URLSearchParams();
    if (params?.filterDate) query.append("filter_date", params.filterDate);
    if (params?.skip) query.append("skip", String(params.skip));
    if (params?.limit) query.append("limit", String(params.limit));
    if (params?.sessionSkip !== undefined) query.append("sessionSkip", String(params.sessionSkip));
    if (params?.sessionLimit !== undefined) query.append("sessionLimit", String(params.sessionLimit));
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request<ActiveBatchesResponse>(`/batches/active${qs}`);
  }

  async createBatch(payload: CreateBatchPayload): Promise<Batch> {
    return this.request<Batch>("/batches", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateBatch(id: string, updates: Partial<Batch>): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
  }

  async updateBatchLifecycleStatus(id: string, status: string, reason: string): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}/lifecycle-status`, {
      method: "POST",
      body: JSON.stringify({ status, reason }),
    });
  }

  async submitBatch(id: string): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}/submit`, { method: "POST" });
  }

  async decideBatch(id: string, level: 1 | 2, decision: "approve" | "reject", reason?: string): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}/approve-level-${level}`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    });
  }

  async approveBatch(id: string, approvalId: string): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approval_id: approvalId }),
    });
  }

  async closeBatchGate2(id: string, payload: BatchNpsClosurePayload): Promise<Batch> {
    return this.request<Batch>(`/batches/${id}/close`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async deleteBatch(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/batches/${id}`, {
      method: "DELETE",
    });
  }

  // Batch Options & Taxonomy APIs
  async getBatchOptions(type: "categories" | "delivery-modes" | "accommodations" | "entities" | string): Promise<BatchOption[]> {
    return this.request<BatchOption[]>(`/batch-options/${type}`);
  }

  async createBatchOption(type: string, payload: CreateBatchOptionPayload): Promise<BatchOption> {
    return this.request<BatchOption>(`/batch-options/${type}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateBatchOption(type: string, id: string, payload: CreateBatchOptionPayload): Promise<BatchOption> {
    return this.request<BatchOption>(`/batch-options/${type}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteBatchOption(type: string, id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/batch-options/${type}/${id}`, {
      method: "DELETE",
    });
  }

  // Faculty Types APIs
  async getFacultyTypes(): Promise<FacultyType[]> {
    return this.request<FacultyType[]>("/batch-options/faculty-types");
  }

  async createFacultyType(payload: CreateBatchOptionPayload): Promise<FacultyType> {
    return this.request<FacultyType>("/batch-options/faculty-types", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateFacultyType(id: string, payload: CreateBatchOptionPayload): Promise<FacultyType> {
    return this.request<FacultyType>(`/batch-options/faculty-types/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteFacultyType(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/batch-options/faculty-types/${id}`, {
      method: "DELETE",
    });
  }

  // Verticals APIs
  async getVerticals(): Promise<Vertical[]> {
    return this.request<Vertical[]>("/batch-options/verticals");
  }

  async createVertical(payload: CreateBatchOptionPayload): Promise<Vertical> {
    return this.request<Vertical>("/batch-options/verticals", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateVertical(id: string, payload: CreateBatchOptionPayload): Promise<Vertical> {
    return this.request<Vertical>(`/batch-options/verticals/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteVertical(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/batch-options/verticals/${id}`, {
      method: "DELETE",
    });
  }

  // Program Types APIs
  async getProgramTypes(): Promise<ProgramType[]> {
    return this.request<ProgramType[]>("/batch-options/program-types");
  }

  async createProgramType(payload: CreateBatchOptionPayload): Promise<ProgramType> {
    return this.request<ProgramType>("/batch-options/program-types", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateProgramType(id: string, payload: CreateBatchOptionPayload): Promise<ProgramType> {
    return this.request<ProgramType>(`/batch-options/program-types/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteProgramType(id: string): Promise<{ detail: string }> {
    return this.request<{ detail: string }>(`/batch-options/program-types/${id}`, {
      method: "DELETE",
    });
  }

  async getApprovalConfiguration(): Promise<ApprovalConfiguration> {
    return this.request<ApprovalConfiguration>("/batches/approval-config");
  }

  async updateApprovalConfiguration(payload: { approver_1_id?: string; approver_2_id?: string }): Promise<ApprovalConfiguration> {
    return this.request<ApprovalConfiguration>("/batches/approval-config", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  // Sessions APIs
  async getSessions(params?: { batch_id?: string; faculty_name?: string; status?: string; all?: boolean }): Promise<TrainingSession[]> {
    const query = new URLSearchParams();
    if (params?.batch_id) query.append("batch_id", params.batch_id);
    if (params?.faculty_name) query.append("faculty_name", params.faculty_name);
    if (params?.status) query.append("status", params.status);
    if (params?.all) query.append("all", "true");
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return this.request<TrainingSession[]>(`/sessions${suffix}`);
  }

  async getScheduledSessions(batchId: string): Promise<ScheduledSession[]> {
    return this.request<ScheduledSession[]>(`/sessions/scheduled?batch_id=${batchId}`);
  }

  async updateScheduledSession(id: string, payload: Partial<ScheduledSession>): Promise<ScheduledSession> {
    return this.request<ScheduledSession>(`/sessions/scheduled/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async deleteScheduledSession(id: string): Promise<void> {
    return this.request<void>(`/sessions/scheduled/${id}`, {
      method: "DELETE",
    });
  }

  async createScheduledSession(payload: {
    batch_id: string;
    session_date: string;
    start_time?: string;
    end_time?: string;
    duration_hours: number;
    module: string;
    trainer_name?: string;
    status?: string;
  }): Promise<ScheduledSession> {
    return this.request<ScheduledSession>("/sessions/scheduled", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async createSession(payload: CreateSessionPayload): Promise<TrainingSession> {
    return this.request<TrainingSession>("/sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async updateSession(id: string, payload: Partial<CreateSessionPayload>): Promise<TrainingSession> {
    return this.request<TrainingSession>(`/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  async cancelSession(id: string, reason: string): Promise<TrainingSession> {
    return this.request<TrainingSession>(`/sessions/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async markSessionNotConducted(id: string, reason: string): Promise<TrainingSession> {
    return this.request<TrainingSession>(`/sessions/${id}/not-conducted`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  async rescheduleSession(
    id: string,
    payload: { date_of_training: string; start_time?: string; end_time?: string; reason: string },
  ): Promise<TrainingSession> {
    return this.request<TrainingSession>(`/sessions/${id}/reschedule`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async completeSessionGate1(sessionId: string, payload: SessionFeedbackPayload): Promise<Gate1CompleteResponse> {
    return this.request<Gate1CompleteResponse>(`/sessions/${sessionId}/complete`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  // Schedules Ingestion APIs
  async ingestScheduleFile(file: File, targetBatchId?: string): Promise<ScheduleIngestResponse> {
    const formData = new FormData();
    formData.append("file", file);
    if (targetBatchId) {
      formData.append("target_batch_id", targetBatchId);
    }

    const response = await this.fetchWithAuth(`${API_BASE}/schedules/ingest`, {
      method: "POST",
      body: formData,
    });

    return response.json();
  }

  async validateScheduleSlots(items: ExtractedScheduleRow[], targetBatchId: string): Promise<{ conflicts: ConflictDetail[] }> {
    return this.request<{ conflicts: ConflictDetail[] }>("/schedules/validate", {
      method: "POST",
      body: JSON.stringify({
        target_batch_id: targetBatchId,
        items,
      }),
    });
  }

  async applySchedule(items: ExtractedScheduleRow[], targetBatchId: string, sourceFilename?: string): Promise<ScheduleApplyResponse> {
    return this.request<ScheduleApplyResponse>("/schedules/apply", {
      method: "POST",
      body: JSON.stringify({
        target_batch_id: targetBatchId,
        source_filename: sourceFilename,
        items,
      }),
    });
  }

  // Analytics & MBR APIs
  async getManagerDashboard(): Promise<ManagerDashboardSummary> {
    return this.request<ManagerDashboardSummary>("/analytics/manager-dashboard");
  }

  async exportMbrReport(): Promise<void> {
    await this.downloadFile(
      "/analytics/mbr-export",
      `MBR_Report_Export_${new Date().toISOString().split("T")[0]}.xlsx`
    );
  }

  // Faculty APIs
  async getFacultyList(params?: { faculty_type?: string; domain?: string }): Promise<FacultyMember[]> {
    const query = new URLSearchParams();
    if (params?.faculty_type) query.append("faculty_type", params.faculty_type);
    if (params?.domain) query.append("domain", params.domain);
    const qs = query.toString() ? `?${query.toString()}` : "";
    return this.request<FacultyMember[]>(`/faculty${qs}`);
  }

  async getFacultyUtilization(): Promise<FacultyUtilizationSummary> {
    return this.request<FacultyUtilizationSummary>("/faculty/utilization");
  }

  async exportFacultyUtilization(params?: { faculty_type?: string; start_date?: string; end_date?: string }): Promise<void> {
    const query = new URLSearchParams();
    if (params?.faculty_type) query.append("faculty_type", params.faculty_type);
    if (params?.start_date) query.append("start_date", params.start_date);
    if (params?.end_date) query.append("end_date", params.end_date);
    const qs = query.toString() ? `?${query.toString()}` : "";
    await this.downloadFile(`/faculty/utilization/export${qs}`, `faculty-utilization-${new Date().toISOString().split("T")[0]}.csv`);
  }

  // Finance Export
  async exportFinance(params?: { status_filter?: string; finance_status?: string; domain?: string; delivery_mode?: string; start_date?: string; end_date?: string }): Promise<void> {
    const query = new URLSearchParams();
    if (params?.status_filter) query.append("status_filter", params.status_filter);
    if (params?.finance_status) query.append("finance_status", params.finance_status);
    if (params?.domain) query.append("domain", params.domain);
    if (params?.delivery_mode) query.append("delivery_mode", params.delivery_mode);
    if (params?.start_date) query.append("start_date", params.start_date);
    if (params?.end_date) query.append("end_date", params.end_date);
    const qs = query.toString() ? `?${query.toString()}` : "";
    await this.downloadFile(`/batches/finance/export${qs}`, `finance-review-${new Date().toISOString().split("T")[0]}.csv`);
  }

  // Analytics Export
  async exportAnalytics(params?: { start_date?: string; end_date?: string; domain?: string }): Promise<void> {
    const query = new URLSearchParams();
    if (params?.start_date) query.append("start_date", params.start_date);
    if (params?.end_date) query.append("end_date", params.end_date);
    if (params?.domain) query.append("domain", params.domain);
    const qs = query.toString() ? `?${query.toString()}` : "";
    await this.downloadFile(`/analytics/export${qs}`, `analytics-export-${new Date().toISOString().split("T")[0]}.xlsx`);
  }

  private async downloadFile(endpoint: string, filename: string): Promise<void> {
    const res = await this.fetchWithAuth(`${API_BASE}${endpoint}`);

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }

  // FMS Sync APIs
  async syncFacultyFms(facultyId: string, eventType: string = "HOURS_UPDATE"): Promise<FmsSyncResponse> {
    const query = new URLSearchParams({
      faculty_id: facultyId,
      event_type: eventType,
    });
    return this.request<FmsSyncResponse>(`/integrations/fms/sync?${query.toString()}`, {
      method: "POST",
    });
  }

  async getFmsLogs(skip: number = 0, limit: number = 50): Promise<FmsSyncLog[]> {
    return this.request<FmsSyncLog[]>(`/integrations/fms/logs?skip=${skip}&limit=${limit}`);
  }

  async getAuditLogs(skip: number = 0, limit: number = 100): Promise<AuditLog[]> {
    return this.request<AuditLog[]>(`/auth/audit-logs?skip=${skip}&limit=${limit}`);
  }

  // Auth password reset
  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    return this.request<ForgotPasswordResponse>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<ResetPasswordResponse> {
    return this.request<ResetPasswordResponse>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, new_password: newPassword }),
    });
  }
}

export const api = new ApiService();
export { formatDate, formatDateTime } from "./dateUtils";
