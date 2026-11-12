from sqlalchemy import Column, Integer, DateTime, ForeignKey, func, Text, CheckConstraint, UniqueConstraint, Index

from app.core.database import Base


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating >= 1 AND rating <= 5"),
        UniqueConstraint("transaction_id", "reviewer_id", name="uq_transaction_reviewer"),
        Index("ix_reviews_reviewee_created", "reviewee_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    reviewee_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    rating = Column(Integer, nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
