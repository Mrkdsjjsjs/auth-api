from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlmodel import Session, select
from pathlib import Path
import base64
import uuid
import aiofiles

from app.database import get_session
from app.models.user import User
from app.models.chat import ChatMember
from app.models.encrypted_file import EncryptedFile, EncryptedFileType
from app.schemas.encrypted_file import (
    EncryptedFileUpload,
    EncryptedFileResponse,
    EncryptedFileUploadResponse,
)
from app.auth import get_current_user

router = APIRouter(prefix="/api/encrypted-files", tags=["encrypted-files"])

# Store encrypted files in non-public directory
ENCRYPTED_FILES_DIR = Path(__file__).parent.parent / "encrypted_storage"
ENCRYPTED_FILES_DIR.mkdir(parents=True, exist_ok=True)

# File type detection
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov"}
DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".txt"}
VOICE_EXTENSIONS = {".ogg", ".mp3", ".webm", ".wav"}

# Size limit: 50MB
MAX_ENCRYPTED_SIZE = 50 * 1024 * 1024


def get_file_type(filename: str) -> EncryptedFileType:
    """Determine file type from extension"""
    ext = Path(filename).suffix.lower()

    if ext in IMAGE_EXTENSIONS:
        return EncryptedFileType.image
    elif ext in VIDEO_EXTENSIONS:
        return EncryptedFileType.video
    elif ext in DOCUMENT_EXTENSIONS:
        return EncryptedFileType.document
    elif ext in VOICE_EXTENSIONS:
        return EncryptedFileType.voice

    return EncryptedFileType.document  # Default


@router.post("/upload", response_model=EncryptedFileUploadResponse,
    summary="Upload encrypted file",
    responses={
        200: {"description": "Encrypted file uploaded"},
        400: {"description": "Invalid data"},
        403: {"description": "Not a member of chat"},
    })
