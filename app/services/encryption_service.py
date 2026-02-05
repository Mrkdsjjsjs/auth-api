"""
Server-side encryption service.
Messages are stored in plaintext in DB.
When sending to client, server encrypts with recipient's public key.
"""
import base64
import os
from typing import Optional
from nacl.public import PrivateKey, PublicKey, Box
from nacl.utils import random as nacl_random
from nacl.secret import SecretBox
from nacl.exceptions import CryptoError


def base64_encode(data: bytes) -> str:
    return base64.b64encode(data).decode('utf-8')


def base64_decode(data: str) -> bytes:
    return base64.b64decode(data)


class EncryptionService:
    """Handles server-side encryption for messages"""

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
