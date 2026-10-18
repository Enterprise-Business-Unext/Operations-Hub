from typing import List, Dict, Any, Optional
from decimal import Decimal
from pydantic import BaseModel


class MetricCard(BaseModel):
    title: str
    value: Any
    subtitle: Optional[str] = None
    trend_percentage: Optional[Decimal] = None


class VerticalBreakdown(BaseModel):
    vertical: str
    active_batches: int
    total_hours: Decimal
    average_feedback: Decimal


class ManagerDashboardSummary(BaseModel):
    total_active_batches: int
    total_ongoing_sessions: int
    total_hours_delivered: Decimal
    overall_avg_nps: Optional[Decimal] = None
    overall_avg_feedback: Optional[Decimal] = None
    faculty_utilization_ratio: Decimal  # Internal vs External
    pending_gate1_feedbacks: int
    pending_gate2_closures: int
    schedule_not_updated_count: int
    vertical_distribution: List[VerticalBreakdown] = []
