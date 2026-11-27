"""Save discovery filters and notify each eligible student once per new listing."""

import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.notification import MutedNotification, SavedSearch
from app.models.product import Product, TransactionType
from app.models.report import Block
from app.models.user import User
from app.routers.notifications import queue_notification

router = APIRouter(prefix="/saved-searches", tags=["saved searches"])


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)
    q: str | None = Field(None, min_length=1, max_length=150)
    category: str | None = Field(None, min_length=1, max_length=60)
    transaction_type: TransactionType | None = None
    condition: str | None = Field(None, min_length=1, max_length=50)
    college: str | None = Field(None, min_length=1, max_length=150)
    min_price: float | None = Field(None, ge=0, lt=1e10, multiple_of=0.01)
    max_price: float | None = Field(None, ge=0, lt=1e10, multiple_of=0.01)
    has_3d: bool | None = None
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    radius_km: int | None = Field(None, ge=1, le=settings.MAX_SEARCH_RADIUS_KM)

    @model_validator(mode="after")
    def validate_filters(self):
        if self.min_price is not None and self.max_price is not None and self.min_price > self.max_price:
            raise ValueError("Minimum price exceeds maximum price")
        location = (self.lat, self.lng, self.radius_km)
        if any(v is not None for v in location) and None in location:
            raise ValueError("Nearby alerts require a location and a radius")
        if not self.model_dump(exclude_none=True):
            raise ValueError("Choose at least one search filter")
        return self


class SearchOut(SearchFilters):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=list[SearchOut], response_model_exclude_none=True)
def list_searches(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(SavedSearch).filter_by(user_id=user.id).order_by(SavedSearch.id.desc()).all()


@router.post("", response_model=SearchOut, response_model_exclude_none=True)
def save_search(filters: SearchFilters, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    values = filters.model_dump(mode="json", exclude_none=True)
    normalized = values.copy()
    for key in ("q", "college", "condition"):
        if key in normalized:
            normalized[key] = normalized[key].lower()
    signature = hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()
    insert = sqlite_insert if db.get_bind().dialect.name == "sqlite" else pg_insert
    stmt = insert(SavedSearch).values(user_id=user.id, signature=signature, **values)
    db.execute(stmt.on_conflict_do_nothing(index_elements=["user_id", "signature"]))
    db.commit()
    return db.query(SavedSearch).filter_by(user_id=user.id, signature=signature).one()


@router.delete("/{search_id}")
def delete_search(search_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.query(SavedSearch).filter_by(id=search_id, user_id=user.id).delete():
        raise HTTPException(404, "Saved search not found")
    db.commit()
    return {"deleted": True}


def notify_matching_searches(db: Session, product: Product, seller: User):
    s = SavedSearch
    # Substring comparisons treat user-entered % and _ literally.
    position = func.instr if db.get_bind().dialect.name == "sqlite" else func.strpos

    def contains(value, criterion):
        return position(func.lower(value), func.lower(criterion)) > 0

    recipients = select(s.user_id).join(User, User.id == s.user_id).join(Product, Product.id == product.id).where(
        s.user_id != seller.id, User.is_blocked_flag.is_(False),
        s.user_id.not_in(select(Block.blocked_id).where(Block.blocker_id == seller.id)),
        s.user_id.not_in(select(Block.blocker_id).where(Block.blocked_id == seller.id)),
        s.user_id.not_in(select(MutedNotification.user_id).where(MutedNotification.category == "saved_searches")),
        or_(s.category.is_(None), s.category == product.category),
        or_(s.transaction_type.is_(None), s.transaction_type == product.transaction_type.value),
        or_(s.condition.is_(None), contains(Product.condition, s.condition)),
        or_(s.college.is_(None), contains(seller.college, s.college)),
        or_(s.q.is_(None), contains(Product.title, s.q), contains(Product.description, s.q)),
        or_(s.min_price.is_(None), Product.price >= s.min_price),
        or_(s.max_price.is_(None), Product.price <= s.max_price),
        or_(s.has_3d.is_(None), Product.has_3d == s.has_3d),
        or_(s.radius_km.is_(None), ST_DWithin(Product.location, ST_SetSRID(ST_MakePoint(s.lng, s.lat), 4326),
                                              s.radius_km * 1000)),
    ).distinct()
    for uid in db.scalars(recipients):
        queue_notification(db, uid, "SAVED_SEARCH_MATCH", "New saved-search match", product.title,
                           f"/listings/{product.id}")
