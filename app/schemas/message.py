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


class MessageListResponse(BaseModel):
    messages: list[MessageResponse]
    has_more: bool
    next_cursor: Optional[str] = None
