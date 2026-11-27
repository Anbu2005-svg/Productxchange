import asyncio
import ipaddress
from typing import Optional, Dict, Any, Literal, get_args
from urllib.parse import urlparse
from pydantic import BaseModel, ConfigDict
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query, status, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import event, select, text

from app.core.database import get_db, is_sqlite
from app.core.security import get_current_user, decode_session
from app.core.rate_limit import check_rate_limit
from app.core.websocket import manager
from app.models.user import User
from app.models.notification import MutedNotification, Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])

DISALLOWED_PUSH_HOSTS = {
    "localhost", "127.0.0.1", "::1", "0.0.0.0", "169.254.169.254", "metadata.google.internal"
}

ALLOWED_PUSH_DOMAINS = (
    "fcm.googleapis.com",
    "push.apple.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "wns.windows.com",
    "android.googleapis.com",
)


def _is_allowed_push_host(hostname: str) -> bool:
    for allowed in ALLOWED_PUSH_DOMAINS:
        if hostname == allowed or hostname.endswith("." + allowed):
            return True
    return False


class PushSubscriptionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    endpoint: str
    p256dh: Optional[str] = None
    auth: Optional[str] = None


def _validate_push_endpoint(endpoint: str):
    if not endpoint or len(endpoint) > 1024:
        raise HTTPException(status_code=400, detail="Invalid push subscription endpoint length")
    if not endpoint.startswith("https://"):
        raise HTTPException(status_code=400, detail="Push subscription endpoint must use HTTPS")
    try:
        parsed = urlparse(endpoint)
        hostname = (parsed.hostname or "").lower()
        if not hostname or hostname in DISALLOWED_PUSH_HOSTS:
            raise HTTPException(status_code=400, detail="Disallowed push endpoint host")

        # SSRF defense: block private, loopback, link-local, and reserved IP ranges
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise HTTPException(status_code=400, detail="Private network endpoints are forbidden")
        except ValueError:
            pass

        if hostname.startswith("10.") or hostname.startswith("192.168.") or hostname.startswith("172."):
            raise HTTPException(status_code=400, detail="Private network endpoints are forbidden")

        # Restrict strictly to recognized browser push service domains to prevent internal SSRF & DNS rebinding
        if not _is_allowed_push_host(hostname):
            raise HTTPException(status_code=400, detail="Push service gateway not recognized or untrusted")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed push endpoint URL")



# In-memory fallback cache for fast push dispatch (bounded to prevent heap exhaustion)
_push_subscriptions: Dict[int, list] = {}
MAX_PUSH_CACHE_USERS = 10000

Category = Literal["offers", "rentals", "listing_expiry", "saved_searches", "messages"]
EVENT_CATEGORIES = {
    **dict.fromkeys(("OFFER_RECEIVED", "OFFER_ACCEPTED", "OFFER_REJECTED", "COUNTER_OFFER",
                     "DEAL_CANCELLED", "DEAL_CONFIRMED", "DEAL_COMPLETED"), "offers"),
    **dict.fromkeys(("RENTAL_DUE", "RENTAL_EXTENSION", "RENTAL_RETURNED"), "rentals"),
    "LISTING_EXPIRY": "listing_expiry", "SAVED_SEARCH_MATCH": "saved_searches", "NEW_MESSAGE": "messages",
}


class PreferenceChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


@router.get("/preferences")
def preferences(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    muted = set(db.scalars(select(MutedNotification.category).where(MutedNotification.user_id == user.id)))
    return {category: category not in muted for category in get_args(Category)}


@router.put("/preferences/{category}")
def change_preference(category: Category, change: PreferenceChange,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if change.enabled:
        db.query(MutedNotification).filter_by(user_id=user.id, category=category).delete()
    else:
        db.execute(text("INSERT INTO muted_notifications (user_id, category) VALUES (:uid, :category) "
                        "ON CONFLICT (user_id, category) DO NOTHING"), {"uid": user.id, "category": category})
    db.commit()
    return preferences(user, db)


def create_notification(db: Session, user_id: int, type: str, title: str, message: str = None, link: str = None):
    """Helper to create a notification from anywhere in the app and broadcast via live WebSocket."""
    category = EVENT_CATEGORIES.get(type)
    if category and db.get(MutedNotification, (user_id, category)) is not None:
        if link == "/deals":
            db.info.setdefault("silent_deal_updates", set()).add(user_id)
        return
    queue_notification(db, user_id, type, title, message, link)


def queue_notification(db, user_id, type, title, message, link):
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        message=message,
        link=link,
    )
    db.add(notif)
    # Don't commit here — let the caller commit as part of their transaction

    db.info.setdefault("notifications_to_deliver", []).append(notif)


@event.listens_for(Session, "after_commit")
def deliver_committed_notifications(db):
    from app.services.push_service import dispatch_push_async

    for user_id in db.info.pop("silent_deal_updates", set()):
        manager.schedule_user_notification(user_id, {"deal_update": True})
    for notif in db.info.pop("notifications_to_deliver", []):
        manager.schedule_user_notification(notif.user_id, {
            "id": notif.id, "type": notif.type, "title": notif.title,
            "message": notif.message, "link": notif.link, "deal_update": notif.link == "/deals",
        })
        dispatch_push_async(notif.user_id, {
            "type": notif.type, "title": notif.title,
            "body": notif.message, "url": notif.link,
        })


@event.listens_for(Session, "after_rollback")
def discard_rolled_back_notifications(db):
    db.info.pop("silent_deal_updates", None)
    db.info.pop("notifications_to_deliver", None)


@router.get("")
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(30)
        .all()
    )


