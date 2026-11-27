from typing import Dict, Set, Any
import asyncio
import json
from uuid import uuid4

from redis.asyncio import Redis
from redis.exceptions import RedisError
from app.core.config import settings
import logging
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages real-time WebSocket connections for chat conversations and live notifications."""

    def __init__(self):
        self.worker_id = uuid4().hex
        self.loop = None
        self.redis = None
        # Maps conversation_id -> set of active WebSockets
        self.chat_connections: Dict[int, Set[WebSocket]] = {}
        # Maps user_id -> set of active notification WebSockets
        self.user_connections: Dict[int, Set[WebSocket]] = {}

    async def listen(self):
        redis = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=2)
        self.redis = redis
        try:
            while True:
                try:
                    async with redis.pubsub() as channel:
                        await channel.subscribe("productxchange:realtime")
                        while True:
                            packet = await channel.get_message(ignore_subscribe_messages=True, timeout=1)
                            if packet is not None and packet["type"] == "message":
                                event = json.loads(packet["data"])
                                if event["worker"] != self.worker_id:
                                    await self.deliver_local(event["kind"], event["id"], event["payload"])
                except (RedisError, OSError, ValueError) as exc:
                    logger.debug("Redis real-time delivery unavailable: %s", type(exc).__name__)
                    await asyncio.sleep(2)
        finally:
            self.redis = None
            await redis.aclose()

    async def broadcast(self, kind, recipient, payload):
        if self.redis is not None:
            try:
                await self.redis.publish("productxchange:realtime", json.dumps({
                    "worker": self.worker_id, "kind": kind, "id": recipient, "payload": payload,
                }, default=str))
            except (RedisError, OSError):
                logger.debug("Using local real-time delivery")
        await self.deliver_local(kind, recipient, payload)

    async def deliver_local(self, kind, recipient, payload):
        if kind == "chat":
            await self._broadcast_chat_local(recipient, payload)
        elif kind == "user":
            await self._send_user_local(recipient, payload)

    def schedule_user_notification(self, user_id, payload):
        if self.loop and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(
                lambda: asyncio.create_task(self.send_user_notification(user_id, payload))
            )

    async def broadcast_chat(self, conversation_id, message_data):
        await self.broadcast("chat", conversation_id, message_data)

    async def send_user_notification(self, user_id, notification_data):
        await self.broadcast("user", user_id, notification_data)

    async def connect_chat(self, conversation_id: int, websocket: WebSocket):
        await websocket.accept()
        conns = self.chat_connections.setdefault(conversation_id, set())
        # Evict oldest socket if connection count exceeds limit (prevents FD starvation)
        if len(conns) >= 10:
            oldest = next(iter(conns))
            try:
                await oldest.close(code=1000)
            except Exception:
                pass
            conns.discard(oldest)
        conns.add(websocket)
        logger.info(f"WebSocket connected to chat {conversation_id}. Total: {len(conns)}")

    def disconnect_chat(self, conversation_id: int, websocket: WebSocket):
        if conversation_id in self.chat_connections:
            self.chat_connections[conversation_id].discard(websocket)
            if not self.chat_connections[conversation_id]:
                del self.chat_connections[conversation_id]
        logger.info(f"WebSocket disconnected from chat {conversation_id}")

    async def _broadcast_chat_local(self, conversation_id: int, message_data: Dict[str, Any]):
        """Broadcast a chat message to all connected peers in this conversation."""
        if conversation_id not in self.chat_connections:
            return

        payload = json.dumps(message_data, default=str)
        dead_sockets = set()
        for ws in list(self.chat_connections[conversation_id]):
            try:
                await ws.send_text(payload)
            except Exception as e:
                logger.warning(f"Error sending to chat socket: {e}")
                dead_sockets.add(ws)

        for dead in dead_sockets:
            self.disconnect_chat(conversation_id, dead)

    async def connect_user(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        conns = self.user_connections.setdefault(user_id, set())
        # Evict oldest notification socket if client opens > 10 connections
        if len(conns) >= 10:
            oldest = next(iter(conns))
            try:
                await oldest.close(code=1000)
            except Exception:
                pass
            conns.discard(oldest)
        conns.add(websocket)
        logger.info(f"User {user_id} connected to notification WebSocket. Total: {len(conns)}")

    def disconnect_user(self, user_id: int, websocket: WebSocket):
        if user_id in self.user_connections:
            self.user_connections[user_id].discard(websocket)
            if not self.user_connections[user_id]:
                del self.user_connections[user_id]
        logger.info(f"User {user_id} disconnected from notification WebSocket.")

    async def _send_user_local(self, user_id: int, notification_data: Dict[str, Any]):
        """Push an instant alert or deal notification to a specific user."""
        if user_id not in self.user_connections:
            return

        payload = json.dumps(notification_data, default=str)
        dead_sockets = set()
        for ws in list(self.user_connections[user_id]):
            try:
                await ws.send_text(payload)
            except Exception as e:
                logger.warning(f"Error sending notification to user {user_id}: {e}")
                dead_sockets.add(ws)

        for dead in dead_sockets:
            self.disconnect_user(user_id, dead)


manager = ConnectionManager()
