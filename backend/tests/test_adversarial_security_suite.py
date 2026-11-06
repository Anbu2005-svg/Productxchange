import io
import pytest
from jose import jwt

from app.core.config import settings
from app.core.security import hash_password, create_access_token
from app.models.user import User
from app.models.product import Product, ProductStatus, TransactionType
from app.models.transaction import Transaction, TransactionState


@pytest.fixture
def admin_user(db):
    admin = User(
        email="root_admin@college.edu",
        password_hash=hash_password("AdminPass123!"),
        full_name="Root Admin",
        college="Admin HQ",
        is_admin=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


@pytest.fixture
def admin_headers(admin_user):
    token = create_access_token(subject=str(admin_user.id))
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def other_admin_user(db):
    admin = User(
        email="sec_admin@college.edu",
        password_hash=hash_password("AdminPass123!"),
        full_name="Secondary Admin",
        college="Admin HQ",
        is_admin=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    return admin


@pytest.fixture
def sample_product(db, user_a):
    prod = Product(
        seller_id=user_a.id,
        title="Gaming Laptop RTX 4060",
        description="Pristine condition laptop with charger",
        category="Electronics & Gadgets",
        condition="Like New",
        price=65000.0,
        transaction_type=TransactionType.BUY,
        latitude=12.9716,
        longitude=77.5946,
        pickup_area="Library Entrance",
        status=ProductStatus.ACTIVE,
    )
    db.add(prod)
    db.commit()
    db.refresh(prod)
    return prod


def test_adversarial_jwt_none_algorithm_and_tampered_signature(client, user_a):
    import base64

    # 1. Attacker crafts raw unsigned token with alg: none
    h = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=")
    p = base64.urlsafe_b64encode(f'{{"sub":"{user_a.id}"}}'.encode()).decode().rstrip("=")
    forged_none_token = f"{h}.{p}."
    res = client.get("/auth/me", headers={"Authorization": f"Bearer {forged_none_token}"})
    assert res.status_code == 401

    # 2. Attacker modifies signature
    valid_token = create_access_token(subject=str(user_a.id))
    tampered_token = valid_token[:-6] + "xxxxxx"
    res = client.get("/auth/me", headers={"Authorization": f"Bearer {tampered_token}"})
    assert res.status_code == 401

    # 3. Garbage token
    res = client.get("/auth/me", headers={"Authorization": "Bearer not.a.real.jwt.token"})
    assert res.status_code == 401


def test_adversarial_profile_mass_assignment_and_xss(client, user_a, auth_headers_a):
    # 1. Attacker tries mass-assignment privilege escalation to gain admin status
    res = client.patch(
        "/auth/me",
        json={"is_admin": True, "full_name": "Attacker Admin"},
        headers=auth_headers_a,
    )
    assert res.status_code == 422  # Extra fields forbidden

    # 2. Attacker injects stored XSS payloads into profile
    xss_payload = "<script>alert('XSS')</script>Student Name"
    res = client.patch(
        "/auth/me",
        json={"full_name": xss_payload, "college": "<img src=x onerror=alert(1)>"},
        headers=auth_headers_a,
    )
    assert res.status_code == 200
    data = res.json()
    assert "<script>" not in data["full_name"]
    assert "&lt;script&gt;" in data["full_name"] or "Student Name" in data["full_name"]
    assert "<img" not in data["college"]


def test_adversarial_password_reset_policy_enforcement_and_reuse(client, user_a):
    # 1. Request password reset
    res = client.post("/auth/forgot-password", json={"email": user_a.email})
    assert res.status_code == 200
    reset_token = res.json().get("dev_reset_token")
    assert reset_token is not None

    # 2. Attacker tries resetting to a weak password (bypassing complexity policy)
    weak_res = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "weakpassword"},
    )
    assert weak_res.status_code == 422  # Complexity check fails

    # 3. Reset to strong password
    strong_res = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "StrongPassword123!"},
    )
    assert strong_res.status_code == 200

    # 4. Attacker tries re-using the exact same reset token
    reused_res = client.post(
        "/auth/reset-password",
        json={"token": reset_token, "new_password": "AnotherPassword123!"},
    )
    assert reused_res.status_code == 400
    assert "already been used" in reused_res.json()["detail"].lower()


