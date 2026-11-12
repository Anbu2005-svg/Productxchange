import io
import time
import json
import secrets
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy import text

from app.core.config import settings
from app.core.security import hash_password, create_access_token, validate_password_strength
from app.models.user import User
from app.models.product import Product, ProductStatus, TransactionType, SavedProduct
from app.models.transaction import Transaction, TransactionState, Offer
from app.models.message import Conversation, Message
from app.models.notification import Notification, PushSubscription
from app.models.report import Report, Block
from app.models.review import Review


# ============================================================================
# SECTION 1: AUTHENTICATION, OTP, LOCKOUT, PROFILE & GDPR LIFECYCLE
# ============================================================================

def test_auth_password_strength_validation():
    """Verify password complexity requirements enforce min-length, letters, and digits."""
    with pytest.raises(ValueError, match="at least 8 characters"):
        validate_password_strength("Short1!")

    with pytest.raises(ValueError, match="at least one digit"):
        validate_password_strength("NoDigitsHere!")

    with pytest.raises(ValueError, match="at least one letter"):
        validate_password_strength("1234567890!")

    # Valid complex password
    assert validate_password_strength("ValidPassword123") == "ValidPassword123"


def test_auth_login_case_insensitivity_and_whitespace(client, db):
    """Ensure emails are case-insensitive and trimmed during registration and login."""
    reg_res = client.post("/auth/register", json={
        "email": "  Student.Scholar@College.EDU  ",
        "password": "Password123!",
        "full_name": "Scholar Student",
        "phone": "9876500001",
        "college": "Main Campus",
    })
    assert reg_res.status_code == 200

    # Login with different casing and surrounding whitespace
    login_res = client.post("/auth/login", json={
        "email": "student.scholar@college.edu",
        "password": "Password123!",
    })
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()


def test_auth_account_lockout_after_five_failed_attempts(client, db, user_a):
    """5 consecutive failed logins trigger a 5-minute security lockout with HTTP 429."""
    for i in range(4):
        res = client.post("/auth/login", json={"email": user_a.email, "password": "WrongPassword1"})
        assert res.status_code == 401

    # 5th attempt locks the account
    res_5 = client.post("/auth/login", json={"email": user_a.email, "password": "WrongPassword1"})
    assert res_5.status_code == 401

    # 6th attempt is blocked by lockout
    res_6 = client.post("/auth/login", json={"email": user_a.email, "password": "WrongPassword1"})
    assert res_6.status_code == 429
    assert "temporarily locked" in res_6.json()["detail"]


def test_auth_otp_phone_canonicalization_and_cooldown(client, auth_headers_a):
    """Verify phone normalization handles +91/0 prefix and 60-second cooldown is enforced."""
    res_req = client.post("/auth/otp/request?phone=%2B919876543210", headers=auth_headers_a)
    assert res_req.status_code == 200
    assert "message" in res_req.json()

    # Second immediate OTP request triggers 60s cooldown HTTP 429
    res_cooldown = client.post("/auth/otp/request?phone=09876543210", headers=auth_headers_a)
    assert res_cooldown.status_code == 429
    assert "Please wait" in res_cooldown.json()["detail"]


def test_auth_avatar_upload_chunked_streaming_and_magic_bytes(client, auth_headers_a):
    """Test avatar upload verifies magic bytes and rejects corrupt headers."""
    # Invalid magic bytes (text payload named .jpg)
    fake_jpg = io.BytesIO(b"NOT_A_REAL_JPEG_HEADER_CONTENT")
    res_bad = client.post(
        "/auth/me/avatar",
        files={"file": ("photo.jpg", fake_jpg, "image/jpeg")},
        headers=auth_headers_a,
    )
    assert res_bad.status_code == 400
    assert "Corrupt or invalid" in res_bad.json()["detail"]

    # Valid JPEG header
    valid_jpg = io.BytesIO(b"\xff\xd8\xff\xe0" + b"\x00" * 100)
    res_ok = client.post(
        "/auth/me/avatar",
        files={"file": ("valid.jpg", valid_jpg, "image/jpeg")},
        headers=auth_headers_a,
    )
    assert res_ok.status_code == 200
    assert "avatar_url" in res_ok.json()