@router.get("/unread-count")
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.is_read == False)  # noqa: E712
        .count()
    )
    return {"count": count}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == user.id,
    ).first()
    if notif:
        notif.is_read = True
        db.commit()
    return {"message": "Marked as read"}


@router.post("/read-all")
def mark_all_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(
        Notification.user_id == user.id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return {"message": "All notifications marked as read"}


@router.websocket("/ws")
async def websocket_notifications(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Real-time push notifications socket."""
    from app.core.config import settings
    origin = websocket.headers.get("origin")
    if origin and origin not in settings.CORS_ORIGINS:
        await websocket.close(code=1008)
        return
    auth_token = token
    if not auth_token:
        cookie_token = websocket.cookies.get("access_token")
        if cookie_token:
            auth_token = cookie_token[7:] if cookie_token.startswith("Bearer ") else cookie_token

    if not auth_token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        subject, version = decode_session(auth_token)
        user_id = int(subject)
        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.is_blocked_flag or user.session_version != version:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect_user(user.id, websocket)
    db.rollback()
    try:
        while True:
            try:
                packet = await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                packet = None
            try:
                _, current_version = decode_session(auth_token)
                current = db.query(User.session_version, User.is_blocked_flag).filter(User.id == user_id).first()
                if not current or current[0] != current_version or current[1]:
                    await websocket.close(code=1008)
                    break
            except HTTPException:
                await websocket.close(code=1008)
                break
            finally:
                db.rollback()
            if packet is None:
                continue
            data = packet
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_user(user_id, websocket)


@router.get("/push-config")
def get_push_config():
    """Returns Web Push service configuration and public key for browser subscription."""
    from app.services.push_service import push_enabled
    from app.core.config import settings

    return {
        "enabled": push_enabled(),
        "publicKey": settings.VAPID_PUBLIC_KEY,
        "service": "web-push-pwa",
    }


@router.post("/push-subscription")
def subscribe_push(
    payload: PushSubscriptionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Registers or updates a browser Web Push subscription for the authenticated student."""
    if not payload.endpoint:
        raise HTTPException(status_code=400, detail="Missing subscription endpoint")

    # Security: Validate push endpoint to protect against SSRF and internal scanning
    _validate_push_endpoint(payload.endpoint)

    # Retain the subscription lookup cache for existing callers.
    # Remove endpoint from other users' lists if device was reassigned / relogged
    for uid, sub_list in list(_push_subscriptions.items()):
        if uid != user.id:
            _push_subscriptions[uid] = [s for s in sub_list if s.get("endpoint") != payload.endpoint]

    subs = _push_subscriptions.setdefault(user.id, [])
    existing_idx = next((i for i, s in enumerate(subs) if s.get("endpoint") == payload.endpoint), None)
    if existing_idx is not None:
        subs[existing_idx] = payload.model_dump()
    else:
        subs.append(payload.model_dump())

    # Bound in-memory cache size to prevent memory leaks under massive scale
    if len(_push_subscriptions) > MAX_PUSH_CACHE_USERS:
        for old_uid in list(_push_subscriptions.keys())[:len(_push_subscriptions) - MAX_PUSH_CACHE_USERS]:
            _push_subscriptions.pop(old_uid, None)

    # Persist to database (atomic ON CONFLICT reassigns endpoint across users safely)
    try:
        if is_sqlite:
            db.execute(
                text("""
                    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                    VALUES (:user_id, :endpoint, :p256dh, :auth)
                    ON CONFLICT(endpoint) DO UPDATE SET
                        user_id = excluded.user_id,
                        p256dh = excluded.p256dh,
                        auth = excluded.auth
                """),
                {"user_id": user.id, "endpoint": payload.endpoint, "p256dh": payload.p256dh, "auth": payload.auth},
            )
        else:
            db.execute(
                text("""
                    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                    VALUES (:user_id, :endpoint, :p256dh, :auth)
                    ON CONFLICT(endpoint) DO UPDATE SET
                        user_id = EXCLUDED.user_id,
                        p256dh = EXCLUDED.p256dh,
                        auth = EXCLUDED.auth
                """),
                {"user_id": user.id, "endpoint": payload.endpoint, "p256dh": payload.p256dh, "auth": payload.auth},
            )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="Could not save the push subscription.") from exc

    return {"status": "subscribed", "endpoint": payload.endpoint}


@router.post("/test-push")
async def send_test_push(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sends a real-time push notification test to the current user's devices."""
    # Security: Rate limit test pushes to 6 per minute to prevent flooding
    allowed, retry_after = check_rate_limit(f"test_push:{user.id}", 6, 60)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many test notifications. Please wait {retry_after} seconds before testing again.",
        )

    test_title = "🔔 ProductXchange Alert"
    test_message = "Push notifications are active! You'll receive instant alerts for offers and meetup handoffs."
    test_link = "/deals"

    # Save as notification
    create_notification(
        db=db,
        user_id=user.id,
        type="PUSH_TEST",
        title=test_title,
        message=test_message,
        link=test_link,
    )
    db.commit()

    from app.models.notification import PushSubscription
    subs_count = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).count()

    return {
        "success": True,
        "title": test_title,
        "message": test_message,
        "subscribers_active": subs_count,
    }


