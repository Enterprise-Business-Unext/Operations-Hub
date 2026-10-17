import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.email import EmailService


def production_settings(**overrides):
    values = {
        "ENVIRONMENT": "production",
        "DATABASE_URL": "",
        "SECRET_KEY": "generated-production-signing-key-with-entropy",
        "POSTGRES_SERVER": "db.example.com",
        "POSTGRES_USER": "ops",
        "POSTGRES_PASSWORD": "p@ss:/%#word-with-strong-length",
        "POSTGRES_DB": "ops",
        "BACKEND_CORS_ORIGINS": [],
        "REDIS_PASSWORD": "redis-secret-with-more-entropy",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_USER": "mailer",
        "SMTP_PASSWORD": "smtp-secret",
        "SMTP_TLS": True,
        "EMAIL_FROM": "ops@example.com",
        "FRONTEND_URL": "https://ops.example.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_database_url_encodes_postgres_password():
    settings = production_settings()

    database_url = make_url(settings.DATABASE_URL)
    assert database_url.password == "p@ss:/%#word-with-strong-length"
    assert "%40" in settings.DATABASE_URL


@pytest.mark.parametrize(
    ("override", "value"),
    [
        ("SECRET_KEY", "your-secret-key-here-min-32-chars"),
        ("DEBUG", True),
        ("FRONTEND_URL", "http://ops.example.com"),
        ("FRONTEND_URL", "https://localhost"),
        ("POSTGRES_PASSWORD", "postgres"),
        ("REDIS_PASSWORD", ""),
        ("REDIS_PASSWORD", "short"),
        ("SMTP_TLS", False),
        ("BACKEND_CORS_ORIGINS", ["*"]),
        ("BACKEND_CORS_ORIGINS", ["http://ops.example.com"]),
        ("BACKEND_CORS_ORIGINS", ["https://localhost"]),
    ],
)
def test_rejects_insecure_production_configuration(override, value):
    with pytest.raises(ValidationError):
        production_settings(**{override: value})


@pytest.mark.asyncio
async def test_unconfigured_welcome_email_does_not_log_credentials(caplog):
    service = EmailService()
    service.smtp_host = ""
    service.smtp_user = ""
    service.smtp_password = ""
    temporary_password = "one-time-secret-password"
    recipient = "private.user@example.com"

    await service.send_welcome_email(
        recipient,
        "Private User",
        temporary_password,
    )

    assert temporary_password not in caplog.text
    assert recipient not in caplog.text