def test_adversarial_product_delete_rug_pull_blocked(client, user_a, user_b, auth_headers_a, auth_headers_b, sample_product):
    # 1. Buyer creates deal on sample product
    tx_res = client.post(
        "/transactions",
        json={"product_id": sample_product.id, "offer_amount": 60000.0},
        headers=auth_headers_b,
    )
    assert tx_res.status_code == 200

    # 2. Seller attempts to rug-pull / exit-scam by deleting the listing while deal is open
    del_res = client.delete(f"/products/{sample_product.id}", headers=auth_headers_a)
    assert del_res.status_code == 409
    assert "active negotiations" in del_res.json()["detail"].lower()


def test_adversarial_transact_on_sold_or_removed_product_blocked(client, user_a, user_b, auth_headers_a, auth_headers_b, sample_product, db):
    # 1. Mark product as SOLD
    sample_product.status = ProductStatus.SOLD
    db.commit()

    # 2. Buyer tries to initiate transaction on sold item
    tx_res = client.post(
        "/transactions",
        json={"product_id": sample_product.id, "offer_amount": 50000.0},
        headers=auth_headers_b,
    )
    assert tx_res.status_code == 400
    assert "inactive or already sold" in tx_res.json()["detail"].lower()


def test_adversarial_blocked_user_cannot_transact(client, user_a, user_b, auth_headers_a, auth_headers_b, sample_product):
    # 1. User A blocks User B
    block_res = client.post(f"/users/{user_b.id}/block", headers=auth_headers_a)
    assert block_res.status_code == 200

    # 2. User B tries to initiate transaction on User A's listing
    tx_res = client.post(
        "/transactions",
        json={"product_id": sample_product.id, "offer_amount": 60000.0},
        headers=auth_headers_b,
    )
    assert tx_res.status_code == 403
    assert "blocked user" in tx_res.json()["detail"].lower()


def test_adversarial_chat_with_suspended_or_ghost_product_blocked(client, user_a, user_b, auth_headers_a, auth_headers_b, db):
    # 1. Attempt to start chat with a non-existent product_id
    ghost_res = client.post(
        f"/chat/conversations/start?other_user_id={user_b.id}&product_id=999999",
        headers=auth_headers_a,
    )
    assert ghost_res.status_code == 404
    assert "product not found" in ghost_res.json()["detail"].lower()

    # 2. Start valid conversation
    convo_res = client.post(
        f"/chat/conversations/start?other_user_id={user_b.id}",
        headers=auth_headers_a,
    )
    assert convo_res.status_code == 200
    convo_id = convo_res.json()["conversation_id"]

    # 3. Admin suspends User B
    user_b.is_blocked_flag = True
    db.commit()

    # 4. User A tries to send message to now-suspended User B
    msg_res = client.post(
        f"/chat/conversations/{convo_id}/messages",
        json={"content": "Are you still available?"},
        headers=auth_headers_a,
    )
    assert msg_res.status_code == 403
    assert "suspended" in msg_res.json()["detail"].lower()


def test_adversarial_report_and_block_edge_cases(client, user_a, admin_user, auth_headers_a):
    # 1. Report non-existent user
    res1 = client.post(
        "/reports",
        json={"reported_user_id": 888888, "reason": "Scamming"},
        headers=auth_headers_a,
    )
    assert res1.status_code == 404

    # 2. Report non-existent product
    res2 = client.post(
        "/reports",
        json={"reported_product_id": 999999, "reason": "Fake item"},
        headers=auth_headers_a,
    )
    assert res2.status_code == 404

    # 3. Block non-existent user
    res3 = client.post("/users/777777/block", headers=auth_headers_a)
    assert res3.status_code == 404

    # 4. Attempt to block an administrator
    res4 = client.post(f"/users/{admin_user.id}/block", headers=auth_headers_a)
    assert res4.status_code == 400
    assert "cannot block an administrator" in res4.json()["detail"].lower()


