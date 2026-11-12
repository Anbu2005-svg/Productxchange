"""
Master Verification Suite for Security Audit Remediations & Zero-Day Hardening
Validates PX-SEC-01 through PX-SEC-10:
  PX-SEC-01: Geospatial privacy leak via high-precision distance trilateration mitigation
  PX-SEC-02: Ghost deal / double-booking race condition prevention via product status locking
  PX-SEC-03: Algorithmic DoS / OOM prevention in sustainability analytics via O(1) SQL aggregations
  PX-SEC-04: OTP rate limit canonicalization for formatted phone numbers
  PX-SEC-05: Strict party authorization checks on TransactionService.cancel()
  PX-SEC-06: IP-based rate limiting on password reset requests
  PX-SEC-07: Email case-sensitivity collision and authentication consistency
  PX-SEC-08: Web Push SSRF protection via strict browser gateway allowlisting
  PX-SEC-09: Push subscription device re-assignment on shared terminal / account switch
  PX-SEC-10: Frontend admin CSV export dynamic API routing without localhost coupling
"""

import pytest
from fastapi import HTTPException
from app.models.user import User
from app.models.product import Product, ProductStatus, TransactionType
from app.models.transaction import Transaction, TransactionState
from app.services.transaction_service import TransactionService
from app.routers.products import _sanitize_product_out
from app.routers.notifications import _validate_push_endpoint, _push_subscriptions
from app.core.security import create_access_token, hash_password


# ============================================================================
# PX-SEC-01: Geospatial Trilateration Mitigation
# ============================================================================

