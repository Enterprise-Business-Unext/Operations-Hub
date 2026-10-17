import json
from typing import Optional

import redis

from app.core.config import settings


class RedisCacheService:
    """Redis-backed cache-aside service with fail-open behavior.

    All Redis errors are swallowed so a cache outage never blocks a request;
    callers simply fall through to the database.
    """

    def __init__(self, redis_url: Optional[str] = None):
        if redis_url:
            self._redis = redis.Redis.from_url(
                redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        else:
            self._redis = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                password=settings.REDIS_PASSWORD,
                db=settings.REDIS_DB,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        self._prefix = "ops_cache"
        self.hits = 0
        self.misses = 0

    def _key(self, namespace: str, identifier: str) -> str:
        return f"{self._prefix}:{namespace}:{identifier}"

    def get(self, namespace: str, identifier: str) -> Optional[str]:
        try:
            result = self._redis.get(self._key(namespace, identifier))
        except redis.ConnectionError:
            return None
        if result is not None:
            self.hits += 1
        else:
            self.misses += 1
        return result

    def set(self, namespace: str, identifier: str, value: str, ttl: int) -> None:
        try:
            self._redis.set(self._key(namespace, identifier), value, ex=ttl)
        except redis.ConnectionError:
            pass

    def delete(self, namespace: str, identifier: str) -> None:
        try:
            self._redis.delete(self._key(namespace, identifier))
        except redis.ConnectionError:
            pass
