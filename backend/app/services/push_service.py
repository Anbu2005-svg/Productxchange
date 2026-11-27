"""Send encrypted browser push notifications from a bounded worker queue."""

import json
import logging
import threading
from typing import Any, Dict
from concurrent.futures import ThreadPoolExecutor
from time import sleep

from pywebpush import WebPushException, webpush
from requests.exceptions import RequestException
from app.core.config import settings

from app.core.database import SessionLocal
from app.models.notification import PushSubscription

logger = logging.getLogger("productxchange.push")

ALLOWED_PUSH_DOMAINS = (
    "fcm.googleapis.com",
    "push.apple.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "wns.windows.com",
    "android.googleapis.com",
)


def _is_safe_push_endpoint(endpoint: str) -> bool:
    if not endpoint or not endpoint.startswith("https://"):
        return False
    from urllib.parse import urlparse
    try:
        parsed = urlparse(endpoint)
        hostname = (parsed.hostname or "").lower()
        if not hostname or hostname in ("localhost", "127.0.0.1", "::1", "169.254.169.254"):
            return False
        for allowed in ALLOWED_PUSH_DOMAINS:
            if hostname == allowed or hostname.endswith("." + allowed):
                return True
    except Exception:
        return False
    return False


def push_enabled() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY and settings.VAPID_SUBJECT)


def _send_push_worker(user_id: int, payload: Dict[str, Any]):
    with SessionLocal() as db:
        subscriptions = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
        db.expunge_all()
    for sub in subscriptions:
        if not (_is_safe_push_endpoint(sub.endpoint) and sub.p256dh and sub.auth):
            continue
        for attempt in range(3):
            try:
                webpush(
                    {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=json.dumps(payload),
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": settings.VAPID_SUBJECT},
                    ttl=86400,
                    timeout=6,
                )
                logger.info("Web Push accepted for subscription %s", sub.id)
                break
            except WebPushException as exc:
                status = exc.response.status_code if exc.response is not None else None
                if status in (404, 410):
                    with SessionLocal() as db:
                        db.query(PushSubscription).filter(
                            PushSubscription.id == sub.id,
                            PushSubscription.user_id == user_id,
                            PushSubscription.p256dh == sub.p256dh,
                            PushSubscription.auth == sub.auth,
                        ).delete()
                        db.commit()
                    break
                if status not in (None, 429, 500, 502, 503, 504) or attempt == 2:
                    logger.warning("Web Push failed for subscription %s (%s)", sub.id, status)
                    break
                sleep(2 ** attempt)
            except RequestException as exc:
                if attempt < 2:
                    sleep(2 ** attempt)
                    continue
                logger.warning("Web Push network failure for subscription %s (%s)", sub.id, type(exc).__name__)
                break
            except Exception as exc:
                logger.warning("Web Push failed for subscription %s (%s)", sub.id, type(exc).__name__)
                break


_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="WebPush")
_pending = threading.BoundedSemaphore(100)


def dispatch_push_async(user_id: int, payload: Dict[str, Any]):
    if not push_enabled():
        return
    if not _pending.acquire(blocking=False):
        logger.warning("Web Push queue is full for user %s", user_id)
        return
    try:
        future = _executor.submit(_send_push_worker, user_id, payload)
    except RuntimeError:
        _pending.release()
        return
    def on_finish(result):
        _pending.release()
        if result.exception():
            logger.error("Web Push worker failed for user %s (%s)", user_id, type(result.exception()).__name__)

    future.add_done_callback(on_finish)
