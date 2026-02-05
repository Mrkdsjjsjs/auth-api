from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.chat import ChatType, MemberRole
from app.schemas.user import UserPublicResponse


class ChatCreate(BaseModel):
    type: ChatType = ChatType.direct
    name: Optional[str] = None
    member_ids: list[str]  # User IDs to add to chat


class ChatUpdate(BaseModel):
    name: Optional[str] = None


class ChatMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    role: MemberRole
    joined_at: datetime
    user: Optional[UserPublicResponse] = None


class LastMessageResponse(BaseModel):
    id: str
    content: Optional[str]
    sender_id: str
    created_at: datetime


class ChatResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: ChatType
    name: Optional[str]
    avatar_url: Optional[str]
    created_by: str
    created_at: datetime
    last_message_at: Optional[datetime]
    members: list[ChatMemberResponse] = []
    unread_count: int = 0
    last_message: Optional[LastMessageResponse] = None


class ChatListResponse(BaseModel):
    chats: list[ChatResponse]
    total: int


class ChatMemberAdd(BaseModel):
    user_ids: list[str]
