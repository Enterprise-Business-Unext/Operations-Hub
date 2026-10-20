import os

# Provide a deterministic SQLite-backed test environment before any app
# module is imported. This allows `python -m pytest -q` to succeed from a
# clean checkout without manually exporting secrets or database credentials.
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SECRET_KEY", "test-secret-key-min-32-chars-for-pytest-only")
os.environ.setdefault("POSTGRES_SERVER", "localhost")
os.environ.setdefault("POSTGRES_PORT", "5432")
os.environ.setdefault("POSTGRES_USER", "postgres")
os.environ.setdefault("POSTGRES_PASSWORD", "postgres")
os.environ.setdefault("POSTGRES_DB", "ops_db")
# Use a throwaway file-based SQLite URL so pydantic_settings is satisfied
# during import. The test client fixture in tests/v1/conftest.py overrides
# get_db() with an in-memory SQLite engine, so nothing is persisted.
os.environ.setdefault("DATABASE_URL", "sqlite:///./ops_test.db")
os.environ.setdefault("BACKEND_CORS_ORIGINS", '["http://localhost:3000"]')
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("REDIS_HOST", "localhost")
os.environ.setdefault("REDIS_PORT", "6379")
os.environ.setdefault("REDIS_DB", "0")
os.environ.setdefault("EMAIL_FROM_NAME", "Test")
os.environ.setdefault("FRONTEND_URL", "http://localhost:3000")
