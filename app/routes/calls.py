"""
Calls API - REST endpoints for call signaling + ICE servers
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.auth import get_current_user
from app.models.user import User
from app.services.call_service import call_service
from app.services.websocket import connection_manager
from app.database import get_session
from sqlmodel import Session, select
from app.models.chat import ChatMember

router = APIRouter(prefix="/api", tags=["calls"])


# ============== Request Models ==============

class CallInitiateRequest(BaseModel):
    chat_id: str
    callee_id: str

class CallRejectRequest(BaseModel):
    reason: Optional[str] = "rejected"

class CallSdpRequest(BaseModel):
    sdp: dict

class CallIceCandidateRequest(BaseModel):
    candidate: Optional[dict] = None

class CallMuteRequest(BaseModel):
    is_muted: bool

class CallScreenShareRequest(BaseModel):
    is_sharing: bool


# ============== Helpers ==============

def get_call_or_404(call_id: str):
    call = call_service.get_call(call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    return call

def verify_call_participant(call, user_id: str):
    if call.caller_id != user_id and call.callee_id != user_id:
        raise HTTPException(status_code=403, detail="Not a participant of this call")

def get_other_user(call, user_id: str) -> str:
    return call.callee_id if call.caller_id == user_id else call.caller_id


# ============== ICE Servers ==============

@router.get("/ice-servers")
async def get_ice_servers(current_user: User = Depends(get_current_user)):
    ice_servers = call_service.get_ice_servers(current_user.id)
    return {"ice_servers": ice_servers}


# ============== Call Signaling Endpoints ==============

@router.post("/calls/initiate")
async def initiate_call(
    body: CallInitiateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    user_id = current_user.id

    # Verify user is member of the chat
    member = session.exec(
        select(ChatMember).where(
            ChatMember.chat_id == body.chat_id,
            ChatMember.user_id == user_id
        )
    ).first()
    if not member:
        raise HTTPException(status_code=403, detail="Not a member of this chat")

    # Check if callee is online
    if not connection_manager.is_user_online(body.callee_id):
        raise HTTPException(status_code=409, detail="User is offline")

    # Get caller info
    caller_name = current_user.display_name or current_user.username or "Unknown"
    caller_avatar = current_user.avatar_url

    try:
        call = call_service.create_call(
            chat_id=body.chat_id,
            caller_id=user_id,
            callee_id=body.callee_id,
            caller_name=caller_name,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Notify callee about incoming call via WS
    await connection_manager.send_to_user(body.callee_id, {
        "type": "call_incoming",
        "call_id": call.id,
        "caller_id": user_id,
        "caller_name": caller_name,
        "caller_avatar": caller_avatar,
        "chat_id": body.chat_id,
    })

    return {"call_id": call.id}


@router.post("/calls/{call_id}/accept")
async def accept_call(
    call_id: str,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    result = call_service.accept_call(call_id)
    if not result:
        raise HTTPException(status_code=409, detail="Call cannot be accepted")

    # Notify caller that call was accepted
    await connection_manager.send_to_user(call.caller_id, {
        "type": "call_accepted",
        "call_id": call_id,
    })

    # Notify other devices of callee to stop ringing
    await connection_manager.send_to_user(current_user.id, {
        "type": "call_accepted_on_other_device",
        "call_id": call_id,
    })

    return {"status": "accepted"}


@router.post("/calls/{call_id}/reject")
async def reject_call(
    call_id: str,
    body: CallRejectRequest = CallRejectRequest(),
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    # Notify caller that call was rejected
    await connection_manager.send_to_user(call.caller_id, {
        "type": "call_rejected",
        "call_id": call_id,
        "reason": body.reason,
    })

    call_service.end_call(call_id)
    return {"status": "rejected"}


@router.post("/calls/{call_id}/end")
async def end_call(
    call_id: str,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    other_user = get_other_user(call, current_user.id)

    # Notify the other user
    await connection_manager.send_to_user(other_user, {
        "type": "call_ended",
        "call_id": call_id,
        "ended_by": current_user.id,
    })

    call_service.end_call(call_id)
    return {"status": "ended"}


@router.post("/calls/{call_id}/offer")
async def send_offer(
    call_id: str,
    body: CallSdpRequest,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    other_user = get_other_user(call, current_user.id)

    await connection_manager.send_to_user(other_user, {
        "type": "call_offer",
        "call_id": call_id,
        "sdp": body.sdp,
    })

    return {"status": "sent"}


@router.post("/calls/{call_id}/answer")
async def send_answer(
    call_id: str,
    body: CallSdpRequest,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    other_user = get_other_user(call, current_user.id)

    await connection_manager.send_to_user(other_user, {
        "type": "call_answer",
        "call_id": call_id,
        "sdp": body.sdp,
    })

    return {"status": "sent"}


@router.post("/calls/{call_id}/ice-candidate")
async def send_ice_candidate(
    call_id: str,
    body: CallIceCandidateRequest,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    other_user = get_other_user(call, current_user.id)

    await connection_manager.send_to_user(other_user, {
        "type": "call_ice_candidate",
        "call_id": call_id,
        "candidate": body.candidate,
    })

    return {"status": "sent"}


@router.post("/calls/{call_id}/mute")
async def send_mute_status(
    call_id: str,
    body: CallMuteRequest,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    other_user = get_other_user(call, current_user.id)

    await connection_manager.send_to_user(other_user, {
        "type": "call_mute",
        "call_id": call_id,
        "user_id": current_user.id,
        "is_muted": body.is_muted,
    })

    return {"status": "sent"}


@router.post("/calls/{call_id}/screen-share")
async def send_screen_share_status(
    call_id: str,
    body: CallScreenShareRequest,
    current_user: User = Depends(get_current_user),
):
    call = get_call_or_404(call_id)
    verify_call_participant(call, current_user.id)

    other_user = get_other_user(call, current_user.id)

    await connection_manager.send_to_user(other_user, {
        "type": "call_screen_share",
        "call_id": call_id,
        "user_id": current_user.id,
        "is_sharing": body.is_sharing,
    })

    return {"status": "sent"}
