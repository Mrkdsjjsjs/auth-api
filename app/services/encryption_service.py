"""
Server-side encryption service.

Architecture:
- E2E encryption for transport (client <-> server)
- AES encryption for storage in DB
- Per-client E2E key pairs generated dynamically and stored in Redis

Flow:
1. Client connects, sends their public key via /api/keys/exchange
2. Server generates E2E key pair for this client, stores in Redis
3. Server returns its public key to client
4. Client encrypts messages with server's public key
5. Server decrypts E2E, encrypts with AES, stores in DB
6. When sending: Server decrypts AES, encrypts for recipient with ephemeral key
"""
import base64
import redis
from typing import Optional, Tuple
from nacl.public import PrivateKey, PublicKey, Box
from nacl.utils import random as nacl_random
from nacl.secret import SecretBox
from app.config import AES_STORAGE_KEY, REDIS_URL


def base64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode('utf-8')


def base64_decode(data: str) -> bytes:
    return base64.b64decode(data)


class EncryptionService:
    """Handles server-side encryption for messages"""

    def __init__(self):
        self._aes_key: Optional[bytes] = None
        self._redis: Optional[redis.Redis] = None
        self._local_cache: dict = {}  # In-memory cache for faster access

    @property
    def redis_client(self) -> redis.Redis:
        """Get sync Redis client for key storage"""
        if self._redis is None:
            self._redis = redis.from_url(REDIS_URL, decode_responses=False)
        return self._redis

    def _key_redis_key(self, user_id: str) -> str:
        """Redis key for storing server keys for a client"""
        return f"encryption:server_keys:{user_id}"

    @property
    def aes_key(self) -> bytes:
        """Get AES key from env, or generate one if not set"""
        if self._aes_key is None:
            if AES_STORAGE_KEY:
                self._aes_key = base64_decode(AES_STORAGE_KEY)
            else:
                # Generate a random key for dev (not persistent!)
                print("[WARN] AES_STORAGE_KEY not set, using random key (messages won't persist across restarts)")
                self._aes_key = nacl_random(SecretBox.KEY_SIZE)
        return self._aes_key

    def get_or_create_server_keys_for_client(self, user_id: str) -> Tuple[bytes, bytes]:
        """
        Get or create E2E key pair for a specific client.
        Keys are stored in Redis for persistence across restarts.
        Returns (private_key_bytes, public_key_bytes)
        """
        # Check local cache first
        if user_id in self._local_cache:
            return self._local_cache[user_id]

        # Try to get from Redis
        redis_key = self._key_redis_key(user_id)
        try:
            stored = self.redis_client.get(redis_key)
            if stored:
                # Keys are stored as private_key:public_key in base64
                parts = stored.decode('utf-8').split(':')
                if len(parts) == 2:
                    private_key = base64_decode(parts[0])
                    public_key = base64_decode(parts[1])
                    self._local_cache[user_id] = (private_key, public_key)
                    print(f"[Encryption] Loaded server keys for client {user_id[:8]} from Redis")
                    return (private_key, public_key)
        except Exception as e:
            print(f"[Encryption] Failed to get keys from Redis: {e}")

        # Generate new key pair
        private_key = PrivateKey.generate()
        public_key = private_key.public_key
        private_bytes = bytes(private_key)
        public_bytes = bytes(public_key)

        # Store in Redis (no expiration - keys should persist)
        try:
            key_data = f"{base64_encode(private_bytes)}:{base64_encode(public_bytes)}"
            self.redis_client.set(redis_key, key_data)
            print(f"[Encryption] Generated and stored new server keys for client {user_id[:8]}")
        except Exception as e:
            print(f"[Encryption] Failed to store keys in Redis: {e}")

        # Cache locally
        self._local_cache[user_id] = (private_bytes, public_bytes)

        return (private_bytes, public_bytes)

    def regenerate_server_keys_for_client(self, user_id: str) -> Tuple[bytes, bytes]:
        """
        Force regenerate E2E key pair for a client.
        Called when client requests key exchange.
        """
        # Clear local cache
        if user_id in self._local_cache:
            del self._local_cache[user_id]

        # Delete from Redis
        redis_key = self._key_redis_key(user_id)
        try:
            self.redis_client.delete(redis_key)
        except Exception as e:
            print(f"[Encryption] Failed to delete old keys from Redis: {e}")

        # Generate new keys
        return self.get_or_create_server_keys_for_client(user_id)

    def get_server_public_key_for_client(self, user_id: str, regenerate: bool = True) -> str:
        """Get server's public key for a client (base64 encoded)"""
        if regenerate:
            _, public_key = self.regenerate_server_keys_for_client(user_id)
        else:
            _, public_key = self.get_or_create_server_keys_for_client(user_id)
        return base64_encode(public_key)

    def decrypt_from_client(self, encrypted_content: str, ephemeral_public_key: str, user_id: str) -> str:
        """
        Decrypt a message from a client.
        Client encrypted with server's public key, using their ephemeral private key.
        """
        try:
            # Get server's private key for this client
            private_key_bytes, _ = self.get_or_create_server_keys_for_client(user_id)
            server_private_key = PrivateKey(private_key_bytes)

            # Parse encrypted content (ciphertext:nonce format)
            parts = encrypted_content.split(':')
            if len(parts) != 2:
                raise ValueError("Invalid encrypted content format")

            ciphertext = base64_decode(parts[0])
            nonce = base64_decode(parts[1])
            client_ephemeral_public = PublicKey(base64_decode(ephemeral_public_key))

            # Create box for decryption
            box = Box(server_private_key, client_ephemeral_public)

            # Decrypt
            plaintext = box.decrypt(ciphertext, nonce)
            return plaintext.decode('utf-8')
        except Exception as e:
            print(f"[Encryption] Failed to decrypt from client: {e}")
            raise

    def encrypt_for_storage(self, plaintext: str) -> str:
        """Encrypt plaintext with AES for database storage"""
        try:
            box = SecretBox(self.aes_key)
            plaintext_bytes = plaintext.encode('utf-8')
            encrypted = box.encrypt(plaintext_bytes)
            # Returns nonce + ciphertext as single blob
            return base64_encode(encrypted)
        except Exception as e:
            print(f"[Encryption] Failed to encrypt for storage: {e}")
            raise

    def decrypt_from_storage(self, encrypted_blob: str) -> str:
        """Decrypt message from database storage"""
        try:
            box = SecretBox(self.aes_key)
            encrypted_bytes = base64_decode(encrypted_blob)
            plaintext = box.decrypt(encrypted_bytes)
            return plaintext.decode('utf-8')
        except Exception as e:
            print(f"[Encryption] Failed to decrypt from storage: {e}")
            raise

    def encrypt_for_user(self, plaintext: str, user_public_key_b64: str) -> dict:
        """
        Encrypt a message for a specific user using their public key.
        Uses ephemeral key pair for forward secrecy.

        Returns: {
            "ciphertext": base64,
            "nonce": base64,
            "ephemeral_public_key": base64
        }
        """
        try:
            # Decode user's public key
            user_public_key = PublicKey(base64_decode(user_public_key_b64))

            # Generate ephemeral key pair for this message
            ephemeral_private = PrivateKey.generate()
            ephemeral_public = ephemeral_private.public_key

            # Create box for encryption
            box = Box(ephemeral_private, user_public_key)

            # Encrypt the message
            plaintext_bytes = plaintext.encode('utf-8')
            encrypted = box.encrypt(plaintext_bytes)

            # encrypted contains nonce + ciphertext
            nonce = encrypted.nonce
            ciphertext = encrypted.ciphertext

            return {
                "ciphertext": base64_encode(ciphertext),
                "nonce": base64_encode(nonce),
                "ephemeral_public_key": base64_encode(bytes(ephemeral_public))
            }
        except Exception as e:
            print(f"Encryption error: {e}")
            raise

    def encrypt_message_response(self, message_dict: dict, user_public_key_b64: Optional[str]) -> dict:
        """
        Encrypt a message response for sending to client.
        If no public key, returns plaintext.
        """
        if not user_public_key_b64:
            # No encryption, return as-is
            return message_dict

        content = message_dict.get("content")
        if not content:
            # No content to encrypt (deleted message, etc)
            return message_dict

        try:
            encrypted = self.encrypt_for_user(content, user_public_key_b64)

            # Replace content with encrypted version
            result = message_dict.copy()
            result["content"] = None  # Don't send plaintext
            result["encrypted_content"] = f"{encrypted['ciphertext']}:{encrypted['nonce']}"
            result["ephemeral_public_key"] = encrypted["ephemeral_public_key"]
            result["encryption_version"] = 1

            return result
        except Exception as e:
            print(f"Failed to encrypt message: {e}")
            # Fallback to plaintext if encryption fails
            return message_dict


# Singleton instance
encryption_service = EncryptionService()
