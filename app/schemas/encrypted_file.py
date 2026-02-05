from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.encrypted_file import EncryptedFileType


class EncryptedKeyPayload(BaseModel):
    """Encryption key wrapped for a specific user"""
    encrypted_key: str  # Base64 encoded encrypted symmetric key
    key_nonce: str  # Base64 encoded nonce
    ephemeral_public_key: str  # Base64 encoded ephemeral public key


class EncryptedFileUpload(BaseModel):
    """Request to upload an encrypted file"""
    # Encrypted file data (base64 encoded)
    encrypted_data: str

    # File metadata
    original_filename: str
    content_type: str
    file_nonce: str  # Base64 encoded nonce used for file encryption

    # Keys wrapped for recipient and sender
    key_for_recipient: EncryptedKeyPayload
    key_for_sender: EncryptedKeyPayload

    # Who can decrypt
    recipient_user_id: str
    chat_id: str


class EncryptedFileResponse(BaseModel):
    """Response with encrypted file metadata"""
    model_config = ConfigDict(from_attributes=True)

    id: str
    original_filename: str
    content_type: str
    file_type: EncryptedFileType
    encrypted_size: int
    uploaded_at: datetime
    uploaded_by: str
    chat_id: str

    # Encryption metadata for decryption (returned based on requesting user)
    file_nonce: str
    encrypted_key: str
    key_nonce: str
    ephemeral_public_key: str


class EncryptedFileUploadResponse(BaseModel):
    """Response after successful upload"""
    file: EncryptedFileResponse
    message: str = "Encrypted file uploaded successfully"