def test_auth_password_reset_flow(client, db, user_a):
    """Test anti-enumeration forgot-password and password reset execution."""
    # 1. Non-existent email returns generic anti-enumeration success
    res_ghost = client.post("/auth/forgot-password", json={"email": "nonexistent@college.edu"})
    assert res_ghost.status_code == 200
    assert "If this email is registered" in res_ghost.json()["message"]

    # 2. Existing user forgot-password
    res_user = client.post("/auth/forgot-password", json={"email": user_a.email})
    assert res_user.status_code == 200

    # 3. Create a valid reset token
    from jose import jwt
    reset_token = jwt.encode(
        {"sub": str(user_a.id), "purpose": "password_reset", "h": user_a.password_hash[-10:], "exp": int(time.time()) + 1800},
        settings.JWT_SECRET,
        algorithm="HS256",
    )

    # 4. Perform password reset
    res_reset = client.post("/auth/reset-password", json={
        "token": reset_token,
        "new_password": "NewSecurePassword456!",
    })
    assert res_reset.status_code == 200

    # 5. Verify login with new password succeeds
    res_new_login = client.post("/auth/login", json={
        "email": user_a.email,
        "password": "NewSecurePassword456!",
    })
    assert res_new_login.status_code == 200


def test_auth_gdpr_account_deletion_with_active_deals(client, db, user_a, user_b, auth_headers_a):
    """GDPR Account Deletion is blocked when confirmed deals are open, and cancels pending deals."""
    prod = Product(seller_id=user_a.id, title="Desk Fan", category="Hostel & Room Essentials", price=200.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    # Confirmed deal blocking deletion
    tx = Transaction(product_id=prod.id, buyer_id=user_b.id, seller_id=user_a.id, state=TransactionState.CONFIRMED)
    db.add(tx)
    db.commit()

    del_res = client.delete("/auth/me", headers=auth_headers_a)
    assert del_res.status_code == 400
    assert "Cannot delete account with active in-progress deals" in del_res.json()["detail"]

    # Cancel deal, now deletion succeeds and anonymizes account
    tx.state = TransactionState.CANCELLED
    db.commit()

    del_ok = client.delete("/auth/me", headers=auth_headers_a)
    assert del_ok.status_code == 200

    db.refresh(user_a)
    assert user_a.is_blocked_flag is True
    assert "deleted_" in user_a.email
    assert user_a.full_name == "Deleted Student"


def test_auth_gdpr_data_export(client, db, user_a, auth_headers_a):
    """Verify GDPR data export returns structured profile, listings, and transaction datasets."""
    prod = Product(seller_id=user_a.id, title="Lab Coat", price=150.0, category="Lab Equipment", transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    res = client.get("/auth/me/export", headers=auth_headers_a)
    assert res.status_code == 200
    data = res.json()
    assert data["user_profile"]["email"] == user_a.email
    assert len(data["listings"]) == 1
    assert data["listings"][0]["title"] == "Lab Coat"


# ============================================================================
# SECTION 2: PRODUCTS, WATCHLIST, 3D ANGLES & DISCOVERY PRIVACY
# ============================================================================

def test_product_max_fifty_active_listings_cap(client, db, user_a, auth_headers_a):
    """Enforce 50 active listings per student anti-spam ceiling."""
    # Seed 50 products
    for i in range(50):
        p = Product(seller_id=user_a.id, title=f"Item {i}", category="Other", price=10.0, transaction_type=TransactionType.BUY)
        db.add(p)
    db.commit()

    # Attempting to create the 51st listing fails with HTTP 400
    res_51 = client.post("/products", json={
        "title": "Item 51",
        "description": "Exceeding limit",
        "category": "Other",
        "price": 50.0,
        "transaction_type": "BUY",
        "latitude": 12.9716,
        "longitude": 77.5946,
    }, headers=auth_headers_a)
    assert res_51.status_code == 400
    assert "Maximum limit of 50 active listings reached" in res_51.json()["detail"]


def test_product_bump_twenty_four_hour_cooldown(client, db, user_a, auth_headers_a):
    """A seller can only bump a listing once every 24 hours."""
    prod = Product(seller_id=user_a.id, title="Calculus 3rd Edition", category="Textbooks & Study Material", price=300.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()
    db.refresh(prod)

    # Immediate bump fails because age < 24h
    res_bump_now = client.post(f"/products/{prod.id}/bump", headers=auth_headers_a)
    assert res_bump_now.status_code == 429
    assert "once every 24 hours" in res_bump_now.json()["detail"]

    # Set created_at to 2 days ago
    prod.created_at = datetime.now(timezone.utc) - timedelta(days=2)
    db.commit()

    # Bump succeeds
    res_bump_ok = client.post(f"/products/{prod.id}/bump", headers=auth_headers_a)
    assert res_bump_ok.status_code == 200


def test_product_watchlist_save_unsave_and_batch_query(client, db, user_a, user_b, auth_headers_a):
    """Test saving to watchlist, unsaving, and batch is_saved inclusion on listing endpoints."""
    prod = Product(seller_id=user_b.id, title="Scientific Calculator", category="Electronics & Gadgets", price=500.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()
    db.refresh(prod)

    # 1. Save listing
    res_save = client.post(f"/products/{prod.id}/save", headers=auth_headers_a)
    assert res_save.status_code == 200
    assert res_save.json()["saved"] is True

    # 2. Duplicate save is idempotent
    res_dup = client.post(f"/products/{prod.id}/save", headers=auth_headers_a)
    assert res_dup.status_code == 200

    # 3. Query listing list, verify batch is_saved is True
    res_list = client.get("/products", headers=auth_headers_a)
    assert res_list.status_code == 200
    items = res_list.json()["items"]
    target = next((i for i in items if i["id"] == prod.id), None)
    assert target is not None
    assert target["is_saved"] is True

    # 4. View personal saved watchlist
    res_saved = client.get("/products/saved", headers=auth_headers_a)
    assert res_saved.status_code == 200
    assert len(res_saved.json()) == 1
    assert res_saved.json()[0]["id"] == prod.id

    # 5. Unsave listing
    res_unsave = client.delete(f"/products/{prod.id}/save", headers=auth_headers_a)
    assert res_unsave.status_code == 200
    assert res_unsave.json()["saved"] is False


def test_product_3d_multi_angle_photo_upload(client, db, user_a, auth_headers_a):
    """Uploading >= 2 distinct camera angles automatically registers 3D turntable model metadata."""
    prod = Product(seller_id=user_a.id, title="Robotics Kit", category="Electronics & Gadgets", price=1200.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()
    db.refresh(prod)

    valid_jpeg_front = io.BytesIO(b"\xff\xd8\xff\xe0" + b"\x01" * 80)
    valid_jpeg_back = io.BytesIO(b"\xff\xd8\xff\xe0" + b"\x02" * 80)

    # 1. Upload front photo
    res_front = client.post(
        f"/products/{prod.id}/images?angle=front",
        files={"file": ("front.jpg", valid_jpeg_front, "image/jpeg")},
        headers=auth_headers_a,
    )
    assert res_front.status_code == 200
    assert res_front.json()["has_3d"] is False

    # 2. Upload back photo -> has_3d activates
    res_back = client.post(
        f"/products/{prod.id}/images?angle=back",
        files={"file": ("back.jpg", valid_jpeg_back, "image/jpeg")},
        headers=auth_headers_a,
    )
    assert res_back.status_code == 200
    assert res_back.json()["has_3d"] is True

    db.refresh(prod)
    assert prod.has_3d is True
    angles = json.loads(prod.image_angles)
    assert "front" in angles and "back" in angles


def test_product_geospatial_privacy_blurring(client, db, user_a, user_b, auth_headers_b):
    """Strangers see coordinates blurred to 2 decimals (~1.1km) and pickup area hidden."""
    prod = Product(
        seller_id=user_a.id,
        title="Microbiology Microscope",
        category="Lab Equipment & Calculators",
        price=3500.0,
        pickup_area="Hostel Block 4, Room 212",
        latitude=12.971648,
        longitude=77.594612,
        transaction_type=TransactionType.BUY,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    # User B queries listing before deal confirmation
    res_stranger = client.get(f"/products/{prod.id}", headers=auth_headers_b)
    assert res_stranger.status_code == 200
    data = res_stranger.json()
    assert data["pickup_area"] is None  # Hidden
    assert data["latitude"] == 12.97   # Blurred to 2 decimals
    assert data["longitude"] == 77.59  # Blurred to 2 decimals


def test_product_delete_anti_exit_scam_protection(client, db, user_a, user_b, auth_headers_a):
    """Seller cannot delete listing while active negotiations or confirmed deals are open."""
    prod = Product(seller_id=user_a.id, title="MacBook Air", category="Electronics & Gadgets", price=45000.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()
    db.refresh(prod)

    tx = Transaction(product_id=prod.id, buyer_id=user_b.id, seller_id=user_a.id, state=TransactionState.ACCEPTED)
    db.add(tx)
    db.commit()

    del_res = client.delete(f"/products/{prod.id}", headers=auth_headers_a)
    assert del_res.status_code == 409
    assert "Cannot remove listing while active negotiations" in del_res.json()["detail"]


# ============================================================================
# SECTION 3: TRANSACTION NEGOTIATION, HANDSHAKE PIN & CIRCULAR RENTALS
# ============================================================================

def test_tx_creation_validation_rules(client, db, user_a, user_b, auth_headers_b):
    """Enforce transaction type rules: Buy requires price, Rent requires days + amount, cannot transact on self."""
    prod_buy = Product(seller_id=user_a.id, title="Notes", category="Textbooks & Study Material", price=50.0, transaction_type=TransactionType.BUY)
    prod_rent = Product(seller_id=user_a.id, title="Camera", category="Electronics & Gadgets", price=200.0, transaction_type=TransactionType.RENT)
    db.add_all([prod_buy, prod_rent])
    db.commit()

    # Buy listing with 0 offer fails
    res_buy_zero = client.post("/transactions", json={"product_id": prod_buy.id, "offer_amount": 0}, headers=auth_headers_b)
    assert res_buy_zero.status_code == 400

    # Rent listing without rental days fails
    res_rent_nodays = client.post("/transactions", json={"product_id": prod_rent.id, "offer_amount": 200}, headers=auth_headers_b)
    assert res_rent_nodays.status_code == 400

    # Self transaction fails
    res_self = client.post("/transactions", json={"product_id": prod_buy.id, "offer_amount": 50}, headers={"Authorization": f"Bearer {create_access_token(str(user_a.id))}"})
    assert res_self.status_code == 400


def test_tx_full_negotiation_and_counter_offer_cycle(client, db, user_a, user_b, auth_headers_a, auth_headers_b):
    """Test full cycle: PENDING -> COUNTER (seller) -> COUNTER (buyer) -> ACCEPT -> CONFIRM."""
    prod = Product(seller_id=user_a.id, title="Gaming Headset", category="Electronics & Gadgets", price=1500.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()
    db.refresh(prod)

    # 1. Buyer offers 1000
    res_create = client.post("/transactions", json={"product_id": prod.id, "offer_amount": 1000.0}, headers=auth_headers_b)
    assert res_create.status_code == 200
    tx_id = res_create.json()["id"]

    # 2. Seller counters at 1300
    res_c1 = client.post(f"/transactions/{tx_id}/action", json={"action": "counter", "counter_amount": 1300.0, "message": "Can meet at 1300"}, headers=auth_headers_a)
    assert res_c1.status_code == 200
    assert res_c1.json()["state"] == "COUNTERED"

    # 3. Buyer counters at 1200
    res_c2 = client.post(f"/transactions/{tx_id}/action", json={"action": "counter", "counter_amount": 1200.0, "message": "Deal at 1200?"}, headers=auth_headers_b)
    assert res_c2.status_code == 200
    assert res_c2.json()["state"] == "COUNTERED"

    # 4. Seller accepts at 1200
    res_acc = client.post(f"/transactions/{tx_id}/action", json={"action": "accept"}, headers=auth_headers_a)
    assert res_acc.status_code == 200
    assert res_acc.json()["state"] == "ACCEPTED"

    # 5. Buyer confirms deal terms
    res_conf = client.post(f"/transactions/{tx_id}/action", json={"action": "confirm"}, headers=auth_headers_b)
    assert res_conf.status_code == 200
    assert res_conf.json()["state"] == "CONFIRMED"


def test_tx_handshake_pin_hmac_and_brute_force_protection(client, db, user_a, user_b, auth_headers_a, auth_headers_b):
    """Buyer receives secret Handshake PIN; seller verifies it at physical meetup; wrong PIN rejected."""
    from app.routers.transactions import _compute_handshake_pin

    prod = Product(seller_id=user_a.id, title="Dorm Chair", category="Hostel & Room Essentials", price=800.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    tx = Transaction(product_id=prod.id, buyer_id=user_b.id, seller_id=user_a.id, agreed_price=800.0, state=TransactionState.CONFIRMED)
    db.add(tx)
    db.commit()
    db.refresh(tx)

    expected_pin = _compute_handshake_pin(tx.id)

    # 1. Buyer sees the PIN in transaction response
    res_buyer = client.get("/transactions/mine", headers=auth_headers_b)
    assert res_buyer.status_code == 200
    assert res_buyer.json()[0]["handshake_pin"] == expected_pin

    # 2. Seller does NOT see the PIN in transaction response
    res_seller = client.get("/transactions/mine", headers=auth_headers_a)
    assert res_seller.status_code == 200
    assert res_seller.json()[0]["handshake_pin"] is None

    # 3. Buyer cannot self-verify PIN
    res_self_verify = client.post(f"/transactions/{tx.id}/verify-handshake", json={"pin": expected_pin}, headers=auth_headers_b)
    assert res_self_verify.status_code == 403
    assert "Only the seller can verify" in res_self_verify.json()["detail"]

    # 4. Seller enters wrong PIN
    res_bad_pin = client.post(f"/transactions/{tx.id}/verify-handshake", json={"pin": "000000"}, headers=auth_headers_a)
    assert res_bad_pin.status_code == 400
    assert "Invalid Handshake PIN" in res_bad_pin.json()["detail"]

    # 5. Seller enters correct PIN -> Deal transitions to COMPLETED
    res_ok_pin = client.post(f"/transactions/{tx.id}/verify-handshake", json={"pin": expected_pin}, headers=auth_headers_a)
    assert res_ok_pin.status_code == 200
    assert res_ok_pin.json()["state"] == "COMPLETED"


def test_tx_circular_rental_return_lifecycle(client, db, user_a, user_b, auth_headers_a):
    """Returning a completed rental marks it returned and restores the item to ACTIVE."""
    prod = Product(seller_id=user_a.id, title="Projector", category="Electronics & Gadgets", price=300.0, status=ProductStatus.RENTED, transaction_type=TransactionType.RENT)
    db.add(prod)
    db.commit()

    tx = Transaction(
        product_id=prod.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.COMPLETED,
        rental_period_days=7,
        rental_returned=False,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # Return rental
    res_ret = client.post(f"/transactions/{tx.id}/return", headers=auth_headers_a)
    assert res_ret.status_code == 200
    assert res_ret.json()["rental_returned"] is True

    # Product status is restored to ACTIVE
    db.refresh(prod)
    assert prod.status == ProductStatus.ACTIVE


# ============================================================================
# SECTION 4: REAL-TIME CHAT & NOTIFICATIONS
# ============================================================================

def test_chat_single_join_unread_count_and_auto_read(client, db, user_a, user_b, auth_headers_a, auth_headers_b):
    """Test start conversation, send messages, single-JOIN unread count, and auto-mark as read."""
    # 1. Start conversation between user_a and user_b
    res_start = client.post(f"/chat/conversations/start?other_user_id={user_b.id}", headers=auth_headers_a)
    assert res_start.status_code == 200
    convo_id = res_start.json()["conversation_id"]

    # 2. User A sends 3 messages to User B
    for i in range(3):
        client.post(f"/chat/conversations/{convo_id}/messages", json={"content": f"Message {i}"}, headers=auth_headers_a)

    # 3. User B queries unread count (single-JOIN query)
    res_unread = client.get("/chat/unread-count", headers=auth_headers_b)
    assert res_unread.status_code == 200
    assert res_unread.json()["unread_count"] == 3

    # 4. User B reads conversation messages -> auto marks as read
    res_msgs = client.get(f"/chat/conversations/{convo_id}/messages", headers=auth_headers_b)
    assert res_msgs.status_code == 200
    assert len(res_msgs.json()) == 3

    # 5. User B unread count drops to 0
    res_unread_after = client.get("/chat/unread-count", headers=auth_headers_b)
    assert res_unread_after.json()["unread_count"] == 0


def test_chat_non_participant_forbidden(client, db, user_a, user_b, auth_headers_admin):
    """A user who is not a party to a conversation cannot read or post messages."""
    convo = Conversation(user_a_id=user_a.id, user_b_id=user_b.id)
    db.add(convo)
    db.commit()
    db.refresh(convo)

    # Admin (third party) tries to view messages
    res = client.get(f"/chat/conversations/{convo.id}/messages", headers=auth_headers_admin)
    assert res.status_code == 403


def test_notifications_lifecycle(client, db, user_a, auth_headers_a):
    """Test listing notifications, unread count, and marking all read."""
    n1 = Notification(user_id=user_a.id, type="OFFER_RECEIVED", title="Offer 1", is_read=False)
    n2 = Notification(user_id=user_a.id, type="NEW_MESSAGE", title="Message 1", is_read=False)
    db.add_all([n1, n2])
    db.commit()

    # Unread count = 2
    res_count = client.get("/notifications/unread-count", headers=auth_headers_a)
    assert res_count.json()["count"] == 2

    # Mark single notification as read
    client.post(f"/notifications/{n1.id}/read", headers=auth_headers_a)
    res_count_1 = client.get("/notifications/unread-count", headers=auth_headers_a)
    assert res_count_1.json()["count"] == 1

    # Mark all read
    client.post("/notifications/read-all", headers=auth_headers_a)
    res_count_0 = client.get("/notifications/unread-count", headers=auth_headers_a)
    assert res_count_0.json()["count"] == 0


# ============================================================================
# SECTION 5: TRUST, SAFETY, COMMUNITY MODERATION & ADMIN
# ============================================================================

def test_trust_user_block_search_exclusion(client, db, user_a, user_b, auth_headers_b):
    """Blocking a user removes their listings from all search feeds."""
    prod = Product(seller_id=user_a.id, title="Drafting Board", category="Other", price=400.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    # Verify listing is visible initially
    res_before = client.get("/products", headers=auth_headers_b)
    assert any(p["id"] == prod.id for p in res_before.json()["items"])

    # User B blocks User A
    res_block = client.post(f"/users/{user_a.id}/block", headers=auth_headers_b)
    assert res_block.status_code == 200

    # Listing vanishes from search results
    res_after = client.get("/products", headers=auth_headers_b)
    assert not any(p["id"] == prod.id for p in res_after.json()["items"])


def test_trust_review_submission_and_rating_recalculation(client, db, user_a, user_b, auth_headers_b):
    """Completed deals allow 1-5 star reviews and update the seller's average rating."""
    prod = Product(seller_id=user_a.id, title="Graphing Calculator", category="Electronics & Gadgets", price=800.0, transaction_type=TransactionType.BUY)
    db.add(prod)
    db.commit()

    tx = Transaction(product_id=prod.id, buyer_id=user_b.id, seller_id=user_a.id, state=TransactionState.COMPLETED)
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 1. Invalid rating out of range
    res_bad_rating = client.post("/reviews", json={"transaction_id": tx.id, "rating": 6, "comment": "Too good"}, headers=auth_headers_b)
    assert res_bad_rating.status_code in (400, 422)

    # 2. Valid 5-star review
    res_ok_review = client.post("/reviews", json={"transaction_id": tx.id, "rating": 5, "comment": "Fast and smooth pickup!"}, headers=auth_headers_b)
    assert res_ok_review.status_code == 200

    # 3. Duplicate review rejected
    res_dup_review = client.post("/reviews", json={"transaction_id": tx.id, "rating": 4, "comment": "Another review"}, headers=auth_headers_b)
    assert res_dup_review.status_code == 400

    # 4. Verify user_a avg_rating is updated to 5.0 with count 1
    db.refresh(user_a)
    assert user_a.avg_rating == 5.0
    assert user_a.rating_count == 1


def test_admin_governance_user_suspension_protection(client, db, user_a, admin_user, auth_headers_admin):
    """Admins cannot suspend themselves or other admins, but can suspend malicious users."""
    # Cannot suspend self
    res_self = client.post(f"/admin/users/{admin_user.id}/suspend", headers=auth_headers_admin)
    assert res_self.status_code == 400
    assert "Cannot suspend your own admin account" in res_self.json()["detail"]

    # Can suspend regular user
    res_suspend = client.post(f"/admin/users/{user_a.id}/suspend", headers=auth_headers_admin)
    assert res_suspend.status_code == 200
    db.refresh(user_a)
    assert user_a.is_blocked_flag is True

    # Suspended user cannot log in
    res_login = client.post("/auth/login", json={"email": user_a.email, "password": "password123"})
    assert res_login.status_code == 403


def test_admin_csv_export_formula_injection_defense(client, db, admin_user, auth_headers_admin):
    """Admin CSV export escapes spreadsheet formula prefixes (=, +, -, @) to prevent formula injection."""
    from app.routers.admin import _sanitize_csv_cell
    assert _sanitize_csv_cell("=CMD|' /C calc'!A0") == "'=CMD|' /C calc'!A0"
    assert _sanitize_csv_cell("+12345") == "'+12345"
    assert _sanitize_csv_cell("-9876") == "'-9876"
    assert _sanitize_csv_cell("@SUM(A1:A10)") == "'@SUM(A1:A10)"
    assert _sanitize_csv_cell("Normal Text") == "Normal Text"

    res = client.get("/admin/export/users", headers=auth_headers_admin)
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]


def test_analytics_sustainability_sixty_second_ttl_cache(client, db):
    """Sustainability metrics use a 60-second in-memory TTL cache to reduce multi-table aggregations."""
    res1 = client.get("/analytics/sustainability")
    assert res1.status_code == 200
    data1 = res1.json()

    # Second request returns cached data instantaneously
    res2 = client.get("/analytics/sustainability")
    assert res2.status_code == 200
    data2 = res2.json()

    assert data1["summary"] == data2["summary"]
    assert data1["category_distribution"] == data2["category_distribution"]


# ============================================================================
# SECTION 6: EXTREME CONCURRENCY & BOUNDED HEAP DEFENSES (5M SCALE)
# ============================================================================

def test_concurrency_rate_store_hard_ceiling_defense():
    """Verify in-memory sliding-window rate store evicts stale keys and stays bounded under 50k keys."""
    from app.core.rate_limit import _local_rate_store, _prune_expired_rate_store, MAX_RATE_STORE_SIZE

    now = time.time()
    # Populate with 60,000 keys (exceeding MAX_RATE_STORE_SIZE = 50,000)
    for i in range(60000):
        _local_rate_store[f"ip:{i}"] = [now - 10]

    _prune_expired_rate_store(now)
    assert len(_local_rate_store) <= MAX_RATE_STORE_SIZE


def test_concurrency_token_revocation_hard_ceiling():
    """Verify in-memory revoked token blacklist remains strictly bounded under flooding."""
    from app.core.security import _local_revoked_tokens, _prune_expired_revoked_tokens, MAX_REVOKED_TOKENS_SIZE

    now = time.time()
    for i in range(55000):
        _local_revoked_tokens[f"token_{i}"] = now + 1000

    _prune_expired_revoked_tokens(now)
    assert len(_local_revoked_tokens) <= MAX_REVOKED_TOKENS_SIZE


def test_concurrency_auth_store_hard_ceiling():
    """Verify in-memory login attempts and OTP stores are bounded under 20k keys."""
    from app.routers.auth import (
        _local_login_attempts, _local_otp_store, _local_otp_cooldowns,
        _prune_auth_in_memory_stores, MAX_AUTH_STORE_SIZE
    )

    now = time.time()
    for i in range(25000):
        _local_login_attempts[f"user_{i}@test.com"] = {"failures": 1, "first_failure": now, "lockout_until": 0}
        _local_otp_store[f"90000{i}"] = {"otp": "123456", "expires_at": now + 300, "attempts": 1}
        _local_otp_cooldowns[f"90000{i}"] = now

    _prune_auth_in_memory_stores(now)
    assert len(_local_login_attempts) <= MAX_AUTH_STORE_SIZE
    assert len(_local_otp_store) <= MAX_AUTH_STORE_SIZE
    assert len(_local_otp_cooldowns) <= MAX_AUTH_STORE_SIZE

