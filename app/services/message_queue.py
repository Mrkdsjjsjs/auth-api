"""
Redis-based message queue for WebSocket scaling.
Allows multiple server instances to broadcast messages to all connected clients.
"""
import asyncio
import json
from typing import Callable, Optional
from app.services.redis_service import redis_service


class MessageQueue:
    """Redis Pub/Sub message queue for WebSocket events"""

    CHANNEL_PREFIX = "messenger:"
    CHANNELS = {
        "messages": "messenger:messages",      # New messages
        "typing": "messenger:typing",          # Typing indicators
        "presence": "messenger:presence",      # Online/offline status
        "notifications": "messenger:notifications",  # Push notifications
    }

    def __init__(self):
        self._listener_task: Optional[asyncio.Task] = None
        self._handlers: dict[str, list[Callable]] = {}

    async def start(self):
        """Start listening to Redis channels"""
        if not redis_service.redis:
            return

        # Subscribe to all channels
        pubsub = redis_service.redis.pubsub()
        await pubsub.subscribe(*self.CHANNELS.values())

        # Start listener task
        self._listener_task = asyncio.create_task(self._listen(pubsub))

    async def stop(self):
        """Stop the listener"""
        if self._listener_task:
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass

    async def _listen(self, pubsub):
        """Listen for messages from Redis"""
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    channel = message["channel"]
                    try:
                        data = json.loads(message["data"])
                        await self._handle_message(channel, data)
                    except json.JSONDecodeError:
                        pass
        except asyncio.CancelledError:
            await pubsub.close()
            raise

    async def _handle_message(self, channel: str, data: dict):
        """Handle incoming message from queue"""
        # Route to appropriate handler
        handlers = self._handlers.get(channel, [])
        for handler in handlers:
            try:
                await handler(data)
            except Exception as e:
                print(f"Handler error: {e}")

    def on(self, channel: str, handler: Callable):
        """Register a handler for a channel"""
        if channel not in self._handlers:
            self._handlers[channel] = []
        self._handlers[channel].append(handler)

    # Publishing methods
    async def publish_message(self, chat_id: str, message: dict):
        """Publish new message event"""
        await redis_service.publish(
            self.CHANNELS["messages"],
            {
                "event": "new_message",
                "chat_id": chat_id,
                "message": message
            }
        )

    async def publish_message_edit(self, chat_id: str, message: dict):
        """Publish message edited event"""
        await redis_service.publish(
            self.CHANNELS["messages"],
            {
                "event": "message_edited",
                "chat_id": chat_id,
                "message": message
            }
        )

    async def publish_message_delete(self, chat_id: str, message_id: str):
        """Publish message deleted event"""
        await redis_service.publish(
            self.CHANNELS["messages"],
            {
                "event": "message_deleted",
                "chat_id": chat_id,
                "message_id": message_id
            }
        )

    async def publish_typing(self, chat_id: str, user_id: str, is_typing: bool):
        """Publish typing indicator"""
        await redis_service.publish(
            self.CHANNELS["typing"],
            {
                "event": "typing_start" if is_typing else "typing_stop",
                "chat_id": chat_id,
                "user_id": user_id
            }
        )

    async def publish_presence(self, user_id: str, is_online: bool):
        """Publish user online/offline status"""
        await redis_service.publish(
            self.CHANNELS["presence"],
            {
                "event": "user_online" if is_online else "user_offline",
                "user_id": user_id
            }
        )

    async def publish_read_receipt(self, chat_id: str, user_id: str, message_id: str):
        """Publish read receipt"""
        await redis_service.publish(
            self.CHANNELS["messages"],
            {
                "event": "read_receipt",
                "chat_id": chat_id,
                "user_id": user_id,
                "message_id": message_id
            }
        )


# Global instance
message_queue = MessageQueue()


async def setup_queue_handlers():
    """Setup handlers for queue messages"""
    from app.services.websocket import connection_manager

    async def handle_message_event(data: dict):
        """Handle message events from queue"""
        event = data.get("event")
        chat_id = data.get("chat_id")

        if event == "new_message":
            await connection_manager.send_to_chat(
                chat_id,
                {"type": "new_message", "message": data.get("message")}
            )
        elif event == "message_edited":
            await connection_manager.send_to_chat(
                chat_id,
                {"type": "message_edited", "message": data.get("message")}
            )
        elif event == "message_deleted":
            await connection_manager.send_to_chat(
                chat_id,
                {"type": "message_deleted", "message_id": data.get("message_id"), "chat_id": chat_id}
            )
        elif event == "read_receipt":
            await connection_manager.send_to_chat(
                chat_id,
                {
                    "type": "read_receipt",
                    "user_id": data.get("user_id"),
                    "message_id": data.get("message_id"),
                    "chat_id": chat_id
                }
            )

    async def handle_typing_event(data: dict):
        """Handle typing events from queue"""
        event = data.get("event")
        chat_id = data.get("chat_id")
        user_id = data.get("user_id")

        await connection_manager.send_to_chat(
            chat_id,
            {"type": event, "user_id": user_id, "chat_id": chat_id},
            exclude_user=user_id
        )

    async def handle_presence_event(data: dict):
        """Handle presence events from queue"""
        event = data.get("event")
        user_id = data.get("user_id")

        # Broadcast to all contacts
        await connection_manager.broadcast_user_status(user_id, event == "user_online")

    # Register handlers
    message_queue.on(MessageQueue.CHANNELS["messages"], handle_message_event)
    message_queue.on(MessageQueue.CHANNELS["typing"], handle_typing_event)
    message_queue.on(MessageQueue.CHANNELS["presence"], handle_presence_event)
