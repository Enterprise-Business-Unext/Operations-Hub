from typing import List, Union, Optional
from ipaddress import ip_address
from urllib.parse import urlsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


def _is_local_host(host: str) -> bool:
    normalized_host = host.lower().rstrip(".")
    if normalized_host == "localhost" or normalized_host.endswith(".localhost"):
        return True
    try:
        return ip_address(normalized_host).is_loopback
    except ValueError:
        return False


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    PROJECT_NAME: str = "3-Workflow Operations & Faculty Governance Platform"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    # Security - MUST be set via environment variables in production
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Database connection settings
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    DATABASE_URL: str = ""
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    BACKEND_CORS_ORIGINS: List[str] = []

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, str):
            import json
            return json.loads(v)
        return v

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if not self.DATABASE_URL:
            self.DATABASE_URL = URL.create(
                "postgresql+psycopg2",
                username=self.POSTGRES_USER,
                password=self.POSTGRES_PASSWORD,
                host=self.POSTGRES_SERVER,
                port=self.POSTGRES_PORT,
                database=self.POSTGRES_DB,
            ).render_as_string(hide_password=False)

        database_url = self.DATABASE_URL
        if self.ENVIRONMENT == "production":
            if len(self.SECRET_KEY) < 32 or self.SECRET_KEY in {
                "your-secret-key-here-min-32-chars",
                "dev_secret_key_super_secure_enterprise_jwt_2026",
            }:
                raise ValueError("SECRET_KEY must be at least 32 characters in production")

            if self.DEBUG:
                raise ValueError("DEBUG must be disabled in production")

            for origin in self.BACKEND_CORS_ORIGINS:
                parsed_origin = urlsplit(origin)
                if (
                    origin in {"*", "null"}
                    or parsed_origin.scheme != "https"
                    or not parsed_origin.hostname
                    or _is_local_host(parsed_origin.hostname)
                    or parsed_origin.path not in {"", "/"}
                    or parsed_origin.query
                    or parsed_origin.fragment
                    or parsed_origin.username
                    or parsed_origin.password
                ):
                    raise ValueError(
                        f"CORS origin '{origin}' must be an HTTPS origin without a path"
                    )

            if "sqlite" in database_url.lower():
                raise ValueError("SQLite DATABASE_URL not allowed in production")

            if len(self.POSTGRES_PASSWORD) < 16:
                raise ValueError("POSTGRES_PASSWORD must be at least 16 characters in production")

            frontend_url = urlsplit(self.FRONTEND_URL)
            if (
                frontend_url.scheme != "https"
                or not frontend_url.hostname
                or _is_local_host(frontend_url.hostname)
            ):
                raise ValueError("FRONTEND_URL must be an HTTPS URL in production")

            if not self.REDIS_PASSWORD or len(self.REDIS_PASSWORD) < 16:
                raise ValueError(
                    "REDIS_PASSWORD must be at least 16 characters in production"
                )

            if not all((
                self.GRAPH_TENANT_ID,
                self.GRAPH_CLIENT_ID,
                self.GRAPH_CLIENT_SECRET,
                self.GRAPH_SENDER_EMAIL,
            )):
                raise ValueError(
                    "Production email requires GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, and GRAPH_SENDER_EMAIL"
                )

        return self

    # Optional FMS Integration - MUST be set via environment variables if used
    FMS_API_BASE_URL: str = ""

    # Redis for rate limiting and caching
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: Optional[str] = None
    REDIS_DB: int = 0
    REDIS_URL: Optional[str] = None

    # Rate limiting
    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60
    RATE_LIMIT_ENABLED: bool = True

    # Forgot password rate limiting
    FORGOT_PASSWORD_RATE_LIMIT: str = "5/minute"
    FORGOT_PASSWORD_RATE_LIMIT_REQUESTS: int = 5
    FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS: int = 300

    # Account lockout
    MAX_FAILED_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_DURATION_MINUTES: int = 15

    # Password policy
    MIN_PASSWORD_LENGTH: int = 12
    REQUIRE_UPPERCASE: bool = True
    REQUIRE_LOWERCASE: bool = True
    REQUIRE_NUMBERS: bool = True
    REQUIRE_SPECIAL_CHARS: bool = True

    # Password reset token settings
    RESET_TOKEN_TTL_HOURS: int = 1
    RESET_TOKEN_TTL_SECONDS: int = 3600

    # Microsoft Graph app-only email settings
    GRAPH_TENANT_ID: str = ""
    GRAPH_CLIENT_ID: str = ""
    GRAPH_CLIENT_SECRET: str = ""
    GRAPH_SENDER_EMAIL: str = ""
    EMAIL_FROM_NAME: str = "Enterprise Ops Platform"
    FRONTEND_URL: str = "http://localhost:3000"


settings = Settings()
