from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, func, Text, Index

from app.core.database import Base


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index("ix_notifications_user_read", "user_id", "is_read"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String, nullable=False)  # OFFER_RECEIVED, OFFER_ACCEPTED, DEAL_CONFIRMED, DEAL_COMPLETED, NEW_MESSAGE, REVIEW_RECEIVED
    title = Column(String, nullable=False)
    message = Column(Text, nullable=True)
    link = Column(String, nullable=True)  # URL to navigate to
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String, unique=True, nullable=False, index=True)
    p256dh = Column(String, nullable=True)
    auth = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
