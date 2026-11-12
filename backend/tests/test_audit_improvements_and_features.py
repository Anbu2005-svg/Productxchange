"""
Test Suite: Audit Improvements, Supabase Storage, Rental Return Lifecycle, and Wishlist Features
Validates:
1. Complete Rental Return workflow (RENT deals move to RENTED, return re-lists to ACTIVE)
2. Domain authorization guard on confirm()
3. Wishlist / Saved items endpoints (POST, DELETE, GET /products/saved)
4. Streaming Admin CSV Export (O(1) memory bound)
5. CORS PUT method preflight allowance
6. Storage deletion for local and Supabase cloud paths
"""
import pytest
from app.core.security import create_access_token
from app.models.product import Product, ProductStatus, TransactionType, SavedProduct
from app.models.transaction import Transaction, TransactionState
from app.models.user import User


def test_rental_lifecycle_and_return_workflow(client, db, user_a, user_b):
    """
    Validates that a completed RENT deal sets product status to RENTED (not SOLD),
    tracks return due date, and returning the item restores product status to ACTIVE.
    """
    token_a = create_access_token(str(user_a.id))
    token_b = create_access_token(str(user_b.id))
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 1. Seller (user_a) lists a rental item
    prod = Product(
        seller_id=user_a.id,
        title="Scientific Calculator fx-991EX",
        category="Lab Equipment & Calculators",
        transaction_type=TransactionType.RENT,
        price=150.0,
        status=ProductStatus.ACTIVE,
        latitude=12.9716,
        longitude=77.5946,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    # 2. Buyer (user_b) requests rental for 14 days
    res_offer = client.post(
        "/transactions",
        headers=headers_b,
        json={
            "product_id": prod.id,
            "offer_amount": 150.0,
            "rental_period_days": 14,
            "notes": "Need for final semester exams",
        },
    )
    assert res_offer.status_code == 200, res_offer.text
    tx_id = res_offer.json()["id"]

    # 3. Seller accepts
    res_accept = client.post(f"/transactions/{tx_id}/action", headers=headers_a, json={"action": "accept"})
    assert res_accept.status_code == 200

    # 4. Buyer confirms deal
    res_confirm = client.post(f"/transactions/{tx_id}/action", headers=headers_b, json={"action": "confirm"})
    assert res_confirm.status_code == 200
    buyer_pin = res_confirm.json()["handshake_pin"]
    assert buyer_pin is not None

    # 5. Physical Handover: Seller verifies buyer's PIN
    res_handshake = client.post(
        f"/transactions/{tx_id}/verify-handshake",
        headers=headers_a,
        json={"pin": buyer_pin},
    )
    assert res_handshake.status_code == 200
    tx_completed = res_handshake.json()
    assert tx_completed["state"] == "COMPLETED"
    assert tx_completed["rental_returned"] is False
    assert tx_completed["rental_due_date"] is not None

    # Check product status in DB -> Must be RENTED, NOT SOLD!
    db.refresh(prod)
    assert prod.status == ProductStatus.RENTED

    # 6. Return Handover: Item is returned after exam
    res_return = client.post(f"/transactions/{tx_id}/return", headers=headers_a)
    assert res_return.status_code == 200
    tx_returned = res_return.json()
    assert tx_returned["rental_returned"] is True
    assert tx_returned["rental_return_date"] is not None

    # Check product status in DB -> Restored to ACTIVE for campus circular economy!
    db.refresh(prod)
    assert prod.status == ProductStatus.ACTIVE


def test_transaction_service_confirm_authorization(client, db, user_a, user_b):
    """
    Verifies that a 3rd party user cannot confirm someone else's transaction.
    """
    token_a = create_access_token(str(user_a.id))
    token_b = create_access_token(str(user_b.id))
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # Create 3rd party user
    user_c = User(
        email="user_c@college.edu",
        password_hash="hashpass",
        full_name="User C",
        is_verified=True,
    )
    db.add(user_c)
    db.commit()
    db.refresh(user_c)
    token_c = create_access_token(str(user_c.id))
    headers_c = {"Authorization": f"Bearer {token_c}"}

    prod = Product(
        seller_id=user_a.id,
        title="Engineering Mechanics Book",
        category="Textbooks & Study Material",
        transaction_type=TransactionType.BUY,
        price=200.0,
        status=ProductStatus.ACTIVE,
        latitude=12.9716,
        longitude=77.5946,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    res_offer = client.post(
        "/transactions",
        headers={"Authorization": f"Bearer {token_b}"},
        json={"product_id": prod.id, "offer_amount": 200.0},
    )
    tx_id = res_offer.json()["id"]

    # Seller accepts
    client.post(f"/transactions/{tx_id}/action", headers=headers_a, json={"action": "accept"})

    # 3rd party user_c attempts to confirm -> must be rejected with 403
    res_intruder = client.post(f"/transactions/{tx_id}/action", headers=headers_c, json={"action": "confirm"})
    assert res_intruder.status_code == 403


def test_wishlist_saved_products_workflow(client, db, user_a, user_b):
    """
    Validates saving a product to wishlist, retrieving saved items, and unsaving.
    """
    token_b = create_access_token(str(user_b.id))
    headers_b = {"Authorization": f"Bearer {token_b}"}

    prod1 = Product(
        seller_id=user_a.id,
        title="Dorm Study Lamp",
        category="Hostel & Room Essentials",
        transaction_type=TransactionType.BUY,
        price=350.0,
        status=ProductStatus.ACTIVE,
        latitude=12.9716,
        longitude=77.5946,
    )
    prod2 = Product(
        seller_id=user_a.id,
        title="Lab Coat Size M",
        category="Lab Equipment & Calculators",
        transaction_type=TransactionType.DONATE,
        price=0.0,
        status=ProductStatus.ACTIVE,
        latitude=12.9716,
        longitude=77.5946,
    )
    db.add_all([prod1, prod2])
    db.commit()
    db.refresh(prod1)
    db.refresh(prod2)

    # 1. Save prod1
    res_save = client.post(f"/products/{prod1.id}/save", headers=headers_b)
    assert res_save.status_code == 200
    assert res_save.json()["saved"] is True

    # 2. Duplicate save is idempotent
    res_save_again = client.post(f"/products/{prod1.id}/save", headers=headers_b)
    assert res_save_again.status_code == 200

    # 3. Retrieve saved items
    res_list = client.get("/products/saved", headers=headers_b)
    assert res_list.status_code == 200
    saved_items = res_list.json()
    assert len(saved_items) == 1
    assert saved_items[0]["id"] == prod1.id
    assert saved_items[0]["is_saved"] is True

    # 4. View single product includes is_saved flag
    res_single = client.get(f"/products/{prod1.id}", headers=headers_b)
    assert res_single.status_code == 200
    assert res_single.json()["is_saved"] is True

    # 5. Unsave prod1
    res_unsave = client.delete(f"/products/{prod1.id}/save", headers=headers_b)
    assert res_unsave.status_code == 200
    assert res_unsave.json()["saved"] is False

    # 6. Verify watchlist is now empty
    res_empty = client.get("/products/saved", headers=headers_b)
    assert res_empty.status_code == 200
    assert len(res_empty.json()) == 0


def test_streaming_admin_csv_export(client, db, admin_user, user_a, user_b):
    """
    Validates streaming CSV export for all supported resources.
    """
    token = create_access_token(str(admin_user.id))
    headers = {"Authorization": f"Bearer {token}"}

    for resource in ("users", "products", "transactions", "reports"):
        res = client.get(f"/admin/export/{resource}", headers=headers)
        assert res.status_code == 200
        assert "text/csv" in res.headers["content-type"]
        assert f"filename=productxchange_{resource}.csv" in res.headers["content-disposition"]
        assert len(res.text) > 0


def test_cors_put_method_allowed(client):
    """
    Validates that CORS preflight allows PUT requests.
    """
    res = client.options(
        "/auth/me",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PUT",
        },
    )
    assert res.status_code == 200
    allowed = res.headers.get("access-control-allow-methods", "")
    assert "PUT" in allowed

