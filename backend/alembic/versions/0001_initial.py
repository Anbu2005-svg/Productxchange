"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-27

"""
from alembic import op
import sqlalchemy as sa
import geoalchemy2

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
                CREATE EXTENSION IF NOT EXISTS vector;
            END IF;
        END $$;
    """)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("email", sa.String, unique=True, index=True, nullable=False),
        sa.Column("phone", sa.String, unique=True, index=True, nullable=True),
        sa.Column("password_hash", sa.String, nullable=False),
        sa.Column("full_name", sa.String, nullable=True),
        sa.Column("college", sa.String, nullable=True),
        sa.Column("verification_method", sa.String, nullable=True),
        sa.Column("is_verified", sa.Boolean, default=False),
        sa.Column("is_admin", sa.Boolean, default=False),
        sa.Column("is_blocked_flag", sa.Boolean, default=False),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("location", geoalchemy2.Geography(geometry_type="POINT", srid=4326), nullable=True),
        sa.Column("location_radius_pref_km", sa.Integer, default=10),
        sa.Column("avg_rating", sa.Float, default=0.0),
        sa.Column("rating_count", sa.Integer, default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("seller_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("category", sa.String, index=True, nullable=False),
        sa.Column("condition", sa.String, nullable=True),
        sa.Column("price", sa.Float, nullable=True),
        sa.Column("transaction_type", sa.Enum("BUY", "EXCHANGE", "RENT", "DONATE", name="transactiontype"), nullable=False, index=True),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("location", geoalchemy2.Geography(geometry_type="POINT", srid=4326), nullable=True),
        sa.Column("pickup_area", sa.String, nullable=True),
        sa.Column("image_urls", sa.ARRAY(sa.String), default=list),
        sa.Column("status", sa.Enum("ACTIVE", "PENDING", "SOLD", "REMOVED", name="productstatus"), default="ACTIVE", index=True),
        sa.Column("ai_suggested_category", sa.String, nullable=True),
        sa.Column("ai_suggested_price", sa.Float, nullable=True),
        sa.Column("ai_suggested_description", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    # Critical for /products/nearby performance at scale — geography column needs a GIST index.
    op.execute("CREATE INDEX idx_products_location ON products USING GIST (location)")
    op.execute("CREATE INDEX idx_users_location ON users USING GIST (location)")

    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False, index=True),
        sa.Column("buyer_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("seller_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("state", sa.Enum("PENDING", "ACCEPTED", "REJECTED", "COUNTERED", "CONFIRMED", "COMPLETED", "CANCELLED", name="transactionstate"), default="PENDING", index=True),
        sa.Column("agreed_price", sa.Float, nullable=True),
        sa.Column("rental_period_days", sa.Integer, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "offers",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("transaction_id", sa.Integer, sa.ForeignKey("transactions.id"), nullable=False, index=True),
        sa.Column("proposed_by_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("amount", sa.Float, nullable=False),
        sa.Column("message", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=True),
        sa.Column("user_a_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("user_b_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("conversation_id", sa.Integer, sa.ForeignKey("conversations.id"), nullable=False, index=True),
        sa.Column("sender_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("image_url", sa.String, nullable=True),
        sa.Column("is_offer_message", sa.Boolean, default=False),
        sa.Column("read", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "reviews",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("transaction_id", sa.Integer, sa.ForeignKey("transactions.id"), nullable=False, unique=True),
        sa.Column("reviewer_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reviewee_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("rating", sa.Integer, nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.CheckConstraint("rating >= 1 AND rating <= 5", name="rating_range"),
    )

    op.create_table(
        "reports",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("reporter_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("reported_user_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reported_product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=True),
        sa.Column("reason", sa.String, nullable=False),
        sa.Column("details", sa.Text, nullable=True),
        sa.Column("resolved", sa.Boolean, default=False),
        sa.Column("admin_notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "blocks",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("blocker_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("blocked_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("blocks")
    op.drop_table("reports")
    op.drop_table("reviews")
    op.drop_table("messages")
    op.drop_table("conversations")
    op.drop_table("offers")
    op.drop_table("transactions")
    op.drop_table("products")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS transactionstate")
    op.execute("DROP TYPE IF EXISTS productstatus")
    op.execute("DROP TYPE IF EXISTS transactiontype")
