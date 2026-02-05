from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum
import uuid


class FileType(str, Enum):
    image = "image"
    document = "document"
    voice = "voice"
    video = "video"


class File(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    filename: str
    original_filename: str
    content_type: str
    file_type: FileType
    size: int  # bytes
    url: str
    thumbnail_url: Optional[str] = Field(default=None)
    uploaded_by: str = Field(foreign_key="user.id")
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
