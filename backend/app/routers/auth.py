import os
import uuid
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib.parse import quote, urlparse
import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status, Request, UploadFile, File
from pydantic import BaseModel, Field, ConfigDict, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import func
from geoalchemy2.functions import ST_MakePoint, ST_SetSRID
from jose import jwt, JWTError

from app.core.database import get_db
from app.core.config import settings
from app.core.security import (
    hash_password, verify_password, create_access_token, get_current_user,
    revoke_token, _extract_token, oauth2_scheme,
)
from app.core.rate_limit import rate_limit_dependency, check_rate_limit

from app.models.user import User
from app.schemas.auth import (
    EmailLinkRequest, EmailOTPRequest, RegisterRequest, LoginRequest,
    SupabaseTokenRequest, TokenResponse, OTPVerifyRequest, LocationUpdateRequest,
)
from app.schemas.user import UserOut, UserUpdate
from app.services.email_service import (
    is_email_configured, send_email_verification_otp, send_password_reset_email,
)

ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_AVATAR_MIMES = {"image/jpeg", "image/png", "image/webp"}
MAX_AVATAR_SIZE = 3 * 1024 * 1024  # 3 MB


class ForgotPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str


class ResetPasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str
    new_password: str = Field(..., min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def check_password_complexity(cls, v: str) -> str:
        from app.core.security import validate_password_strength
        return validate_password_strength(v)


router = APIRouter(prefix="/auth", tags=["auth"])

# Redis connection with fallback to in-memory store
_redis_client = None
try:
    import redis
    _r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1)
    _r.ping()
    _redis_client = _r
except Exception:
    _redis_client = None

# Local fallback store for development: {phone: {"otp": str, "expires_at": float, "attempts": int, "window_start": float}}
_local_otp_store: dict[str, dict] = {}
_local_otp_failures: dict[str, dict] = {}  # {phone: {"count": int, "first_at": float}}
_local_login_attempts: dict[str, dict] = {}
_local_otp_cooldowns: dict[str, float] = {}  # {phone: last_request_timestamp}
_last_auth_cleanup: float = 0.0
MAX_AUTH_STORE_SIZE = 20000


def _prune_auth_in_memory_stores(now: float):
    """Enforces bounded heap memory across in-memory auth caches under 5M user traffic."""
    global _last_auth_cleanup
    if (
        now - _last_auth_cleanup < 30.0
        and len(_local_login_attempts) < 5000
        and len(_local_otp_store) < 5000
        and len(_local_otp_cooldowns) < 5000
    ):
        return
    _last_auth_cleanup = now

    # 1. Prune expired login attempts
    stale_logins = [
        k for k, v in _local_login_attempts.items()
        if now > v.get("lockout_until", 0) and (now - v.get("first_failure", 0) > 1800)
    ]
    for k in stale_logins:
        _local_login_attempts.pop(k, None)
    if len(_local_login_attempts) > MAX_AUTH_STORE_SIZE:
        for k in list(_local_login_attempts.keys())[:len(_local_login_attempts) - MAX_AUTH_STORE_SIZE]:
            _local_login_attempts.pop(k, None)

    # 2. Prune expired OTP entries
    stale_otps = [
        k for k, v in _local_otp_store.items()
        if now > v.get("expires_at", 0) and (now - v.get("window_start", 0) > 1800)
    ]
    for k in stale_otps:
        _local_otp_store.pop(k, None)
    if len(_local_otp_store) > MAX_AUTH_STORE_SIZE:
        for k in list(_local_otp_store.keys())[:len(_local_otp_store) - MAX_AUTH_STORE_SIZE]:
            _local_otp_store.pop(k, None)

    # 3. Prune OTP cooldowns older than 5 minutes
    stale_cooldowns = [k for k, t in _local_otp_cooldowns.items() if now - t > 300]
    for k in stale_cooldowns:
        _local_otp_cooldowns.pop(k, None)
    if len(_local_otp_cooldowns) > MAX_AUTH_STORE_SIZE:
        for k in list(_local_otp_cooldowns.keys())[:len(_local_otp_cooldowns) - MAX_AUTH_STORE_SIZE]:
            _local_otp_cooldowns.pop(k, None)

    # 4. Prune OTP failure records older than 15 minutes
    stale_failures = [k for k, v in _local_otp_failures.items() if now - v.get("first_at", 0) > 900]
    for k in stale_failures:
        _local_otp_failures.pop(k, None)
    if len(_local_otp_failures) > MAX_AUTH_STORE_SIZE:
        for k in list(_local_otp_failures.keys())[:len(_local_otp_failures) - MAX_AUTH_STORE_SIZE]:
            _local_otp_failures.pop(k, None)


