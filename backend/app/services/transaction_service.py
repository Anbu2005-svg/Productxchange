from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.transaction import Transaction, TransactionState, Offer, VALID_TRANSITIONS
from app.models.product import ProductStatus
from app.models.user import User
from app.routers.notifications import create_notification
from app.core.email import send_transactional_email


class TransactionService:
    """
    Central service for all transaction state transitions.
    Buy/Exchange/Rent/Donate all reuse this state machine.
    """

    def __init__(self, db: Session):
        self.db = db

    def _assert_transition(self, current: TransactionState, target: TransactionState):
        allowed = VALID_TRANSITIONS.get(current, set())
        if target not in allowed:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot move transaction from {current} to {target}",
            )

    def _get_last_offer(self, tx: Transaction) -> Offer | None:
        return (
            self.db.query(Offer)
            .filter(Offer.transaction_id == tx.id)
            .order_by(Offer.created_at.desc(), Offer.id.desc())
            .first()
        )

    def _assert_can_respond_to_offer(self, tx: Transaction, actor_id: int):
        last_offer = self._get_last_offer(tx)
        if last_offer:
            if actor_id == last_offer.proposed_by_id:
                raise HTTPException(
                    status_code=403,
                    detail="Cannot accept, reject, or counter your own offer. Awaiting response from the other party.",
                )
        else:
            # If no offers recorded yet, the buyer initiated the transaction, so only the seller can respond
            if actor_id != tx.seller_id:
                raise HTTPException(
                    status_code=403,
                    detail="Only the seller can respond to the initial transaction request.",
                )

    def create(self, product_id: int, buyer_id: int, seller_id: int,
               offer_amount: float | None, rental_period_days: int | None,
               notes: str | None) -> Transaction:
        tx = Transaction(
            product_id=product_id,
            buyer_id=buyer_id,
            seller_id=seller_id,
            state=TransactionState.PENDING,
            agreed_price=offer_amount,
            rental_period_days=rental_period_days,
            notes=notes,
            buyer_completed=False,
            seller_completed=False,
        )
        self.db.add(tx)
        self.db.commit()
        self.db.refresh(tx)
        if offer_amount is not None:
            self.db.add(Offer(transaction_id=tx.id, proposed_by_id=buyer_id, amount=offer_amount))
            self.db.commit()
        create_notification(
            self.db, seller_id, "OFFER_RECEIVED",
            "New offer received!",
            f"You received an offer of ₹{offer_amount or 0} on your listing.",
            "/deals"
        )
        self._send_notification_email(
            seller_id,
            "New Offer Received",
            f"You received an offer of ₹{offer_amount or 0} on your campus listing."
        )
        self.db.commit()
        return tx

    def _send_notification_email(self, user_id: int, subject: str, message: str):
        try:
            target_user = self.db.query(User).filter(User.id == user_id).first()
            if target_user and target_user.email:
                send_transactional_email(
                    to_email=target_user.email,
                    subject=f"[ProductXchange] {subject}",
                    text_content=f"Hello,\n\n{message}\n\nView deal details at http://localhost:3000/deals\n\n— ProductXchange Campus Platform"
                )
        except Exception:
            pass

    def accept(self, tx: Transaction, actor_id: int) -> Transaction:
        self._assert_transition(tx.state, TransactionState.ACCEPTED)
        self._assert_can_respond_to_offer(tx, actor_id)
        tx.state = TransactionState.ACCEPTED
        notify_id = tx.buyer_id if actor_id == tx.seller_id else tx.seller_id
        create_notification(
            self.db, notify_id, "OFFER_ACCEPTED",
            "Your offer was accepted! 🎉",
            "The other party accepted your deal. Confirm to unlock the pickup location.",
            "/deals"
        )
        self._send_notification_email(
            notify_id,
            "Offer Accepted! 🎉",
            "Your offer has been accepted! Please confirm the deal to unlock the campus meetup point."
        )
        self.db.commit()
        self.db.refresh(tx)
        return tx

    def reject(self, tx: Transaction, actor_id: int) -> Transaction:
        self._assert_transition(tx.state, TransactionState.REJECTED)
        self._assert_can_respond_to_offer(tx, actor_id)
        tx.state = TransactionState.REJECTED
        notify_id = tx.buyer_id if actor_id == tx.seller_id else tx.seller_id
        create_notification(
            self.db, notify_id, "OFFER_REJECTED",
            "Offer Declined",
            "The other party has declined your transaction offer.",
            "/deals"
        )
        self.db.commit()
        self.db.refresh(tx)
        return tx

    def counter(self, tx: Transaction, actor_id: int, amount: float, message: str | None) -> Transaction:
        self._assert_transition(tx.state, TransactionState.COUNTERED)
        self._assert_can_respond_to_offer(tx, actor_id)
        tx.state = TransactionState.COUNTERED
        tx.agreed_price = amount
        self.db.add(Offer(transaction_id=tx.id, proposed_by_id=actor_id, amount=amount, message=message))
        notify_id = tx.buyer_id if actor_id == tx.seller_id else tx.seller_id
        create_notification(
            self.db, notify_id, "COUNTER_OFFER",
            "New Counter-Offer",
            f"A counter-offer of ₹{amount} has been proposed.",
            "/deals"
        )
        self.db.commit()
        self.db.refresh(tx)
        return tx

    def confirm(self, tx: Transaction, actor_id: int) -> Transaction:
        self._assert_transition(tx.state, TransactionState.CONFIRMED)
        if actor_id not in (tx.buyer_id, tx.seller_id):
            raise HTTPException(status_code=403, detail="Not a party to this transaction")
        tx.state = TransactionState.CONFIRMED
        # Anti ghost-deal / double-booking: lock listing status to PENDING handover
        if tx.product and tx.product.status == ProductStatus.ACTIVE:
            tx.product.status = ProductStatus.PENDING
        notify_id = tx.buyer_id if actor_id == tx.seller_id else tx.seller_id
        create_notification(
            self.db, notify_id, "DEAL_CONFIRMED",
            "Deal confirmed! 🔓",
            "Pickup location has been unlocked. Meet up and complete the handover.",
            "/deals"
        )
        self._send_notification_email(
            notify_id,
            "Meetup Location Unlocked! 🔓",
            "The deal has been confirmed and pickup location is unlocked. Meet up safely and verify your handshake PIN to complete the handover."
        )
        self.db.commit()
        self.db.refresh(tx)
        return tx

    def complete(self, tx: Transaction, actor_id: int) -> Transaction:
        if tx.state != TransactionState.CONFIRMED:
            raise HTTPException(
                status_code=409,
                detail=f"Cannot complete transaction in {tx.state} state. It must be CONFIRMED first.",
            )
        if actor_id == tx.buyer_id:
            tx.buyer_completed = True
        elif actor_id == tx.seller_id:
            tx.seller_completed = True
        else:
            raise HTTPException(status_code=403, detail="Not a party to this transaction")

        # Double-party completion: requires both buyer and seller to mark complete
        if tx.buyer_completed and tx.seller_completed:
            self._assert_transition(tx.state, TransactionState.COMPLETED)
            tx.state = TransactionState.COMPLETED
            if tx.product:
                is_rent = str(getattr(tx.product, "transaction_type", "")).upper() in ("RENT", "TRANSACTIONTYPE.RENT")
                if is_rent:
                    tx.product.status = ProductStatus.RENTED
                    from datetime import datetime, timezone, timedelta
                    period_days = tx.rental_period_days or 30
                    tx.rental_due_date = datetime.now(timezone.utc) + timedelta(days=period_days)
                    tx.rental_returned = False
                else:
                    tx.product.status = ProductStatus.SOLD
            # Notify both parties
            create_notification(
                self.db, tx.buyer_id, "DEAL_COMPLETED",
                "Deal completed! 🤝",
                "Both parties have confirmed the handover. Don't forget to leave a review!",
                "/deals"
            )
            create_notification(
                self.db, tx.seller_id, "DEAL_COMPLETED",
                "Deal completed! 🤝",
                "Both parties have confirmed the handover. Don't forget to leave a review!",
                "/deals"
            )

        self.db.commit()
        self.db.refresh(tx)
        return tx

    def return_rental_item(self, tx: Transaction, actor_id: int) -> Transaction:
        """
        Completes the physical return of a rented campus item.
        Restores listing to ACTIVE in the circular campus marketplace.
        """
        if actor_id not in (tx.buyer_id, tx.seller_id):
            raise HTTPException(status_code=403, detail="Not a party to this transaction")
        if tx.state != TransactionState.COMPLETED:
            raise HTTPException(status_code=400, detail="Transaction must be completed before returning item")
        if not tx.product or str(getattr(tx.product, "transaction_type", "")).upper() not in ("RENT", "TRANSACTIONTYPE.RENT"):
            raise HTTPException(status_code=400, detail="Only rental transactions can be returned")
        if tx.rental_returned:
            raise HTTPException(status_code=400, detail="Rental item has already been marked returned")

        from datetime import datetime, timezone
        tx.rental_returned = True
        tx.rental_return_date = datetime.now(timezone.utc)
        tx.product.status = ProductStatus.ACTIVE

        # Notify both parties
        create_notification(
            self.db, tx.buyer_id, "RENTAL_RETURNED",
            "Rental Item Returned 🔄",
            f"The rental item '{tx.product.title}' has been returned and re-listed on campus.",
            "/deals"
        )
        create_notification(
            self.db, tx.seller_id, "RENTAL_RETURNED",
            "Rental Item Returned 🔄",
            f"Your item '{tx.product.title}' has been safely returned and is active for other students.",
            "/deals"
        )
        self._send_notification_email(
            tx.seller_id,
            "Rental Item Returned 🔄",
            f"Your rental item '{tx.product.title}' has been safely returned and restored to active campus discovery."
        )
        self.db.commit()
        self.db.refresh(tx)
        return tx

    def cancel(self, tx: Transaction, actor_id: int) -> Transaction:
        self._assert_transition(tx.state, TransactionState.CANCELLED)
        if actor_id not in (tx.buyer_id, tx.seller_id):
            raise HTTPException(status_code=403, detail="Not a party to this transaction")
        tx.state = TransactionState.CANCELLED
        # Revert listing status back to ACTIVE if it was PENDING handover for this deal
        if tx.product and tx.product.status == ProductStatus.PENDING:
            other_confirmed = self.db.query(Transaction).filter(
                Transaction.product_id == tx.product_id,
                Transaction.id != tx.id,
                Transaction.state == TransactionState.CONFIRMED,
            ).first()
            if not other_confirmed:
                tx.product.status = ProductStatus.ACTIVE
        notify_id = tx.buyer_id if actor_id == tx.seller_id else tx.seller_id
        create_notification(
            self.db, notify_id, "DEAL_CANCELLED",
            "Deal cancelled",
            "The other party has cancelled this transaction.",
            "/deals"
        )
        self.db.commit()
        self.db.refresh(tx)
        return tx
