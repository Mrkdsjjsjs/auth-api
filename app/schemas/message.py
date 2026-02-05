from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.message import MessageType
from app.schemas.user import UserPublicResponse


class MessageCreate(BaseModel):
    """Client can send encrypted or plaintext messages"""
    content: Optional[str] = None  # Plaintext fallback
    message_type: MessageType = MessageType.text
    file_id: Optional[str] = None
    reply_to_id: Optional[str] = None
    # Client-side encryption fields
    encrypted_content: Optional[str] = None  # ciphertext:nonce format
    ephemeral_public_key: Optional[str] = None


class MessageUpdate(BaseModel):
    content: str


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
    reply_to_id: Optional[str] = None
    is_edited: bool
    is_deleted: bool
    created_at: datetime
    sender: Optional[UserPublicResponse] = None
    # Encryption fields (added by server when sending to client)
    encrypted_content: Optional[str] = None
    ephemeral_public_key: Optional[str] = None
    encryption_version: int = 0


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    has_more: bool
    next_cursor: Optional[str] = None
