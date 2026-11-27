"""Version marketplace schema additions and reservation invariants."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

COLUMNS = {
    "users": {"avatar_url": "VARCHAR", "session_version": "INTEGER NOT NULL DEFAULT 0"},
    "products": {"embedding": "TEXT", "has_3d": "BOOLEAN DEFAULT FALSE", "image_angles": "TEXT",
                 "expiry_reminded": "BOOLEAN NOT NULL DEFAULT FALSE"},
    "transactions": {"rental_returned": "BOOLEAN NOT NULL DEFAULT FALSE",
                     "rental_return_date": "TIMESTAMPTZ", "rental_due_date": "TIMESTAMPTZ",
                     "rental_reminder_for": "TIMESTAMPTZ", "rental_extension_days": "INTEGER",
                     "buyer_condition_photo": "BYTEA", "seller_condition_photo": "BYTEA"},
}
PRICES = (("products", "price"), ("products", "ai_suggested_price"),
          ("transactions", "agreed_price"), ("offers", "amount"))


INDEXES = (
    'CREATE INDEX IF NOT EXISTS ix_products_status_created_at ON products(status, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_products_status_category ON products(status, category)',
    'CREATE INDEX IF NOT EXISTS ix_products_seller_status ON products(seller_id, status)',
    'CREATE INDEX IF NOT EXISTS ix_products_created_at ON products(created_at)',
    'CREATE INDEX IF NOT EXISTS ix_saved_products_user_created ON saved_products(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_transactions_buyer_updated ON transactions(buyer_id, updated_at)',
    'CREATE INDEX IF NOT EXISTS ix_transactions_seller_updated ON transactions(seller_id, updated_at)',
    'CREATE INDEX IF NOT EXISTS ix_transactions_buyer_state ON transactions(buyer_id, state)',
    'CREATE INDEX IF NOT EXISTS ix_transactions_seller_state ON transactions(seller_id, state)',
    'CREATE INDEX IF NOT EXISTS ix_transactions_product_state ON transactions(product_id, state)',
    'CREATE INDEX IF NOT EXISTS ix_transactions_created_at ON transactions(created_at)',
    'CREATE INDEX IF NOT EXISTS ix_offers_tx_created ON offers(transaction_id, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_conversations_user_a ON conversations(user_a_id)',
    'CREATE INDEX IF NOT EXISTS ix_conversations_user_b ON conversations(user_b_id)',
    'CREATE INDEX IF NOT EXISTS ix_conversations_product ON conversations(product_id)',
    'CREATE INDEX IF NOT EXISTS ix_conversations_created ON conversations(created_at)',
    'CREATE INDEX IF NOT EXISTS ix_messages_convo_created ON messages(conversation_id, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_messages_convo_sender_read ON messages(conversation_id, sender_id, read)',
    'CREATE INDEX IF NOT EXISTS ix_notifications_user_created ON notifications(user_id, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_notifications_user_read ON notifications(user_id, is_read)',
    'CREATE INDEX IF NOT EXISTS ix_users_is_verified ON users(is_verified)',
    'CREATE INDEX IF NOT EXISTS ix_users_is_blocked ON users(is_blocked_flag)',
    'CREATE INDEX IF NOT EXISTS ix_reviews_reviewee_created ON reviews(reviewee_id, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_reports_resolved_created ON reports(resolved, created_at)',
    'CREATE INDEX IF NOT EXISTS ix_blocks_blocker_blocked ON blocks(blocker_id, blocked_id)',
)


def upgrade():
    op.execute("ALTER TYPE productstatus ADD VALUE IF NOT EXISTS 'RENTED'")
    op.execute("""
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            type VARCHAR NOT NULL,
            title VARCHAR NOT NULL,
            message TEXT,
            link VARCHAR,
            is_read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint VARCHAR NOT NULL UNIQUE,
            p256dh VARCHAR,
            auth VARCHAR,
            created_at TIMESTAMPTZ DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS saved_products (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE (user_id, product_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user_id ON push_subscriptions (user_id)")
    for table, columns in COLUMNS.items():
        for column, column_type in columns.items():
            op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {column_type}")
    for table, column in PRICES:
        op.alter_column(table, column, type_=sa.Numeric(12, 2), postgresql_using=f"ROUND({column}::numeric, 2)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_confirmed_deal_per_product ON transactions (product_id) WHERE state = 'CONFIRMED'")
    op.execute("ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_transaction_id_key")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_transaction_reviewer ON reviews (transaction_id, reviewer_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_blocker_blocked ON blocks (blocker_id, blocked_id)")
    for statement in INDEXES:
        op.execute(statement)


def downgrade():
    op.drop_index("uq_confirmed_deal_per_product", table_name="transactions")
    for table, column in PRICES:
        op.alter_column(table, column, type_=sa.Float())
    for table, columns in {
        "users": ("session_version",), "products": ("expiry_reminded",),
        "transactions": ("rental_reminder_for", "rental_extension_days",
                         "buyer_condition_photo", "seller_condition_photo"),
    }.items():
        for column in columns:
            op.drop_column(table, column)
