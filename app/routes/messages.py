from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session, select
from datetime import datetime
from typing import Optional
from app.database import get_session
from app.models.user import User
from app.models.chat import Chat, ChatMember
from app.models.message import Message
from app.models.encryption import UserKey
from app.schemas.message import (
    MessageCreate, MessageUpdate, MessageResponse, MessageListResponse
)
from app.schemas.user import UserPublicResponse
from app.auth import get_current_user
from app.services.websocket import connection_manager
from app.services.encryption_service import encryption_service

router = APIRouter(tags=["messages"])


def get_user_public_key(user_id: str, session: Session) -> Optional[str]:
    """Get user's active public key for encryption"""
    user_key = session.exec(
        select(UserKey).where(
            UserKey.user_id == user_id,
            UserKey.key_type == "identity",
            UserKey.is_active == True
        )
    ).first()
    return user_key.public_key if user_key else None


def build_message_response(message: Message, session: Session, encrypt_for_user_id: Optional[str] = None) -> dict:
    """Build message response dict, optionally encrypting for recipient"""
    sender = session.get(User, message.sender_id)

    response = {
        "id": message.id,
        "chat_id": message.chat_id,
        "sender_id": message.sender_id,
        "content": message.content if not message.is_deleted else None,
        "message_type": message.message_type,
        "file_url": message.file_url if not message.is_deleted else None,
        "file_id": message.file_id,
        "reply_to_id": message.reply_to_id,
        "is_edited": message.is_edited,
        "is_deleted": message.is_deleted,
        "created_at": message.created_at.isoformat(),
        "sender": UserPublicResponse.model_validate(sender).model_dump(mode='json') if sender else None,
        "encrypted_content": None,
        "ephemeral_public_key": None,
        "encryption_version": 0,
    }

    # Encrypt for recipient if they have a public key
    if encrypt_for_user_id and not message.is_deleted and message.content:
        public_key = get_user_public_key(encrypt_for_user_id, session)
        if public_key:
            response = encryption_service.encrypt_message_response(response, public_key)

    return response


@router.get("/api/chats/{chat_id}/messages", response_model=MessageListResponse,
    summary="Get messages",
    responses={
        200: {"description": "Messages returned"},
        403: {"description": "Not a member of this chat"},
    })
