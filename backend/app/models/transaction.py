import enum
from sqlalchemy import Column, Integer, Numeric, DateTime, ForeignKey, func, Enum, Text, Boolean, String, Index, LargeBinary, text
from sqlalchemy.orm import relationship, deferred

from app.core.database import Base


class TransactionState(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    COUNTERED = "COUNTERED"
    CONFIRMED = "CONFIRMED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


# Valid transitions enforced in services/transaction_service.py
VALID_TRANSITIONS = {
    TransactionState.PENDING: {TransactionState.ACCEPTED, TransactionState.REJECTED, TransactionState.COUNTERED, TransactionState.CANCELLED},
    TransactionState.COUNTERED: {TransactionState.ACCEPTED, TransactionState.REJECTED, TransactionState.COUNTERED, TransactionState.CANCELLED},
    TransactionState.ACCEPTED: {TransactionState.CONFIRMED, TransactionState.CANCELLED},
    TransactionState.CONFIRMED: {TransactionState.COMPLETED, TransactionState.CANCELLED},
    TransactionState.REJECTED: set(),
    TransactionState.COMPLETED: set(),
    TransactionState.CANCELLED: set(),
}


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        Index("ix_transactions_buyer_updated", "buyer_id", "updated_at"),
        Index("ix_transactions_seller_updated", "seller_id", "updated_at"),
        Index("ix_transactions_buyer_state", "buyer_id", "state"),
        Index("ix_transactions_seller_state", "seller_id", "state"),
        Index("ix_transactions_product_state", "product_id", "state"),
        Index("ix_transactions_created_at", "created_at"),
        Index("uq_confirmed_deal_per_product", "product_id", unique=True,
              postgresql_where=text("state = 'CONFIRMED'"), sqlite_where=text("state = 'CONFIRMED'")),
    )

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    buyer_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    seller_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    state = Column(Enum(TransactionState), default=TransactionState.PENDING, index=True)
    agreed_price = Column(Numeric(12, 2), nullable=True)
    rental_period_days = Column(Integer, nullable=True)  # for RENT type
    notes = Column(Text, nullable=True)
    buyer_completed = Column(Boolean, default=False, nullable=False)
    seller_completed = Column(Boolean, default=False, nullable=False)

    # Rental lifecycle tracking
    rental_returned = Column(Boolean, default=False, nullable=False)
    rental_return_date = Column(DateTime(timezone=True), nullable=True)
    rental_due_date = Column(DateTime(timezone=True), nullable=True)
    rental_reminder_for = Column(DateTime(timezone=True), nullable=True)
    rental_extension_days = Column(Integer, nullable=True)
    buyer_condition_photo = deferred(Column(LargeBinary, nullable=True))
    seller_condition_photo = deferred(Column(LargeBinary, nullable=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    product = relationship("Product")
    buyer = relationship("User", foreign_keys=[buyer_id])
    seller = relationship("User", foreign_keys=[seller_id])
    offers = relationship("Offer", back_populates="transaction", order_by="Offer.created_at")


class Offer(Base):
    __tablename__ = "offers"
    __table_args__ = (
        Index("ix_offers_tx_created", "transaction_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, index=True)
    proposed_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    message = Column(String(1000), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    transaction = relationship("Transaction", back_populates="offers")
