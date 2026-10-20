import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import logging
import secrets
import time
import uuid
import redis.asyncio as redis

from app.core.config import settings
from app.api.v1 import api_router
from app.db.init_db import init_db
from app.core.scheduler import start_scheduler, stop_scheduler


class ErrorResponseMiddleware:
    """Convert unhandled exceptions into a JSON 500.

    Starlette's ServerErrorMiddleware is the outermost middleware, so an
    exception response is generated outside CORSMiddleware and carries no
    Access-Control-Allow-Origin header. The browser then reports an opaque
    "CORS header missing" error instead of the real failure. This middleware is
    registered inside CORSMiddleware, so the 500 it builds still passes back
    out through the CORS layer and reaches the frontend with its headers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def send_wrapper(message):
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            if response_started:
                # Cannot replace an in-flight response; let ASGI handle it.
                raise
            logging.exception("Unhandled exception on %s %s", scope.get('method'), scope.get('path'))
            detail = "Internal server error"
            response = JSONResponse(status_code=500, content={"detail": detail})
            await response(scope, receive, send)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'; "
            "form-action 'self'"
        )
        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class RedisRateLimitMiddleware(BaseHTTPMiddleware):
    """Redis-backed rate limiting for production scalability."""
    def __init__(self, app, requests_per_window: int = 100, window_seconds: int = 60):
        super().__init__(app)
        self.requests_per_window = requests_per_window
        self.window_seconds = window_seconds
        self._redis: redis.Redis | None = None

    async def _get_redis(self) -> redis.Redis:
        if self._redis is None:
            if settings.REDIS_URL:
                self._redis = redis.from_url(
                    settings.REDIS_URL,
                    encoding="utf-8",
                    decode_responses=True,
                )
            else:
                self._redis = redis.Redis(
                    host=settings.REDIS_HOST,
                    port=settings.REDIS_PORT,
                    password=settings.REDIS_PASSWORD,
                    db=settings.REDIS_DB,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=2,
                    socket_timeout=2,
                )
        return self._redis

    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting if disabled
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        # Rate limit all mutation endpoints (POST, PUT, PATCH, DELETE), including auth
        if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        key = f"ratelimit:{client_ip}:{request.url.path}"
        
        try:
            r = await self._get_redis()
            current = await r.incr(key)
            if current == 1:
                await r.expire(key, self.window_seconds)
            
            if current > self.requests_per_window:
                ttl = await r.ttl(key)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests. Please try again later."},
                    headers={"Retry-After": str(max(ttl, 1))}
                )
        except redis.ConnectionError:
            # If Redis is unavailable, fail open in development, fail closed in production
            if settings.ENVIRONMENT == "production":
                return JSONResponse(
                    status_code=503,
                    content={"detail": "Rate limiting service unavailable"}
                )
            # In development, log and continue
            print(f"[RateLimit] Redis connection failed, continuing without rate limiting: {key}")
        except Exception as e:
            if settings.ENVIRONMENT == "production":
                return JSONResponse(
                    status_code=500,
                    content={"detail": "Rate limiting error"}
                )
            print(f"[RateLimit] Unexpected error: {e}")
        
        return await call_next(request)


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Add X-Request-ID header for distributed tracing."""
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id
        
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class CSRFMiddleware(BaseHTTPMiddleware):
    """CSRF protection: require X-CSRF-Token header matching csrf_token cookie on mutations."""

    EXEMPT_PATHS = {"/api/v1/auth/login", "/api/v1/auth/forgot-password", "/api/v1/auth/reset-password"}

    async def dispatch(self, request: Request, call_next):
        # Only protect mutation endpoints
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        # Exempt public/auth-init endpoints
        if request.url.path in self.EXEMPT_PATHS:
            return await call_next(request)

        # Only enforce CSRF when a csrf_token cookie has been issued (i.e. user has logged in).
        # Before login there is no cookie to match against, so no CSRF check is needed.
        csrf_cookie = request.cookies.get("csrf_token")
        if not csrf_cookie:
            return await call_next(request)

        csrf_header = request.headers.get("X-CSRF-Token")

        if not csrf_header or csrf_cookie != csrf_header:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing or mismatched"},
            )

        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Keep the schema and required lookup data initialized in every environment.
    init_db(seed_base_data=True)
    
    # Start scheduler
    start_scheduler()
    
    yield
    
    # Stop scheduler on shutdown
    stop_scheduler()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url=f"{settings.API_V1_STR}/docs" if settings.ENVIRONMENT != "production" else None,
    redoc_url=f"{settings.API_V1_STR}/redoc" if settings.ENVIRONMENT != "production" else None,
    lifespan=lifespan
)

# Error handling. Added first so it is the innermost middleware: the 500 it
# builds travels back out through security headers, rate limiting and CORS.
app.add_middleware(ErrorResponseMiddleware)

# Security Headers
app.add_middleware(SecurityHeadersMiddleware)

# Request ID Tracing
app.add_middleware(RequestIDMiddleware)

# CSRF Protection (applied before CORS)
app.add_middleware(CSRFMiddleware)

# Rate Limiting (applied before CORS)
if settings.RATE_LIMIT_ENABLED:
    app.add_middleware(RedisRateLimitMiddleware, requests_per_window=settings.RATE_LIMIT_REQUESTS, window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS)

# CORS Configuration - Restricted methods and headers
if settings.BACKEND_CORS_ORIGINS or settings.ENVIRONMENT != "production":
    if settings.ENVIRONMENT != "production":
        # In development, dynamically allow any origin
        allow_origins = ["*"]
        allow_credentials = False
    else:
        # In production, use restricted origins with credentials
        allow_origins = [str(origin) for origin in settings.BACKEND_CORS_ORIGINS]
        allow_credentials = True

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=allow_credentials,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "Origin", "X-Requested-With"],
        expose_headers=["X-Total-Count"],
        max_age=600,
    )


@app.get("/health", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "environment": settings.ENVIRONMENT
    }


@app.get("/", tags=["Root"])
def root():
    return {
        "message": "Welcome to Enterprise 3-Workflow Operations & Faculty Governance Platform API",
        "docs_url": f"{settings.API_V1_STR}/docs" if settings.ENVIRONMENT != "production" else "disabled",
        "version": "1.0.0"
    }


app.include_router(api_router, prefix=settings.API_V1_STR)


class ConnectionManager:
    """Manage WebSocket connections for real-time updates."""
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


@app.websocket("/ws/analytics")
async def websocket_analytics(websocket: WebSocket):
    """WebSocket endpoint for real-time team analytics and active batches updates."""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Echo back heartbeat acknowledgment
            await websocket.send_json({"type": "heartbeat", "status": "ok"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)


async def broadcast_batch_update(batch_data: dict):
    """Broadcast batch status updates to connected WebSocket clients."""
    await manager.broadcast({
        "type": "batch_update",
        "data": batch_data
    })


async def broadcast_session_update(session_data: dict):
    """Broadcast session completion updates to connected WebSocket clients."""
    await manager.broadcast({
        "type": "session_update",
        "data": session_data
    })
