import json
import math
import sqlite3
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import StaticPool
from sqlalchemy.ext.compiler import compiles
from geoalchemy2 import Geography
from sqlalchemy.types import ARRAY

from app.core.config import settings

Base = declarative_base()

# SQLite shims for Geography and ARRAY types (enables local execution without Docker)
@compiles(Geography, "sqlite")
def compile_geography(element, compiler, **kw):
    return "TEXT"


@compiles(ARRAY, "sqlite")
def compile_array(element, compiler, **kw):
    return "TEXT"


sqlite3.register_adapter(list, lambda val: json.dumps(val))


def _haversine(lon1, lat1, lon2, lat2):
    try:
        lon1, lat1, lon2, lat2 = float(lon1), float(lat1), float(lon2), float(lat2)
    except (ValueError, TypeError):
        return 0.0
    R = 6371000  # meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_pt(pt_str):
    if not pt_str or not isinstance(pt_str, str):
        return 0.0, 0.0
    if ":" in pt_str:
        parts = pt_str.split(":")
        return float(parts[0]), float(parts[1])
    return 0.0, 0.0


def register_sqlite_functions(dbapi_connection, connection_record=None):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.close()

    dbapi_connection.create_function("CreateSpatialIndex", 2, lambda a, b: 1)
    dbapi_connection.create_function("InitSpatialMetaData", 0, lambda: 1)
    dbapi_connection.create_function("AsBinary", 1, lambda a: a.encode("utf-8") if isinstance(a, str) else (a or b""))
    dbapi_connection.create_function("GeomFromWKB", 1, lambda a: a.decode("utf-8") if isinstance(a, bytes) else (a or ""))
    dbapi_connection.create_function("GeomFromText", 1, lambda a: a)
    dbapi_connection.create_function("ST_GeogFromText", 1, lambda a: a)
    dbapi_connection.create_function("ST_GeomFromText", 1, lambda a: a)
    dbapi_connection.create_function("ST_GeogFromWKB", 1, lambda a: a)
    dbapi_connection.create_function("ST_AsBinary", 1, lambda a: a.encode("utf-8") if isinstance(a, str) else (a or b""))
    dbapi_connection.create_function("ST_AsText", 1, lambda a: a if isinstance(a, str) else (a.decode("utf-8", "ignore") if isinstance(a, bytes) else str(a)))
    dbapi_connection.create_function("ST_SetSRID", 2, lambda a, b: a)
    dbapi_connection.create_function("ST_MakePoint", 2, lambda lng, lat: f"{lng}:{lat}")
    dbapi_connection.create_function("ST_Distance", 2, lambda a, b: _haversine(*_parse_pt(a), *_parse_pt(b)))
    dbapi_connection.create_function("ST_DWithin", 3, lambda a, b, dist: 1 if _haversine(*_parse_pt(a), *_parse_pt(b)) <= float(dist) else 0)


is_sqlite = settings.DATABASE_URL.startswith("sqlite")
if is_sqlite:
    connect_args = {"check_same_thread": False}
    engine_kwargs = {"poolclass": StaticPool} if settings.DATABASE_URL in {"sqlite://", "sqlite:///:memory:"} else {}
else:
    connect_args = {}
    engine_kwargs = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_size": 30,
        "max_overflow": 50,
        "pool_timeout": 30,
    }

engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, **engine_kwargs)


