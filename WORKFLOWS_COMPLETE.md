## 13. API Endpoint Reference (Key Endpoints)

| Domain | Method | Endpoint | Auth | Key Notes |
|---|---|---|---|---|
| **Auth** | POST | `/api/v1/auth/login` | None | Login, account lockout, token generation |
| **Auth** | POST | `/api/v1/auth/refresh` | None | Refresh token rotation |
| **Auth** | GET | `/api/v1/auth/me` | Any | Current user profile |
| **Auth** | POST | `/api/v1/auth/change-password` | Any | Self password change with policy |
| **Batches** | GET | `/api/v1/batches` | Any | Scoped by RBAC; `mine=true` for owned |
| **Batches** | POST | `/api/v1/batches` | Coordinator+ | NOT Admin, Delivery team only |
| **Batches** | PATCH | `/api/v1/batches/{id}` | Coordinator+ | Operational scope, may trigger reapproval |
| **Batches** | POST | `/api/v1/batches/{id}/submit` | Coordinator+ | Submit for approval |
| **Batches** | POST | `/api/v1/batches/{id}/approve-level-1` | Approver 1 | Level 1 approval |
| **Batches** | POST | `/api/v1/batches/{id}/approve-level-2` | Approver 2 | Level 2 approval |
| **Batches** | POST | `/api/v1/batches/{id}/approve` | Manager/Admin | Direct manager approval |
| **Batches** | POST | `/api/v1/batches/{id}/lifecycle-status` | Coordinator+ | Status transitions with validation |
| **Batches** | POST | `/api/v1/batches/{id}/close` | Coordinator+ | Gate 2 - NPS closure |
| **Batches** | POST | `/api/v1/batches/{id}/sync-status` | Admin | Manual lifecycle sync |
| **Sessions** | GET | `/api/v1/sessions` | Any | Scoped by RBAC; `all=true` needs Manager/Admin |
| **Sessions** | POST | `/api/v1/sessions` | Coordinator+ | Log utilization (delivery) |
| **Sessions** | POST | `/api/v1/sessions/scheduled` | Coordinator+ | Create timetable entry |
| **Sessions** | PATCH | `/api/v1/sessions/{id}` | Coordinator+ | Update session (not if Completed) |
| **Sessions** | POST | `/api/v1/sessions/{id}/cancel` | Coordinator+ | Cancel with outcome reason |
| **Sessions** | POST | `/api/v1/sessions/{id}/not-conducted` | Coordinator+ | Mark not conducted |
| **Sessions** | POST | `/api/v1/sessions/{id}/reschedule` | Coordinator+ | Reschedule session |
| **Sessions** | PATCH | `/api/v1/sessions/{id}/complete` | Coordinator+ | Gate 1 - session feedback |
| **Sessions** | GET | `/api/v1/sessions/scheduled` | Any | List curriculum/timetable for batch |
| **Schedules** | POST | `/api/v1/schedules/ingest` | Coordinator+ | Preview only (no persistence) |
| **Schedules** | POST | `/api/v1/schedules/apply` | Coordinator+ | Apply & persist atomically |
| **Faculty** | GET | `/api/v1/faculty/utilization` | Coordinator+ | Utilization overview & metrics |
| **Analytics** | GET | `/api/v1/analytics/manager-dashboard` | Manager/Admin | Manager dashboard |
| **Analytics** | GET | `/api/v1/analytics/mbr-export` | Manager/Admin | MBR export |
| **Integrations** | POST | `/api/v1/integrations/fms/sync` | Admin | FMS sync (mock) |

---

**Legend:** Coordinator+ = Coordinator, Manager, or Admin | Any = Authenticated user | None = Public

---

*Generated from complete workflow analysis of the codebase. All Mermaid diagrams are PR-ready and render correctly in Mermaid-compatible viewers.*