async def upload_encrypted_file(
    data: EncryptedFileUpload,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Upload an E2E encrypted file.
    File is encrypted client-side before upload.
    Server stores only the encrypted blob.
    """
    # Check chat membership
    member = session.exec(
        select(ChatMember).where(
            ChatMember.chat_id == data.chat_id,
            ChatMember.user_id == current_user.id
        )
    ).first()
    if not member:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not a member of this chat"
        )

    # Decode and validate encrypted data
    try:
        encrypted_bytes = base64.b64decode(data.encrypted_data)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 encoded data"
        )

    if len(encrypted_bytes) > MAX_ENCRYPTED_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum size of {MAX_ENCRYPTED_SIZE // (1024*1024)}MB"
        )

    # Generate unique storage path
    file_id = str(uuid.uuid4())
    storage_filename = f"{file_id}.enc"
    storage_path = ENCRYPTED_FILES_DIR / storage_filename

    # Save encrypted file
    async with aiofiles.open(storage_path, "wb") as f:
        await f.write(encrypted_bytes)

    # Determine file type
    file_type = get_file_type(data.original_filename)

    # Create database record
    encrypted_file = EncryptedFile(
        id=file_id,
        original_filename=data.original_filename,
        content_type=data.content_type,
        file_type=file_type,
        encrypted_size=len(encrypted_bytes),
        storage_path=str(storage_path),
        file_nonce=data.file_nonce,
        # Keys for recipient
        encrypted_key_recipient=data.key_for_recipient.encrypted_key,
        key_nonce_recipient=data.key_for_recipient.key_nonce,
        ephemeral_key_recipient=data.key_for_recipient.ephemeral_public_key,
        recipient_user_id=data.recipient_user_id,
        # Keys for sender
        encrypted_key_sender=data.key_for_sender.encrypted_key,
        key_nonce_sender=data.key_for_sender.key_nonce,
        ephemeral_key_sender=data.key_for_sender.ephemeral_public_key,
        # Ownership
        uploaded_by=current_user.id,
        chat_id=data.chat_id,
    )

    session.add(encrypted_file)
    session.commit()
    session.refresh(encrypted_file)

    # Return response with keys for current user (sender)
    response = EncryptedFileResponse(
        id=encrypted_file.id,
        original_filename=encrypted_file.original_filename,
        content_type=encrypted_file.content_type,
        file_type=encrypted_file.file_type,
        encrypted_size=encrypted_file.encrypted_size,
        uploaded_at=encrypted_file.uploaded_at,
        uploaded_by=encrypted_file.uploaded_by,
        chat_id=encrypted_file.chat_id,
        file_nonce=encrypted_file.file_nonce,
        encrypted_key=encrypted_file.encrypted_key_sender,
        key_nonce=encrypted_file.key_nonce_sender,
        ephemeral_public_key=encrypted_file.ephemeral_key_sender,
    )

    return EncryptedFileUploadResponse(file=response)


@router.get("/{file_id}", response_model=EncryptedFileResponse,
    summary="Get encrypted file metadata",
    responses={
        200: {"description": "File metadata returned"},
        403: {"description": "Cannot access this file"},
        404: {"description": "File not found"},
    })
def get_encrypted_file_info(
    file_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Get encrypted file metadata with decryption keys for the requesting user.
    Only sender and recipient can access.
    """
    encrypted_file = session.get(EncryptedFile, file_id)
    if not encrypted_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    # Check access - only sender or recipient can access
    is_sender = encrypted_file.uploaded_by == current_user.id
    is_recipient = encrypted_file.recipient_user_id == current_user.id

    if not is_sender and not is_recipient:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this file"
        )

    # Return keys based on who is requesting
    if is_sender:
        return EncryptedFileResponse(
            id=encrypted_file.id,
            original_filename=encrypted_file.original_filename,
            content_type=encrypted_file.content_type,
            file_type=encrypted_file.file_type,
            encrypted_size=encrypted_file.encrypted_size,
            uploaded_at=encrypted_file.uploaded_at,
            uploaded_by=encrypted_file.uploaded_by,
            chat_id=encrypted_file.chat_id,
            file_nonce=encrypted_file.file_nonce,
            encrypted_key=encrypted_file.encrypted_key_sender,
            key_nonce=encrypted_file.key_nonce_sender,
            ephemeral_public_key=encrypted_file.ephemeral_key_sender,
        )
    else:
        return EncryptedFileResponse(
            id=encrypted_file.id,
            original_filename=encrypted_file.original_filename,
            content_type=encrypted_file.content_type,
            file_type=encrypted_file.file_type,
            encrypted_size=encrypted_file.encrypted_size,
            uploaded_at=encrypted_file.uploaded_at,
            uploaded_by=encrypted_file.uploaded_by,
            chat_id=encrypted_file.chat_id,
            file_nonce=encrypted_file.file_nonce,
            encrypted_key=encrypted_file.encrypted_key_recipient,
            key_nonce=encrypted_file.key_nonce_recipient,
            ephemeral_public_key=encrypted_file.ephemeral_key_recipient,
        )


@router.get("/{file_id}/download",
    summary="Download encrypted file blob",
    responses={
        200: {"description": "Encrypted file data returned"},
        403: {"description": "Cannot access this file"},
        404: {"description": "File not found"},
    })
async def download_encrypted_file(
    file_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Download the encrypted file blob.
    Client must decrypt using their keys.
    Only sender and recipient can download.
    """
    encrypted_file = session.get(EncryptedFile, file_id)
    if not encrypted_file:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found"
        )

    # Check access - only sender or recipient can access
    is_sender = encrypted_file.uploaded_by == current_user.id
    is_recipient = encrypted_file.recipient_user_id == current_user.id

    if not is_sender and not is_recipient:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this file"
        )

    # Read encrypted file
    storage_path = Path(encrypted_file.storage_path)
    if not storage_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found on disk"
        )

    async with aiofiles.open(storage_path, "rb") as f:
        encrypted_data = await f.read()

    # Return raw encrypted bytes
    return Response(
        content=encrypted_data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{encrypted_file.original_filename}.enc"'
        }
    )
