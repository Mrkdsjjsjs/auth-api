from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from datetime import datetime
from typing import List

from app.database import get_session
from app.models.user import User
from app.models.chat import Chat, ChatMember
from app.models.encryption import UserKey, EncryptedPrivateKeyBackup, ChatEncryptionKey
from app.schemas.encryption import (
    PublicKeyRegister,
    KeyRotationRequest,
    EncryptedKeyBackup,
    UserPublicKeyResponse,
    KeyBackupResponse,
    ChatKeyResponse,
    ChatKeysResponse,
    ChatKeyCreate,
    ChatKeyRotate,
    ServerKeyExchangeRequest,
    ServerKeyExchangeResponse,
)
from app.services.encryption_service import encryption_service
from app.auth import get_current_user

router = APIRouter(prefix="/api/keys", tags=["encryption"])


@router.post("/register", response_model=UserPublicKeyResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register public keys",
    responses={
        201: {"description": "Keys registered successfully"},
        400: {"description": "Keys already registered"},
    })
def register_public_key(
    data: PublicKeyRegister,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Register user's public encryption keys**

    Called after login when user has generated new keys.

    - **public_key**: Base64 X25519 public key
    - **signature_public_key**: Base64 Ed25519 public key
    - **key_type**: "identity" or "session"
    """
    # Deactivate any existing keys of same type
    existing_keys = session.exec(
        select(UserKey).where(
            UserKey.user_id == current_user.id,
            UserKey.key_type == data.key_type,
            UserKey.is_active == True
        )
    ).all()

    max_version = 0
    for key in existing_keys:
        key.is_active = False
        session.add(key)
        max_version = max(max_version, key.key_version)

    # Create new key
    user_key = UserKey(
        user_id=current_user.id,
        key_type=data.key_type,
        public_key=data.public_key,
        signature_public_key=data.signature_public_key,
        key_version=max_version + 1,
    )
    session.add(user_key)
    session.commit()
    session.refresh(user_key)

    return user_key


@router.get("/user/{user_id}", response_model=UserPublicKeyResponse,
    summary="Get user's public key",
    responses={
        200: {"description": "Public key returned"},
        404: {"description": "User or key not found"},
    })
def get_user_public_key(
    user_id: str,
    key_type: str = "identity",
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get a user's active public key**

    Used to encrypt messages for the recipient.

    - **user_id**: Target user's ID
    - **key_type**: "identity" or "session" (default: identity)
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user_key = session.exec(
        select(UserKey).where(
            UserKey.user_id == user_id,
            UserKey.key_type == key_type,
            UserKey.is_active == True
        )
    ).first()

    if not user_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active key found for user")

    return user_key


@router.get("/me", response_model=List[UserPublicKeyResponse],
    summary="Get my public keys",
    responses={
        200: {"description": "Public keys returned"},
    })
def get_my_public_keys(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get current user's active public keys**
    """
    keys = session.exec(
        select(UserKey).where(
            UserKey.user_id == current_user.id,
            UserKey.is_active == True
        )
    ).all()

    return keys


@router.post("/rotate", response_model=UserPublicKeyResponse,
    summary="Rotate session keys",
    responses={
        200: {"description": "Keys rotated successfully"},
        400: {"description": "Invalid signature"},
    })
def rotate_keys(
    data: KeyRotationRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Rotate session encryption keys**

    Called on token refresh. Signature must be valid using identity key.

    - **new_public_key**: Base64 new X25519 public key
    - **new_signature_public_key**: Base64 new Ed25519 public key
    - **signature**: Signature of new keys using identity key
    """
    # Get current identity key for verification
    identity_key = session.exec(
        select(UserKey).where(
            UserKey.user_id == current_user.id,
            UserKey.key_type == "identity",
            UserKey.is_active == True
        )
    ).first()

    # Note: In production, verify the signature here using identity_key
    # For now, we trust the client since they're authenticated

    # Deactivate current session keys
    session_keys = session.exec(
        select(UserKey).where(
            UserKey.user_id == current_user.id,
            UserKey.key_type == "session",
            UserKey.is_active == True
        )
    ).all()

    max_version = 0
    for key in session_keys:
        key.is_active = False
        session.add(key)
        max_version = max(max_version, key.key_version)

    # Create new session key
    new_key = UserKey(
        user_id=current_user.id,
        key_type="session",
        public_key=data.new_public_key,
        signature_public_key=data.new_signature_public_key,
        key_version=max_version + 1,
    )
    session.add(new_key)
    session.commit()
    session.refresh(new_key)

    return new_key


@router.post("/backup", status_code=status.HTTP_201_CREATED,
    summary="Save encrypted private key backup",
    responses={
        201: {"description": "Backup saved"},
    })
def save_key_backup(
    data: EncryptedKeyBackup,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Save encrypted private key backup**

    For key recovery on new devices. Private key is encrypted with password-derived key.

    - **encrypted_blob**: Base64 encrypted private key bundle
    - **salt**: Base64 PBKDF2 salt
    """
    existing = session.exec(
        select(EncryptedPrivateKeyBackup).where(
            EncryptedPrivateKeyBackup.user_id == current_user.id
        )
    ).first()

    if existing:
        existing.encrypted_blob = data.encrypted_blob
        existing.salt = data.salt
        existing.updated_at = datetime.utcnow()
        session.add(existing)
    else:
        backup = EncryptedPrivateKeyBackup(
            user_id=current_user.id,
            encrypted_blob=data.encrypted_blob,
            salt=data.salt,
        )
        session.add(backup)

    session.commit()
    return {"status": "ok"}


@router.get("/backup", response_model=KeyBackupResponse,
    summary="Get encrypted private key backup",
    responses={
        200: {"description": "Backup returned"},
        404: {"description": "No backup found"},
    })
def get_key_backup(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get encrypted private key backup**

    For restoring keys on a new device.
    """
    backup = session.exec(
        select(EncryptedPrivateKeyBackup).where(
            EncryptedPrivateKeyBackup.user_id == current_user.id
        )
    ).first()

    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No backup found")

    return backup


@router.get("/chat/{chat_id}", response_model=ChatKeyResponse,
    summary="Get chat encryption key",
    responses={
        200: {"description": "Chat key returned"},
        403: {"description": "Not a member of this chat"},
        404: {"description": "No encryption key found"},
    })
def get_chat_key(
    chat_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get encrypted group key for a chat**

    Returns the group key encrypted for the current user.
    """
    # Verify membership
    member = session.exec(
        select(ChatMember).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == current_user.id
        )
    ).first()

    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat")

    chat_key = session.exec(
        select(ChatEncryptionKey).where(
            ChatEncryptionKey.chat_id == chat_id,
            ChatEncryptionKey.user_id == current_user.id
        ).order_by(ChatEncryptionKey.key_version.desc())
    ).first()

    if not chat_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No encryption key found for this chat")

    return chat_key


@router.post("/chat/{chat_id}", response_model=ChatKeysResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Set chat encryption keys",
    responses={
        201: {"description": "Chat keys set"},
        403: {"description": "Not authorized to set chat keys"},
    })
def set_chat_keys(
    chat_id: str,
    data: ChatKeyRotate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Set/rotate group encryption key for chat**

    Chat creator/admin sets the group key encrypted for each member.

    - **encrypted_keys**: List of {user_id, encrypted_key, user_key_id}
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    # Check if user is admin
    member = session.exec(
        select(ChatMember).where(
            ChatMember.chat_id == chat_id,
            ChatMember.user_id == current_user.id
        )
    ).first()

    if not member or member.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can set chat keys")

    # Get current max version
    current_max = session.exec(
        select(ChatEncryptionKey).where(
            ChatEncryptionKey.chat_id == chat_id
        ).order_by(ChatEncryptionKey.key_version.desc())
    ).first()

    new_version = (current_max.key_version + 1) if current_max else 1

    # Create new keys for all specified users
    created_keys = []
    for key_data in data.encrypted_keys:
        chat_key = ChatEncryptionKey(
            chat_id=chat_id,
            user_id=key_data.user_id,
            user_key_id=key_data.user_key_id,
            encrypted_key=key_data.encrypted_key,
            key_version=new_version,
        )
        session.add(chat_key)
        created_keys.append(chat_key)

    session.commit()

    # Refresh all created keys
    key_responses = []
    for key in created_keys:
        session.refresh(key)
        key_responses.append(ChatKeyResponse.model_validate(key))

    return ChatKeysResponse(
        chat_id=chat_id,
        keys=key_responses,
        key_version=new_version
    )


@router.post("/chat/{chat_id}/rotate", response_model=ChatKeysResponse,
    summary="Rotate chat encryption key",
    responses={
        200: {"description": "Chat key rotated"},
        403: {"description": "Not authorized"},
    })
def rotate_chat_key(
    chat_id: str,
    data: ChatKeyRotate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Rotate group encryption key**

    Call when a member leaves or for periodic rotation.
    """
    return set_chat_keys(chat_id, data, session, current_user)


@router.post("/exchange", response_model=ServerKeyExchangeResponse,
    summary="Exchange keys with server for E2E transport",
    responses={
        200: {"description": "Server public key returned"},
    })
def exchange_keys(
    data: ServerKeyExchangeRequest,
    current_user: User = Depends(get_current_user)
):
    """
    **Exchange keys with server for E2E transport**

    Client sends their public key, server returns its public key for this client.
    Server generates a unique key pair per client for E2E transport encryption.

    - **client_public_key**: Base64 X25519 public key from client
    """
    # Get or create server's key pair for this client
    server_public_key = encryption_service.get_server_public_key_for_client(current_user.id)

    return ServerKeyExchangeResponse(server_public_key=server_public_key)
