from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum
import uuid


class ChatType(str, Enum):
    direct = "direct"
    group = "group"


class MemberRole(str, Enum):
    admin = "admin"
    member = "member"


class Chat(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    type: ChatType = Field(default=ChatType.direct)
    name: Optional[str] = Field(default=None)
    avatar_url: Optional[str] = Field(default=None)
    created_by: str = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_message_at: Optional[datetime] = Field(default=None)


class ChatMember(SQLModel, table=True):
    __tablename__ = "chat_member"

    chat_id: str = Field(foreign_key="chat.id", primary_key=True)
    user_id: str = Field(foreign_key="user.id", primary_key=True)
    role: MemberRole = Field(default=MemberRole.member)
    joined_at: datetime = Field(default_factory=datetime.utcnow)
    last_read_message_id: Optional[str] = Field(default=None)
