from datetime import datetime, timedelta, timezone

import pytest

from app.models.notification import Notification
from app.models.product import Product, ProductStatus, TransactionType
from app.models.transaction import Transaction, TransactionState
from app.services import reminders


def make_product(db, seller, *, kind=TransactionType.BUY, age=0, status=ProductStatus.ACTIVE):
    product = Product(seller_id=seller.id, title="Campus calculator", category="Electronics", transaction_type=kind,
                      price=149.95, status=status, created_at=datetime.now(timezone.utc) - timedelta(days=age))
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def test_confirm_releases_competing_negotiations(client, db, user_a, user_b, admin_user,
                                                 auth_headers_a, auth_headers_b, auth_headers_admin):
    product = make_product(db, user_a)
    deals = []
    for headers in (auth_headers_b, auth_headers_admin):
        offer = client.post("/transactions", headers=headers, json={"product_id": product.id, "offer_amount": 149.95})
        assert offer.status_code == 200, offer.text
        deal = offer.json()["id"]
        assert client.post(f"/transactions/{deal}/action", headers=auth_headers_a,
                           json={"action": "accept"}).status_code == 200
        deals.append(deal)
    for deal, headers, expected in ((deals[0], auth_headers_b, 200), (deals[1], auth_headers_admin, 409),
                                     (deals[0], auth_headers_b, 200)):
        assert client.post(f"/transactions/{deal}/action", headers=headers,
                           json={"action": "confirm"}).status_code == expected
    assert db.get(Transaction, deals[1]).state == TransactionState.CANCELLED


def test_expiry_reminder_and_owner_renewal(client, db, monkeypatch, user_a, auth_headers_a, auth_headers_b):
    product = make_product(db, user_a, age=31)
    from contextlib import nullcontext

    monkeypatch.setattr(reminders, "SessionLocal", lambda: nullcontext(db))
    reminders.check_reminders()
    reminders.check_reminders()
    assert db.query(Notification).filter_by(user_id=user_a.id, type="LISTING_EXPIRY").count() == 1
    assert client.get("/products").json()["total_count"] == 0
    offer = {"product_id": product.id, "offer_amount": 149.95}
    assert client.post("/transactions", headers=auth_headers_b, json=offer).status_code == 409
    assert client.post(f"/products/{product.id}/renew", headers=auth_headers_b).status_code == 403
    renewed = client.post(f"/products/{product.id}/renew", headers=auth_headers_a)
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["is_expired"] is False
    assert client.get("/products").json()["total_count"] == 1


def test_rental_extensions_photos_and_disputes(client, db, user_a, user_b, auth_headers_a, auth_headers_b,
                                               auth_headers_admin, monkeypatch):
    from contextlib import nullcontext

    product = make_product(db, user_a, kind=TransactionType.RENT, status=ProductStatus.RENTED, age=31)
    original_due = datetime.now(timezone.utc) + timedelta(days=1)
    tx = Transaction(product_id=product.id, buyer_id=user_b.id, seller_id=user_a.id,
                     state=TransactionState.COMPLETED, rental_due_date=original_due, rental_period_days=7)
    db.add(tx)
    db.commit()
    path = f"/transactions/{tx.id}"
    monkeypatch.setattr(reminders, "SessionLocal", lambda: nullcontext(db))
    reminders.check_reminders()
    reminders.check_reminders()
    assert db.query(Notification).filter_by(type="RENTAL_DUE").count() == 2
    assert client.post(path + "/return", headers=auth_headers_b).status_code == 403
    assert client.post(path + "/rental-extension", headers=auth_headers_b, json={"days": 2}).status_code == 200
    assert client.post(path + "/rental-extension/approve", headers=auth_headers_b).status_code == 403
    extension = client.post(path + "/rental-extension/approve", headers=auth_headers_a)
    assert extension.status_code == 200, extension.text
    assert extension.json()["rental_period_days"] == 9
    photo = bytes.fromhex("ffd8ffe000104a4649460001ffd9")
    uploaded = client.post(path + "/condition-photo", headers=auth_headers_b,
                           files={"file": ("condition.jpg", photo, "image/jpeg")})
    assert uploaded.status_code == 200, uploaded.text
    assert client.get(path + "/condition-photo/renter", headers=auth_headers_admin).status_code == 403
    permitted = client.get(path + "/condition-photo/renter", headers=auth_headers_a)
    assert permitted.content == photo
    assert permitted.headers["cache-control"] == "private, no-store"
    assert client.post(path + "/rental-dispute", headers=auth_headers_b,
                       json={"details": "Please review the condition at handover"}).status_code == 200
    for _ in range(2):
        assert client.post(path + "/return", headers=auth_headers_a).json()["rental_returned"]
    assert client.get("/products").json()["total_count"] == 1


def test_password_reset_revokes_cookie_and_bearer_sessions(client, user_a):
    login = client.post("/auth/login", json={"email": user_a.email, "password": "password123"})
    assert login.status_code == 200
    assert "HttpOnly" in login.headers["set-cookie"]
    access = login.json()["access_token"]
    assert client.get("/auth/me").status_code == 200
    with client.websocket_connect("/notifications/ws") as ws:
        ws.send_text("ping")
        assert ws.receive_text() == "pong"
    assert client.patch("/auth/me", headers={"Origin": "https://untrusted.example"},
                        json={"full_name": "Blocked"}).status_code == 403
    reset = client.post("/auth/forgot-password", json={"email": user_a.email}).json()["dev_reset_token"]
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + reset}).status_code == 401
    assert client.post("/auth/reset-password", json={"token": reset, "new_password": "newpassword123"}).status_code == 200
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + access}).status_code == 401
    assert client.post("/auth/login", json={"email": user_a.email, "password": "newpassword123"}).status_code == 200
    assert client.get("/auth/me").status_code == 200


