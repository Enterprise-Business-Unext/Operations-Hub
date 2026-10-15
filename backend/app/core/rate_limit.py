import asyncio
import time
from typing import Dict, Tuple, Optional
from app.core.config import settings


class InMemoryRateLimiter:
    """In-memory rate limiter with sliding window and asyncio locks for concurrency."""

    def __init__(self):
        self._store: Dict[str, list[float]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()

    def _get_lock(self, key: str) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    async def is_allowed(
        self,
        key: str,
        max_requests: int,
        window_seconds: int
    ) -> Tuple[bool, int, int]:
        """
        Check if request is allowed under rate limit.
        Returns (allowed, remaining, retry_after_seconds)
        """
        now = time.time()
        window_start = now - window_seconds

        lock = self._get_lock(key)
        async with lock:
            if key not in self._store:
                self._store[key] = []

            requests = self._store[key]
            requests[:] = [ts for ts in requests if ts > window_start]

            if len(requests) >= max_requests:
                oldest = requests[0]
                retry_after = int(oldest + window_seconds - now) + 1
                return False, 0, max(retry_after, 1)

            requests.append(now)
            remaining = max_requests - len(requests)
            return True, remaining, 0

    async def cleanup(self, max_age_seconds: int = 3600) -> None:
        """Remove expired entries to prevent memory growth."""
        now = time.time()
        cutoff = now - max_age_seconds
        async with self._global_lock:
            for key in list(self._store.keys()):
                requests = [ts for ts in self._store[key] if ts > cutoff]
                if requests:
                    self._store[key] = requests
                else:
                    del self._store[key]
                    if key in self._locks:
                        del self._locks[key]


_rate_limiter: Optional[InMemoryRateLimiter] = None


def get_rate_limiter() -> InMemoryRateLimiter:
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = InMemoryRateLimiter()
    return _rate_limiter


async def check_rate_limit(
    identifier: str,
    max_requests: int = None,
    window_seconds: int = None
) -> Tuple[bool, int, int]:
    """
    Check rate limit for an identifier.
    Returns (allowed, remaining, retry_after)
    """
    if not settings.RATE_LIMIT_ENABLED:
        return True, 999, 0

    limiter = get_rate_limiter()
    max_req = max_requests or settings.RATE_LIMIT_REQUESTS
    window = window_seconds or settings.RATE_LIMIT_WINDOW_SECONDS
    return await limiter.is_allowed(identifier, max_req, window)


async def check_forgot_password_rate_limit(ip: str) -> Tuple[bool, int, int]:
    """Check rate limit specifically for forgot password endpoint."""
    if not settings.RATE_LIMIT_ENABLED:
        return True, 999, 0

    limiter = get_rate_limiter()
    return await limiter.is_allowed(
        f"forgot_password:{ip}",
        settings.FORGOT_PASSWORD_RATE_LIMIT_REQUESTS,
        settings.FORGOT_PASSWORD_RATE_LIMIT_WINDOW_SECONDS
    )