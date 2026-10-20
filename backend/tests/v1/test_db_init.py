from sqlalchemy import Enum, String

from app.db.init_db import _is_legacy_string_column, _seed_base_data
from app.models.batch import (
    Accommodation,
    ApprovalConfiguration,
    BatchCategory,
    BatchStatus,
    DeliveryMode,
    Entity,
    FacultyType,
    ProgramType,
    Vertical,
)
from app.models.user import Role, Team, User


def test_batch_enum_is_not_treated_as_legacy_varchar():
    assert not _is_legacy_string_column(Enum(BatchStatus, name="batchstatus"))


def test_varchar_status_is_treated_as_legacy_string():
    assert _is_legacy_string_column(String(50))


def test_base_data_seeds_reference_data_idempotently_without_users(db_session):
    user_count = db_session.query(User).count()

    _seed_base_data(db_session)
    db_session.commit()
    _seed_base_data(db_session)
    db_session.commit()

    assert db_session.query(User).count() == user_count
    assert {role.name for role in db_session.query(Role).all()} == {
        "Admin", "Manager", "Coordinator", "Sales", "Faculty"
    }
    assert {team.name for team in db_session.query(Team).all()} >= {
        "Delivery", "Sales", "Finance"
    }
    assert db_session.query(BatchCategory).count() == 4
    assert db_session.query(DeliveryMode).count() == 3
    assert db_session.query(Accommodation).count() == 2
    assert db_session.query(Entity).count() == 2
    assert db_session.query(Vertical).count() == 6
    assert db_session.query(ProgramType).count() == 3
    assert db_session.query(FacultyType).count() == 3
    assert db_session.query(ApprovalConfiguration).count() == 1
