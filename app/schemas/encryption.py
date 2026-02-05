from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime


# Request schemas

class PublicKeyRegister(BaseModel):
    """Register user's public encryption keys"""
    public_key: str  # Base64 X25519 public key
    signature_public_key: str  # Base64 Ed25519 public key
    key_type: str = "identity"  # "identity" | "session"


class KeyRotationRequest(BaseModel):
    """Request to rotate session keys"""
    new_public_key: str  # Base64 new X25519 public key
    new_signature_public_key: str  # Base64 new Ed25519 public key
    signature: str  # Signature of new keys using identity key


class EncryptedKeyBackup(BaseModel):
    """Encrypted private key backup for recovery"""
    encrypted_blob: str  # Base64 encrypted private key bundle
    salt: str  # Base64 PBKDF2 salt


class ChatKeyCreate(BaseModel):
    """Create/update encrypted chat key for a user"""
    user_id: str
    encrypted_key: str  # Base64 encrypted group key
    user_key_id: str


class ChatKeyRotate(BaseModel):
    """Rotate chat group key"""
    encrypted_keys: List[ChatKeyCreate]  # New key encrypted for each member


# Response schemas

class UserPublicKeyResponse(BaseModel):
    """Public key information for a user"""
    id: str
    user_id: str
    key_type: str
    public_key: str
    signature_public_key: str
    key_version: int
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class KeyBackupResponse(BaseModel):
    """Encrypted key backup response"""
    encrypted_blob: str
    salt: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatKeyResponse(BaseModel):
    """Encrypted chat key for current user"""
    id: str
    chat_id: str
    encrypted_key: str
    key_version: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatKeysResponse(BaseModel):
    """All encrypted chat keys for members"""
    chat_id: str
    keys: List[ChatKeyResponse]
    key_version: int


# Message encryption schemas

class EncryptedMessageCreate(BaseModel):
    """Create an encrypted message"""
    encrypted_content: str  # Base64 encrypted content
    encryption_version: int = 1
    sender_key_id: str
    ephemeral_public_key: Optional[str] = None  # For direct chats
    message_type: str = "text"
    file_id: Optional[str] = None
    reply_to_id: Optional[str] = None


class EncryptedMessageResponse(BaseModel):
    """Encrypted message response"""
    id: str
    chat_id: str
    sender_id: str
    encrypted_content: Optional[str]
    encryption_version: int
    sender_key_id: Optional[str]
    ephemeral_public_key: Optional[str]
    message_type: str
    is_edited: bool
    is_deleted: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
