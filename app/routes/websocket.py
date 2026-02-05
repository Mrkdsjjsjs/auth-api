from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlmodel import Session
from app.database import get_session
from app.models.user import User
from app.auth import decode_token
from app.services.websocket import connection_manager
from datetime import datetime
import json

router = APIRouter(tags=["websocket"])


async def get_user_from_token(token: str, session: Session) -> User | None:
    """Validate token and get user for WebSocket"""
    user_id = decode_token(token, "access")
    if not user_id:
        return None
    return session.get(User, user_id)


@router.websocket("/ws/{access_token}")
async def websocket_endpoint(
    websocket: WebSocket,
    access_token: str
):
    """
    **WebSocket Real-time Connection**

    Connect with access token for real-time messaging.

    **Client -> Server Events:**
    - `send_message`: Send a message
    - `typing_start`: Start typing indicator
    - `typing_stop`: Stop typing indicator
    - `read_receipt`: Mark messages as read

    **Server -> Client Events:**
    - `new_message`: New message received
    - `message_edited`: Message was edited
    - `message_deleted`: Message was deleted
    - `typing_start`: User started typing
    - `typing_stop`: User stopped typing
    - `user_online`: User came online
    - `user_offline`: User went offline
    - `read_receipt`: Message read receipt
    """
    # Get database session
    from app.database import engine
    from sqlmodel import Session as SQLSession

    with SQLSession(engine) as session:
        user = await get_user_from_token(access_token, session)
        if not user:
            await websocket.close(code=4001, reason="Invalid token")
            return

        await connection_manager.connect(websocket, user.id)

        # Update user online status
        user.is_online = True
        user.last_seen = datetime.utcnow()
        session.add(user)
        session.commit()

        # Broadcast online status
        await connection_manager.broadcast_user_status(user.id, True)

        try:
            while True:
                data = await websocket.receive_text()
                try:
                    message = json.loads(data)
                    await handle_websocket_message(message, user.id, session)
                except json.JSONDecodeError:
                    await websocket.send_json({"error": "Invalid JSON"})

        except WebSocketDisconnect:
            connection_manager.disconnect(websocket, user.id)

            # Update offline status
            with SQLSession(engine) as session:
                user = session.get(User, user.id)
                if user:
                    user.is_online = False
                    user.last_seen = datetime.utcnow()
                    session.add(user)
                    session.commit()

            await connection_manager.broadcast_user_status(user.id, False)


async def handle_websocket_message(message: dict, user_id: str, session: Session):
    """Handle incoming WebSocket messages"""
    event_type = message.get("type")

    if event_type == "typing_start":
        chat_id = message.get("chat_id")
        if chat_id:
            await connection_manager.send_to_chat(
                chat_id,
                {
                    "type": "typing_start",
                    "user_id": user_id,
                    "chat_id": chat_id
                },
                exclude_user=user_id
            )

    elif event_type == "typing_stop":
        chat_id = message.get("chat_id")
        if chat_id:
            await connection_manager.send_to_chat(
                chat_id,
                {
                    "type": "typing_stop",
                    "user_id": user_id,
                    "chat_id": chat_id
                },
                exclude_user=user_id
            )

    elif event_type == "read_receipt":
        chat_id = message.get("chat_id")
        message_id = message.get("message_id")
        if chat_id and message_id:
            from app.models.chat import ChatMember
            from sqlmodel import select

            member = session.exec(
                select(ChatMember).where(
                    ChatMember.chat_id == chat_id,
                    ChatMember.user_id == user_id
                )
            ).first()

            if member:
                member.last_read_message_id = message_id
                session.add(member)
                session.commit()

                await connection_manager.send_to_chat(
                    chat_id,
                    {
                        "type": "read_receipt",
                        "user_id": user_id,
                        "message_id": message_id,
                        "chat_id": chat_id
                    },
                    exclude_user=user_id
                )