def register_pg_session_settings(dbapi_connection, connection_record=None):
    """Enforces query and idle transaction timeouts to prevent connection starvation under massive concurrency."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("SET statement_timeout = '15s';")
        cursor.execute("SET idle_in_transaction_session_timeout = '30s';")
    except Exception:
        pass
    finally:
        cursor.close()


if is_sqlite:
    event.listens_for(engine, "connect")(register_sqlite_functions)
else:
    event.listens_for(engine, "connect")(register_pg_session_settings)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    """Bootstrap local SQLite. PostgreSQL is migrated by Alembic before startup."""
    if is_sqlite:
        Base.metadata.create_all(bind=engine)
        ensure_schema_migrations()


def ensure_schema_migrations():
    """Lightweight auto-migration for newly added model columns and tables."""
    try:
        from sqlalchemy import text
        with engine.connect() as conn:
            if is_sqlite:
                result = conn.execute(text("PRAGMA table_info(users)")).fetchall()
                cols = [r[1] for r in result]
                if "session_version" not in cols and cols:
                    conn.execute(text("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0"))
                if "avatar_url" not in cols and len(cols) > 0:
                    conn.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR"))

                prod_result = conn.execute(text("PRAGMA table_info(products)")).fetchall()
                prod_cols = [r[1] for r in prod_result]
                if "expiry_reminded" not in prod_cols and prod_cols:
                    conn.execute(text("ALTER TABLE products ADD COLUMN expiry_reminded BOOLEAN NOT NULL DEFAULT 0"))
                if "has_3d" not in prod_cols and len(prod_cols) > 0:
                    conn.execute(text("ALTER TABLE products ADD COLUMN has_3d BOOLEAN DEFAULT 0"))
                if "image_angles" not in prod_cols and len(prod_cols) > 0:
                    conn.execute(text("ALTER TABLE products ADD COLUMN image_angles TEXT"))

                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS push_subscriptions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        endpoint TEXT NOT NULL UNIQUE,
                        p256dh TEXT,
                        auth TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))

                # Auto-migrate rental fields on transactions
                tx_result = conn.execute(text("PRAGMA table_info(transactions)")).fetchall()
                tx_cols = [r[1] for r in tx_result]
                if "rental_reminder_for" not in tx_cols and tx_cols:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN rental_reminder_for TIMESTAMP"))
                if "rental_extension_days" not in tx_cols and tx_cols:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN rental_extension_days INTEGER"))
                if "buyer_condition_photo" not in tx_cols and tx_cols:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN buyer_condition_photo BLOB"))
                if "seller_condition_photo" not in tx_cols and tx_cols:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN seller_condition_photo BLOB"))
                if "rental_returned" not in tx_cols and len(tx_cols) > 0:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN rental_returned BOOLEAN DEFAULT 0"))
                if "rental_return_date" not in tx_cols and len(tx_cols) > 0:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN rental_return_date TIMESTAMP"))
                if "rental_due_date" not in tx_cols and len(tx_cols) > 0:
                    conn.execute(text("ALTER TABLE transactions ADD COLUMN rental_due_date TIMESTAMP"))

                # Auto-create saved_products wishlist table
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS saved_products (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        product_id INTEGER NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_id, product_id)
                    )
                """))
                conn.commit()
            # Keep indexes in older SQLite databases aligned with the models.
            index_sqls = [
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_deal_per_product ON transactions(product_id) WHERE state = 'CONFIRMED'",
                "CREATE INDEX IF NOT EXISTS ix_products_status_created_at ON products(status, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_products_status_category ON products(status, category)",
                "CREATE INDEX IF NOT EXISTS ix_products_seller_status ON products(seller_id, status)",
                "CREATE INDEX IF NOT EXISTS ix_products_created_at ON products(created_at)",
                "CREATE INDEX IF NOT EXISTS ix_saved_products_user_created ON saved_products(user_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_transactions_buyer_updated ON transactions(buyer_id, updated_at)",
                "CREATE INDEX IF NOT EXISTS ix_transactions_seller_updated ON transactions(seller_id, updated_at)",
                "CREATE INDEX IF NOT EXISTS ix_transactions_buyer_state ON transactions(buyer_id, state)",
                "CREATE INDEX IF NOT EXISTS ix_transactions_seller_state ON transactions(seller_id, state)",
                "CREATE INDEX IF NOT EXISTS ix_transactions_product_state ON transactions(product_id, state)",
                "CREATE INDEX IF NOT EXISTS ix_transactions_created_at ON transactions(created_at)",
                "CREATE INDEX IF NOT EXISTS ix_offers_tx_created ON offers(transaction_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_conversations_user_a ON conversations(user_a_id)",
                "CREATE INDEX IF NOT EXISTS ix_conversations_user_b ON conversations(user_b_id)",
                "CREATE INDEX IF NOT EXISTS ix_conversations_product ON conversations(product_id)",
                "CREATE INDEX IF NOT EXISTS ix_conversations_created ON conversations(created_at)",
                "CREATE INDEX IF NOT EXISTS ix_messages_convo_created ON messages(conversation_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_messages_convo_sender_read ON messages(conversation_id, sender_id, read)",
                "CREATE INDEX IF NOT EXISTS ix_notifications_user_created ON notifications(user_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications(user_id, is_read)",
                "CREATE INDEX IF NOT EXISTS ix_users_is_verified ON users(is_verified)",
                "CREATE INDEX IF NOT EXISTS ix_users_is_blocked ON users(is_blocked_flag)",
                "CREATE INDEX IF NOT EXISTS ix_reviews_reviewee_created ON reviews(reviewee_id, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_reports_resolved_created ON reports(resolved, created_at)",
                "CREATE INDEX IF NOT EXISTS ix_blocks_blocker_blocked ON blocks(blocker_id, blocked_id)",
            ]
            for idx_sql in index_sqls:
                try:
                    conn.execute(text(idx_sql))
                except Exception:
                    pass
            conn.commit()
    except Exception:
        pass


# Note: init_db() is called by the application entrypoint (main.py) to prevent redundant double initialization during imports/tests.



def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