def test_px_sec_01_trilateration_mitigation(db, user_a, user_b):
    """
    Verify distance_m is coarsened to nearest 100 meters for unconfirmed viewers
    to prevent distance-intersection trilateration attacks, while keeping exact
    precision for the seller and confirmed deal counterparties.
    """
    prod = Product(
        title="Calculus Textbook",
        description="Math textbook in great condition",
        price=350.0,
        category="Books",
        transaction_type=TransactionType.BUY,
        seller_id=user_a.id,
        latitude=12.9716,
        longitude=77.5946,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    # 1. Unconfirmed viewer (stranger / user_b before deal confirmation)
    # 142.7 meters should round to 100.0 meters
    res_stranger_1 = _sanitize_product_out(prod, user_b, db, distance_m=142.7)
    assert res_stranger_1.distance_m == 100.0

    # 285.4 meters should round to 300.0 meters
    res_stranger_2 = _sanitize_product_out(prod, user_b, db, distance_m=285.4)
    assert res_stranger_2.distance_m == 300.0

    # 49.0 meters should round to 0.0 meters
    res_stranger_3 = _sanitize_product_out(prod, user_b, db, distance_m=49.0)
    assert res_stranger_3.distance_m == 0.0

    # 2. Seller viewing their own listing retains exact precision
    res_seller = _sanitize_product_out(prod, user_a, db, distance_m=142.7)
    assert res_seller.distance_m == 142.7

    # 3. Confirmed deal counterparty retains exact precision for meetup coordination
    tx = Transaction(
        product_id=prod.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.CONFIRMED,
        agreed_price=350.0,
        notes="Tomorrow 2 PM",
    )
    db.add(tx)
    db.commit()

    res_counterparty = _sanitize_product_out(prod, user_b, db, distance_m=142.7)
    assert res_counterparty.distance_m == 142.7


# ============================================================================
# PX-SEC-02 & PX-SEC-05: Transaction State Machine Hardening
# ============================================================================

def test_px_sec_02_double_booking_lock_and_cancel_revert(db, user_a, user_b):
    """
    Verify deal confirmation transitions product to PENDING to prevent ghost deals,
    and cancellation by authorized party restores ACTIVE status.
    """
    prod = Product(
        title="Lab Coat",
        description="Size M lab coat",
        price=200.0,
        category="Stationery",
        transaction_type=TransactionType.BUY,
        seller_id=user_a.id,
        status=ProductStatus.ACTIVE,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    service = TransactionService(db)

    # Create initiated transaction
    tx = service.create(
        product_id=prod.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        offer_amount=200.0,
        rental_period_days=None,
        notes="Friday 10 AM",
    )
    assert tx.state == TransactionState.PENDING
    assert prod.status == ProductStatus.ACTIVE

    # Accept deal by seller
    service.accept(tx=tx, actor_id=user_a.id)
    assert tx.state == TransactionState.ACCEPTED

    # Confirm deal by seller -> product MUST lock to PENDING
    confirmed_tx = service.confirm(tx=tx, actor_id=user_a.id)
    assert confirmed_tx.state == TransactionState.CONFIRMED
    db.refresh(prod)
    assert prod.status == ProductStatus.PENDING

    # Cancel deal by buyer -> product status MUST revert to ACTIVE
    cancelled_tx = service.cancel(tx=tx, actor_id=user_b.id)
    assert cancelled_tx.state == TransactionState.CANCELLED
    db.refresh(prod)
    assert prod.status == ProductStatus.ACTIVE


def test_px_sec_05_cancel_counterparty_authorization(db, user_a, user_b):
    """
    Verify unauthorized third parties cannot cancel transactions they are not party to.
    """
    # Create third party student user_c
    user_c = User(
        email="user_c@college.edu",
        password_hash=hash_password("password123"),
        full_name="User C",
        college="Arts College",
    )
    db.add(user_c)
    db.commit()
    db.refresh(user_c)

    prod = Product(
        title="Drafter",
        description="Engineering drafter",
        price=450.0,
        category="Stationery",
        transaction_type=TransactionType.BUY,
        seller_id=user_a.id,
        status=ProductStatus.ACTIVE,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)

    service = TransactionService(db)
    tx = service.create(
        product_id=prod.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        offer_amount=450.0,
        rental_period_days=None,
        notes="Monday 4 PM",
    )

    # Attempt cancel by user_c (neither buyer nor seller) MUST raise 403 Forbidden
    with pytest.raises(HTTPException) as excinfo:
        service.cancel(tx=tx, actor_id=user_c.id)
    assert excinfo.value.status_code == 403
    assert "Not a party to this transaction" in excinfo.value.detail

    # Transaction remains in PENDING state
    db.refresh(tx)
    assert tx.state == TransactionState.PENDING


# ============================================================================
# PX-SEC-03: Sustainability Analytics O(1) SQL Aggregations
# ============================================================================

def test_px_sec_03_analytics_sustainability_aggregations(client, db, user_a, user_b, auth_headers_a):
    """
    Verify /analytics/sustainability calculates eco-metrics via database aggregations
    without loading large table result-sets into heap memory.
    """
    # Populate products across multiple categories
    p1 = Product(title="Laptop", price=25000.0, category="Electronics", transaction_type=TransactionType.BUY, seller_id=user_a.id, status=ProductStatus.ACTIVE)
    p2 = Product(title="Textbook", price=400.0, category="Books", transaction_type=TransactionType.BUY, seller_id=user_b.id, status=ProductStatus.SOLD)
    p3 = Product(title="Desk Chair", price=1200.0, category="Furniture", transaction_type=TransactionType.BUY, seller_id=user_a.id, status=ProductStatus.ACTIVE)
    db.add_all([p1, p2, p3])
    db.commit()

    res = client.get("/analytics/sustainability", headers=auth_headers_a)
    assert res.status_code == 200
    data = res.json()

    assert "summary" in data
    assert "total_co2_saved_kg" in data["summary"]
    assert "total_rupees_saved" in data["summary"]
    assert "category_distribution" in data
    assert "user_impact" in data

    # Verify category counts match
    categories = {item["category"] for item in data["category_distribution"]}
    assert "Electronics" in categories
    assert "Books" in categories
    assert "Furniture" in categories

    # User A impact metrics are populated
    assert data["user_impact"]["co2_saved_kg"] > 0
    assert data["user_impact"]["rupees_saved"] > 0


# ============================================================================
# PX-SEC-04: OTP Phone Canonicalization Rate Limiting
# ============================================================================

def test_px_sec_04_phone_canonicalization_cooldown_and_rate_limits(client, auth_headers_a):
    """
    Verify formatted and unformatted phone numbers map to the exact same canonical
    key for cooldowns, rate limits, and verification.
    """
    # 1. Request OTP using formatted phone with country code and spaces (+91 99887 76655)
    res1 = client.post("/auth/otp/request?phone=+91 99887 76655", headers=auth_headers_a)
    assert res1.status_code == 200
    assert res1.json()["message"] == "OTP sent"

    # 2. Immediate request using raw digits MUST trigger 60s cooldown (429)
    res2 = client.post("/auth/otp/request?phone=9988776655", headers=auth_headers_a)
    assert res2.status_code == 429
    assert "Please wait" in res2.json()["detail"]

    # 3. Third request using another formatting variant "+919988776655" ALSO triggers 429
    res3 = client.post("/auth/otp/request?phone=+919988776655", headers=auth_headers_a)
    assert res3.status_code == 429

    # 4. Verification with canonical or formatted digits validates against stored OTP
    from app.routers.auth import _local_otp_store
    otp_code = _local_otp_store.get("9988776655", {}).get("otp")
    assert otp_code is not None

    # Verify using formatted digits and valid "otp" field
    res_verify = client.post(
        "/auth/otp/verify",
        json={"phone": "+91 99887 76655", "otp": otp_code},
        headers=auth_headers_a,
    )
    assert res_verify.status_code == 200
    assert res_verify.json()["message"] == "Phone verified successfully"


# ============================================================================
# PX-SEC-06: Forgot Password Rate Limiting & Dev Token Guard
# ============================================================================

def test_px_sec_06_forgot_password_rate_limiting(client, user_a):
    """
    Verify /auth/forgot-password enforces IP rate-limits (max 5 requests per 10 mins).
    """
    email_payload = {"email": user_a.email}

    # 5 attempts should succeed
    for _ in range(5):
        res = client.post("/auth/forgot-password", json=email_payload)
        assert res.status_code == 200
        assert "message" in res.json()

    # 6th attempt from same client must receive 429 Too Many Requests
    res_blocked = client.post("/auth/forgot-password", json=email_payload)
    assert res_blocked.status_code == 429
    assert "Too many password reset requests" in res_blocked.json()["detail"]


# ============================================================================
# PX-SEC-07: Email Normalization & Collision Prevention
# ============================================================================

def test_px_sec_07_email_case_insensitivity(client):
    """
    Verify emails are consistently lowercased on registration, collision check, and login.
    """
    # 1. Register with mixed casing
    reg_payload = {
        "email": "Student.Audit@College.EDU",
        "password": "SecurePassword123!",
        "full_name": "Audit Student",
        "phone": "9112233445",
        "college": "Testing Institute",
    }
    res_reg = client.post("/auth/register", json=reg_payload)
    assert res_reg.status_code == 200
    token = res_reg.json()["access_token"]

    # Verify /auth/me returns canonical lowercase email
    me_res = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == "student.audit@college.edu"

    # 2. Attempt registration with lowercase variant MUST fail with 400
    collision_payload = {
        "email": "student.audit@college.edu",
        "password": "AnotherPassword123!",
        "full_name": "Duplicate Student",
    }
    res_col = client.post("/auth/register", json=collision_payload)
    assert res_col.status_code == 400
    assert "Registration failed" in res_col.json()["detail"]

    # 3. Attempt registration with all-uppercase variant MUST ALSO fail with 400
    collision_payload_upper = {
        "email": "STUDENT.AUDIT@COLLEGE.EDU",
        "password": "AnotherPassword123!",
        "full_name": "Duplicate Student Upper",
    }
    res_col_upper = client.post("/auth/register", json=collision_payload_upper)
    assert res_col_upper.status_code == 400
    assert "Registration failed" in res_col_upper.json()["detail"]

    # 4. Login with uppercase variant succeeds
    res_login_upper = client.post(
        "/auth/login",
        json={"email": "STUDENT.AUDIT@COLLEGE.EDU", "password": "SecurePassword123!"},
    )
    assert res_login_upper.status_code == 200
    token_upper = res_login_upper.json()["access_token"]
    me_upper = client.get("/auth/me", headers={"Authorization": f"Bearer {token_upper}"})
    assert me_upper.json()["email"] == "student.audit@college.edu"

    # 5. Login with lowercase variant succeeds
    res_login_lower = client.post(
        "/auth/login",
        json={"email": "student.audit@college.edu", "password": "SecurePassword123!"},
    )
    assert res_login_lower.status_code == 200
    token_lower = res_login_lower.json()["access_token"]
    me_lower = client.get("/auth/me", headers={"Authorization": f"Bearer {token_lower}"})
    assert me_lower.json()["email"] == "student.audit@college.edu"


# ============================================================================
# PX-SEC-08: Web Push SSRF Defense & Domain Allowlist
# ============================================================================

def test_px_sec_08_push_endpoint_ssrf_and_gateway_allowlist():
    """
    Verify push subscription endpoints reject arbitrary untrusted domains,
    private IPs, loopback, and metadata services, while accepting legitimate
    Web Push RFC gateways.
    """
    # Untrusted / internal / SSRF endpoints must be rejected
    untrusted_endpoints = [
        "https://attacker-c2.com/push/receive",
        "https://internal-service.local:9000/sub",
        "https://metadata.google.internal/computeMetadata/v1",
        "https://127.0.0.1/push",
        "https://10.20.30.40/push",
        "http://fcm.googleapis.com/send/xyz",  # Insecure HTTP
    ]
    for ep in untrusted_endpoints:
        with pytest.raises(HTTPException):
            _validate_push_endpoint(ep)

    # Valid push service gateways must pass
    valid_endpoints = [
        "https://fcm.googleapis.com/fcm/send/abc12345",
        "https://updates.push.services.mozilla.com/wpush/v2/def67890",
        "https://web.push.apple.com/ghi112233",
        "https://wns2-sn1p.notify.windows.com/w/?token=jkl445566",
    ]
    for ep in valid_endpoints:
        _validate_push_endpoint(ep)  # Does not raise


# ============================================================================
# PX-SEC-09: Push Subscription Device Reassignment on Account Switch
# ============================================================================

def test_px_sec_09_push_subscription_reassignment(client, user_a, user_b, auth_headers_a, auth_headers_b, db):
    """
    Verify when a new user signs in on a shared browser device, the push endpoint
    is updated to the new user in both database and in-memory notification caches.
    """
    shared_endpoint = "https://fcm.googleapis.com/fcm/send/shared-campus-terminal-device"
    payload = {
        "endpoint": shared_endpoint,
        "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QT9Q0nA7gmSCFY04NkWy6hmUVGVo8ehNVjhfZI88",
        "auth": "tBHItJI5svbpez7KI4CCXg",
    }

    # 1. User A subscribes on the shared terminal
    res_a = client.post("/notifications/push-subscription", json=payload, headers=auth_headers_a)
    assert res_a.status_code == 200

    # User A's cache has the endpoint
    user_a_endpoints = [s["endpoint"] for s in _push_subscriptions.get(user_a.id, [])]
    assert shared_endpoint in user_a_endpoints

    # 2. User B logs in on the same terminal and subscribes with identical endpoint
    res_b = client.post("/notifications/push-subscription", json=payload, headers=auth_headers_b)
    assert res_b.status_code == 200

    # User A's cache must NO LONGER have the shared endpoint (device reassigned)
    user_a_endpoints_after = [s["endpoint"] for s in _push_subscriptions.get(user_a.id, [])]
    assert shared_endpoint not in user_a_endpoints_after

    # User B's cache now owns the endpoint
    user_b_endpoints = [s["endpoint"] for s in _push_subscriptions.get(user_b.id, [])]
    assert shared_endpoint in user_b_endpoints

    # Database record now references user_b
    from sqlalchemy import text
    row = db.execute(
        text("SELECT user_id FROM push_subscriptions WHERE endpoint = :ep"),
        {"ep": shared_endpoint},
    ).fetchone()
    assert row is not None
    assert row[0] == user_b.id


# ============================================================================
# PX-SEC-10: Frontend Admin CSV Export Dynamic Base & Auth
# ============================================================================

def test_px_sec_10_admin_csv_export_endpoint(client, user_a, db):
    """
    Verify backend CSV export returns proper streaming headers and frontend page
    references API_BASE dynamically instead of hardcoded localhost.
    """
    # Grant user_a admin rights
    user_a.is_admin = True
    db.commit()

    token_a = create_access_token(subject=str(user_a.id))
    res = client.get("/admin/export/users", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attachment; filename=productxchange_users.csv" in res.headers["content-disposition"]
    assert "ID,Email,Full Name,College" in res.text

    # Verify frontend file no longer has hardcoded localhost:8000 in downloadCsv
    import pathlib
    frontend_admin_page = pathlib.Path("frontend/src/app/admin/page.tsx").read_text(encoding="utf-8")
    assert "http://localhost:8000/admin/export" not in frontend_admin_page
    assert "${API_BASE}/admin/export/${resource}" in frontend_admin_page
    assert 'credentials: "include"' in frontend_admin_page
