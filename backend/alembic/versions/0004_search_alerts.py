"""Account-owned search alerts and notification preferences."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_searches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column("q", sa.String(150)), sa.Column("category", sa.String(60)),
        sa.Column("transaction_type", sa.String(12)), sa.Column("condition", sa.String(50)),
        sa.Column("college", sa.String(150)), sa.Column("min_price", sa.Numeric(12, 2)),
        sa.Column("max_price", sa.Numeric(12, 2)), sa.Column("has_3d", sa.Boolean),
        sa.Column("lat", sa.Float), sa.Column("lng", sa.Float), sa.Column("radius_km", sa.Integer),
        sa.UniqueConstraint("user_id", "signature", name="uq_saved_search_criteria"),
    )
    op.create_table(
        "muted_notifications",
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("category", sa.String(32), primary_key=True),
    )
    if op.get_context().dialect.name == "postgresql":
        # All access goes through the backend's authenticated session and database role.
        op.execute("ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY")
        op.execute("ALTER TABLE muted_notifications ENABLE ROW LEVEL SECURITY")


def downgrade():
    op.drop_table("muted_notifications")
    op.drop_table("saved_searches")