def get_messages(
    chat_id: str,
    limit: int = Query(default=50, le=100),
    before: Optional[str] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Get chat messages with cursor pagination.
    Messages are encrypted for the requesting user.
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

    # Build query
    query = select(Message).where(Message.chat_id == chat_id)

    if before:
        cursor_msg = session.get(Message, before)
        if cursor_msg:
            query = query.where(Message.created_at < cursor_msg.created_at)

    query = query.order_by(Message.created_at.desc()).limit(limit + 1)
    messages = session.exec(query).all()

    has_more = len(messages) > limit
    if has_more:
        messages = messages[:limit]

    # Reverse to get chronological order
    messages = list(reversed(messages))

    # Build responses with encryption for current user
    message_responses = [
        build_message_response(msg, session, encrypt_for_user_id=current_user.id)
        for msg in messages
    ]

    return MessageListResponse(
        messages=message_responses,
        has_more=has_more,
        next_cursor=messages[0].id if messages and has_more else None
    )


@router.post("/api/chats/{chat_id}/messages", response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send message",
    responses={
        201: {"description": "Message sent"},
        403: {"description": "Not a member of this chat"},
    })
async def send_message(
    chat_id: str,
    data: MessageCreate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """
    Send a message to chat (plaintext).
    Server stores plaintext and encrypts when delivering to recipients.
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

    # Validate reply_to_id
    if data.reply_to_id:
        reply_msg = session.get(Message, data.reply_to_id)
        if not reply_msg or reply_msg.chat_id != chat_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reply message")

    # Get file URL if file_id provided
    file_url = None
    if data.file_id:
        from app.models.file import File
        file_record = session.get(File, data.file_id)
        if file_record:
            file_url = file_record.url

    # Store message as plaintext
    message = Message(
        chat_id=chat_id,
        sender_id=current_user.id,
        content=data.content,
        message_type=data.message_type,
        file_id=data.file_id,
        file_url=file_url,
        reply_to_id=data.reply_to_id,
    )
    session.add(message)

    # Update chat's last_message_at
    chat.last_message_at = datetime.utcnow()
    session.add(chat)

    session.commit()
    session.refresh(message)

    # Get all chat members for WebSocket broadcast
    members = session.exec(
        select(ChatMember).where(ChatMember.chat_id == chat_id)
    ).all()

    print(f"[WS] Broadcasting message {message.id} to {len(members)} members")

    # Send encrypted message to each member via WebSocket
    for chat_member in members:
        member_user_id = chat_member.user_id
        encrypted_response = build_message_response(message, session, encrypt_for_user_id=member_user_id)

        print(f"[WS] Sending to user {member_user_id}, encrypted: {encrypted_response.get('encryption_version', 0) > 0}")
        await connection_manager.send_to_user(
            member_user_id,
            {
                "type": "new_message",
                "message": encrypted_response
            }
        )

    # Return encrypted response for sender
    response = build_message_response(message, session, encrypt_for_user_id=current_user.id)
    return response


@router.put("/api/messages/{message_id}", response_model=MessageResponse,
    summary="Edit message",
    responses={
        200: {"description": "Message edited"},
        403: {"description": "Cannot edit this message"},
    })
async def edit_message(
    message_id: str,
    data: MessageUpdate,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """Edit a message. Can only edit your own text messages."""
    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    if message.sender_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit other's messages")

    if message.is_deleted:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot edit deleted message")

    message.content = data.content
    message.is_edited = True
    session.add(message)
    session.commit()
    session.refresh(message)

    # Broadcast edit to all chat members
    members = session.exec(
        select(ChatMember).where(ChatMember.chat_id == message.chat_id)
    ).all()

    for chat_member in members:
        encrypted_response = build_message_response(message, session, encrypt_for_user_id=chat_member.user_id)
        await connection_manager.send_to_user(
            chat_member.user_id,
            {
                "type": "message_edited",
                "message": encrypted_response
            }
        )

    response = build_message_response(message, session, encrypt_for_user_id=current_user.id)
    return response


@router.delete("/api/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete message",
    responses={
        204: {"description": "Message deleted"},
        403: {"description": "Cannot delete this message"},
    })
async def delete_message(
    message_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """Delete a message. Soft deletes the message. Only sender can delete."""
    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    if message.sender_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete other's messages")

    message.is_deleted = True
    message.content = None
    message.file_url = None
    session.add(message)
    session.commit()

    # Broadcast deletion
    await connection_manager.send_to_chat(
        message.chat_id,
        {
            "type": "message_deleted",
            "message_id": message_id,
            "chat_id": message.chat_id
        }
    )


@router.post("/api/messages/{message_id}/read", status_code=status.HTTP_204_NO_CONTENT,
    summary="Mark as read",
    responses={
        204: {"description": "Marked as read"},
    })
async def mark_read(
    message_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """Mark message as read. Updates the user's last read message in the chat."""
    message = session.get(Message, message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")

    member = session.exec(
        select(ChatMember).where(
            ChatMember.chat_id == message.chat_id,
            ChatMember.user_id == current_user.id
        )
    ).first()

    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat")

    member.last_read_message_id = message_id
    session.add(member)
    session.commit()

    # Broadcast read receipt
    await connection_manager.send_to_chat(
        message.chat_id,
        {
            "type": "read_receipt",
            "user_id": current_user.id,
            "message_id": message_id,
            "chat_id": message.chat_id
        },
        exclude_user=current_user.id
    )


@router.get("/api/messages/search", response_model=MessageListResponse,
    summary="Search messages",
    responses={
        200: {"description": "Search results returned"},
    })
def search_messages(
    q: str,
    chat_id: Optional[str] = None,
    limit: int = Query(default=50, le=100),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    """Search for messages across all chats or within a specific chat."""
    # Get user's chat IDs
    member_query = select(ChatMember.chat_id).where(ChatMember.user_id == current_user.id)
    user_chat_ids = session.exec(member_query).all()

    if not user_chat_ids:
        return MessageListResponse(messages=[], has_more=False)

    query = select(Message).where(
        Message.chat_id.in_(user_chat_ids),
        Message.is_deleted == False,
        Message.content.ilike(f"%{q}%")
    )

    if chat_id:
        if chat_id not in user_chat_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this chat")
        query = query.where(Message.chat_id == chat_id)

    query = query.order_by(Message.created_at.desc()).limit(limit)
    messages = session.exec(query).all()

    # Encrypt search results for current user
    message_responses = [
        build_message_response(msg, session, encrypt_for_user_id=current_user.id)
        for msg in messages
    ]

    return MessageListResponse(
        messages=message_responses,
        has_more=False
    )
