from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
import uuid


class User(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    reset_token: Optional[str] = Field(default=None)
    reset_token_expires: Optional[datetime] = Field(default=None)
    # New messenger fields
    username: Optional[str] = Field(default=None, unique=True, index=True)
    display_name: Optional[str] = Field(default=None)
    avatar_url: Optional[str] = Field(default=None)
    bio: Optional[str] = Field(default=None)
    last_seen: Optional[datetime] = Field(default=None)
    is_online: bool = Field(default=False)
