from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlmodel import Session, select
from datetime import datetime
from app.database import get_session
from app.models.user import User
from app.models.chat import Chat, ChatMember, ChatType, MemberRole
from app.models.message import Message
from app.schemas.chat import (
    ChatCreate, ChatUpdate, ChatResponse, ChatListResponse,
    ChatMemberAdd, ChatMemberResponse, LastMessageResponse
)
from app.schemas.user import UserPublicResponse
from app.auth import get_current_user
from app.services.redis_service import redis_service

router = APIRouter(prefix="/api/chats", tags=["chats"])

CHAT_LIST_CACHE_TTL = 60  # 1 minute


def get_chat_response(chat: Chat, session: Session, current_user_id: str) -> ChatResponse:
    """Helper to build ChatResponse with members and unread count"""
    members_query = select(ChatMember).where(ChatMember.chat_id == chat.id)
    members = session.exec(members_query).all()

    member_responses = []
    for member in members:
        user = session.get(User, member.user_id)
        member_responses.append(ChatMemberResponse(
            user_id=member.user_id,
            role=member.role,
            joined_at=member.joined_at,
            user=UserPublicResponse.model_validate(user) if user else None
        ))

    # Calculate unread count based on last read message timestamp
    current_member = next((m for m in members if m.user_id == current_user_id), None)
    unread_count = 0
    if current_member and current_member.last_read_message_id:
        # Get the timestamp of last read message
        last_read_msg = session.get(Message, current_member.last_read_message_id)
        if last_read_msg:
            # Count messages after last read
            unread_query = select(Message).where(
                Message.chat_id == chat.id,
                Message.created_at > last_read_msg.created_at,
                Message.is_deleted == False
            )
            unread_count = len(session.exec(unread_query).all())
    elif current_member:
        # No messages read yet - count all messages not from current user
        unread_query = select(Message).where(
            Message.chat_id == chat.id,
            Message.is_deleted == False,
            Message.sender_id != current_user_id
        )
        unread_count = len(session.exec(unread_query).all())

    # Get last message
    last_message = None
    last_msg = session.exec(
        select(Message)
        .where(Message.chat_id == chat.id, Message.is_deleted == False)
        .order_by(Message.created_at.desc())
        .limit(1)
    ).first()
    if last_msg:
        last_message = LastMessageResponse(
            id=last_msg.id,
            content=last_msg.content,
            sender_id=last_msg.sender_id,
            created_at=last_msg.created_at
        )

    return ChatResponse(
        id=chat.id,
        type=chat.type,
        name=chat.name,
        avatar_url=chat.avatar_url,
        created_by=chat.created_by,
        created_at=chat.created_at,
        last_message_at=chat.last_message_at,
        members=member_responses,
        unread_count=unread_count,
        last_message=last_message
    )


@router.get("", response_model=ChatListResponse,
    summary="📋 List user's chats",
    responses={
        200: {"description": "Chats list returned"},
    })
async def list_chats(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get all chats for current user**

    Returns all chats the user is a member of, sorted by last message.
    Uses Redis cache for faster response.
    """
    cache_key = redis_service.user_chats_key(current_user.id)

    # Try cache first
    cached = await redis_service.get_json(cache_key)
    if cached:
        return ChatListResponse(chats=cached, total=len(cached))

    # Get chat IDs user is member of
    member_query = select(ChatMember.chat_id).where(ChatMember.user_id == current_user.id)
    chat_ids = session.exec(member_query).all()

    if not chat_ids:
        return ChatListResponse(chats=[], total=0)

    # Get chats ordered by last_message_at
    chats_query = select(Chat).where(Chat.id.in_(chat_ids)).order_by(Chat.last_message_at.desc())
    chats = session.exec(chats_query).all()

    chat_responses = [get_chat_response(chat, session, current_user.id) for chat in chats]

    # Cache the result
    cache_data = [c.model_dump(mode='json') for c in chat_responses]
    await redis_service.set(cache_key, cache_data, CHAT_LIST_CACHE_TTL)

    return ChatListResponse(chats=chat_responses, total=len(chat_responses))


@router.post("", response_model=ChatResponse, status_code=status.HTTP_201_CREATED,
    summary="➕ Create chat",
    responses={
        201: {"description": "Chat created"},
        400: {"description": "Invalid chat data"},
    })
async def create_chat(
    data: ChatCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Create a new chat**

    Create a direct or group chat.

    - **type**: "direct" or "group"
    - **name**: Chat name (required for groups)
    - **member_ids**: List of user IDs to add
    """
    # Validate members exist
    for user_id in data.member_ids:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"User {user_id} not found")

    # For direct chats, check if one already exists
    if data.type == ChatType.direct:
        if len(data.member_ids) != 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Direct chat requires exactly one other member")

        other_user_id = data.member_ids[0]

        # Check for existing direct chat
        existing_query = select(Chat).where(Chat.type == ChatType.direct)
        existing_chats = session.exec(existing_query).all()

        for existing_chat in existing_chats:
            members = session.exec(
                select(ChatMember.user_id).where(ChatMember.chat_id == existing_chat.id)
            ).all()
            if set(members) == {current_user.id, other_user_id}:
                return get_chat_response(existing_chat, session, current_user.id)

    # Create chat
    chat = Chat(
        type=data.type,
        name=data.name,
        created_by=current_user.id
    )
    session.add(chat)
    session.commit()
    session.refresh(chat)

    # Add creator as admin
    creator_member = ChatMember(
        chat_id=chat.id,
        user_id=current_user.id,
        role=MemberRole.admin
    )
    session.add(creator_member)

    # Add other members
    for user_id in data.member_ids:
        if user_id != current_user.id:
            member = ChatMember(
                chat_id=chat.id,
                user_id=user_id,
                role=MemberRole.member
            )
            session.add(member)

    session.commit()

    # Invalidate cache for all members
    all_member_ids = [current_user.id] + [uid for uid in data.member_ids if uid != current_user.id]
    await redis_service.invalidate_chat_for_members(all_member_ids)

    return get_chat_response(chat, session, current_user.id)


