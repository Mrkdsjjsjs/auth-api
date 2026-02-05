import redis.asyncio as redis
import json
from typing import Optional, Any
from app.config import REDIS_URL


class RedisService:
    """Redis service for caching and pub/sub"""

    def __init__(self):
        self.redis: Optional[redis.Redis] = None
        self.pubsub: Optional[redis.client.PubSub] = None

    async def connect(self):
        """Connect to Redis"""
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        self.pubsub = self.redis.pubsub()

    async def disconnect(self):
        """Disconnect from Redis"""
        if self.pubsub:
            await self.pubsub.close()
        if self.redis:
            await self.redis.close()

    # Cache operations
    async def get(self, key: str) -> Optional[str]:
        """Get value from cache"""
        if not self.redis:
            return None
        return await self.redis.get(key)

    async def set(self, key: str, value: Any, expire: int = 300):
        """Set value in cache with expiration (default 5 min)"""
        if not self.redis:
            return
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        await self.redis.set(key, value, ex=expire)

    async def delete(self, key: str):
        """Delete key from cache"""
        if not self.redis:
            return
        await self.redis.delete(key)

    # Pub/Sub operations
    async def publish(self, channel: str, message: dict):
        """Publish message to channel"""
        if not self.redis:
            return
        await self.redis.publish(channel, json.dumps(message))

    async def subscribe(self, channel: str):
        """Subscribe to channel"""
        if not self.pubsub:
            return
        await self.pubsub.subscribe(channel)

    async def unsubscribe(self, channel: str):
        """Unsubscribe from channel"""
        if not self.pubsub:
            return
        await self.pubsub.unsubscribe(channel)

    # User presence
    async def set_user_online(self, user_id: str):
        """Mark user as online"""
        if not self.redis:
            return
        await self.redis.sadd("online_users", user_id)
        await self.redis.set(f"user:{user_id}:last_seen", "now", ex=60)

    async def set_user_offline(self, user_id: str):
        """Mark user as offline"""
        if not self.redis:
            return
        await self.redis.srem("online_users", user_id)

    async def is_user_online(self, user_id: str) -> bool:
        """Check if user is online"""
        if not self.redis:
            return False
        return await self.redis.sismember("online_users", user_id)

    async def get_online_users(self) -> set:
        """Get all online user IDs"""
        if not self.redis:
            return set()
        return await self.redis.smembers("online_users")

    # Typing indicators
    async def set_typing(self, chat_id: str, user_id: str):
        """Set user typing in chat (expires in 5 seconds)"""
        if not self.redis:
            return
        await self.redis.set(f"typing:{chat_id}:{user_id}", "1", ex=5)

    async def get_typing_users(self, chat_id: str) -> list:
        """Get users currently typing in chat"""
        if not self.redis:
            return []
        keys = await self.redis.keys(f"typing:{chat_id}:*")
        return [k.split(":")[-1] for k in keys]


# Global instance
redis_service = RedisService()
