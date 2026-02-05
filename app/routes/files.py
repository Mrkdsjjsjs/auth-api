from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from sqlmodel import Session
from pathlib import Path
from app.database import get_session
from app.models.user import User
from app.models.file import File as FileModel
from app.schemas.file import FileResponse as FileResponseSchema, FileUploadResponse
from app.auth import get_current_user
from app.services.file_service import FileService

router = APIRouter(prefix="/api", tags=["files"])

UPLOAD_DIR = Path(__file__).parent.parent / "static" / "uploads"


@router.post("/upload", response_model=FileUploadResponse,
    summary="📤 Upload file",
    responses={
        200: {"description": "File uploaded"},
        400: {"description": "Invalid file type or size"},
    })
async def upload_file(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Upload a file**

    Upload images, documents, or voice messages.

    **Limits:**
    - Images: 10MB (jpg, png, gif, webp)
    - Documents: 50MB (pdf, doc, docx, xls, xlsx, zip)
    - Voice: 5MB (ogg, mp3, webm)

    Thumbnails are auto-generated for images.
    """
    file_service = FileService()
    file_record = await file_service.upload_file(file, current_user.id, session)

    return FileUploadResponse(
        file=FileResponseSchema.model_validate(file_record)
    )


@router.get("/files/{file_id}", response_model=FileResponseSchema,
    summary="📥 Get file info",
    responses={
        200: {"description": "File info returned"},
        404: {"description": "File not found"},
    })
def get_file_info(
    file_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get file metadata**

    Returns file information without downloading.
    """
    file_record = session.get(FileModel, file_id)
    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    return file_record


@router.get("/files/{file_id}/download",
    summary="⬇️ Download file",
    responses={
        200: {"description": "File downloaded"},
        404: {"description": "File not found"},
    })
def download_file(
    file_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Download file**

    Returns the actual file for download.
    """
    file_record = session.get(FileModel, file_id)
    if not file_record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    file_path = UPLOAD_DIR / file_record.filename
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk")

    return FileResponse(
        path=file_path,
        filename=file_record.original_filename,
        media_type=file_record.content_type
    )
