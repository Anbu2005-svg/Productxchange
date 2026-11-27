import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Response, File, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db, is_sqlite
from app.core.config import settings
from app.core.security import get_current_user
from app.core.rate_limit import check_rate_limit
from app.models.user import User
from app.models.product import Product, ProductStatus
from app.models.transaction import Transaction, TransactionState
from app.schemas.transaction import TransactionCreate, TransactionAction, TransactionOut, HandshakeVerify, RentalExtension, RentalDispute, ReportCreate
from app.services.transaction_service import TransactionService

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _compute_handshake_pin(tx_id: int) -> str:
    # Keyed HMAC using server secret salt so attackers cannot pre-compute handshake PINs
    h = hmac.new(settings.JWT_SECRET.encode(), f"px_handshake_{tx_id}".encode(), hashlib.sha256).hexdigest()
    return f"{int(h[:6], 16) % 900000 + 100000}"


def _tx_to_out(tx: Transaction, user: Optional[User] = None) -> TransactionOut:
    out = TransactionOut.model_validate(tx)
    # Physical Meetup Security: The handshake PIN is a secret physical handover token held ONLY by the BUYER.
    # The buyer reveals it to the seller upon receiving item. Only the buyer receives the PIN in their transaction details.
    if tx.state in (TransactionState.CONFIRMED, TransactionState.COMPLETED):
        if user and user.id == tx.buyer_id:
            out.handshake_pin = _compute_handshake_pin(tx.id)
        else:
            out.handshake_pin = None
    else:
        out.handshake_pin = None
    return out


