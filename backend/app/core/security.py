from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Union
import re
import jwt
from jwt import PyJWTError
from passlib.context import CryptContext
from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def validate_password_strength(password: str) -> list[str]:
    """Validate password against policy. Returns list of errors (empty if valid)."""
    errors = []
    if len(password) < settings.MIN_PASSWORD_LENGTH:
        errors.append(f"Password must be at least {settings.MIN_PASSWORD_LENGTH} characters")
    if settings.REQUIRE_UPPERCASE and not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter")
    if settings.REQUIRE_LOWERCASE and not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter")
    if settings.REQUIRE_NUMBERS and not re.search(r"\d", password):
        errors.append("Password must contain at least one number")
    if settings.REQUIRE_SPECIAL_CHARS and not re.search(r"[!@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]", password):
        errors.append("Password must contain at least one special character")
    return errors


def create_access_token(
    subject: Union[str, Any],
    role: str,
    expires_delta: Optional[timedelta] = None,
    extra_claims: Optional[dict] = None
) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "role": role,
        "type": "access",
    }
    if extra_claims:
        to_encode.update(extra_claims)

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token(
    subject: Union[str, Any],
    expires_delta: Optional[timedelta] = None
) -> str:
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "type": "refresh",
    }

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "access":
            return None
        return payload
    except PyJWTError:
        return None


def decode_refresh_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "refresh":
            return None
        return payload
    except PyJWTError:
        return None


def create_reset_token(
    subject: Union[str, Any],
    email: str,
    expires_delta: Optional[timedelta] = None
) -> str:
    """Create a signed JWT token for password reset."""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(hours=settings.RESET_TOKEN_TTL_HOURS)

    to_encode = {
        "exp": expire,
        "sub": str(subject),
        "email": email,
        "type": "password_reset",
    }

    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def decode_reset_token(token: str) -> Optional[dict]:
    """Decode and verify a password reset token."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "password_reset":
            return None
        return payload
    except PyJWTError:
        return None
