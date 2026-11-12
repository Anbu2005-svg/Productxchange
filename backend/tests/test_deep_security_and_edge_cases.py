"""
Deep Security, Boundary Conditions & Edge Case Verification Suite
Tests:
1. AI upload validation (magic bytes, MIME type enforcement, 5MB limits).
2. Chat image URL sanitization (SSRF, javascript: URI, extension validation).
3. Transaction state machine strict boundary transitions & double-party rules.
4. Geospatial coordinate boundary conditions (-90/+90, -180/+180, invalid ranges).
5. Rate limit enforcement on sensitive auth endpoints (forgot-password, reset-password).
6. Administrative export authorization & CSV formula injection escape.
7. Anti-harassment two-way block isolation, chat blocking & unblock restoration.
8. Multi-campus query isolation & category filter sanitization.
"""

import io
import pytest
from app.models.user import User
from app.models.product import Product, ProductStatus, TransactionType
from app.models.transaction import Transaction, TransactionState


# ============================================================================
# 1. AI UPLOAD VALIDATION & EVASION DEFENSES
# ============================================================================

def test_ai_suggest_listing_magic_byte_enforcement(client, auth_headers_a):
    """Uploading a script disguised with .jpg extension fails magic byte validation."""
    fake_jpg = io.BytesIO(b"<?php echo 'shell'; ?>")
    res = client.post(
        "/ai/suggest-listing",
        files={"file": ("exploit.jpg", fake_jpg, "image/jpeg")},
        headers=auth_headers_a,
    )
    assert res.status_code == 400
    assert "Corrupt or invalid image format" in res.json()["detail"]


def test_ai_suggest_listing_disallowed_extension(client, auth_headers_a):
    """Uploading executable extensions (.exe, .sh) is rejected immediately."""
    fake_file = io.BytesIO(b"echo 1")
    res = client.post(
        "/ai/suggest-listing",
        files={"file": ("script.sh", fake_file, "text/x-shellscript")},
        headers=auth_headers_a,
    )
    assert res.status_code == 400
    assert "Only JPG, PNG, and WebP" in res.json()["detail"]


def test_ai_suggest_listing_disallowed_mime(client, auth_headers_a):
    """MIME spoofing with disallowed content-type is rejected."""
    valid_jpeg = io.BytesIO(b"\xff\xd8\xff\xe0" + b"\x00" * 40)
    res = client.post(
        "/ai/suggest-listing",
        files={"file": ("photo.jpg", valid_jpeg, "application/octet-stream")},
        headers=auth_headers_a,
    )
    assert res.status_code == 400
    assert "Invalid MIME type" in res.json()["detail"]


def test_ai_suggest_listing_valid_magic_bytes_succeeds(client, auth_headers_a):
    """Uploading genuine JPEG magic bytes passes validation and returns structured suggestion."""
    valid_jpeg = io.BytesIO(b"\xff\xd8\xff\xe0" + b"\x01" * 60)
    res = client.post(
        "/ai/suggest-listing",
        files={"file": ("desk_lamp.jpg", valid_jpeg, "image/jpeg")},
        headers=auth_headers_a,
    )
    assert res.status_code == 200
    data = res.json()
    assert "title" in data
    assert "description" in data
    assert "attributes" in data


# ============================================================================
# 2. CHAT IMAGE URL SANITIZATION & SSRF DEFENSES
# ============================================================================

def test_chat_message_javascript_uri_rejected(client, db, user_a, user_b, auth_headers_a):
    """Pydantic rejects javascript: scheme or XSS payloads in chat image_url."""
    res_start = client.post(f"/chat/conversations/start?other_user_id={user_b.id}", headers=auth_headers_a)
    convo_id = res_start.json()["conversation_id"]

    res_xss = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Check this", "image_url": "javascript:alert(1)"},
        headers=auth_headers_a,
    )
    assert res_xss.status_code == 422


def test_chat_message_remote_ssrf_url_rejected(client, db, user_a, user_b, auth_headers_a):
    """Chat image_url only permits https:// or /uploads/ with valid image extensions."""
    res_start = client.post(f"/chat/conversations/start?other_user_id={user_b.id}", headers=auth_headers_a)
    convo_id = res_start.json()["conversation_id"]

    # Insecure HTTP scheme rejected
    res_insecure = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Look here", "image_url": "http://malicious-internal.net/probe.jpg"},
        headers=auth_headers_a,
    )
    assert res_insecure.status_code == 422

    # Malicious payload with newlines/control chars rejected
    res_inject = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Look here", "image_url": "/uploads/test\nmalicious.jpg"},
        headers=auth_headers_a,
    )
    assert res_inject.status_code == 422


