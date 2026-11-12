from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, func, Text, Boolean, Index, UniqueConstraint

from app.core.database import Base


class Report(Base):
    __tablename__ = "reports"
    __table_args__ = (
        Index("ix_reports_resolved_created", "resolved", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reported_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reported_product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    reason = Column(String, nullable=False)
    details = Column(Text, nullable=True)
    resolved = Column(Boolean, default=False, index=True)
    admin_notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Block(Base):
    __tablename__ = "blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_blocker_blocked"),
        Index("ix_blocks_blocker_blocked", "blocker_id", "blocked_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    blocker_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    blocked_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
