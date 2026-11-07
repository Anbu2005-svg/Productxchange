import io
import pytest
from app.core.security import hash_password, create_access_token
from app.models.user import User
from app.models.product import Product, ProductStatus, TransactionType
from app.models.transaction import Transaction, TransactionState


@pytest.fixture
def auth_headers_b(user_b):
    token = create_access_token(subject=str(user_b.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers(admin_user):
    token = create_access_token(subject=str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def active_product(db, user_a):
    prod = Product(
        seller_id=user_a.id,
        title="Engineering Calculus Textbook",
        description="Standard 10th edition in good condition",
        category="Textbooks",
        condition="Good",
        price=450.0,
        transaction_type=TransactionType.BUY,
        latitude=12.9716,
        longitude=77.5946,
        pickup_area="Main Library Gate",
        status=ProductStatus.ACTIVE,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)
    return prod


def test_hacker_cannot_edit_or_upload_on_sold_or_removed_listing(client, user_a, auth_headers_a, active_product, db):
    """
    Penetration Test: Attacker attempts to modify, upload pictures, 3D convert,
    or delete a listing that has already been finalized as SOLD or REMOVED.
    """
    # 1. Mark active product as SOLD
    active_product.status = ProductStatus.SOLD
    db.commit()

    # Attempt to edit sold listing
    res_edit = client.patch(
        f"/products/{active_product.id}",
        json={"title": "Hacked Sold Product", "price": 10.0},
        headers=auth_headers_a,
    )
    assert res_edit.status_code == 400
    assert "already sold or removed" in res_edit.json()["detail"].lower()

    # Attempt to upload photos to sold listing
    dummy_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    res_upload = client.post(
        f"/products/{active_product.id}/images",
        files={"file": ("hack.png", io.BytesIO(dummy_png), "image/png")},
        headers=auth_headers_a,
    )
    assert res_upload.status_code == 400
    assert "sold or removed" in res_upload.json()["detail"].lower()

    # Attempt 3D conversion on sold listing
    res_3d = client.post(
        f"/products/{active_product.id}/3d-convert",
        json={"angles": {"front": "/uploads/test.png", "back": "/uploads/test2.png"}},
        headers=auth_headers_a,
    )
    assert res_3d.status_code == 400
    assert "sold or removed" in res_3d.json()["detail"].lower()

    # Attempt to remove already sold product
    res_del = client.delete(f"/products/{active_product.id}", headers=auth_headers_a)
    assert res_del.status_code == 400
    assert "already sold or removed" in res_del.json()["detail"].lower()


def test_hacker_account_deletion_cancels_active_negotiations(client, user_a, user_b, auth_headers_a, auth_headers_b, active_product, db):
    """
    Penetration Test: Buyer sends offer; before seller accepts, buyer initiates account deletion.
    The system must automatically cancel pending offers so the seller is not left with orphaned ghost records.
    """
    # 1. Buyer offers on product
    res_offer = client.post(
        "/transactions",
        json={"product_id": active_product.id, "offer_amount": 400.0, "notes": "Can pick up today"},
        headers=auth_headers_b,
    )
    assert res_offer.status_code == 200
    tx_id = res_offer.json()["id"]

    # Verify transaction is PENDING
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    assert tx.state == TransactionState.PENDING

    # 2. Buyer deletes their account
    res_del_acc = client.delete("/auth/me", headers=auth_headers_b)
    assert res_del_acc.status_code == 200

    # 3. Verify transaction is now CANCELLED cleanly
    db.refresh(tx)
    assert tx.state == TransactionState.CANCELLED

    # 4. Seller attempting to act on cancelled transaction fails with 409
    res_accept = client.post(
        f"/transactions/{tx_id}/action",
        json={"action": "accept"},
        headers=auth_headers_a,
    )
    assert res_accept.status_code == 409


def test_hacker_spoofed_product_in_chat_rejected(client, user_a, user_b, auth_headers_a, auth_headers_b, active_product, db):
    """
    Penetration Test: Attacker tries to start a chat referencing a product that neither participant owns,
    or referencing a product that has been REMOVED.
    """
    # 1. User C exists
    user_c = User(
        email="student_c@college.edu",
        password_hash=hash_password("Pass12345!"),
        full_name="Student C",
    )
    db.add(user_c)
    db.commit()
    token_c = create_access_token(subject=str(user_c.id))
    headers_c = {"Authorization": f"Bearer {token_c}"}

    # User B and User C try to start a chat referencing User A's active product
    res_spoof = client.post(
        f"/chat/conversations/start?other_user_id={user_c.id}&product_id={active_product.id}",
        headers=auth_headers_b,
    )
    assert res_spoof.status_code == 400
    assert "must be the listing owner" in res_spoof.json()["detail"].lower()

    # User A removes product
    active_product.status = ProductStatus.REMOVED
    db.commit()

    # User B tries to start chat about removed product
    res_removed = client.post(
        f"/chat/conversations/start?other_user_id={user_a.id}&product_id={active_product.id}",
        headers=auth_headers_b,
    )
    assert res_removed.status_code == 400
    assert "removed listing" in res_removed.json()["detail"].lower()


def test_hacker_handshake_pin_brute_force_rate_limit(client, user_a, user_b, auth_headers_a, auth_headers_b, active_product, db):
    """
    Penetration Test: Seller attempts to brute-force the 6-digit handshake PIN.
    After 5 failed attempts, the rate limiter must lock out subsequent requests with HTTP 429.
    """
    # Create deal in CONFIRMED state
    tx = Transaction(
        product_id=active_product.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.CONFIRMED,
        agreed_price=450.0,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 5 failed attempts allowed (returns 400 Invalid Handshake PIN)
    for attempt in range(5):
        res = client.post(
            f"/transactions/{tx.id}/verify-handshake",
            json={"pin": f"00000{attempt}"},
            headers=auth_headers_a,
        )
        assert res.status_code == 400
        assert "invalid handshake pin" in res.json()["detail"].lower()

    # 6th attempt must be blocked by anti brute-force rate limiter with 429
    res_lockout = client.post(
        f"/transactions/{tx.id}/verify-handshake",
        json={"pin": "000006"},
        headers=auth_headers_a,
    )
    assert res_lockout.status_code == 429
    assert "too many failed pin verification attempts" in res_lockout.json()["detail"].lower()


def test_hacker_zero_or_negative_price_offer_in_buy_transaction(client, user_a, user_b, auth_headers_a, auth_headers_b, active_product, db):
    """
    Penetration Test: Buyer attempts to initiate or counter with zero or negative price on a BUY listing.
    """
    # 1. Zero offer on BUY listing is rejected
    res_zero = client.post(
        "/transactions",
        json={"product_id": active_product.id, "offer_amount": 0.0},
        headers=auth_headers_b,
    )
    assert res_zero.status_code == 400
    assert "greater than zero" in res_zero.json()["detail"].lower()

    # 2. Negative offer rejected by Pydantic validation
    res_neg = client.post(
        "/transactions",
        json={"product_id": active_product.id, "offer_amount": -100.0},
        headers=auth_headers_b,
    )
    assert res_neg.status_code == 422

    # 3. Create valid transaction
    res_valid = client.post(
        "/transactions",
        json={"product_id": active_product.id, "offer_amount": 350.0},
        headers=auth_headers_b,
    )
    assert res_valid.status_code == 200
    tx_id = res_valid.json()["id"]

    # 4. Seller attempts counter-offer of 0 or negative
    res_counter_zero = client.post(
        f"/transactions/{tx_id}/action",
        json={"action": "counter", "counter_amount": 0.0},
        headers=auth_headers_a,
    )
    assert res_counter_zero.status_code == 400
    assert "greater than zero" in res_counter_zero.json()["detail"].lower()


def test_hacker_geospatial_and_inverted_price_query_rejected(client):
    """
    Penetration Test: Malicious query parameters targeting spatial distance calculation
    or SQL price bounding logic.
    """
    # 1. Out of range latitude
    res_lat = client.get("/products/nearby/search?lat=95.0&lng=77.5")
    assert res_lat.status_code == 422

    # 2. Out of range longitude
    res_lng = client.get("/products/nearby/search?lat=12.9&lng=190.0")
    assert res_lng.status_code == 422

    # 3. Inverted price range on list products (min_price > max_price)
    res_inv = client.get("/products?min_price=1000&max_price=100")
    assert res_inv.status_code == 400
    assert "min_price cannot be greater than max_price" in res_inv.json()["detail"]

    # 4. Inverted price range on nearby search
    res_inv_nearby = client.get("/products/nearby/search?lat=12.9&lng=77.5&min_price=500&max_price=50")
    assert res_inv_nearby.status_code == 400
    assert "min_price cannot be greater than max_price" in res_inv_nearby.json()["detail"]


def test_hacker_chat_insecure_url_scheme_rejected(client, user_a, user_b, auth_headers_a, auth_headers_b):
    """
    Penetration Test: Attacker attempts to send plain unencrypted HTTP links or script URLs
    in message attachments.
    """
    convo_res = client.post(f"/chat/conversations/start?other_user_id={user_b.id}", headers=auth_headers_a)
    convo_id = convo_res.json()["conversation_id"]

    # Insecure plain HTTP rejected
    res_http = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Check this", "image_url": "http://insecure-cdn.com/malicious.png"},
        headers=auth_headers_a,
    )
    assert res_http.status_code == 422

    # Javascript scheme rejected
    res_js = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Check this", "image_url": "javascript:alert(1)"},
        headers=auth_headers_a,
    )
    assert res_js.status_code == 422


def test_hacker_image_upload_and_3d_convert_404_on_missing_product(client, auth_headers_a):
    """
    Penetration Test: Attacker targets nonexistent product IDs to inspect server behavior.
    The server must properly return 404 rather than unhandled exception or 403.
    """
    dummy_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    res1 = client.post(
        "/products/999999/images",
        files={"file": ("test.png", io.BytesIO(dummy_png), "image/png")},
        headers=auth_headers_a,
    )
    assert res1.status_code == 404

    res2 = client.post(
        "/products/999999/3d-convert",
        json={"angles": {}},
        headers=auth_headers_a,
    )
    assert res2.status_code == 404


def test_hacker_duplicate_review_and_rating_bounds(client, user_a, user_b, auth_headers_a, auth_headers_b, active_product, db):
    """
    Penetration Test: Attacker attempts to submit reviews outside 1-5 rating bounds
    or submit multiple reviews on the same completed transaction.
    """
    tx = Transaction(
        product_id=active_product.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.COMPLETED,
        agreed_price=450.0,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 1. Rating out of bounds (< 1)
    res_low = client.post(
        "/reviews",
        json={"transaction_id": tx.id, "rating": 0, "comment": "Horrible"},
        headers=auth_headers_b,
    )
    assert res_low.status_code == 422

    # 2. Rating out of bounds (> 5)
    res_high = client.post(
        "/reviews",
        json={"transaction_id": tx.id, "rating": 6, "comment": "Super"},
        headers=auth_headers_b,
    )
    assert res_high.status_code == 422

    # 3. Legitimate review
    res_valid = client.post(
        "/reviews",
        json={"transaction_id": tx.id, "rating": 5, "comment": "Smooth deal!"},
        headers=auth_headers_b,
    )
    assert res_valid.status_code == 200

    # 4. Duplicate review attempt
    res_dup = client.post(
        "/reviews",
        json={"transaction_id": tx.id, "rating": 5, "comment": "Inflate rating!"},
        headers=auth_headers_b,
    )
    assert res_dup.status_code == 400
    assert "already reviewed" in res_dup.json()["detail"].lower()


def test_hacker_admin_csv_formula_injection_defense(client, user_a, admin_headers, db):
    """
    Penetration Test: Attacker injects spreadsheet formulas (=cmd, @SUM, +calc) into product titles
    to target administrators opening exported CSV files in Excel (CWE-1236).
    """
    exploit_prod = Product(
        seller_id=user_a.id,
        title="=cmd|'/C calc'!A0",
        description="+SUM(1,2)",
        category="@DangerousCategory",
        condition="Good",
        price=100.0,
        transaction_type=TransactionType.BUY,
        latitude=12.9716,
        longitude=77.5946,
        status=ProductStatus.ACTIVE,
    )
    db.add(exploit_prod)
    db.commit()

    # Admin exports products
    res = client.get("/admin/export/products", headers=admin_headers)
    assert res.status_code == 200
    csv_text = res.text

    # Verify formula prefixes have been safely neutralized with single quote prefix
    assert "'=cmd|'/C calc'!A0" in csv_text
    assert "'@DangerousCategory" in csv_text


def test_hacker_bump_spamming_cooldown_enforced(client, user_a, auth_headers_a, active_product):
    """
    Penetration Test: Attacker spams bump requests on an active listing to dominate recent search results.
    """
    res = client.post(f"/products/{active_product.id}/bump", headers=auth_headers_a)
    assert res.status_code == 429
    assert "once every 24 hours" in res.json()["detail"].lower()


def test_hacker_cross_conversation_unauthorized_access_blocked(client, user_a, user_b, auth_headers_a, auth_headers_b, db):
    """
    Penetration Test: Attacker (User C) attempts to eavesdrop or inject messages into
    a private chat conversation between User A and User B.
    """
    # 1. Start conversation between User A and User B
    convo_res = client.post(f"/chat/conversations/start?other_user_id={user_b.id}", headers=auth_headers_a)
    convo_id = convo_res.json()["conversation_id"]

    # 2. User C registers and gets auth headers
    user_c = User(
        email="eavesdropper@college.edu",
        password_hash=hash_password("Pass12345!"),
        full_name="Eavesdropper",
    )
    db.add(user_c)
    db.commit()
    token_c = create_access_token(subject=str(user_c.id))
    headers_c = {"Authorization": f"Bearer {token_c}"}

    # 3. User C attempts to read messages
    res_read = client.get(f"/chat/conversations/{convo_id}/messages", headers=headers_c)
    assert res_read.status_code == 403

    # 4. User C attempts to inject message
    res_inject = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "I am injecting a message"},
        headers=headers_c,
    )
    assert res_inject.status_code == 403