def test_adversarial_review_loopholes(client, user_a, user_b, auth_headers_a, auth_headers_b, sample_product, db):
    # 1. Create deal
    tx = Transaction(
        product_id=sample_product.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.ACCEPTED,
        agreed_price=60000.0,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 2. Attempt to review transaction before completion (state = ACCEPTED)
    res_premature = client.post(
        "/reviews",
        json={"transaction_id": tx.id, "rating": 5, "comment": "Great deal!"},
        headers=auth_headers_b,
    )
    assert res_premature.status_code == 400
    assert "completed transactions" in res_premature.json()["detail"].lower()

    # 3. Third-party hacker tries to review someone else's transaction
    user_c = User(
        email="hacker_c@college.edu",
        password_hash=hash_password("Pass123!"),
        full_name="Third Party",
    )
    db.add(user_c)
    db.commit()
    db.refresh(user_c)
    token_c = create_access_token(subject=str(user_c.id))

    res_third_party = client.post(
        "/reviews",
        json={"transaction_id": tx.id, "rating": 1, "comment": "Fake review"},
        headers={"Authorization": f"Bearer {token_c}"},
    )
    assert res_third_party.status_code == 403


def test_adversarial_handshake_pin_spoofing_and_tampering(client, user_a, user_b, auth_headers_a, auth_headers_b, sample_product, db):
    # 1. Set deal to CONFIRMED
    tx = Transaction(
        product_id=sample_product.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.CONFIRMED,
        agreed_price=60000.0,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 2. Check seller view — PIN MUST NOT be visible to seller
    seller_view = client.get("/transactions/mine", headers=auth_headers_a).json()
    seller_tx = next(t for t in seller_view if t["id"] == tx.id)
    assert seller_tx["handshake_pin"] is None

    # 3. Check buyer view — PIN IS visible to buyer
    buyer_view = client.get("/transactions/mine", headers=auth_headers_b).json()
    buyer_tx = next(t for t in buyer_view if t["id"] == tx.id)
    buyer_pin = buyer_tx["handshake_pin"]
    assert buyer_pin is not None

    # 4. Buyer attempts to self-verify their own PIN (bypassing physical handover)
    self_verify = client.post(
        f"/transactions/{tx.id}/verify-handshake",
        json={"pin": buyer_pin},
        headers=auth_headers_b,
    )
    assert self_verify.status_code == 403
    assert "only the seller can verify" in self_verify.json()["detail"].lower()

    # 5. Seller attempts wrong PIN
    bad_verify = client.post(
        f"/transactions/{tx.id}/verify-handshake",
        json={"pin": "000000"},
        headers=auth_headers_a,
    )
    assert bad_verify.status_code == 400
    assert "invalid handshake pin" in bad_verify.json()["detail"].lower()


def test_adversarial_admin_endpoints_idor_and_rbac(client, user_a, admin_headers, auth_headers_a):
    # 1. Regular student tries accessing admin endpoints
    assert client.get("/admin/stats", headers=auth_headers_a).status_code == 403
    assert client.get("/admin/users", headers=auth_headers_a).status_code == 403
    assert client.get("/admin/reports", headers=auth_headers_a).status_code == 403

    # 2. Admin calls with non-existent listing
    res_missing = client.post("/admin/listings/999999/remove", headers=admin_headers)
    assert res_missing.status_code == 404


def test_adversarial_file_upload_loopholes(client, user_a, auth_headers_a):
    # 1. Attempt uploading executable file masquerading as image
    exe_content = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00"
    res1 = client.post(
        "/auth/me/avatar",
        files={"file": ("malware.exe", io.BytesIO(exe_content), "application/x-msdownload")},
        headers=auth_headers_a,
    )
    assert res1.status_code == 400

    # 2. Attempt uploading file with .png extension but corrupted / non-image bytes
    fake_png = b"NotAPngImageAtAllHeader123456789"
    res2 = client.post(
        "/auth/me/avatar",
        files={"file": ("fake.png", io.BytesIO(fake_png), "image/png")},
        headers=auth_headers_a,
    )
    assert res2.status_code == 400
    assert "invalid image format" in res2.json()["detail"].lower()


def test_adversarial_transaction_state_jump_attacks(client, user_a, user_b, auth_headers_a, auth_headers_b, sample_product, db):
    # 1. Start transaction (state PENDING)
    tx = Transaction(
        product_id=sample_product.id,
        buyer_id=user_b.id,
        seller_id=user_a.id,
        state=TransactionState.PENDING,
        agreed_price=60000.0,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # 2. Buyer tries jumping straight to CONFIRM without offer being accepted
    res_jump_confirm = client.post(
        f"/transactions/{tx.id}/action",
        json={"action": "confirm"},
        headers=auth_headers_b,
    )
    assert res_jump_confirm.status_code == 409

    # 3. Seller tries jumping straight to COMPLETE
    res_jump_complete = client.post(
        f"/transactions/{tx.id}/action",
        json={"action": "complete"},
        headers=auth_headers_a,
    )
    assert res_jump_complete.status_code == 409