def test_chat_message_valid_upload_url_accepted(client, db, user_a, user_b, auth_headers_a):
    """Chat message with legitimate /uploads/ photo URL succeeds."""
    res_start = client.post(f"/chat/conversations/start?other_user_id={user_b.id}", headers=auth_headers_a)
    convo_id = res_start.json()["conversation_id"]

    res_ok = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Here is the item picture", "image_url": "/uploads/item123.jpg"},
        headers=auth_headers_a,
    )
    assert res_ok.status_code == 200
    assert res_ok.json()["image_url"] == "/uploads/item123.jpg"


# ============================================================================
# 3. TRANSACTION STATE MACHINE STRICT TRANSITIONS
# ============================================================================

def test_tx_double_party_completion_requirement(client, db, user_a, user_b, auth_headers_a, auth_headers_b):
    """Transaction only moves to COMPLETED when BOTH parties have signed off."""
    prod = Product(seller_id=user_a.id, title="Physics Notebook", category="Textbooks & Study Material", price=150.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    tx = Transaction(
        product_id=prod.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.CONFIRMED,
        buyer_completed=False,
        seller_completed=False,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 1. Buyer signs off
    res_buyer = client.post(f"/transactions/{tx.id}/action", json={"action": "complete"}, headers=auth_headers_b)
    assert res_buyer.status_code == 200
    assert res_buyer.json()["state"] == "CONFIRMED"  # Still confirmed, not completed yet!
    assert res_buyer.json()["buyer_completed"] is True
    assert res_buyer.json()["seller_completed"] is False

    # 2. Seller signs off -> state transitions to COMPLETED
    res_seller = client.post(f"/transactions/{tx.id}/action", json={"action": "complete"}, headers=auth_headers_a)
    assert res_seller.status_code == 200
    assert res_seller.json()["state"] == "COMPLETED"
    assert res_seller.json()["seller_completed"] is True


def test_tx_cannot_act_on_completed_deal(client, db, user_a, user_b, auth_headers_a):
    """Attempting actions (e.g. accept, counter, confirm) on a COMPLETED deal returns HTTP 409."""
    prod = Product(seller_id=user_a.id, title="Mechanical Pencil", category="Other", price=50.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    tx = Transaction(product_id=prod.id, buyer_id=user_b.id, seller_id=user_a.id, state=TransactionState.COMPLETED)
    db.add(tx)
    db.commit()

    res_invalid = client.post(f"/transactions/{tx.id}/action", json={"action": "accept"}, headers=auth_headers_a)
    assert res_invalid.status_code == 409


def test_tx_rental_negative_period_rejected(client, db, user_a, auth_headers_b):
    """Initiating a rental with negative or zero days is rejected."""
    prod = Product(seller_id=user_a.id, title="Dorm Lamp", category="Hostel & Room Essentials", price=200.0, transaction_type=TransactionType.RENT)
    db.add(prod)
    db.commit()

    res_neg = client.post(
        "/transactions",
        json={"product_id": prod.id, "offer_amount": 200.0, "rental_period_days": -5},
        headers=auth_headers_b,
    )
    assert res_neg.status_code in (400, 422)


# ============================================================================
# 4. GEOSPATIAL COORDINATES & BOUNDARY CONDITIONS
# ============================================================================

def test_geospatial_out_of_range_coordinates_rejected(client):
    """Latitude > 90 or Longitude > 180 returns 422 Unprocessable Entity."""
    res_lat = client.get("/products/nearby/search?lat=95.0&lng=77.59")
    assert res_lat.status_code == 422

    res_lng = client.get("/products/nearby/search?lat=12.97&lng=195.0")
    assert res_lng.status_code == 422


def test_geospatial_extreme_valid_coordinates_accepted(client):
    """Boundary coordinates (-90, -180) and (+90, +180) execute without crashing."""
    res_min = client.get("/products/nearby/search?lat=-90.0&lng=-180.0&radius_km=10")
    assert res_min.status_code == 200

    res_max = client.get("/products/nearby/search?lat=90.0&lng=180.0&radius_km=10")
    assert res_max.status_code == 200


def test_geospatial_radius_bounds(client):
    """Radius < 1km or > 100km is rejected by query validators."""
    res_zero = client.get("/products/nearby/search?lat=12.97&lng=77.59&radius_km=0")
    assert res_zero.status_code == 422

    res_too_large = client.get("/products/nearby/search?lat=12.97&lng=77.59&radius_km=250")
    assert res_too_large.status_code == 422


# ============================================================================
# 5. SENSITIVE AUTH RATE LIMITING (FORGOT/RESET PASSWORD)
# ============================================================================

def test_auth_forgot_password_rate_limit(client, db, user_a):
    """Password reset requests are rate-limited to 5 requests per minute per IP."""
    statuses = []
    for _ in range(7):
        res = client.post("/auth/forgot-password", json={"email": user_a.email})
        statuses.append(res.status_code)

    # At least one request must be rejected with HTTP 429
    assert 429 in statuses


# ============================================================================
# 6. ADMINISTRATIVE EXPORT PERMISSIONS & FORMULA INJECTION ESCAPING
# ============================================================================

def test_admin_export_forbidden_to_regular_users(client, auth_headers_a):
    """Regular authenticated students are rejected with HTTP 403 when requesting data exports."""
    res = client.get("/admin/export/users", headers=auth_headers_a)
    assert res.status_code == 403


def test_admin_export_formula_injection_defense(client, db, auth_headers_admin):
    """CSV export neutralizes spreadsheet formula characters (=, +, -, @)."""
    malicious_user = User(
        email="hacker@vit.ac.in",
        password_hash="hash",
        full_name="=cmd|' /C calc'!A0",
        college="+IIT Bombay",
    )
    db.add(malicious_user)
    db.commit()

    res = client.get("/admin/export/users", headers=auth_headers_admin)
    assert res.status_code == 200
    csv_text = res.text
    # Formula prefixes must be single-quoted to neutralize execution
    assert "'=cmd" in csv_text or "\\=cmd" in csv_text or "'=" in csv_text


# ============================================================================
# 7. ANTI-HARASSMENT TWO-WAY BLOCK ISOLATION & RESTORATION
# ============================================================================

def test_two_way_block_and_unblock_lifecycle(client, db, user_a, user_b, auth_headers_a, auth_headers_b):
    """User A blocks User B: B cannot initiate chat or transactions; unblocking restores search visibility."""
    prod = Product(seller_id=user_a.id, title="Casio FX-991CW", category="Electronics & Gadgets", price=900.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    # 1. User A blocks User B
    res_block = client.post(f"/users/{user_b.id}/block", headers=auth_headers_a)
    assert res_block.status_code == 200

    # 2. User B tries to start chat with User A -> HTTP 403
    res_chat = client.post(f"/chat/conversations/start?other_user_id={user_a.id}", headers=auth_headers_b)
    assert res_chat.status_code == 403
    assert "Cannot message this user" in res_chat.json()["detail"]

    # 3. User B tries to make offer on User A's item -> HTTP 403
    res_tx = client.post(
        "/transactions",
        json={"product_id": prod.id, "offer_amount": 800.0},
        headers=auth_headers_b,
    )
    assert res_tx.status_code == 403
    assert "blocked user" in res_tx.json()["detail"]

    # 4. User A unblocks User B
    res_unblock = client.delete(f"/users/{user_b.id}/block", headers=auth_headers_a)
    assert res_unblock.status_code == 200

    # 5. User B can now initiate chat
    res_chat_ok = client.post(f"/chat/conversations/start?other_user_id={user_a.id}", headers=auth_headers_b)
    assert res_chat_ok.status_code == 200


def test_cannot_block_admin_or_self(client, db, user_a, admin_user, auth_headers_a):
    """Users cannot block administrators or themselves."""
    # Self-block
    res_self = client.post(f"/users/{user_a.id}/block", headers=auth_headers_a)
    assert res_self.status_code == 400
    assert "Cannot block yourself" in res_self.json()["detail"]

    # Block admin
    res_admin = client.post(f"/users/{admin_user.id}/block", headers=auth_headers_a)
    assert res_admin.status_code == 400
    assert "administrator" in res_admin.json()["detail"]


# ============================================================================
# 8. MULTI-CAMPUS QUERY ISOLATION & FILTER SANITIZATION
# ============================================================================

def test_multi_campus_filtering(client, db, user_a, user_b, auth_headers_a):
    """Querying with college parameter restricts listings strictly to that campus hub."""
    user_a.college = "VIT Bangalore"
    user_b.college = "IISc Bangalore"
    db.commit()

    p_vit = Product(seller_id=user_a.id, title="VIT Physics Notes", category="Textbooks & Study Material", price=100.0, transaction_type=TransactionType.BUY)
    p_iisc = Product(seller_id=user_b.id, title="IISc Lab Coat", category="Lab Equipment & Calculators", price=250.0, transaction_type=TransactionType.BUY)
    db.add_all([p_vit, p_iisc])
    db.commit()

    # Filter by VIT Bangalore
    res_vit = client.get("/products?college=VIT+Bangalore", headers=auth_headers_a)
    assert res_vit.status_code == 200
    items = res_vit.json()["items"]
    assert any(i["id"] == p_vit.id for i in items)
    assert not any(i["id"] == p_iisc.id for i in items)

    # Filter with ALL returns both
    res_all = client.get("/products?college=ALL", headers=auth_headers_a)
    assert res_all.status_code == 200
    all_items = res_all.json()["items"]
    assert any(i["id"] == p_vit.id for i in all_items)
    assert any(i["id"] == p_iisc.id for i in all_items)
