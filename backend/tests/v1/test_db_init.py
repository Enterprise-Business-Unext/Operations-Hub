from sqlalchemy import Enum, String

from app.db.init_db import _is_legacy_string_column
from app.models.batch import BatchStatus


def test_batch_enum_is_not_treated_as_legacy_varchar():
    assert not _is_legacy_string_column(Enum(BatchStatus, name="batchstatus"))


def test_varchar_status_is_treated_as_legacy_string():
    assert _is_legacy_string_column(String(50))
