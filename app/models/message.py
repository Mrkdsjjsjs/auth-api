from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum
import uuid


class MessageType(str, Enum):
    text = "text"
    image = "image"
    file = "file"
    voice = "voice"


class Message(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    chat_id: str = Field(foreign_key="chat.id", index=True)
    sender_id: str = Field(foreign_key="user.id")
    content: Optional[str] = Field(default=None)
    message_type: MessageType = Field(default=MessageType.text)
    file_url: Optional[str] = Field(default=None)
    file_id: Optional[str] = Field(default=None, foreign_key="file.id")
    reply_to_id: Optional[str] = Field(default=None, foreign_key="message.id")
    is_edited: bool = Field(default=False)
    is_deleted: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