def _read_bounded_upload(file_obj, max_size: int, chunk_size: int = 65536) -> bytes:
    """Streams file upload in bounded chunks to prevent heap exhaustion attacks."""
    chunks = []
    total = 0
    while True:
        chunk = file_obj.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_size:
            raise HTTPException(
                status_code=413,
                detail=f"Uploaded file exceeds maximum allowed limit of {max_size // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def _normalize_phone(phone: Optional[str]) -> Optional[str]:
    """Canonicalize phone numbers by stripping non-digits, whitespace, leading zeros, and +91/91 country prefix."""
    if not phone:
        return None
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def _set_auth_cookie(response: Response, token: str):
    is_prod = settings.ENV == "production"
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="none" if is_prod else "lax",
        secure=is_prod,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )


def _clear_auth_cookie(response: Response):
    is_prod = settings.ENV == "production"
    response.delete_cookie(
        key="access_token",
        path="/",
        samesite="none" if is_prod else "lax",
        secure=is_prod,
    )


def _check_otp_cooldown(phone: str):
    """Enforce 60-second cooldown between OTP requests to prevent brute-force cycling."""
    now = time.time()
    _prune_auth_in_memory_stores(now)
    if _redis_client:
        cooldown_key = f"otp_cooldown:{phone}"
        last_req = _redis_client.get(cooldown_key)
        if last_req and now - float(last_req) < 60:
            wait = int(60 - (now - float(last_req)))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait} seconds before requesting another OTP.",
            )
        _redis_client.setex(cooldown_key, 60, str(now))
    else:
        last_req = _local_otp_cooldowns.get(phone, 0)
        if now - last_req < 60:
            wait = int(60 - (now - last_req))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {wait} seconds before requesting another OTP.",
            )
        _local_otp_cooldowns[phone] = now


def _check_rate_limit(phone: str):
    now = time.time()
    _prune_auth_in_memory_stores(now)
    if _redis_client:
        rate_key = f"otp_rate:{phone}"
        requests = _redis_client.incr(rate_key)
        if requests == 1:
            _redis_client.expire(rate_key, 600)  # 10 minute window
        if requests > 5:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many OTP requests for this phone number. Please wait a few minutes.",
            )
    else:
        entry = _local_otp_store.setdefault(phone, {})
        window_start = entry.get("window_start", 0)
        attempts = entry.get("attempts", 0)
        if now - window_start < 600:
            if attempts >= 5:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many OTP requests for this phone number. Please wait a few minutes.",
                )
            entry["attempts"] = attempts + 1
        else:
            entry["window_start"] = now
            entry["attempts"] = 1


def _check_login_rate_limit(email: str):
    now = time.time()
    _prune_auth_in_memory_stores(now)
    clean_email = email.strip().lower()
    entry = _local_login_attempts.get(clean_email)
    if entry:
        lockout_until = entry.get("lockout_until", 0)
        if now < lockout_until:
            wait_seconds = int(lockout_until - now)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed login attempts. Account temporarily locked. Please try again in {wait_seconds} seconds.",
            )


def _record_login_failure(email: str):
    now = time.time()
    _prune_auth_in_memory_stores(now)
    clean_email = email.strip().lower()
    entry = _local_login_attempts.setdefault(clean_email, {"failures": 0, "first_failure": now, "lockout_until": 0})
    if now - entry.get("first_failure", 0) > 300:
        entry["failures"] = 1
        entry["first_failure"] = now
    else:
        entry["failures"] = entry.get("failures", 0) + 1

    if entry["failures"] >= 5:
        entry["lockout_until"] = now + 300  # 5-minute lockout


