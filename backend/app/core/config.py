from typing import List, Union, Optional
from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import re


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

    # Database - MUST be set via environment variables
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str
    DATABASE_URL: str
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # CORS - Restricted to specific origins, no wildcards
    # Defaults for development; override via env var BACKEND_CORS_ORIGINS in production
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "null",
    ]

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
        if self.ENVIRONMENT == "production":
            # Validate SECRET_KEY strength
            if len(self.SECRET_KEY) < 32:
                raise ValueError("SECRET_KEY must be at least 32 characters in production")
            
            # Validate CORS origins - no localhost in production
            for origin in self.BACKEND_CORS_ORIGINS:
                if "localhost" in origin or "127.0.0.1" in origin:
                    raise ValueError(f"CORS origin '{origin}' contains localhost - not allowed in production")
            
            # Validate DATABASE_URL is not SQLite
            if "sqlite" in self.DATABASE_URL.lower():
                raise ValueError("SQLite DATABASE_URL not allowed in production")
        
        return self

    # Optional FMS Integration - MUST be set via environment variables if used
    FMS_API_BASE_URL: str = ""
    FMS_API_KEY: str = ""

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

    # Email settings
    SMTP_HOST: str = "localhost"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_TLS: bool = True
    EMAIL_FROM: str = "noreply@enterprise-ops.com"
    EMAIL_FROM_NAME: str = "Enterprise Ops Platform"
    FRONTEND_URL: str = "http://localhost:3000"


settings = Settings()
