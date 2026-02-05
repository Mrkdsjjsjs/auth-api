from fastapi import WebSocket
from typing import Dict, List, Optional
from sqlmodel import Session, select
import json
import asyncio


class ConnectionManager:
    """Manages WebSocket connections for real-time messaging"""

    def __init__(self):
        # user_id -> list of WebSocket connections
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        """Accept and store a new WebSocket connection"""
        await websocket.accept()

        if user_id not in self.active_connections:
            self.active_connections[user_id] = []

        self.active_connections[user_id].append(websocket)
        print(f"[WS Manager] User {user_id} connected, total connections: {len(self.active_connections[user_id])}")
        print(f"[WS Manager] All connected users: {list(self.active_connections.keys())}")

        # Set user online in Redis
        from app.services.redis_service import redis_service
        await redis_service.set_user_online(user_id)

    def disconnect(self, websocket: WebSocket, user_id: str):
        """Remove a WebSocket connection"""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)

            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_to_user(self, user_id: str, message: dict):
        """Send message to all connections of a specific user"""
        if user_id in self.active_connections:
            num_connections = len(self.active_connections[user_id])
            print(f"[WS Manager] Sending to user {user_id}, {num_connections} connections")
            disconnected = []
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                    print(f"[WS Manager] Sent message type {message.get('type')} to user {user_id}")
                except Exception as e:
                    print(f"[WS Manager] Failed to send to user {user_id}: {e}")
                    disconnected.append(connection)

            # Clean up disconnected connections
            for conn in disconnected:
                self.disconnect(conn, user_id)
        else:
            print(f"[WS Manager] User {user_id} has no active connections")

    async def send_to_chat(
        self,
        chat_id: str,
        message: dict,
        exclude_user: Optional[str] = None
    ):
        """Send message to all members of a chat"""
        # Skip if no active connections
        if not self.active_connections:
            return

        from app.database import engine
        from sqlmodel import Session as SQLSession
        from app.models.chat import ChatMember

        with SQLSession(engine) as session:
            members = session.exec(
                select(ChatMember.user_id).where(ChatMember.chat_id == chat_id)
            ).all()

            for user_id in members:
                if exclude_user and user_id == exclude_user:
                    continue
                await self.send_to_user(user_id, message)

    async def broadcast_user_status(self, user_id: str, is_online: bool):
        """Broadcast user online/offline status to their contacts"""
        from app.database import engine
        from sqlmodel import Session as SQLSession
        from app.models.chat import ChatMember
        from app.services.redis_service import redis_service

        # Update Redis
        if is_online:
            await redis_service.set_user_online(user_id)
        else:
            await redis_service.set_user_offline(user_id)

        # Skip DB query if no connections
        if not self.active_connections:
            return

        with SQLSession(engine) as session:
            # Get all chats user is member of
            user_chats = session.exec(
                select(ChatMember.chat_id).where(ChatMember.user_id == user_id)
            ).all()

            # Get all users in those chats
            contact_ids = set()
            for chat_id in user_chats:
                members = session.exec(
                    select(ChatMember.user_id).where(ChatMember.chat_id == chat_id)
                ).all()
                contact_ids.update(members)

            contact_ids.discard(user_id)

            event_type = "user_online" if is_online else "user_offline"
            for contact_id in contact_ids:
                await self.send_to_user(contact_id, {
                    "type": event_type,
                    "user_id": user_id
                })

    async def broadcast_typing(self, chat_id: str, user_id: str, is_typing: bool):
        """Broadcast typing indicator"""
        from app.services.redis_service import redis_service

        if is_typing:
            await redis_service.set_typing(chat_id, user_id)

        await self.send_to_chat(
            chat_id,
            {
                "type": "typing_start" if is_typing else "typing_stop",
                "user_id": user_id,
                "chat_id": chat_id
            },
            exclude_user=user_id
        )

    def is_user_online(self, user_id: str) -> bool:
        """Check if user has any active connections"""
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0


# Global connection manager instance
connection_manager = ConnectionManager()