def _record_login_success(email: str):
    clean_email = email.strip().lower()
    _local_login_attempts.pop(clean_email, None)


def _store_otp(phone: str, otp: str):
    now = time.time()
    _prune_auth_in_memory_stores(now)
    if _redis_client:
        _redis_client.setex(f"otp:{phone}", 300, otp)  # 5 min TTL
    else:
        entry = _local_otp_store.setdefault(phone, {})
        entry["otp"] = otp
        entry["expires_at"] = now + 300


def _get_stored_otp(phone: str) -> Optional[str]:
    if _redis_client:
        return _redis_client.get(f"otp:{phone}")
    entry = _local_otp_store.get(phone)
    if not entry:
        return None
    if time.time() > entry.get("expires_at", 0):
        _local_otp_store.pop(phone, None)
        return None
    return entry.get("otp")


def _delete_stored_otp(phone: str):
    if _redis_client:
        _redis_client.delete(f"otp:{phone}")
    else:
        if phone in _local_otp_store:
            _local_otp_store[phone].pop("otp", None)
            _local_otp_store[phone].pop("expires_at", None)


def _mask_email(email: str) -> str:
    if not email or "@" not in email:
        return ""
    name, domain = email.split("@", 1)
    if len(name) <= 2:
        masked_name = name[0] + "*"
    else:
        masked_name = name[0] + "*" * (len(name) - 2) + name[-1]
    return f"{masked_name}@{domain}"


def _get_safe_redirect_url(redirect_to: Optional[str], fallback_path: str) -> str:
    default_origin = settings.CORS_ORIGINS[0] if settings.CORS_ORIGINS else "http://localhost:3000"
    fallback = f"{default_origin.rstrip('/')}{fallback_path}"
    if not redirect_to:
        return fallback
    try:
        parsed = urlparse(redirect_to)
        candidate_origin = f"{parsed.scheme}://{parsed.netloc}"
        allowed_origins = set(settings.CORS_ORIGINS) | {"http://localhost:3000", "http://127.0.0.1:3000"}
        if candidate_origin in allowed_origins:
            return redirect_to
    except Exception:
        pass
    return fallback


def _verify_supabase_user_token(access_token: str) -> dict:
    if not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase Auth is not configured on the server.",
        )
    url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    try:
        resp = httpx.get(
            url,
            headers={
                "apikey": settings.SUPABASE_KEY,
                "Authorization": f"Bearer {access_token}",
            },
            timeout=10,
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Supabase Auth service.",
        )
    if resp.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired verification token.",
        )
    data = resp.json()
    if not data.get("email"):
        raise HTTPException(status_code=400, detail="Verified email missing from Supabase response.")
    return data


@router.post("/register/send-link")
def send_register_verification_link(payload: EmailLinkRequest, db: Session = Depends(get_db)):
    clean_email = payload.email.strip().lower()
    existing = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing:
        return {"message": "If this email is eligible, a verification link has been sent."}

    otp_key = f"email_link:{clean_email}"
    _check_otp_cooldown(otp_key)
    _check_rate_limit(otp_key)

    if not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase Auth is not configured on the server.",
        )

    safe_redirect = _get_safe_redirect_url(payload.redirect_to, "/register")
    otp_url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/otp?redirect_to={quote(safe_redirect, safe='')}"
    try:
        resp = httpx.post(
            otp_url,
            headers={"apikey": settings.SUPABASE_KEY, "Content-Type": "application/json"},
            json={
                "email": clean_email,
                "create_user": True,
                "email_redirect_to": safe_redirect,
            },
            timeout=10,
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not reach Supabase email service.",
        )

    if resp.status_code == 429:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Email rate limit reached (Supabase free tier allows 2 emails/hour). Please wait or use Google Sign-In.",
        )
    if resp.status_code >= 400:
        detail = "Could not send verification link."
        try:
            err = resp.json()
            detail = err.get("msg") or err.get("error_description") or err.get("message") or detail
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=detail)

    return {"message": "Verification link sent to your email. Click it to continue creating your account."}


