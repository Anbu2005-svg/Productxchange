import os
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
DEFAULT_SQLITE_PATH = os.path.join(BACKEND_DIR, "productxchange.db").replace("\\", "/")


class Settings(BaseSettings):
    # Core
    PROJECT_NAME: str = "ProductXchange"
    ENV: str = "development"
    CORS_ORIGINS: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    # Database (defaults to local SQLite file in backend/productxchange.db if not overridden)
    DATABASE_URL: str = f"sqlite:///{DEFAULT_SQLITE_PATH}"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # Auth
    JWT_SECRET: str = "CHANGE_ME_IN_PRODUCTION"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Storage (Standardized exclusively on Supabase BaaS Cloud Storage with Local Fallback)
    STORAGE_BACKEND: str = "supabase"  # "supabase" or "local"
    LOCAL_STORAGE_DIR: str = os.path.join(BACKEND_DIR, "uploads")

    # Supabase BaaS Integration (Primary Cloud Storage & Database)
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""
    SUPABASE_BUCKET: str = "products"

    # Discovery defaults
    DEFAULT_SEARCH_RADIUS_KM: int = 10
    MAX_SEARCH_RADIUS_KM: int = 100

    model_config = SettingsConfigDict(
        env_file=(os.path.join(BACKEND_DIR, ".env"), ".env"),
        extra="ignore"
    )


settings = Settings()

# Seamless fallback to local storage if Supabase credentials are not configured in local development
if settings.STORAGE_BACKEND == "supabase" and not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
    settings.STORAGE_BACKEND = "local"

# Security check: fail-fast if default JWT secret is used in production
if settings.ENV == "production" and (settings.JWT_SECRET in ("CHANGE_ME_IN_PRODUCTION", "anbu-productxchange-secret-key-2026") or len(settings.JWT_SECRET) < 32):
    raise ValueError("CRITICAL SECURITY ERROR: Insecure or default JWT_SECRET detected in production! Set a random 32+ character secret.")

# Normalize relative sqlite paths to always point to backend/productxchange.db
if settings.DATABASE_URL in ("sqlite:///./productxchange.db", "sqlite:///productxchange.db"):
    settings.DATABASE_URL = f"sqlite:///{DEFAULT_SQLITE_PATH}"

# Automatic Supabase / PostgreSQL URL normalizer for SQLAlchemy psycopg2
# Supabase dashboards provide URLs starting with "postgres://" or "postgresql://"
if settings.DATABASE_URL.startswith("postgres://"):
    settings.DATABASE_URL = settings.DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)
elif settings.DATABASE_URL.startswith("postgresql://") and not settings.DATABASE_URL.startswith("postgresql+"):
    settings.DATABASE_URL = settings.DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)

# Ensure SSL requirement for cloud-hosted PostgreSQL (Supabase, Neon, AWS)
if ("supabase" in settings.DATABASE_URL or "neon.tech" in settings.DATABASE_URL) and "sslmode=" not in settings.DATABASE_URL:
    delimiter = "&" if "?" in settings.DATABASE_URL else "?"
    settings.DATABASE_URL = f"{settings.DATABASE_URL}{delimiter}sslmode=require"

