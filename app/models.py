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

class UserCreate(SQLModel):
    email: str
    password: str

class UserResponse(SQLModel):
    id: str
    email: str
    created_at: datetime

class TokenResponse(SQLModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class RefreshRequest(SQLModel):
    refresh_token: str

class ForgotPasswordRequest(SQLModel):
    email: str

class ResetPasswordRequest(SQLModel):
    token: str
    new_password: str

class MessageResponse(SQLModel):
    message: str