@router.post("/supabase/verify-email-token")
def verify_supabase_email_token(payload: SupabaseTokenRequest):
    sb_user = _verify_supabase_user_token(payload.supabase_access_token)
    return {
        "email": sb_user["email"].strip().lower(),
        "full_name": (sb_user.get("user_metadata") or {}).get("full_name") or (sb_user.get("user_metadata") or {}).get("name"),
    }


@router.get("/oauth/google/url")
def get_google_oauth_url(redirect_to: Optional[str] = None):
    if not settings.SUPABASE_URL:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase Auth is not configured on the server.",
        )
    safe_redirect = _get_safe_redirect_url(redirect_to, "/login")
    base = settings.SUPABASE_URL.rstrip("/")
    return {"url": f"{base}/auth/v1/authorize?provider=google&redirect_to={quote(safe_redirect, safe='')}"}


@router.post("/supabase/oauth-login", response_model=TokenResponse)
def supabase_oauth_login(payload: SupabaseTokenRequest, response: Response, db: Session = Depends(get_db)):
    sb_user = _verify_supabase_user_token(payload.supabase_access_token)
    clean_email = sb_user["email"].strip().lower()
    meta = sb_user.get("user_metadata") or {}
    full_name = meta.get("full_name") or meta.get("name")
    avatar_url = meta.get("avatar_url") or meta.get("picture")

    user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if user:
        if user.is_blocked_flag:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is suspended. Please contact administrator.",
            )
        if not user.is_verified:
            user.is_verified = True
            user.verification_method = user.verification_method or "google_oauth"
        if not user.full_name and full_name:
            user.full_name = full_name
        if not user.avatar_url and avatar_url:
            user.avatar_url = avatar_url
        db.commit()
    else:
        user = User(
            email=clean_email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            full_name=full_name,
            avatar_url=avatar_url,
            is_verified=True,
            verification_method="college_email" if clean_email.endswith((".edu", ".ac.in")) else "google_oauth",
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(subject=str(user.id), session_version=user.session_version)
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/register/send-otp")
def send_register_email_otp(payload: EmailOTPRequest, db: Session = Depends(get_db)):
    clean_email = payload.email.strip().lower()
    existing = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing:
        return {"message": "If this email is eligible, a 6-digit verification code has been sent."}

    otp_key = f"email:{clean_email}"
    _check_otp_cooldown(otp_key)
    _check_rate_limit(otp_key)

    if settings.ENV == "production" and not is_email_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email verification service is not configured yet. Please contact administrator.",
        )

    otp = f"{secrets.randbelow(1000000):06d}"
    _store_otp(otp_key, otp)
    sent = send_email_verification_otp(clean_email, otp)
    if settings.ENV == "production" and not sent:
        _delete_stored_otp(otp_key)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send verification email right now. Please try again later.",
        )

    resp: dict[str, str] = {"message": "Verification code sent to your email."}
    if settings.ENV != "production" and not is_email_configured():
        resp["dev_otp"] = otp
    return resp


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    clean_email = payload.email.strip().lower()
    existing = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if existing:
        # Constant-time response: hash the password even when rejecting to prevent timing leak
        hash_password(payload.password)
        raise HTTPException(status_code=400, detail="Registration failed. Please try a different email or login.")

    email_verified = False
    verification_method = None
    if payload.supabase_access_token:
        sb_user = _verify_supabase_user_token(payload.supabase_access_token)
        if sb_user["email"].strip().lower() != clean_email:
            raise HTTPException(status_code=400, detail="Verified email does not match registration email.")
        email_verified = True
        verification_method = "college_email" if clean_email.endswith((".edu", ".ac.in")) else "supabase_email"
    elif settings.ENV == "production" or payload.email_otp is not None:
        if not payload.email_otp:
            raise HTTPException(status_code=400, detail="Please verify your email via verification link before creating an account.")
        otp_key = f"email:{clean_email}"
        now = time.time()
        failure_entry = _local_otp_failures.get(otp_key, {"count": 0, "first_at": now})
        if failure_entry.get("count", 0) >= 10:
            _delete_stored_otp(otp_key)
            if now - failure_entry.get("first_at", 0) < 900:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many failed verification attempts. Please try again in 15 minutes.",
                )
            _local_otp_failures.pop(otp_key, None)
            failure_entry = {"count": 0, "first_at": now}

        expected = _get_stored_otp(otp_key)
        if expected is None or not secrets.compare_digest(expected, payload.email_otp):
            failure_entry["count"] = failure_entry.get("count", 0) + 1
            failure_entry.setdefault("first_at", now)
            _local_otp_failures[otp_key] = failure_entry
            raise HTTPException(status_code=400, detail="Invalid or expired email verification code.")

        _local_otp_failures.pop(otp_key, None)
        _delete_stored_otp(otp_key)
        email_verified = True
        verification_method = "college_email" if clean_email.endswith((".edu", ".ac.in")) else "email_otp"

    user = User(
        email=clean_email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        college=payload.college,
        is_verified=email_verified,
        verification_method=verification_method,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(subject=str(user.id), session_version=user.session_version)
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, response: Response, db: Session = Depends(get_db)):
    clean_email = payload.email.strip().lower()
    _check_login_rate_limit(clean_email)

    user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    if not user:
        # Constant-time: hash a dummy password to prevent timing side-channel enumeration
        verify_password(payload.password, hash_password("dummy-constant-time-pad"))
        _record_login_failure(clean_email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, user.password_hash):
        _record_login_failure(clean_email)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if user.is_blocked_flag:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is suspended. Please contact administrator.",
        )

    _record_login_success(clean_email)
    token = create_access_token(subject=str(user.id), session_version=user.session_version)
    _set_auth_cookie(response, token)
    return TokenResponse(access_token=token)