@router.get("/{chat_id}", response_model=ChatResponse,
    summary="📬 Get chat details",
    responses={
        200: {"description": "Chat details returned"},
        404: {"description": "Chat not found"},
        403: {"description": "Not a member of this chat"},
    })
def get_chat(
    chat_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get chat by ID**

    Returns chat details including members.
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    # Check membership
    member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
    ).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat")

    return get_chat_response(chat, session, current_user.id)


@router.put("/{chat_id}", response_model=ChatResponse,
    summary="✏️ Update chat",
    responses={
        200: {"description": "Chat updated"},
        404: {"description": "Chat not found"},
        403: {"description": "Not an admin of this chat"},
    })
def update_chat(
    chat_id: str,
    data: ChatUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Update chat details**

    Only group chats can be updated. Requires admin role.
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    # Check admin membership
    member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
    ).first()
    if not member or member.role != MemberRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if chat.type == ChatType.direct:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot update direct chat")

    if data.name is not None:
        chat.name = data.name

    session.add(chat)
    session.commit()
    session.refresh(chat)

    return get_chat_response(chat, session, current_user.id)


@router.delete("/{chat_id}", status_code=status.HTTP_204_NO_CONTENT,
    summary="🗑️ Delete/Leave chat",
    responses={
        204: {"description": "Chat left or deleted"},
        404: {"description": "Chat not found"},
    })
def delete_chat(
    chat_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Leave or delete chat**

    For direct chats: leaves the chat.
    For group chats: leaves the chat, or deletes if admin and last member.
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
    ).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this chat")

    # Remove member
    session.delete(member)
    session.commit()

    # Check if chat is empty
    remaining = session.exec(select(ChatMember).where(ChatMember.chat_id == chat_id)).all()
    if not remaining:
        # Delete all messages and the chat
        messages = session.exec(select(Message).where(Message.chat_id == chat_id)).all()
        for msg in messages:
            session.delete(msg)
        session.delete(chat)
        session.commit()


@router.get("/{chat_id}/members", response_model=list[ChatMemberResponse],
    summary="👥 Get chat members",
    responses={
        200: {"description": "Members list returned"},
    })
def get_members(
    chat_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Get chat members**

    Returns all members of a chat with their roles.
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    # Check membership
    user_member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
    ).first()
    if not user_member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat")

    members = session.exec(select(ChatMember).where(ChatMember.chat_id == chat_id)).all()

    result = []
    for member in members:
        user = session.get(User, member.user_id)
        result.append(ChatMemberResponse(
            user_id=member.user_id,
            role=member.role,
            joined_at=member.joined_at,
            user=UserPublicResponse.model_validate(user) if user else None
        ))

    return result


@router.post("/{chat_id}/members", response_model=list[ChatMemberResponse],
    summary="➕ Add members",
    responses={
        200: {"description": "Members added"},
        403: {"description": "Admin access required"},
    })
def add_members(
    chat_id: str,
    data: ChatMemberAdd,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Add members to group chat**

    Requires admin role. Only for group chats.
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    if chat.type == ChatType.direct:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot add members to direct chat")

    # Check admin
    admin_member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
    ).first()
    if not admin_member or admin_member.role != MemberRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    for user_id in data.user_ids:
        user = session.get(User, user_id)
        if not user:
            continue

        # Check if already member
        existing = session.exec(
            select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
        ).first()
        if existing:
            continue

        member = ChatMember(
            chat_id=chat_id,
            user_id=user_id,
            role=MemberRole.member
        )
        session.add(member)

    session.commit()

    # Return updated member list
    return get_members(chat_id, session, current_user)


@router.delete("/{chat_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT,
    summary="➖ Remove member",
    responses={
        204: {"description": "Member removed"},
        403: {"description": "Admin access required"},
    })
def remove_member(
    chat_id: str,
    user_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    **Remove member from group chat**

    Requires admin role. Cannot remove yourself (use leave instead).
    """
    chat = session.get(Chat, chat_id)
    if not chat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    if chat.type == ChatType.direct:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove members from direct chat")

    if user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use leave endpoint to leave chat")

    # Check admin
    admin_member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == current_user.id)
    ).first()
    if not admin_member or admin_member.role != MemberRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    member = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id)
    ).first()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")

    session.delete(member)
    session.commit()