@router.post("", response_model=TransactionOut)
def create_transaction(payload: TransactionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Lock the product row to prevent race conditions in duplicate transaction checks
    product_query = db.query(Product).filter(Product.id == payload.product_id)
    if not is_sqlite:
        product_query = product_query.with_for_update()
    product = product_query.first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if product.status != ProductStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Cannot transact on an inactive or already sold listing.")
    from app.routers.products import listing_is_expired

    if listing_is_expired(product):
        raise HTTPException(status_code=409, detail="The seller needs to renew this listing.")
    if product.seller_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot transact on your own listing")

    # Anti-harassment: Verify parties have not blocked each other
    from app.models.report import Block
    from sqlalchemy import or_, and_
    is_blocked = db.query(Block).filter(
        or_(
            and_(Block.blocker_id == user.id, Block.blocked_id == product.seller_id),
            and_(Block.blocker_id == product.seller_id, Block.blocked_id == user.id),
        )
    ).first()
    if is_blocked:
        raise HTTPException(status_code=403, detail="Cannot initiate transaction with a blocked user.")

    # Verify seller account is active
    seller = db.query(User).filter(User.id == product.seller_id).first()
    if not seller or seller.is_blocked_flag:
        raise HTTPException(status_code=400, detail="Seller account is unavailable or suspended.")

    # Prevent duplicate active transactions on the same product by the same buyer
    active_states = {
        TransactionState.PENDING,
        TransactionState.COUNTERED,
        TransactionState.ACCEPTED,
        TransactionState.CONFIRMED,
    }
    existing_tx = (
        db.query(Transaction)
        .filter(
            Transaction.product_id == product.id,
            Transaction.buyer_id == user.id,
            Transaction.state.in_(active_states),
        )
        .first()
    )
    if existing_tx:
        raise HTTPException(
            status_code=400,
            detail="You already have an active negotiation or transaction on this item.",
        )

    # Validate offer amounts per transaction type
    prod_type = product.transaction_type.value if hasattr(product.transaction_type, "value") else str(product.transaction_type)
    if prod_type == "BUY" and (payload.offer_amount is None or payload.offer_amount <= 0):
        raise HTTPException(status_code=400, detail="Offer amount must be greater than zero for buy listings.")
    if prod_type == "RENT":
        if payload.rental_period_days is None or payload.rental_period_days <= 0:
            raise HTTPException(status_code=400, detail="Rental period in days is required for rental listings.")
        if payload.offer_amount is None or payload.offer_amount <= 0:
            raise HTTPException(status_code=400, detail="Offer amount must be greater than zero for rental listings.")

    svc = TransactionService(db)
    tx = svc.create(
        product_id=product.id,
        buyer_id=user.id,
        seller_id=product.seller_id,
        offer_amount=payload.offer_amount,
        rental_period_days=payload.rental_period_days,
        notes=payload.notes,
    )
    return _tx_to_out(tx, user)


def _get_tx_or_404(tx_id: int, db: Session, for_update: bool = False) -> Transaction:
    query = db.query(Transaction).filter(Transaction.id == tx_id)
    if for_update and not is_sqlite:
        # Acquire locks in the same order as deal creation, including competing deals.
        db.query(Product.id).filter(
            Product.id == db.query(Transaction.product_id).filter(Transaction.id == tx_id).scalar_subquery()
        ).with_for_update().first()
        query = query.with_for_update()
    tx = query.first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return tx


def _assert_party(tx: Transaction, user: User):
    if user.id not in (tx.buyer_id, tx.seller_id):
        raise HTTPException(status_code=403, detail="Not a party to this transaction")


@router.post("/{tx_id}/action", response_model=TransactionOut)
def act_on_transaction(tx_id: int, payload: TransactionAction, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tx = _get_tx_or_404(tx_id, db, for_update=True)
    _assert_party(tx, user)
    svc = TransactionService(db)

    action = payload.action.lower()
    if action == "accept":
        return _tx_to_out(svc.accept(tx, user.id), user)
    if action == "reject":
        return _tx_to_out(svc.reject(tx, user.id), user)
    if action == "counter":
        if payload.counter_amount is None:
            raise HTTPException(status_code=400, detail="counter_amount required")
        if payload.counter_amount <= 0:
            raise HTTPException(status_code=400, detail="Counter amount must be greater than zero.")
        return _tx_to_out(svc.counter(tx, user.id, payload.counter_amount, payload.message), user)
    if action == "confirm":
        return _tx_to_out(svc.confirm(tx, user.id), user)
    if action == "complete":
        return _tx_to_out(svc.complete(tx, user.id), user)
    if action == "return":
        return _tx_to_out(svc.return_rental_item(tx, user.id), user)
    if action == "cancel":
        return _tx_to_out(svc.cancel(tx, user.id), user)
    raise HTTPException(status_code=400, detail=f"Unknown action: {action}")


@router.post("/{tx_id}/return", response_model=TransactionOut)
def return_rental(
    tx_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Marks a completed rental item as safely returned, restoring it to ACTIVE on campus."""
    tx = _get_tx_or_404(tx_id, db, for_update=True)
    _assert_party(tx, user)
    svc = TransactionService(db)
    returned_tx = svc.return_rental_item(tx, user.id)
    return _tx_to_out(returned_tx, user)


@router.post("/{tx_id}/verify-handshake", response_model=TransactionOut)
def verify_handshake(
    tx_id: int,
    payload: HandshakeVerify,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    In-person QR / Handshake PIN Verification:
    Both parties meet up; the buyer presents their 6-digit handshake PIN to the seller.
    The seller enters the PIN to verify receipt/handover and transition deal to COMPLETED.
    """
    tx = _get_tx_or_404(tx_id, db, for_update=True)
    _assert_party(tx, user)
    if tx.state != TransactionState.CONFIRMED:
        raise HTTPException(status_code=400, detail="Transaction must be CONFIRMED to verify handshake PIN")

    # Anti self-verification: only the seller verifies the buyer's PIN
    if user.id != tx.seller_id:
        raise HTTPException(
            status_code=403,
            detail="Only the seller can verify the buyer's handshake PIN at the physical meetup.",
        )

    # Anti brute-force rate limit: max 5 attempts per minute per transaction
    allowed, retry_after = check_rate_limit(f"handshake_verify:{tx_id}:{user.id}", 5, 60)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed PIN verification attempts. Please wait {retry_after} seconds before trying again.",
        )

    expected_pin = _compute_handshake_pin(tx.id)
    if not secrets.compare_digest(payload.pin.strip(), expected_pin):
        raise HTTPException(status_code=400, detail="Invalid Handshake PIN. Please verify code with the other party.")

    svc = TransactionService(db)
    tx.buyer_completed = True
    tx.seller_completed = True
    completed_tx = svc.complete(tx, user.id)
    return _tx_to_out(completed_tx, user)


@router.get("/mine", response_model=list[TransactionOut])
def my_transactions(
    response: Response,
    skip: int = 0,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    safe_skip = max(0, skip)
    safe_limit = min(max(1, limit), 100)
    query = db.query(Transaction).filter((Transaction.buyer_id == user.id) | (Transaction.seller_id == user.id))
    total_count = query.count()
    response.headers["X-Total-Count"] = str(total_count)

    items = query.order_by(Transaction.updated_at.desc()).offset(safe_skip).limit(safe_limit).all()
    return [_tx_to_out(t, user) for t in items]


def get_rental(tx_id: int, user: User, db: Session, *, active: bool = True):
    tx = _get_tx_or_404(tx_id, db, for_update=active)
    _assert_party(tx, user)
    if tx.state != TransactionState.COMPLETED or tx.rental_due_date is None or (active and tx.rental_returned):
        raise HTTPException(status_code=409, detail="This operation is unavailable for the rental.")
    return tx


@router.post("/{tx_id}/rental-extension", response_model=TransactionOut)
def request_extension(tx_id: int, payload: RentalExtension, user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    from app.routers.notifications import create_notification

    tx = get_rental(tx_id, user, db)
    if user.id != tx.buyer_id:
        raise HTTPException(status_code=403, detail="Only the renter can request an extension.")
    if tx.rental_extension_days is not None:
        raise HTTPException(status_code=409, detail="An extension request is already pending.")
    tx.rental_extension_days = payload.days
    create_notification(db, tx.seller_id, "RENTAL_EXTENSION", "Rental extension requested",
                        f"The renter requests {payload.days} additional days.", "/deals")
    db.commit()
    return _tx_to_out(tx, user)


@router.post("/{tx_id}/rental-extension/{decision}", response_model=TransactionOut)
def decide_extension(tx_id: int, decision: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.routers.notifications import create_notification

    tx = get_rental(tx_id, user, db)
    if user.id != tx.seller_id:
        raise HTTPException(status_code=403, detail="Only the owner can decide on an extension.")
    if decision not in {"approve", "decline"}:
        raise HTTPException(status_code=400, detail="Choose approve or decline.")
    if tx.rental_extension_days is None:
        raise HTTPException(status_code=409, detail="No extension request is pending.")
    if decision == "approve":
        tx.rental_due_date += timedelta(days=tx.rental_extension_days)
        tx.rental_period_days = (tx.rental_period_days or 30) + tx.rental_extension_days
    tx.rental_extension_days = None
    create_notification(db, tx.buyer_id, "RENTAL_EXTENSION", "Rental extension updated",
                        f"The owner chose to {decision} your request.", "/deals")
    db.commit()
    return _tx_to_out(tx, user)


@router.post("/{tx_id}/condition-photo")
def upload_condition_photo(tx_id: int, file: UploadFile = File(...), user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    from app.routers.products import _read_bounded_upload, _validate_image_bytes

    tx = get_rental(tx_id, user, db)
    content = _read_bounded_upload(file.file, 2 * 1024 * 1024)
    if file.content_type != "image/jpeg" or not _validate_image_bytes(content, ".jpg"):
        raise HTTPException(status_code=400, detail="Upload a JPEG condition photo.")
    if user.id == tx.buyer_id:
        tx.buyer_condition_photo = content
    else:
        tx.seller_condition_photo = content
    db.commit()
    return {"uploaded": True}


@router.get("/{tx_id}/condition-photo/{party}")
def get_condition_photo(tx_id: int, party: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tx = get_rental(tx_id, user, db, active=False)
    content = None
    if party == "renter":
        content = tx.buyer_condition_photo
    elif party == "owner":
        content = tx.seller_condition_photo
    if not content:
        raise HTTPException(status_code=404, detail="Condition photo not found.")
    return Response(content, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@router.post("/{tx_id}/rental-dispute")
def report_rental_dispute(tx_id: int, payload: RentalDispute, user: User = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    from app.routers.trust import create_report

    tx = get_rental(tx_id, user, db, active=False)
    other_user = tx.seller_id if user.id == tx.buyer_id else tx.buyer_id
    return create_report(ReportCreate(reported_user_id=other_user, reason="Rental dispute",
                                     details=f"Rental #{tx.id}: {payload.details}"), user, db)