@router.post("/logout")
def logout(request: Request, response: Response, token: Optional[str] = Depends(oauth2_scheme)):
    raw_token = _extract_token(request, token)
    if raw_token:
        revoke_token(raw_token)
    _clear_auth_cookie(response)
    return {"message": "Logged out successfully"}


@router.post("/otp/request")
def request_otp(
    phone: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Request OTP for phone verification. Requires authentication to prevent abuse."""
    clean_phone = _normalize_phone(phone) or ""
    if len(clean_phone) < 10 or len(clean_phone) > 15:
        raise HTTPException(
            status_code=400,
            detail="Invalid phone number format. Please provide a valid 10-15 digit phone number.",
        )

    # Check if this phone is already bound to a different user
    existing_user = db.query(User).filter(User.phone == clean_phone, User.id != user.id).first()
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="This phone number is already associated with another account.",
        )

    # Canonicalize phone number for rate-limiting, storage, and binding
    _check_otp_cooldown(clean_phone)  # 60-second cooldown between requests
    _check_rate_limit(clean_phone)    # 5 requests per 10-minute window

    # Cryptographically secure 6-digit OTP
    otp = f"{secrets.randbelow(1000000):06d}"
    _store_otp(clean_phone, otp)
    # Do NOT reset failure counter on re-request (prevents brute-force cycling)
    # Output to logs in development only / hook SMS gateway in production
    if settings.ENV != "production":
        print(f"[OTP SERVICE] Verification code for {clean_phone}: {otp}")
    return {"message": "OTP sent"}


@router.post("/otp/verify")
def verify_otp(payload: OTPVerifyRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clean_phone = _normalize_phone(payload.phone) or ""
    now = time.time()
    failure_entry = _local_otp_failures.get(clean_phone, {"count": 0, "first_at": now})
    total_failures = failure_entry.get("count", 0)

    # Global failure cap: 10 total attempts per phone across all OTP generations (15-min window)
    if total_failures >= 10:
        _delete_stored_otp(clean_phone)
        if now - failure_entry.get("first_at", 0) < 900:  # 15-minute lockout
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed verification attempts. This phone is temporarily locked. Please try again in 15 minutes.",
            )
        # Window expired — reset
        _local_otp_failures.pop(clean_phone, None)
        failure_entry = {"count": 0, "first_at": now}

    expected = _get_stored_otp(clean_phone)
    if expected is None or not secrets.compare_digest(expected, payload.otp):
        failure_entry["count"] = failure_entry.get("count", 0) + 1
        failure_entry.setdefault("first_at", now)
        _local_otp_failures[clean_phone] = failure_entry
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")

    # Verify ownership: only the requesting user can bind this phone
    existing_user = db.query(User).filter(User.phone == clean_phone, User.id != user.id).first()
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="This phone number is already associated with another account.",
        )

    _local_otp_failures.pop(clean_phone, None)
    user.phone = clean_phone
    user.is_verified = True
    user.verification_method = "phone_otp"
    db.commit()
    _delete_stored_otp(clean_phone)
    return {"message": "Phone verified successfully"}


@router.patch("/me/location", response_model=UserOut)
def update_location(payload: LocationUpdateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.latitude = payload.latitude
    user.longitude = payload.longitude
    user.location_radius_pref_km = payload.location_radius_pref_km or user.location_radius_pref_km
    user.location = ST_SetSRID(ST_MakePoint(payload.longitude, payload.latitude), 4326)
    db.commit()
    db.refresh(user)
    return user


def _validate_image_bytes(data: bytes, ext: str) -> bool:
    if len(data) < 12:
        return False
    if ext in (".jpg", ".jpeg") and data.startswith(b"\xff\xd8\xff"):
        return True
    if ext == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if ext == ".webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return True
    return False


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/me", response_model=UserOut)
def update_profile(payload: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip() or None
    if payload.college is not None:
        user.college = payload.college.strip() or None
    # Security: Phone numbers CANNOT be updated via PATCH /auth/me.
    # All phone updates and bindings must go through /auth/otp/request and /auth/otp/verify.
    db.commit()
    db.refresh(user)
    return user


@router.post("/me/avatar")
def upload_avatar(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Rate limit: max 10 avatar uploads per minute per user to prevent storage flood/DoS
    allowed, retry_after = check_rate_limit(f"avatar_upload:{user.id}", 10, 60)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many avatar upload attempts. Please wait {retry_after} seconds.",
        )

    filename = file.filename or "avatar.jpg"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_AVATAR_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file extension '{ext}'. Allowed: {', '.join(sorted(ALLOWED_AVATAR_EXTENSIONS))}",
        )

    if file.content_type and file.content_type.lower() not in ALLOWED_AVATAR_MIMES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid MIME type '{file.content_type}'. Allowed: image/jpeg, image/png, image/webp",
        )

    content = _read_bounded_upload(file.file, MAX_AVATAR_SIZE)
    if not _validate_image_bytes(content, ext):
        raise HTTPException(status_code=400, detail="Corrupt or invalid image format.")

    key = f"avatar_{user.id}_{uuid.uuid4().hex[:8]}{ext}"

    if settings.STORAGE_BACKEND == "supabase" and settings.SUPABASE_URL and settings.SUPABASE_KEY:
        import httpx
        base_url = settings.SUPABASE_URL.rstrip("/")
        supabase_upload_url = f"{base_url}/storage/v1/object/{settings.SUPABASE_BUCKET}/{key}"
        headers = {
            "Authorization": f"Bearer {settings.SUPABASE_KEY}",
            "apikey": settings.SUPABASE_KEY,
            "Content-Type": file.content_type or "image/jpeg",
        }
        with httpx.Client(timeout=15.0) as client:
            resp = client.post(supabase_upload_url, headers=headers, content=content)
            if resp.status_code not in (200, 201):
                raise HTTPException(status_code=500, detail=f"Failed to upload avatar to Supabase Storage: {resp.text}")
        url = f"{base_url}/storage/v1/object/public/{settings.SUPABASE_BUCKET}/{key}"
    else:
        os.makedirs(settings.LOCAL_STORAGE_DIR, exist_ok=True)
        file_path = os.path.join(settings.LOCAL_STORAGE_DIR, key)
        with open(file_path, "wb") as f:
            f.write(content)
        url = f"/uploads/{key}"

    user.avatar_url = url
    db.commit()
    return {"avatar_url": url}



@router.get("/me/export")
def export_user_data(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """GDPR Compliance: complete personal data export in structured JSON format."""
    from app.models.product import Product
    from app.models.transaction import Transaction
    from app.models.review import Review

    products = db.query(Product).filter(Product.seller_id == user.id).all()
    transactions = db.query(Transaction).filter((Transaction.buyer_id == user.id) | (Transaction.seller_id == user.id)).all()
    reviews_written = db.query(Review).filter(Review.reviewer_id == user.id).all()
    reviews_received = db.query(Review).filter(Review.reviewee_id == user.id).all()

    return {
        "user_profile": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "phone": user.phone,
            "college": user.college,
            "is_verified": user.is_verified,
            "avg_rating": user.avg_rating,
            "rating_count": user.rating_count,
            "created_at": str(user.created_at) if user.created_at else None,
        },
        "listings": [
            {
                "id": p.id,
                "title": p.title,
                "description": p.description,
                "price": p.price,
                "category": p.category,
                "status": str(p.status),
                "created_at": str(p.created_at),
            }
            for p in products
        ],
        "transactions": [
            {
                "id": t.id,
                "product_id": t.product_id,
                "role": "seller" if t.seller_id == user.id else "buyer",
                "state": str(t.state),
                "agreed_price": t.agreed_price,
                "created_at": str(t.created_at),
            }
            for t in transactions
        ],
        "reviews_written": [
            {"id": r.id, "rating": r.rating, "comment": r.comment, "created_at": str(r.created_at)}
            for r in reviews_written
        ],
        "reviews_received": [
            {"id": r.id, "rating": r.rating, "comment": r.comment, "created_at": str(r.created_at)}
            for r in reviews_received
        ],
    }


@router.delete("/me")
def delete_account(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """GDPR Compliance: permanently delete user account and clean up active resources."""
    from app.models.product import Product, ProductStatus
    from app.models.transaction import Transaction, TransactionState

    # Check for active deals
    active_tx = db.query(Transaction).filter(
        ((Transaction.buyer_id == user.id) | (Transaction.seller_id == user.id)),
        Transaction.state.in_([TransactionState.ACCEPTED, TransactionState.CONFIRMED]),
    ).first()
    if active_tx:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete account with active in-progress deals. Please complete or cancel them first.",
        )

    # Cancel any pending / countered negotiations cleanly so neither party is stuck
    db.query(Transaction).filter(
        ((Transaction.buyer_id == user.id) | (Transaction.seller_id == user.id)),
        Transaction.state.in_([TransactionState.PENDING, TransactionState.COUNTERED]),
    ).update({"state": TransactionState.CANCELLED}, synchronize_session=False)

    # Soft-remove user listings
    db.query(Product).filter(Product.seller_id == user.id).update({"status": ProductStatus.REMOVED})

    # Anonymize/delete user profile
    from app.models.notification import MutedNotification, SavedSearch
    db.query(SavedSearch).filter_by(user_id=user.id).delete()
    db.query(MutedNotification).filter_by(user_id=user.id).delete()
    user.is_blocked_flag = True
    user.email = f"deleted_{user.id}_{uuid.uuid4().hex[:6]}@deleted.local"
    user.phone = None
    user.full_name = "Deleted Student"
    user.avatar_url = None
    db.commit()
    return {"message": "Account successfully closed and data anonymized."}


@router.post("/forgot-password")
def forgot_password(request: Request, payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    # Rate limit password resets: max 5 requests per 10 minutes per IP/client
    from app.core.rate_limit import get_client_ip
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(f"forgot_pw:{client_ip}", 5, 600)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many password reset requests. Please try again in {retry_after} seconds.",
        )

    clean_email = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == clean_email).first()
    # Anti-enumeration: return standard response even if email is not found
    if not user:
        return {"message": "If this email is registered, a password reset link has been dispatched."}

    token_payload = {
        "sub": str(user.id),
        "purpose": "password_reset",
        "h": user.password_hash[-10:],
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
    }
    reset_token = jwt.encode(token_payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    reset_url = f"http://localhost:3000/login?reset_token={reset_token}"
    send_password_reset_email(user.email, user.full_name or "Student", reset_url)

    # Security: Never return reset tokens in HTTP API responses in production environments.
    # Output to automated test runner in development/test only.
    response_data = {"message": "If this email is registered, a password reset link has been dispatched."}
    if settings.ENV != "production" and os.getenv("PYTEST_CURRENT_TEST"):
        response_data["dev_reset_token"] = reset_token
    return response_data


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    try:
        decoded = jwt.decode(payload.token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired password reset link.")

    if decoded.get("purpose") != "password_reset":
        raise HTTPException(status_code=400, detail="Invalid reset token.")

    user_id = int(decoded.get("sub", 0))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found.")

    if decoded.get("h") != user.password_hash[-10:]:
        raise HTTPException(status_code=400, detail="This reset link has already been used.")

    updated = db.query(User).filter(User.id == user.id, User.password_hash == user.password_hash).update({
        User.password_hash: hash_password(payload.new_password),
        User.session_version: User.session_version + 1,
    })
    if updated != 1:
        raise HTTPException(status_code=400, detail="This reset link has already been used.")
    db.commit()
    return {"message": "Password reset successfully. You may now log in with your new password."}


@router.get(
    "/users/{user_id}/public-profile",
    dependencies=[Depends(rate_limit_dependency(max_requests=30, window_seconds=60))],
)
def public_profile(user_id: int, db: Session = Depends(get_db)):
    from app.models.product import Product, ProductStatus
    from app.models.review import Review

    target = db.query(User).filter(User.id == user_id).first()
    if not target or target.is_blocked_flag:
        raise HTTPException(status_code=404, detail="User not found")

    listings = (
        db.query(Product)
        .filter(Product.seller_id == user_id, Product.status == ProductStatus.ACTIVE)
        .order_by(Product.created_at.desc())
        .limit(20)
        .all()
    )

    reviews = (
        db.query(Review)
        .filter(Review.reviewee_id == user_id)
        .order_by(Review.created_at.desc())
        .limit(20)
        .all()
    )

    # Resolve reviewer names
    reviewer_ids = [r.reviewer_id for r in reviews]
    reviewers = {u.id: u for u in db.query(User).filter(User.id.in_(reviewer_ids)).all()} if reviewer_ids else {}

    return {
        "user": {
            "id": target.id,
            "full_name": target.full_name,
            "avatar_url": target.avatar_url,
            "email": _mask_email(target.email),  # PII masked for privacy
            "college": target.college,
            "is_verified": target.is_verified,
            "avg_rating": target.avg_rating,
            "rating_count": target.rating_count,
            "created_at": str(target.created_at) if target.created_at else None,
        },
        "listings": [
            {
                "id": p.id,
                "title": p.title,
                "price": p.price,
                "transaction_type": p.transaction_type.value if hasattr(p.transaction_type, "value") else str(p.transaction_type),
                "category": p.category,
                "condition": p.condition,
                "image_urls": p.image_urls or [],
                "status": p.status.value if hasattr(p.status, "value") else str(p.status),
                "created_at": str(p.created_at) if p.created_at else None,
            }
            for p in listings
        ],
        "reviews": [
            {
                "id": r.id,
                "rating": r.rating,
                "comment": r.comment,
                "reviewer_name": reviewers.get(r.reviewer_id, None) and reviewers[r.reviewer_id].full_name or "Anonymous",
                "created_at": str(r.created_at) if r.created_at else None,
            }
            for r in reviews
        ],
    }
