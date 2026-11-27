"""Schedule listing and rental reminders once per expiry or due date."""

import asyncio
from datetime import datetime, timedelta, timezone
import logging

from sqlalchemy import or_

from app.core.database import SessionLocal
from app.models.product import Product, ProductStatus
from app.models.transaction import Transaction, TransactionState
from app.routers.notifications import create_notification
from app.routers.products import LISTING_LIFETIME

logger = logging.getLogger(__name__)


def check_reminders():
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        listings = db.query(Product).filter(
            Product.status == ProductStatus.ACTIVE,
            Product.expiry_reminded.is_(False),
            Product.created_at <= now - LISTING_LIFETIME + timedelta(days=7),
        ).order_by(Product.id).limit(100).all()
        for product in listings:
            claimed = db.query(Product).filter(
                Product.id == product.id, Product.created_at == product.created_at,
                Product.status == ProductStatus.ACTIVE, Product.expiry_reminded.is_(False),
            ).update({Product.expiry_reminded: True}, synchronize_session=False)
            if claimed:
                create_notification(db, product.seller_id, "LISTING_EXPIRY", "Renew your listing",
                                    product.title + " is expiring soon or has expired.",
                                    f"/listings/{product.id}")
        db.commit()
        eligible = (
            Transaction.state == TransactionState.COMPLETED, Transaction.rental_returned.is_(False),
            Transaction.rental_due_date <= now + timedelta(days=2),
            or_(Transaction.rental_reminder_for.is_(None),
                Transaction.rental_reminder_for != Transaction.rental_due_date),
        )
        rentals = db.query(Transaction).filter(*eligible).order_by(Transaction.id).limit(100).all()
        for rental in rentals:
            claimed = db.query(Transaction).filter(
                Transaction.id == rental.id, Transaction.rental_due_date == rental.rental_due_date,
                *eligible,
            ).update({Transaction.rental_reminder_for: Transaction.rental_due_date}, synchronize_session=False)
            if claimed:
                for user_id in (rental.buyer_id, rental.seller_id):
                    create_notification(db, user_id, "RENTAL_DUE", "Rental return reminder",
                                        f"Rental #{rental.id} is due {rental.rental_due_date:%d %b %Y}.", "/deals")
        db.commit()


async def run_reminders():
    while True:
        try:
            await asyncio.to_thread(check_reminders)
        except Exception:
            logger.exception("Reminder scan failed")
        await asyncio.sleep(60)
