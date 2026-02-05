from fastapi import UploadFile, HTTPException, status
from sqlmodel import Session
from pathlib import Path
from typing import Optional
import uuid
import aiofiles
import subprocess
import json
from PIL import Image
import io

from app.models.file import File, FileType

UPLOAD_DIR = Path(__file__).parent.parent / "static" / "uploads"
THUMBNAIL_DIR = UPLOAD_DIR / "thumbnails"

# File type configurations
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".txt"}
VOICE_EXTENSIONS = {".ogg", ".mp3", ".webm", ".wav"}

# Size limits in bytes
IMAGE_SIZE_LIMIT = 10 * 1024 * 1024  # 10MB
VIDEO_SIZE_LIMIT = 20 * 1024 * 1024  # 20MB
DOCUMENT_SIZE_LIMIT = 50 * 1024 * 1024  # 50MB
VOICE_SIZE_LIMIT = 5 * 1024 * 1024  # 5MB

# Video duration limit for avatars (seconds)
VIDEO_AVATAR_MAX_DURATION = 10

THUMBNAIL_SIZE = (200, 200)


class FileService:
    """Service for handling file uploads"""

    def __init__(self):
        # Ensure upload directories exist
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        THUMBNAIL_DIR.mkdir(parents=True, exist_ok=True)

    def get_file_type(self, filename: str) -> Optional[FileType]:
        """Determine file type from extension"""
        ext = Path(filename).suffix.lower()

        if ext in IMAGE_EXTENSIONS:
            return FileType.image
        elif ext in VIDEO_EXTENSIONS:
            return FileType.video
        elif ext in DOCUMENT_EXTENSIONS:
            return FileType.document
        elif ext in VOICE_EXTENSIONS:
            return FileType.voice

        return None

    def validate_file(self, file: UploadFile, file_type: FileType) -> None:
        """Validate file size based on type"""
        # Get file size
        file.file.seek(0, 2)  # Seek to end
        size = file.file.tell()
        file.file.seek(0)  # Reset to beginning

        if file_type == FileType.image and size > IMAGE_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Image size exceeds limit of {IMAGE_SIZE_LIMIT // (1024*1024)}MB"
            )
        elif file_type == FileType.video and size > VIDEO_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Video size exceeds limit of {VIDEO_SIZE_LIMIT // (1024*1024)}MB"
            )
        elif file_type == FileType.document and size > DOCUMENT_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Document size exceeds limit of {DOCUMENT_SIZE_LIMIT // (1024*1024)}MB"
            )
        elif file_type == FileType.voice and size > VOICE_SIZE_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Voice file size exceeds limit of {VOICE_SIZE_LIMIT // (1024*1024)}MB"
            )

    def get_video_duration(self, file_path: Path) -> Optional[float]:
        """Get video duration in seconds using ffprobe"""
        try:
            result = subprocess.run(
                [
                    "ffprobe", "-v", "quiet", "-print_format", "json",
                    "-show_format", str(file_path)
                ],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                return float(data.get("format", {}).get("duration", 0))
        except Exception:
            pass
        return None

    async def create_thumbnail(self, file_path: Path, thumbnail_filename: str) -> Optional[str]:
        """Create thumbnail for image files"""
        try:
            img = Image.open(file_path)
            img.thumbnail(THUMBNAIL_SIZE)

            # Convert to RGB if necessary (for PNG with transparency)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")

            thumbnail_path = THUMBNAIL_DIR / thumbnail_filename
            img.save(thumbnail_path, "JPEG", quality=85)

            return f"/static/uploads/thumbnails/{thumbnail_filename}"
        except Exception:
            return None

    async def upload_file(
        self,
        file: UploadFile,
        user_id: str,
        session: Session
    ) -> File:
        """Upload a file and create database record"""
        if not file.filename:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Filename is required"
            )

        file_type = self.get_file_type(file.filename)
        if not file_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported file type"
            )

        self.validate_file(file, file_type)

        # Generate unique filename
        ext = Path(file.filename).suffix.lower()
        unique_filename = f"{uuid.uuid4()}{ext}"
        file_path = UPLOAD_DIR / unique_filename

        # Get file size
        file.file.seek(0, 2)
        size = file.file.tell()
        file.file.seek(0)

        # Save file
        async with aiofiles.open(file_path, "wb") as f:
            content = await file.read()
            await f.write(content)

        # Create thumbnail for images
        thumbnail_url = None
        if file_type == FileType.image:
            thumbnail_filename = f"thumb_{unique_filename.rsplit('.', 1)[0]}.jpg"
            thumbnail_url = await self.create_thumbnail(file_path, thumbnail_filename)

        # Create database record
        file_record = File(
            filename=unique_filename,
            original_filename=file.filename,
            content_type=file.content_type or "application/octet-stream",
            file_type=file_type,
            size=size,
            url=f"/static/uploads/{unique_filename}",
            thumbnail_url=thumbnail_url,
            uploaded_by=user_id
        )

        session.add(file_record)
        session.commit()
        session.refresh(file_record)

        return file_record
