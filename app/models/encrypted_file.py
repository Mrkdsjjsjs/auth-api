from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from enum import Enum
import uuid


class EncryptedFileType(str, Enum):
    image = "image"
    document = "document"
    voice = "voice"
    video = "video"


class EncryptedFile(SQLModel, table=True):
    """
    E2E encrypted file storage.
    Files are encrypted client-side before upload.
    Server stores only encrypted blobs - cannot read content.
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)

    # File metadata (not sensitive)
    original_filename: str
    content_type: str
    file_type: EncryptedFileType
    encrypted_size: int  # Size of encrypted blob

    # Storage path (not in /static - not publicly accessible)
    storage_path: str

    # Encryption metadata - needed for decryption
    file_nonce: str  # Base64 encoded nonce for file encryption (secretbox)

    # Key encrypted for recipient
    encrypted_key_recipient: str  # Base64 encoded
    key_nonce_recipient: str  # Base64 encoded
    ephemeral_key_recipient: str  # Base64 encoded ephemeral public key
    recipient_user_id: str = Field(foreign_key="user.id")

    # Key encrypted for sender (so they can view their own files)
    encrypted_key_sender: str  # Base64 encoded
    key_nonce_sender: str  # Base64 encoded
    ephemeral_key_sender: str  # Base64 encoded ephemeral public key

    # Ownership
    uploaded_by: str = Field(foreign_key="user.id")
    chat_id: str = Field(foreign_key="chat.id", index=True)

    # Timestamps
    uploaded_at: datetime = Field(default_factory=datetime.utcnow)
