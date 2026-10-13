from decimal import Decimal
from typing import List, Optional, Tuple
from abc import ABC, abstractmethod

from app.models.session import FacultyUtilization
from app.models.user import User


class IFacultyRepository(ABC):
    """Data-access contract for the faculty roster and utilisation reporting."""

    @abstractmethod
    def list_active_faculty(self) -> List[User]:
        pass

    @abstractmethod
    def get_distinct_deployed_faculty_names(self) -> List[str]:
        """Distinct trainer names appearing on any non-cancelled delivery."""
        pass

    @abstractmethod
    def list_non_cancelled_deliveries(self) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def list_non_cancelled_deliveries_for_domain(self, domain: str) -> List[FacultyUtilization]:
        pass

    @abstractmethod
    def list_utilization_for_export(
        self,
        faculty_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        user_id: Optional[str] = None,
        all: bool = False,
    ) -> List[FacultyUtilization]:
        """Delivery ledger rows for the utilization CSV export, newest first.

        ``faculty_type`` is matched through faculty_type_id because the ledger has
        no denormalized faculty-type column.
        """
        pass