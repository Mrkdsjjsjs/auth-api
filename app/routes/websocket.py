from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlmodel import Session, select
from app.database import get_session
from app.models.user import User
from app.models.chat import ChatMember
from app.auth import decode_token
from app.services.websocket import connection_manager
from app.services.call_service import call_service
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
    """
    from app.database import engine
    from sqlmodel import Session as SQLSession
    import traceback

    print(f"[WS] New connection attempt...")

    try:
        # Accept the WebSocket connection FIRST
        await websocket.accept()
        print(f"[WS] Connection accepted")
    except Exception as e:
        print(f"[WS] Failed to accept connection: {e}")
        traceback.print_exc()
        return

    user_id = None
    try:
        with SQLSession(engine) as session:
            user = await get_user_from_token(access_token, session)
            if not user:
                print(f"[WS] Invalid token, closing")
                await websocket.close(code=4001, reason="Invalid token")
                return

            user_id = user.id
            print(f"[WS] User authenticated: {user_id[:8]}")

            await connection_manager.connect(websocket, user_id)

            # Update user online status
            user.is_online = True
            user.last_seen = datetime.utcnow()
            session.add(user)
            session.commit()

            # Broadcast online status
            await connection_manager.broadcast_user_status(user_id, True)

            try:
                while True:
                    data = await websocket.receive_text()
                    try:
                        message = json.loads(data)
                        await handle_websocket_message(message, user_id, session)
                    except json.JSONDecodeError:
                        await websocket.send_json({"error": "Invalid JSON"})

            except WebSocketDisconnect:
                print(f"[WS] User {user_id[:8]} disconnected")
                connection_manager.disconnect(websocket, user_id)

                with SQLSession(engine) as new_session:
                    db_user = new_session.get(User, user_id)
                    if db_user:
                        db_user.is_online = False
                        db_user.last_seen = datetime.utcnow()
                        new_session.add(db_user)
                        new_session.commit()

                await connection_manager.broadcast_user_status(user_id, False)

    except Exception as e:
        print(f"[WS] Error in websocket handler: {e}")
        traceback.print_exc()
        if user_id:
            connection_manager.disconnect(websocket, user_id)
        try:
            await websocket.close(code=1011, reason="Internal error")
        except:
            pass


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

    # ============== CALL EVENTS ==============

    elif event_type == "call_initiate":
        chat_id = message.get("chat_id")
        callee_id = message.get("callee_id")

        if not chat_id or not callee_id:
            return

        # Verify user is member of the chat
        member = session.exec(
            select(ChatMember).where(
                ChatMember.chat_id == chat_id,
                ChatMember.user_id == user_id
            )
        ).first()

        if not member:
            await connection_manager.send_to_user(user_id, {
                "type": "call_error",
                "error": "Not a member of this chat"
            })
            return

        # Get caller info
        caller = session.get(User, user_id)
        caller_name = caller.display_name or caller.username or "Unknown"
        caller_avatar = caller.avatar_url if caller else None

        try:
            call = call_service.create_call(
                chat_id=chat_id,
                caller_id=user_id,
                callee_id=callee_id,
                caller_name=caller_name
            )

            # Notify callee about incoming call
            await connection_manager.send_to_user(callee_id, {
                "type": "call_incoming",
                "call_id": call.id,
                "caller_id": user_id,
                "caller_name": caller_name,
                "caller_avatar": caller_avatar,
                "chat_id": chat_id
            })

            # Confirm to caller
            await connection_manager.send_to_user(user_id, {
                "type": "call_initiated",
                "call_id": call.id,
                "callee_id": callee_id
            })

        except ValueError as e:
            await connection_manager.send_to_user(user_id, {
                "type": "call_error",
                "error": str(e)
            })

    elif event_type == "call_accept":
        call_id = message.get("call_id")
        if not call_id:
            return

        call = call_service.accept_call(call_id)
        if call:
            # Notify caller that call was accepted
            await connection_manager.send_to_user(call.caller_id, {
                "type": "call_accepted",
                "call_id": call_id
            })

            # Notify other devices of callee to stop ringing
            await connection_manager.send_to_user(user_id, {
                "type": "call_accepted_on_other_device",
                "call_id": call_id
            })

    elif event_type == "call_reject":
        call_id = message.get("call_id")
        reason = message.get("reason", "rejected")
        if not call_id:
            return

        call = call_service.get_call(call_id)
        if call:
            # Notify caller that call was rejected
            await connection_manager.send_to_user(call.caller_id, {
                "type": "call_rejected",
                "call_id": call_id,
                "reason": reason
            })
            # End the call
            call_service.end_call(call_id)

    elif event_type == "call_end":
        call_id = message.get("call_id")
        if not call_id:
            return

        call = call_service.get_call(call_id)
        if call:
            other_user = call.callee_id if call.caller_id == user_id else call.caller_id
            # Notify the other user
            await connection_manager.send_to_user(other_user, {
                "type": "call_ended",
                "call_id": call_id,
                "ended_by": user_id
            })
            # End the call
            call_service.end_call(call_id)

    # ============== WebRTC SIGNALING ==============

    elif event_type == "call_offer":
        call_id = message.get("call_id")
        sdp = message.get("sdp")
        if not call_id or not sdp:
            return

        call = call_service.get_call(call_id)
        if call:
            # Forward offer to callee
            await connection_manager.send_to_user(call.callee_id, {
                "type": "call_offer",
                "call_id": call_id,
                "sdp": sdp
            })

    elif event_type == "call_answer":
        call_id = message.get("call_id")
        sdp = message.get("sdp")
        if not call_id or not sdp:
            return

        call = call_service.get_call(call_id)
        if call:
            # Forward answer to caller
            await connection_manager.send_to_user(call.caller_id, {
                "type": "call_answer",
                "call_id": call_id,
                "sdp": sdp
            })

    elif event_type == "call_ice_candidate":
        call_id = message.get("call_id")
        candidate = message.get("candidate")
        if not call_id:
            return

        call = call_service.get_call(call_id)
        if call:
            # Forward ICE candidate to the other user
            other_user = call.callee_id if call.caller_id == user_id else call.caller_id
            await connection_manager.send_to_user(other_user, {
                "type": "call_ice_candidate",
                "call_id": call_id,
                "candidate": candidate
            })

    # ============== CALL STATE EVENTS ==============

    elif event_type == "call_mute":
        call_id = message.get("call_id")
        is_muted = message.get("is_muted", False)
        if not call_id:
            return

        call = call_service.get_call(call_id)
        if call:
            other_user = call.callee_id if call.caller_id == user_id else call.caller_id
            await connection_manager.send_to_user(other_user, {
                "type": "call_mute",
                "call_id": call_id,
                "user_id": user_id,
                "is_muted": is_muted
            })

    elif event_type == "call_screen_share":
        call_id = message.get("call_id")
        is_sharing = message.get("is_sharing", False)
        if not call_id:
            return

        call = call_service.get_call(call_id)
        if call:
            other_user = call.callee_id if call.caller_id == user_id else call.caller_id
            await connection_manager.send_to_user(other_user, {
                "type": "call_screen_share",
                "call_id": call_id,
                "user_id": user_id,
                "is_sharing": is_sharing
            })
