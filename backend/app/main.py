import os
import asyncio
from contextlib import asynccontextmanager, suppress

from app.core.websocket import manager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse

from app.core.config import settings
from app.core.database import Base, engine, is_sqlite, init_db
from app.core.rate_limit import get_client_ip, check_rate_limit
from app.core.logging_config import StructuredLoggingMiddleware
from app.routers import auth, products, transactions, chat, trust, admin, ai, notifications, analytics
from app.routers import saved_searches
import app.models  # noqa: F401 - ensure all models are registered

# Auto-initialize database tables and extensions (works on SQLite & Supabase PostgreSQL)
init_db()

@asynccontextmanager
async def lifespan(app):
    from app.services.reminders import run_reminders

    manager.loop = asyncio.get_running_loop()
    tasks = [asyncio.create_task(manager.listen()), asyncio.create_task(run_reminders())]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        manager.loop = None


app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)


@app.middleware("http")
async def check_request_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        allowed_origin = origin in settings.CORS_ORIGINS or origin == str(request.base_url).rstrip("/")
        if (origin and not allowed_origin) or (not origin and request.headers.get("sec-fetch-site") == "cross-site"):
            return PlainTextResponse("Request origin is not allowed", status_code=403)
    return await call_next(request)


# 1. Security Headers Middleware (OWASP recommended)
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self), camera=(), microphone=()"
    # Dynamic connect-src including configured CORS origins and their WebSocket equivalents
    allowed_connect = ["'self'", "http://localhost:8000", "http://127.0.0.1:8000", "ws://localhost:8000", "ws://127.0.0.1:8000"]
    for origin in settings.CORS_ORIGINS:
        if origin not in allowed_connect:
            allowed_connect.append(origin)
        ws_origin = origin.replace("https://", "wss://").replace("http://", "ws://")
        if ws_origin not in allowed_connect:
            allowed_connect.append(ws_origin)

    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data: https: blob:; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        f"connect-src {' '.join(allowed_connect)}; "
        "frame-ancestors 'none';"
    )
    if settings.ENV == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    return response


# 2. Rate Limiting Middleware for Sensitive Routes
RATE_LIMIT_RULES = {
    "/auth/register/send-link": (5, 60), # 5 Supabase verification links / minute per IP
    "/auth/register/send-otp": (5, 60),  # 5 email verification codes / minute per IP
    "/auth/supabase": (15, 60),          # 15 Supabase token verifications / minute per IP
    "/auth/register": (10, 60),          # 10 registrations / minute per IP
    "/auth/login": (25, 60),          # 25 login requests / minute per IP
    "/auth/otp/request": (5, 60),     # 5 OTP requests / minute per IP (prevents SMS toll fraud)
    "/auth/users/": (30, 60),         # 30 profile lookups / minute per IP (anti-scraping)
    "/ai/suggest-listing": (20, 60),  # 20 AI suggestions / minute per IP
    "/reports": (10, 60),             # 10 reports / minute per IP (prevents moderation spam)
    "/chat/conversations": (60, 60),  # 60 chat requests / minute per IP (anti-polling-DDoS)
    "/analytics/sustainability": (20, 60),  # 20 sustainability queries / minute per IP (anti-algorithmic-DoS)
}

@app.middleware("http")
async def rate_limiting_middleware(request: Request, call_next):
    path = request.url.path
    for prefix, (max_reqs, window) in RATE_LIMIT_RULES.items():
        if path.startswith(prefix):
            client_ip = get_client_ip(request)
            key = f"rl:{prefix}:{client_ip}"
            allowed, retry_after = check_rate_limit(key, max_reqs, window)
            if not allowed:
                return PlainTextResponse(
                    content=f"Too many requests. Please slow down and try again in {retry_after} seconds.",
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                )
    return await call_next(request)


# 3. Structured Logging Middleware
app.add_middleware(StructuredLoggingMiddleware)

# 4. Secure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS if settings.ENV == "development" else [o for o in settings.CORS_ORIGINS if "localhost" not in o],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With", "X-Request-ID"],
    expose_headers=["X-Total-Count", "X-Request-ID"],
)


# 4. Secure Static Files Handler (disallows script execution and non-image extensions)
ALLOWED_STATIC_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".glb", ".gltf"}

class SecureStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        ext = os.path.splitext(path)[1].lower()
        if ext and ext not in ALLOWED_STATIC_EXTENSIONS:
            return PlainTextResponse("Forbidden: file type not permitted", status_code=403)
        return await super().get_response(path, scope)

os.makedirs(settings.LOCAL_STORAGE_DIR, exist_ok=True)
app.mount("/uploads", SecureStaticFiles(directory=settings.LOCAL_STORAGE_DIR, check_dir=False), name="uploads")


# 5. Application Routers
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(transactions.router)
app.include_router(chat.router)
app.include_router(trust.router)
app.include_router(admin.router)
app.include_router(ai.router)
app.include_router(notifications.router)
app.include_router(saved_searches.router)
app.include_router(analytics.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": settings.PROJECT_NAME}