def test_web_push_encrypts_and_signs_payload(db, user_a, monkeypatch):
    import base64
    from contextlib import nullcontext
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    import requests
    from app.models.notification import PushSubscription
    from app.services import push_service

    encode = lambda data: base64.urlsafe_b64encode(data).decode().rstrip("=")
    vapid = ec.generate_private_key(ec.SECP256R1())
    client_key = ec.generate_private_key(ec.SECP256R1()).public_key()
    subscription = PushSubscription(
        user_id=user_a.id, endpoint="https://fcm.googleapis.com/push/integration",
        p256dh=encode(client_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)),
        auth=encode(b"0123456789abcdef"),
    )
    db.add(subscription)
    db.commit()
    monkeypatch.setattr(push_service, "SessionLocal", lambda: nullcontext(db))
    monkeypatch.setattr(push_service.settings, "VAPID_PRIVATE_KEY", encode(vapid.private_bytes(
        serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())))
    monkeypatch.setattr(push_service.settings, "VAPID_SUBJECT", "mailto:push@example.com")
    captured = []

    def submit(url, **kwargs):
        captured.append(kwargs)
        response = requests.Response()
        response.status_code = 201
        return response

    monkeypatch.setattr(requests, "post", submit)
    push_service._send_push_worker(user_a.id, {"title": "Campus reminder"})
    assert len(captured) == 1
    headers = {key.lower(): value for key, value in captured[0]["headers"].items()}
    assert headers["content-encoding"] == "aes128gcm"
    assert headers["authorization"].lower().startswith("vapid ")
    assert b"Campus reminder" not in captured[0]["data"]


def test_realtime_relay_distributes_to_remote_worker(monkeypatch):
    import asyncio
    import json
    from app.core import websocket

    async def check():
        class Relay:
            def __init__(self):
                self.messages = asyncio.Queue()
                self.ready = asyncio.Event()

            def pubsub(self):
                return self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                pass

            async def subscribe(self, channel):
                self.ready.set()

            async def get_message(self, **kwargs):
                return {"type": "message", "data": await self.messages.get()}

            async def publish(self, channel, message):
                await self.messages.put(message)

            async def aclose(self):
                pass

        class Socket:
            def __init__(self):
                self.outbox = asyncio.Queue()

            async def send_text(self, data):
                await self.outbox.put(json.loads(data))

        relay = Relay()
        monkeypatch.setattr(websocket.Redis, "from_url", lambda *args, **kwargs: relay)
        local = websocket.ConnectionManager()
        remote = websocket.ConnectionManager()
        local.redis = relay
        source_socket = Socket()
        remote_socket = Socket()
        local.chat_connections[3] = {source_socket}
        remote.chat_connections[3] = {remote_socket}
        task = asyncio.create_task(remote.listen())
        try:
            await asyncio.wait_for(relay.ready.wait(), 1)
            await local.broadcast_chat(3, {"content": "Cross-worker message"})
            assert await asyncio.wait_for(remote_socket.outbox.get(), 1) == {"content": "Cross-worker message"}
            assert await asyncio.wait_for(source_socket.outbox.get(), 1) == {"content": "Cross-worker message"}
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(check())


@pytest.mark.parametrize("database", ["sqlite", "postgresql"])
def test_concurrent_confirmation(database, tmp_path, monkeypatch):
    import os
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from uuid import uuid4

    from fastapi import HTTPException
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker
    from app.core.database import Base, SessionLocal, is_sqlite, register_sqlite_functions
    from app.routers import transactions
    from app.models.user import User
    from app.routers.transactions import _get_tx_or_404
    from app.services.transaction_service import TransactionService

    if database == "postgresql":
        if os.getenv("PX_TEST_POSTGRES") != "1" or is_sqlite:
            pytest.skip("Requires a migrated, disposable PostgreSQL/PostGIS database.")
    else:
        engine = create_engine(f"sqlite:///{(tmp_path / 'concurrency.db').as_posix()}")
        event.listen(engine, "connect", register_sqlite_functions)
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine)
        monkeypatch.setattr(transactions, "is_sqlite", True)
    key = uuid4().hex
    with SessionLocal() as db:
        users = [User(email=f"{key}-{i}@example.test", password_hash="test-only") for i in range(3)]
        db.add_all(users)
        db.flush()
        user_ids = [user.id for user in users]
        product = make_product(db, users[0])
        product_id = product.id
        deals = [Transaction(product_id=product_id, buyer_id=buyer_id, seller_id=user_ids[0],
                             state=TransactionState.ACCEPTED) for buyer_id in user_ids[1:]]
        db.add_all(deals)
        db.flush()
        deal_ids = [deal.id for deal in deals]
        db.commit()
    barrier = Barrier(2)

    def confirm(deal_id):
        with SessionLocal() as db:
            barrier.wait(timeout=5)
            try:
                deal = _get_tx_or_404(deal_id, db, for_update=True)
                return TransactionService(db).confirm(deal, deal.buyer_id).state.value
            except HTTPException as error:
                return error.status_code

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(confirm, deal_ids))
        assert results.count("CONFIRMED") == results.count(409) == 1
        with SessionLocal() as db:
            states = {db.get(Transaction, deal_id).state for deal_id in deal_ids}
            assert states == {TransactionState.CONFIRMED, TransactionState.CANCELLED}
    finally:
        with SessionLocal() as db:
            db.query(Notification).filter(Notification.user_id.in_(user_ids)).delete()
            db.query(Transaction).filter(Transaction.id.in_(deal_ids)).delete()
            db.query(Product).filter(Product.id == product_id).delete()
            db.query(User).filter(User.id.in_(user_ids)).delete()
            db.commit()
