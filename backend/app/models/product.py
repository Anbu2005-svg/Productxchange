import enum
from sqlalchemy import (
    Column, Integer, String, Float, Numeric, false, DateTime, ForeignKey, func, Enum, ARRAY, Text, Boolean, UniqueConstraint, Index
)
from sqlalchemy.types import UserDefinedType
from sqlalchemy.orm import relationship
from geoalchemy2 import Geography

from sqlalchemy.ext.compiler import compiles
from app.core.database import Base


class VectorType(UserDefinedType):
    def __init__(self, dimensions=1024):
        self.dimensions = dimensions

    def get_col_spec(self, **kw):
        return f"vector({self.dimensions})"


@compiles(VectorType, "sqlite")
def compile_vector_sqlite(element, compiler, **kw):
    return "TEXT"


@compiles(VectorType, "postgresql")
def compile_vector_pg(element, compiler, **kw):
    return f"vector({element.dimensions})"


class TransactionType(str, enum.Enum):
    BUY = "BUY"
    EXCHANGE = "EXCHANGE"
    RENT = "RENT"
    DONATE = "DONATE"


class ProductStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"
    RENTED = "RENTED"
    SOLD = "SOLD"
    REMOVED = "REMOVED"


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        Index("ix_products_status_created_at", "status", "created_at"),
        Index("ix_products_status_category", "status", "category"),
        Index("ix_products_seller_status", "seller_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True)
    seller_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String, index=True, nullable=False)
    condition = Column(String, nullable=True)
    expiry_reminded = Column(Boolean, nullable=False, default=False, server_default=false())
    price = Column(Numeric(12, 2), nullable=True)
    transaction_type = Column(Enum(TransactionType), nullable=False, index=True)

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location = Column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    pickup_area = Column(String, nullable=True)  # human-readable, hidden until deal confirmed

    image_urls = Column(ARRAY(String), default=list)
    has_3d = Column(Boolean, default=False, nullable=True)
    image_angles = Column(Text, nullable=True)  # JSON-encoded mapping of angle -> image url
    status = Column(Enum(ProductStatus), default=ProductStatus.ACTIVE, index=True)

    # Embedding vector for semantic search (BGE-M3 1024-dim)
    embedding = Column(VectorType(1024), nullable=True)

    # AI-assist fields (populated later in Step 7, nullable for now)
    ai_suggested_category = Column(String, nullable=True)
    ai_suggested_price = Column(Numeric(12, 2), nullable=True)
    ai_suggested_description = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    seller = relationship("User")


class SavedProduct(Base):
    __tablename__ = "saved_products"
    __table_args__ = (
        UniqueConstraint("user_id", "product_id", name="uq_user_saved_product"),
        Index("ix_saved_products_user_created", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    product = relationship("Product")
    user = relationship("User")
