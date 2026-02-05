from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.file import FileType


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    original_filename: str
    content_type: str
    file_type: FileType
    size: int
    url: str
    thumbnail_url: Optional[str]
    uploaded_at: datetime


class FileUploadResponse(BaseModel):
    file: FileResponse
    message: str = "File uploaded successfully"
