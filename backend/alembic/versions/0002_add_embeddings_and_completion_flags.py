"""Add embedding column and transaction completion flags

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-29

"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # Transaction completion flags
    op.add_column(
        "transactions",
        sa.Column("buyer_completed", sa.Boolean(), server_default=sa.text("false"), nullable=False)
    )
    op.add_column(
        "transactions",
        sa.Column("seller_completed", sa.Boolean(), server_default=sa.text("false"), nullable=False)
    )

    # pgvector embedding column for semantic search (if extension exists)
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
                    ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(1024);
                    CREATE INDEX IF NOT EXISTS idx_products_embedding_hnsw ON products USING hnsw (embedding vector_cosine_ops);
                END IF;
            END $$;
        """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_products_embedding_hnsw")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS embedding")
    op.drop_column("transactions", "seller_completed")
    op.drop_column("transactions", "buyer_completed")
