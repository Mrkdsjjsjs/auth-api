from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    created_at: datetime
    username: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    last_seen: Optional[datetime] = None
    is_online: bool = False


class UserUpdate(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    bio: Optional[str] = None


class UserPublicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    last_seen: Optional[datetime] = None
    is_online: bool = False


class UserSearchResponse(BaseModel):
    users: list[UserPublicResponse]
    total: int
