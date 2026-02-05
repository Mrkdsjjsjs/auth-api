from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.message import MessageType
from app.schemas.user import UserPublicResponse


class EncryptedPayload(BaseModel):
    encrypted_content: str  # ciphertext:nonce format
    ephemeral_public_key: str


class MessageCreate(BaseModel):
    """E2E encrypted message - encrypted separately for each recipient"""
    content: Optional[str] = None  # Plaintext fallback (only if encryption fails)
    message_type: MessageType = MessageType.text
    file_id: Optional[str] = None
    encrypted_file_id: Optional[str] = None  # E2E encrypted file
    reply_to_id: Optional[str] = None
    # E2E encryption - separate payload for each user
    encrypted_for_recipient: Optional[EncryptedPayload] = None
    encrypted_for_sender: Optional[EncryptedPayload] = None
    recipient_user_id: Optional[str] = None


class MessageUpdate(BaseModel):
    content: str


class EncryptedFileInfo(BaseModel):
    """Info about an encrypted file attached to a message"""
    id: str
    original_filename: str
    content_type: str
    file_type: str
    file_nonce: str
    encrypted_key: str
    key_nonce: str
    ephemeral_public_key: str


class MessageResponse(BaseModel):
    """Response includes encryption fields added by server"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    chat_id: str
    sender_id: str
    content: Optional[str] = None  # None if encrypted
    message_type: MessageType
    file_url: Optional[str] = None
    file_id: Optional[str] = None
    encrypted_file_id: Optional[str] = None
    reply_to_id: Optional[str] = None
    is_edited: bool
    is_deleted: bool
    created_at: datetime
    sender: Optional[UserPublicResponse] = None
    # Encryption fields (added by server when sending to client)
    encrypted_content: Optional[str] = None
    ephemeral_public_key: Optional[str] = None
    encryption_version: int = 0
    # Encrypted file info (if message has encrypted file)
    encrypted_file: Optional[EncryptedFileInfo] = None


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    has_more: bool
    next_cursor: Optional[str] = None
