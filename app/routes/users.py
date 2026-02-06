from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel
from sqlmodel import Session, select, or_
from datetime import datetime
from app.database import get_session
from app.models.user import User
from app.schemas.user import UserResponse, UserUpdate, UserPublicResponse, UserSearchResponse
from app.auth import get_current_user
from app.services.file_service import FileService

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/search", response_model=UserSearchResponse,
    summary="🔍 Search users",
    responses={
        200: {"description": "Search results returned"},
    })
def search_users(
    q: str,
    limit: int = 20,
    offset: int = 0,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Search users by username or email**

    Search for users to start a conversation.
    Supports @username tag search for exact matching.

    - **q**: Search query (matches username or email). Use @username for exact username search.
    - **limit**: Max results (default 20)
    - **offset**: Pagination offset
    """
    # Check if searching by @username tag
    if q.startswith("@"):
        username_query = q[1:]  # Remove @ prefix
        if username_query:
            # Exact prefix match for @username search
            query = select(User).where(
                User.username.ilike(f"{username_query}%"),
                User.id != current_user.id
            ).offset(offset).limit(limit)

            users = session.exec(query).all()

            count_query = select(User).where(
                User.username.ilike(f"{username_query}%"),
                User.id != current_user.id
            )
            total = len(session.exec(count_query).all())
        else:
            users = []
            total = 0
    else:
        # Regular search across all fields
        search_pattern = f"%{q}%"
        query = select(User).where(
            or_(
                User.username.ilike(search_pattern),
                User.email.ilike(search_pattern),
                User.display_name.ilike(search_pattern)
            ),
            User.id != current_user.id
        ).offset(offset).limit(limit)

        users = session.exec(query).all()

        # Get total count
        count_query = select(User).where(
            or_(
                User.username.ilike(search_pattern),
                User.email.ilike(search_pattern),
                User.display_name.ilike(search_pattern)
            ),
            User.id != current_user.id
        )
        total = len(session.exec(count_query).all())

    return UserSearchResponse(
        users=[UserPublicResponse.model_validate(u) for u in users],
        total=total
    )


@router.get("/me", response_model=UserResponse,
    summary="👤 Get current user profile",
    responses={
        200: {"description": "User profile returned"},
    })
def get_me(current_user: User = Depends(get_current_user)):
    """
    **Get authenticated user's full profile**

    Returns the current user's complete profile information.
    """
    return current_user


@router.put("/me", response_model=UserResponse,
    summary="✏️ Update profile",
    responses={
        200: {"description": "Profile updated"},
        400: {"description": "Username already taken"},
    })
def update_me(
    data: UserUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Update user profile**

    Update username, display name, or bio.

    - **username**: Unique username (optional)
    - **display_name**: Display name (optional)
    - **bio**: User bio (optional)
    """
    if data.username:
        existing = session.exec(
            select(User).where(User.username == data.username, User.id != current_user.id)
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already taken")
        current_user.username = data.username

    if data.display_name is not None:
        current_user.display_name = data.display_name

    if data.bio is not None:
        current_user.bio = data.bio

    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.put("/me/avatar", response_model=UserResponse,
    summary="🖼️ Update avatar",
    responses={
        200: {"description": "Avatar updated"},
        400: {"description": "Invalid file type or video too long"},
    })
async def update_avatar(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Upload new avatar**

    Upload a new profile picture or video.

    - **file**: Image (jpg, png, gif, webp) or video (mp4, webm, mov)
    - Image max size: 10MB
    - Video max size: 20MB, max duration: 10 seconds
    """
    from app.services.file_service import VIDEO_AVATAR_MAX_DURATION
    from app.models.file import FileType
    from pathlib import Path

    file_service = FileService()

    # Check if it's a video
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    is_video = ext in {".mp4", ".webm", ".mov"}

    file_record = await file_service.upload_file(file, current_user.id, session)

    # If video, check duration
    if is_video:
        from app.services.file_service import UPLOAD_DIR
        video_path = UPLOAD_DIR / file_record.filename
        duration = file_service.get_video_duration(video_path)

        if duration is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not read video duration"
            )

        if duration > VIDEO_AVATAR_MAX_DURATION:
            # Delete the uploaded file
            video_path.unlink(missing_ok=True)
            session.delete(file_record)
            session.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Video must be {VIDEO_AVATAR_MAX_DURATION} seconds or less (yours is {duration:.1f}s)"
            )

    current_user.avatar_url = file_record.url
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


class EmojiAvatarRequest(BaseModel):
    emoji: str


@router.put("/me/avatar/emoji", response_model=UserResponse,
    summary="😀 Set emoji avatar",
    responses={
        200: {"description": "Emoji avatar set"},
    })
def set_emoji_avatar(
    data: EmojiAvatarRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """Set emoji as avatar"""
    current_user.avatar_url = f"emoji:{data.emoji}"
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.get("/{user_id}", response_model=UserPublicResponse,
    summary="👤 Get user by ID",
    responses={
        200: {"description": "User found"},
        404: {"description": "User not found"},
    })
def get_user(
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get public profile of a user**

    Returns public profile information for a specific user.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
