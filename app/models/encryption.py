from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
import uuid


class UserKey(SQLModel, table=True):
    """User's public encryption keys"""
    __tablename__ = "user_key"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    key_type: str = Field(default="identity")  # "identity" | "session"
    public_key: str  # Base64 X25519 public key
    signature_public_key: str  # Base64 Ed25519 public key for signing
    is_active: bool = Field(default=True)
    key_version: int = Field(default=1)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EncryptedPrivateKeyBackup(SQLModel, table=True):
    """Encrypted backup of user's private key for recovery"""
    __tablename__ = "encrypted_private_key_backup"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="user.id", unique=True, index=True)
    encrypted_blob: str  # Base64 encrypted private key bundle
    salt: str  # Base64 PBKDF2 salt
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ChatEncryptionKey(SQLModel, table=True):
    """Encrypted group key for each chat member"""
    __tablename__ = "chat_encryption_key"

    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    chat_id: str = Field(foreign_key="chat.id", index=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    user_key_id: str = Field(foreign_key="user_key.id")
    encrypted_key: str  # Base64 group key encrypted for this user
    key_version: int = Field(default=1)
    created_at: datetime = Field(default_factory=datetime.utcnow)
