from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.core.security import get_optional_current_user
from app.models.user import User
from app.models.product import Product, ProductStatus
from app.models.transaction import Transaction, TransactionState

router = APIRouter(prefix="/analytics", tags=["analytics"])

# Estimated carbon and waste savings factors per category based on life cycle assessment (LCA)
CATEGORY_IMPACT_FACTORS = {
    "textbooks": {"co2_kg": 2.6, "waste_kg": 0.8, "avg_new_price": 600},
    "books": {"co2_kg": 2.2, "waste_kg": 0.6, "avg_new_price": 500},
    "electronics": {"co2_kg": 48.0, "waste_kg": 2.5, "avg_new_price": 4500},
    "cycles": {"co2_kg": 28.0, "waste_kg": 14.0, "avg_new_price": 5000},
    "bicycles": {"co2_kg": 28.0, "waste_kg": 14.0, "avg_new_price": 5000},
    "lab equipment": {"co2_kg": 12.0, "waste_kg": 1.5, "avg_new_price": 1200},
    "hostel essentials": {"co2_kg": 8.5, "waste_kg": 3.0, "avg_new_price": 1000},
    "stationery": {"co2_kg": 1.2, "waste_kg": 0.4, "avg_new_price": 300},
    "furniture": {"co2_kg": 22.0, "waste_kg": 12.0, "avg_new_price": 2500},
    "default": {"co2_kg": 5.0, "waste_kg": 1.0, "avg_new_price": 800},
}


def _get_factors(category_name: Optional[str]):
    if not category_name:
        return CATEGORY_IMPACT_FACTORS["default"]
    cat_lower = category_name.lower().strip()
    for key, factors in CATEGORY_IMPACT_FACTORS.items():
        if key in cat_lower:
            return factors
    return CATEGORY_IMPACT_FACTORS["default"]


@router.get("/sustainability")
def get_sustainability_metrics(
    user: Optional[User] = Depends(get_optional_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns campus-wide environmental and financial sustainability metrics:
    - CO2 emissions saved (kg)
    - Equivalent trees planted
    - Landfill waste diverted (kg)
    - Total student money saved (INR)
    - Items circulated across campus
    - Personal eco-impact badge (if logged in)
    """
    # 1. Total active listings and completed transactions
    total_listings = db.query(func.count(Product.id)).scalar() or 0
    completed_count = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.state == TransactionState.COMPLETED)
        .scalar() or 0
    )
    circulated_count = max(completed_count, total_listings)  # Account for all circulating peer items

    # 2. Memory-Safe SQL Aggregations: O(1) heap memory, prevents Out-Of-Memory (OOM) algorithmic DoS
    product_stats = (
        db.query(
            Product.category,
            Product.status,
            func.count(Product.id),
            func.sum(func.coalesce(Product.price, 0.0)),
        )
        .group_by(Product.category, Product.status)
        .all()
    )

    total_co2_kg = 0.0
    total_waste_kg = 0.0
    total_rupees_saved = 0.0
    category_counts: dict[str, int] = {}

    for cat, status, count, price_sum in product_stats:
        cat_name = cat or "General"
        category_counts[cat_name] = category_counts.get(cat_name, 0) + count
        factors = _get_factors(cat_name)

        # Baseline savings: listing an item keeps it in circular economy
        item_multiplier = 1.5 if status == ProductStatus.SOLD else 1.0
        total_co2_kg += factors["co2_kg"] * item_multiplier * count
        total_waste_kg += factors["waste_kg"] * item_multiplier * count

        # Savings = retail estimated price minus campus second-hand price
        retail_est = factors["avg_new_price"] * count
        actual_price = float(price_sum or 0.0)
        savings = max(0.0, retail_est - actual_price)
        total_rupees_saved += savings

    # If completed transactions exist, incorporate agreed prices via SQL group-by
    completed_cat_counts = (
        db.query(Product.category, func.count(Transaction.id))
        .join(Product, Transaction.product_id == Product.id)
        .filter(Transaction.state == TransactionState.COMPLETED)
        .group_by(Product.category)
        .all()
    )
    for cat, tx_count in completed_cat_counts:
        factors = _get_factors(cat)
        total_co2_kg += factors["co2_kg"] * 0.5 * tx_count
        total_waste_kg += factors["waste_kg"] * 0.5 * tx_count

    # Trees equivalent: 1 mature tree absorbs ~21 kg CO2/year
    trees_equivalent = round(total_co2_kg / 21.0, 1)

    # 3. User personal impact (if logged in)
    user_impact = None
    if user:
        user_prod_stats = (
            db.query(
                Product.category,
                func.count(Product.id),
                func.sum(func.coalesce(Product.price, 0.0)),
            )
            .filter(Product.seller_id == user.id)
            .group_by(Product.category)
            .all()
        )
        user_co2 = 0.0
        user_waste = 0.0
        user_saved = 0.0
        for cat, count, price_sum in user_prod_stats:
            f = _get_factors(cat)
            user_co2 += f["co2_kg"] * count
            user_waste += f["waste_kg"] * count
            user_saved += max(0.0, (f["avg_new_price"] * count) - float(price_sum or 0.0))

        user_tx_stats = (
            db.query(Product.category, func.count(Transaction.id))
            .join(Product, Transaction.product_id == Product.id)
            .filter(
                (Transaction.buyer_id == user.id) | (Transaction.seller_id == user.id),
                Transaction.state == TransactionState.COMPLETED,
            )
            .group_by(Product.category)
            .all()
        )
        for cat, count in user_tx_stats:
            f = _get_factors(cat)
            user_co2 += f["co2_kg"] * 0.5 * count
            user_waste += f["waste_kg"] * 0.5 * count

        # Eco tier based on CO2 saved
        tier = "Green Pioneer 🌱"
        if user_co2 >= 100:
            tier = "Campus Eco Champion 🏆"
        elif user_co2 >= 50:
            tier = "Sustainability Warrior 🌿"
        elif user_co2 >= 20:
            tier = "Conscious Exchanger ♻️"

        user_impact = {
            "user_id": user.id,
            "tier": tier,
            "co2_saved_kg": round(user_co2, 1),
            "waste_diverted_kg": round(user_waste, 1),
            "rupees_saved": round(user_saved),
            "items_shared": sum(s[1] for s in user_prod_stats),
            "deals_completed": sum(s[1] for s in user_tx_stats),
        }

    return {
        "summary": {
            "total_co2_saved_kg": round(total_co2_kg, 1),
            "trees_equivalent": trees_equivalent,
            "total_waste_diverted_kg": round(total_waste_kg, 1),
            "total_rupees_saved": round(total_rupees_saved),
            "items_circulated": circulated_count,
            "completed_deals": completed_count,
        },
        "category_distribution": [
            {"category": k, "count": v}
            for k, v in sorted(category_counts.items(), key=lambda x: x[1], reverse=True)[:6]
        ],
        "user_impact": user_impact,
    }
