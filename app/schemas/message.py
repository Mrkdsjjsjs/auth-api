from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.message import MessageType
from app.schemas.user import UserPublicResponse


class MessageCreate(BaseModel):
    content: Optional[str] = None
    message_type: MessageType = MessageType.text
    file_id: Optional[str] = None
    reply_to_id: Optional[str] = None
    # E2E encryption fields
    encrypted_content: Optional[str] = None
    encryption_version: int = 0  # 0=plaintext, 1=E2E
    sender_key_id: Optional[str] = None
    ephemeral_public_key: Optional[str] = None


class MessageUpdate(BaseModel):
    content: str


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    chat_id: str
    sender_id: str
    content: Optional[str]
    message_type: MessageType
    file_url: Optional[str]
    file_id: Optional[str]
    reply_to_id: Optional[str]
    is_edited: bool
    is_deleted: bool
    created_at: datetime
    sender: Optional[UserPublicResponse] = None
    # E2E encryption fields
    encrypted_content: Optional[str] = None
    encryption_version: int = 0
    sender_key_id: Optional[str] = None
    ephemeral_public_key: Optional[str] = None


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    has_more: bool
    next_cursor: Optional[str] = None
