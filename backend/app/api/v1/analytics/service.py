import io
import json
from datetime import datetime, timezone, date
from decimal import Decimal
from typing import Optional

import pandas as pd
from fastapi.responses import StreamingResponse

from app.core.cache import RedisCacheService
from app.models.batch import Batch
from app.models.user import User
from app.schemas.analytics import ManagerDashboardSummary, VerticalBreakdown
from app.api.v1.analytics.repository_interfaces import IAnalyticsRepository
from app.api.v1.auth.repository_interfaces import IUserRepository


_ACTIVE_STATUSES = ["Upcoming", "Ongoing"]


class AnalyticsService:
    def __init__(self, analytics_repo: IAnalyticsRepository, user_repo: IUserRepository, cache: Optional[RedisCacheService] = None):
        self.analytics_repo = analytics_repo
        self.user_repo = user_repo
        self.cache = cache or RedisCacheService()

    @staticmethod
    def _average(values) -> Optional[Decimal]:
        if not values:
            return None
        valid_decimals = []
        for v in values:
            val = v[0]
            if val is not None:
                try:
                    valid_decimals.append(Decimal(str(val)))
                except (ValueError, TypeError):
                    pass
        if not valid_decimals:
            return None
        return sum(valid_decimals) / Decimal(len(valid_decimals))

    def _get_scoped_batch_ids(self, current_user: Optional[User]) -> Optional[list]:
        """Batch IDs scoped to the manager hierarchy, or None for admin/unrestricted."""
        if not current_user or (current_user.role or "").lower() == "admin":
            return None

        scope_user_ids = {current_user.id}
        scope_user_ids.update(self.user_repo.get_managed_coordinator_ids(current_user.id))

        scoped_ids = self.analytics_repo.list_scoped_batch_ids(list(scope_user_ids), current_user.id)
        if not scoped_ids:
            return []
        return scoped_ids

    def manager_dashboard(self, current_user: Optional[User] = None) -> ManagerDashboardSummary:
        user_id = str(current_user.id) if current_user else "global"
        cache_key = f"analytics:dashboard:{user_id}"
        cached = self.cache.get("v1", cache_key)
        if cached:
            return ManagerDashboardSummary.model_validate_json(cached)

        scoped_ids = self._get_scoped_batch_ids(current_user)

        total_active = self.analytics_repo.count_batches(scoped_ids, _ACTIVE_STATUSES)
        avg_nps = self._average(self.analytics_repo.list_column_values(scoped_ids, Batch.batch_nps))
        avg_feedback = self._average(self.analytics_repo.list_column_values(scoped_ids, Batch.batch_avg_feedback))
        pending_gate2 = self.analytics_repo.count_pending_gate2(scoped_ids, _ACTIVE_STATUSES)

        # Real ongoing sessions
        total_ongoing_sessions = self.analytics_repo.count_ongoing_sessions(scoped_ids, date.today())

        # Total hours delivered from completed sessions
        delivered_hours_sum = self.analytics_repo.sum_delivered_hours(scoped_ids)
        if delivered_hours_sum is not None:
            total_hours_delivered = delivered_hours_sum
        else:
            # Fallback: sum total_hours from Completed batches
            total_hours_delivered = self.analytics_repo.sum_batch_hours(scoped_ids, status_filter="Completed")

        # Pending Gate 1 Feedbacks (sessions completed or past date without rating)
        pending_gate1 = self.analytics_repo.count_pending_gate1(scoped_ids, datetime.now(timezone.utc))

        # Faculty utilization ratio: deployed faculty / total faculty count within the manager's hierarchy scope
        if scoped_ids is not None:
            scope_user_ids = [current_user.id]
            scope_user_ids.extend(self.user_repo.get_managed_coordinator_ids(current_user.id))
            total_fac_count = self.analytics_repo.count_active_faculty(scope_user_ids)
        else:
            total_fac_count = self.analytics_repo.count_active_faculty()

        deployed_fac_count = self.analytics_repo.count_distinct_deployed_faculty(scoped_ids)

        if total_fac_count > 0:
            util_ratio = Decimal(str(round((min(deployed_fac_count, total_fac_count) / total_fac_count) * 100, 1)))
        else:
            util_ratio = Decimal("0.0")

        # Dynamic vertical breakdown from distinct domains in DB
        domain_names = self.analytics_repo.list_distinct_domains(scoped_ids)
        if not domain_names:
            domain_names = ["IT/ITES", "Cloud", "DS/ML", "BFSI"]

        verticals = [
            VerticalBreakdown(
                vertical=domain,
                active_batches=aggregate.active_batches,
                total_hours=aggregate.total_hours,
                average_feedback=aggregate.average_feedback,
            )
            for domain, aggregate in self.analytics_repo.aggregate_by_domain(
                scoped_ids, domain_names, _ACTIVE_STATUSES
            )
        ]

        # Sort verticals by active batches descending
        verticals.sort(key=lambda x: x.active_batches, reverse=True)

        dashboard = ManagerDashboardSummary(
            total_active_batches=total_active,
            total_ongoing_sessions=total_ongoing_sessions,
            total_hours_delivered=total_hours_delivered,
            overall_avg_nps=avg_nps,
            overall_avg_feedback=avg_feedback,
            faculty_utilization_ratio=util_ratio,
            pending_gate1_feedbacks=pending_gate1,
            pending_gate2_closures=pending_gate2,
            vertical_distribution=verticals,
        )

        user_id = str(current_user.id) if current_user else "global"
        cache_key = f"analytics:dashboard:{user_id}"
        self.cache.set("v1", cache_key, dashboard.model_dump_json(), ttl=60)
        return dashboard

    def export_mbr(self, current_user: Optional[User] = None) -> StreamingResponse:
        scoped_ids = self._get_scoped_batch_ids(current_user)
        if scoped_ids is None:
            batches = self.analytics_repo.list_all_batches()
        elif len(scoped_ids) == 0:
            batches = []
        else:
            batches = self.analytics_repo.list_batches_by_ids(scoped_ids)
        data = [{
            "Batch ID": batch.batch_id,
            "Approval ID": batch.approval_id,
            "Client": batch.client_name or "N/A",
            "Category": batch.category,
            "Program Name": batch.program_name,
            "Technology": batch.technology,
            "Delivery Mode": batch.delivery_mode_detail.name if batch.delivery_mode_detail else None,
            "Location / City": batch.location_city,
            "Status": batch.status,
            "Total Enrollments": batch.total_enrollments,
            "Training Days": batch.training_days,
            "Batch NPS": float(batch.batch_nps) if batch.batch_nps else None,
            "Batch Avg Feedback": float(batch.batch_avg_feedback) if batch.batch_avg_feedback else None,
            "Schema Locked": "Yes" if batch.is_schema_locked else "No",
        } for batch in batches]
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            pd.DataFrame(data).to_excel(writer, index=False, sheet_name="Active Batches")
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=MBR_Report_Export.xlsx"},
        )